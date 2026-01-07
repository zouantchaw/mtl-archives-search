import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/missing_images.jsonl',
);
const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest.jsonl');
const DEFAULT_OUTPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/manifest_missing.jsonl',
);
const DEFAULT_EXTENDED = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/manifest_extended.jsonl',
);
const DEFAULT_SUMMARY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/manifest_missing_summary.json',
);
const DEFAULT_ERRORS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/manifest_missing_errors.jsonl',
);

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_DELAY_MS = 150;

type MissingRecord = {
  dataset: string;
  primary_external_url: string;
  primary_file_url_key: string;
  external_urls: string[];
  record: Record<string, unknown>;
};

function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.trim();
}

async function extractMaxIndex(manifestPath: string): Promise<number> {
  let max = -1;
  if (!fs.existsSync(manifestPath)) return max;
  const stream = fs.createReadStream(manifestPath, { encoding: 'utf-8' });
  return new Promise<number>((resolve, reject) => {
    import('readline')
      .then(readline => {
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', line => {
          if (!line.trim()) return;
          const record = JSON.parse(line);
          const filename = String(record.metadata_filename || '');
          const match = filename.match(/_metadata_(\d+)\.json$/);
          if (match) {
            const value = Number(match[1]);
            if (!Number.isNaN(value) && value > max) max = value;
          }
        });
        rl.on('close', () => resolve(max));
      })
      .catch(reject);
  });
}

function buildAttributes(dataset: string, record: Record<string, unknown>) {
  const attributes: { trait_type: string; value: unknown }[] = [];
  const pushIf = (trait_type: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      attributes.push({ trait_type, value });
    }
  };

  if (dataset === 'phototheque_archives') {
    pushIf('Date', record['Date']);
    pushIf('Cote', record['Cote']);
    pushIf('Credits', record['Mention de crédits']);
    return attributes;
  }

  if (dataset === 'aerial_1925_1935') {
    pushIf('Date', record['Date']);
    pushIf('Credits', record['Mention de crédits']);
    return attributes;
  }

  if (dataset === 'aerial_obliques_1960_1992') {
    pushIf('Date', record['Titre / Photographe / Dates']);
    pushIf('Cote', record['Cote (reportage)']);
    pushIf('Credits', record['Mention de crédits']);
    return attributes;
  }

  // Other aerial datasets use Cote/Titre + Dates + credits.
  pushIf('Date', record['Dates'] ?? record['Date']);
  pushIf('Credits', record['Mention de crédits']);
  return attributes;
}

function buildName(dataset: string, record: Record<string, unknown>): string {
  if (dataset === 'phototheque_archives') {
    return String(record['Titre'] || '');
  }
  if (dataset === 'aerial_1925_1935') {
    return String(record['Titre'] || '');
  }
  if (dataset === 'aerial_obliques_1960_1992') {
    return String(record['Titre / Photographe / Dates'] || '');
  }
  return String(record['Cote/Titre'] || record['Titre'] || record['Cote'] || '');
}

function buildDescription(dataset: string, record: Record<string, unknown>): string {
  if (dataset === 'phototheque_archives') {
    return String(record['Description'] || '');
  }
  if (dataset === 'aerial_1925_1935') {
    return String(record['Éléments notables'] || '');
  }
  if (dataset === 'aerial_obliques_1960_1992') {
    return String(record['Description'] || '');
  }
  return '';
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  let index = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = index;
      if (current >= items.length) break;
      index += 1;
      await fn(items[current], current);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      extended: { type: 'string', default: DEFAULT_EXTENDED },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
      errors: { type: 'string', default: DEFAULT_ERRORS },
      bucket: { type: 'string' },
      account: { type: 'string' },
      'access-key': { type: 'string' },
      'secret-key': { type: 'string' },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      delay: { type: 'string', default: String(DEFAULT_DELAY_MS) },
      limit: { type: 'string' },
      offset: { type: 'string' },
      'skip-extended': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const inputPath = values.input!;
  const manifestPath = values.manifest!;
  const outputPath = values.output!;
  const extendedPath = values.extended!;
  const summaryPath = values.summary!;
  const errorPath = values.errors!;
  const concurrency = Math.max(1, Number(values.concurrency || DEFAULT_CONCURRENCY));
  const delayMs = Math.max(0, Number(values.delay || DEFAULT_DELAY_MS));
  const limit = values.limit ? Math.max(0, Number(values.limit)) : null;
  const offset = values.offset ? Math.max(0, Number(values.offset)) : 0;
  const skipExtended = values['skip-extended'] || false;
  const dryRun = values['dry-run'] || false;

  if (!fs.existsSync(inputPath)) {
    console.error(`Missing list not found: ${inputPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const reportsDir = path.dirname(summaryPath);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const accessKey =
    values['access-key'] || process.env.CLOUDFLARE_R2_ACCESS_KEY || process.env.CLOUDFLARE_ACCESS_KEY;
  const secretKey =
    values['secret-key'] ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
  const accountId = values.account || process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = values.bucket || process.env.CLOUDFLARE_R2_BUCKET;

  if (!dryRun && (!accessKey || !secretKey || !accountId || !bucket)) {
    console.error('Missing R2 credentials (access key, secret key, account id, bucket).');
    process.exit(1);
  }

  const s3Client = !dryRun
    ? new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKey!,
        secretAccessKey: secretKey!,
      },
    })
    : null;

  const missing: MissingRecord[] = [];
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const readline = await import('readline');
  const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
  let idx = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (idx < offset) {
      idx += 1;
      continue;
    }
    if (limit !== null && missing.length >= limit) break;
    missing.push(JSON.parse(line));
    idx += 1;
  }

  if (!missing.length) {
    console.log('No missing records to process.');
    return;
  }

  const maxIndex = await extractMaxIndex(manifestPath);
  let nextIndex = Number.isFinite(maxIndex) ? maxIndex + 1 : 0;

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    manifest_path: manifestPath,
    output_path: outputPath,
    extended_path: skipExtended ? null : extendedPath,
    total_missing: missing.length,
    processed: 0,
    uploaded: 0,
    failed: 0,
    bytes_uploaded: 0,
    dry_run: dryRun,
  };

  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  const errorStream = fs.createWriteStream(errorPath, { encoding: 'utf-8' });

  await runWithConcurrency(missing, concurrency, async (item, index) => {
    const recordIndex = nextIndex + index;
    const key = `mtl_archives_image_${recordIndex}.jpg`;
    const metadataFilename = `mtl_archives_metadata_${recordIndex}.json`;
    const externalUrl = normalizeUrl(item.primary_external_url);

    try {
      let imageBuffer: Buffer | null = null;
      if (!dryRun) {
        const response = await fetch(externalUrl);
        if (!response.ok) {
          throw new Error(`Fetch failed (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);
        imageBuffer = await sharp(inputBuffer).jpeg().toBuffer();

        await s3Client!.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: imageBuffer,
            ContentType: 'image/jpeg',
          }),
        );
      }

      const manifestRecord = {
        metadata_filename: metadataFilename,
        image_filename: key,
        resolved_image_filename: key,
        image_exists: !dryRun,
        image_size_bytes: imageBuffer ? imageBuffer.length : 0,
        name: buildName(item.dataset, item.record),
        description: buildDescription(item.dataset, item.record),
        attributes: buildAttributes(item.dataset, item.record),
        external_url: externalUrl,
        portal_match: false,
        portal_record: null,
      };

      outputStream.write(`${JSON.stringify(manifestRecord)}\n`);
      summary.processed += 1;
      if (!dryRun) {
        summary.uploaded += 1;
        summary.bytes_uploaded += imageBuffer ? imageBuffer.length : 0;
      }

      if (delayMs > 0) await sleep(delayMs);
    } catch (error) {
      summary.processed += 1;
      summary.failed += 1;
      errorStream.write(
        `${JSON.stringify({
          dataset: item.dataset,
          external_url: externalUrl,
          error: String(error),
        })}\n`,
      );
    }
  });

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote missing manifest to ${outputPath}`);
  console.log(`Wrote summary to ${summaryPath}`);

  if (!skipExtended) {
    const extendedStream = fs.createWriteStream(extendedPath, { encoding: 'utf-8' });
    const existingStream = fs.createReadStream(manifestPath, { encoding: 'utf-8' });
    await new Promise<void>((resolve, reject) => {
      existingStream.pipe(extendedStream, { end: false });
      existingStream.on('error', reject);
      existingStream.on('end', resolve);
    });

    const missingStream = fs.createReadStream(outputPath, { encoding: 'utf-8' });
    await new Promise<void>((resolve, reject) => {
      missingStream.pipe(extendedStream);
      missingStream.on('error', reject);
      missingStream.on('end', resolve);
    });
    console.log(`Wrote extended manifest to ${extendedPath}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
