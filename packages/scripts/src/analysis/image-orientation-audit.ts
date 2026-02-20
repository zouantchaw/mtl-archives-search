import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_orientation_audit.json');
const DEFAULT_DECISIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_orientation_decisions.jsonl');

type AuditDecision = {
  metadataFilename: string;
  imageKey: string;
  imageUrl: string;
  sourceOrientation: number | null;
  width: number | null;
  height: number | null;
  recommendedRotationDegrees: number | null;
  confidence: number;
  reason: string;
};

function fail(message: string): never {
  console.error(`[image-orientation:audit] FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    if (inline !== undefined) {
      args.set(key, inline);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }
    args.set(key, next);
    i += 1;
  }
  return args;
}

function parseLimit(value: string | boolean | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function cleanText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function imageUrlFromRecord(record: any, r2Domain: string | null): string | null {
  const directUrl = cleanText(record.imageUrl || record.image_url);
  if (directUrl) return directUrl;

  const imageKey = cleanText(record.resolved_image_filename || record.image_filename);
  if (!imageKey || !r2Domain) return null;
  return `https://${r2Domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(imageKey)}`;
}

function metadataFilenameFromRecord(record: any): string {
  const raw = cleanText(record.metadata_filename || record.metadataFilename);
  return raw || '';
}

function imageKeyFromRecord(record: any): string {
  return cleanText(record.resolved_image_filename || record.image_filename || record.imageFilename || record.resolvedImageFilename);
}

async function* readJsonl(inputPath: string): AsyncGenerator<any> {
  const stream = fs.createReadStream(inputPath);
  const source = inputPath.endsWith('.gz') ? stream.pipe(createGunzip()) : stream;
  const rl = readline.createInterface({ input: source, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed);
    } catch (error) {
      console.warn('[image-orientation:audit] skipping malformed line', error);
    }
  }
}

function toRotationFromExifOrientation(value: number | null): number | null {
  if (value === 6) return 90;
  if (value === 3) return 180;
  if (value === 8) return 270;
  return null;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

async function writePreviewSheet(
  sourceBuffer: Buffer,
  outPath: string,
  labelPrefix: string,
): Promise<void> {
  const tileSize = 360;
  const gap = 16;
  const width = tileSize * 2 + gap * 3;
  const height = tileSize * 2 + gap * 3 + 40;
  const rotations = [0, 90, 180, 270];

  const tiles = await Promise.all(rotations.map(async (rotation) => {
    return sharp(sourceBuffer, { failOn: 'none' })
      .rotate(rotation)
      .resize(tileSize, tileSize, { fit: 'contain', background: { r: 242, g: 242, b: 242, alpha: 1 } })
      .jpeg({ quality: 85 })
      .toBuffer();
  }));

  const composites = tiles.map((input, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    return {
      input,
      left: gap + col * (tileSize + gap),
      top: 40 + gap + row * (tileSize + gap),
    };
  });

  const labelsSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
      <text x="${gap}" y="26" fill="#111111" font-family="Arial" font-size="18" font-weight="700">${labelPrefix}</text>
      <text x="${gap + 8}" y="${40 + gap - 6}" fill="#444444" font-family="Arial" font-size="14">0°</text>
      <text x="${gap * 2 + tileSize + 8}" y="${40 + gap - 6}" fill="#444444" font-family="Arial" font-size="14">90°</text>
      <text x="${gap + 8}" y="${40 + gap * 2 + tileSize - 6}" fill="#444444" font-family="Arial" font-size="14">180°</text>
      <text x="${gap * 2 + tileSize + 8}" y="${40 + gap * 2 + tileSize - 6}" fill="#444444" font-family="Arial" font-size="14">270°</text>
    </svg>
  `;

  await sharp(Buffer.from(labelsSvg))
    .composite(composites)
    .png()
    .toFile(outPath);
}

function buildUpdateSql(decisions: AuditDecision[]): string {
  const lines: string[] = ['-- Generated by image-orientation-audit', 'BEGIN TRANSACTION;'];
  for (const decision of decisions) {
    if (decision.recommendedRotationDegrees == null || decision.confidence < 0.95) continue;
    lines.push(
      `UPDATE manifest SET rotation_degrees=${decision.recommendedRotationDegrees} WHERE metadata_filename='${decision.metadataFilename.replace(/'/g, "''")}';`
    );
  }
  lines.push('COMMIT;');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(String(args.get('input') || DEFAULT_INPUT));
  const reportPath = path.resolve(String(args.get('report') || DEFAULT_REPORT));
  const decisionsPath = path.resolve(String(args.get('decisions') || DEFAULT_DECISIONS));
  const limit = parseLimit(args.get('limit'));
  const r2DomainRaw = cleanText(args.get('r2-domain'));
  const r2Domain = r2DomainRaw || cleanText(process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN) || null;
  const previewDirArg = cleanText(args.get('write-preview-dir'));
  const previewDir = previewDirArg ? path.resolve(previewDirArg) : null;
  const sqlPathArg = cleanText(args.get('write-sql'));
  const sqlPath = sqlPathArg ? path.resolve(sqlPathArg) : null;
  const overridesPathArg = cleanText(args.get('write-overrides'));
  const overridesPath = overridesPathArg ? path.resolve(overridesPathArg) : null;

  if (!fs.existsSync(inputPath)) fail(`Input file not found: ${inputPath}`);
  ensureDirForFile(reportPath);
  ensureDirForFile(decisionsPath);
  if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
  if (sqlPath) ensureDirForFile(sqlPath);
  if (overridesPath) ensureDirForFile(overridesPath);

  const out = fs.createWriteStream(decisionsPath, { encoding: 'utf8' });
  const decisions: AuditDecision[] = [];

  let scanned = 0;
  let processed = 0;
  let skipped = 0;
  let failures = 0;
  let recommended = 0;

  for await (const record of readJsonl(inputPath)) {
    if (limit && scanned >= limit) break;
    scanned += 1;

    const metadataFilename = metadataFilenameFromRecord(record);
    const imageKey = imageKeyFromRecord(record);
    const imageUrl = imageUrlFromRecord(record, r2Domain);
    if (!metadataFilename || !imageKey || !imageUrl) {
      skipped += 1;
      continue;
    }

    try {
      const response = await fetch(imageUrl, { headers: { accept: 'image/*' } });
      if (!response.ok) {
        failures += 1;
        continue;
      }
      const sourceBuffer = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(sourceBuffer, { failOn: 'none' }).metadata();
      const sourceOrientation = meta.orientation ?? null;
      const suggested = toRotationFromExifOrientation(sourceOrientation);
      const decision: AuditDecision = {
        metadataFilename,
        imageKey,
        imageUrl,
        sourceOrientation,
        width: meta.width ?? null,
        height: meta.height ?? null,
        recommendedRotationDegrees: suggested,
        confidence: suggested == null ? 0 : 0.98,
        reason: suggested == null
          ? 'no_exif_orientation_hint; manual_review_needed'
          : `exif_orientation_${sourceOrientation}`,
      };

      if (previewDir) {
        const previewName = sanitizeFilename(metadataFilename.replace(/\.json$/i, ''));
        await writePreviewSheet(sourceBuffer, path.join(previewDir, `${previewName}.png`), metadataFilename);
      }

      out.write(`${JSON.stringify(decision)}\n`);
      decisions.push(decision);
      processed += 1;
      if (suggested != null) recommended += 1;
    } catch {
      failures += 1;
    }
  }

  out.end();

  if (sqlPath) {
    fs.writeFileSync(sqlPath, buildUpdateSql(decisions), 'utf8');
  }

  if (overridesPath) {
    const overrides: Record<string, number> = {};
    for (const decision of decisions) {
      if (decision.recommendedRotationDegrees == null || decision.confidence < 0.95) continue;
      overrides[decision.metadataFilename.replace(/\.json$/i, '')] = decision.recommendedRotationDegrees;
    }
    fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), 'utf8');
  }

  const summary = {
    inputPath,
    decisionsPath,
    scanned,
    processed,
    skipped,
    failures,
    recommended,
    previewDir,
    sqlPath,
    overridesPath,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[image-orientation:audit] scanned=${scanned}`);
  console.log(`[image-orientation:audit] processed=${processed}, skipped=${skipped}, failures=${failures}`);
  console.log(`[image-orientation:audit] recommendations=${recommended}`);
  console.log(`[image-orientation:audit] report=${reportPath}`);
  console.log(`[image-orientation:audit] decisions=${decisionsPath}`);
  if (previewDir) console.log(`[image-orientation:audit] previews=${previewDir}`);
  if (sqlPath) console.log(`[image-orientation:audit] sql=${sqlPath}`);
  if (overridesPath) console.log(`[image-orientation:audit] overrides=${overridesPath}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

