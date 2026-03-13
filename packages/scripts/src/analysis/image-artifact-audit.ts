import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import sharp from 'sharp';

type Candidate = {
  id: string;
  imageKey: string;
  imageUrl: string;
  name?: string;
  dateValue?: string;
};

type EdgeStats = {
  mean: number;
  std: number;
  darkFrac: number;
  whiteFrac: number;
};

type Decision = {
  id: string;
  imageUrl: string;
  imageKey: string;
  sourceSize: { width: number; height: number };
  crop?: { left: number; top: number; width: number; height: number };
  masks: Array<{ x: number; y: number; width: number; height: number; kind: 'header' | 'footer' }>;
  actions: string[];
  metrics: {
    cropAreaRatio: number;
    borderPx: { top: number; bottom: number; left: number; right: number };
    headerRows: number;
    footerRows: number;
  };
  warning?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_artifact_audit.json');
const DEFAULT_DECISIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_artifact_decisions.ndjson');
const DEFAULT_FLAGGED = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_artifact_flagged_samples.ndjson');

function fail(message: string): never {
  console.error(`[image-artifacts:audit] FAIL: ${message}`);
  process.exit(1);
}

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function resolveCliPath(input: string, options?: { mustExist?: boolean }) {
  const mustExist = options?.mustExist ?? false;
  if (path.isAbsolute(input)) {
    return input;
  }

  const isDataPath = input === 'data' || input.startsWith('data/');
  if (isDataPath) {
    return path.resolve(MONOREPO_ROOT, input);
  }

  const cwdPath = path.resolve(process.cwd(), input);
  if (!mustExist || fs.existsSync(cwdPath)) {
    return cwdPath;
  }

  return path.resolve(MONOREPO_ROOT, input);
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveImageUrl(record: any, publicDomain?: string): string | null {
  const externalUrl = cleanText(record.external_url);
  if (externalUrl) return externalUrl;

  const imageKey = cleanText(record.resolved_image_filename || record.image_filename);
  if (!imageKey) return null;

  if (publicDomain) {
    return `https://${publicDomain}/${imageKey.replace(/^\/+/, '')}`;
  }

  return null;
}

function openManifestStream(inputPath: string) {
  const stream = fs.createReadStream(inputPath);
  if (inputPath.endsWith('.gz')) {
    return stream.pipe(zlib.createGunzip());
  }
  return stream;
}

async function* readJsonl(inputPath: string): AsyncGenerator<any> {
  const stream = openManifestStream(inputPath);
  const readline = await import('readline');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

async function readImageBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  if (url.startsWith('file://')) {
    const filePath = decodeURIComponent(url.slice('file://'.length));
    return fs.readFileSync(filePath);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

function computeRowStats(data: Uint8Array, width: number, row: number): EdgeStats {
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let white = 0;

  const offset = row * width;
  for (let x = 0; x < width; x += 1) {
    const v = data[offset + x];
    sum += v;
    sumSq += v * v;
    if (v < 24) dark += 1;
    if (v > 232) white += 1;
  }

  const n = width;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    mean,
    std: Math.sqrt(variance),
    darkFrac: dark / n,
    whiteFrac: white / n,
  };
}

function computeColStats(data: Uint8Array, width: number, height: number, col: number): EdgeStats {
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let white = 0;

  for (let y = 0; y < height; y += 1) {
    const v = data[y * width + col];
    sum += v;
    sumSq += v * v;
    if (v < 24) dark += 1;
    if (v > 232) white += 1;
  }

  const n = height;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    mean,
    std: Math.sqrt(variance),
    darkFrac: dark / n,
    whiteFrac: white / n,
  };
}

function isBorderLike(stats: EdgeStats): boolean {
  const extreme = stats.mean < 20 || stats.mean > 236;
  const mostlyExtreme = stats.darkFrac > 0.98 || stats.whiteFrac > 0.98;
  return (extreme && stats.std < 10) || (mostlyExtreme && stats.std < 16);
}

function detectEdgeBorderRows(
  data: Uint8Array,
  width: number,
  height: number,
  maxRows: number,
  fromTop: boolean,
) {
  let border = 0;
  for (let i = 0; i < maxRows; i += 1) {
    const row = fromTop ? i : height - 1 - i;
    const stats = computeRowStats(data, width, row);
    if (!isBorderLike(stats)) break;
    border += 1;
  }
  return border;
}

function detectEdgeBorderCols(
  data: Uint8Array,
  width: number,
  height: number,
  maxCols: number,
  fromLeft: boolean,
) {
  let border = 0;
  for (let i = 0; i < maxCols; i += 1) {
    const col = fromLeft ? i : width - 1 - i;
    const stats = computeColStats(data, width, height, col);
    if (!isBorderLike(stats)) break;
    border += 1;
  }
  return border;
}

function detectTemplateBandRows(
  data: Uint8Array,
  width: number,
  height: number,
  fromTop: boolean,
  borderRows: number,
) {
  const maxScan = Math.floor(height * 0.16);
  const minBand = Math.max(4, Math.floor(height * 0.01));
  const maxBand = Math.max(minBand + 1, Math.floor(height * 0.12));

  let band = 0;
  for (let i = borderRows; i < maxScan; i += 1) {
    const row = fromTop ? i : height - 1 - i;
    const stats = computeRowStats(data, width, row);

    const looksLikeTextOnPaper =
      stats.whiteFrac > 0.82 &&
      stats.darkFrac > 0.005 &&
      stats.darkFrac < 0.22 &&
      stats.std > 7 &&
      stats.std < 70;

    if (!looksLikeTextOnPaper) break;
    band += 1;
  }

  if (band < minBand || band > maxBand) return 0;
  return band;
}

function scaleValue(value: number, from: number, to: number) {
  return Math.round((value / from) * to);
}

function chooseCanonical(members: Decision[]) {
  return [...members].sort((a, b) => {
    const areaA = a.sourceSize.width * a.sourceSize.height;
    const areaB = b.sourceSize.width * b.sourceSize.height;
    if (areaA !== areaB) return areaB - areaA;
    return a.id.localeCompare(b.id);
  })[0];
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => next());
  await Promise.all(workers);
  return results;
}

function applyDecisionPreview(buffer: Buffer, decision: Decision) {
  let pipeline = sharp(buffer);

  if (decision.crop) {
    pipeline = pipeline.extract(decision.crop);
  }

  if (decision.masks.length > 0) {
    const overlays = decision.masks.map((mask) => ({
      input: Buffer.from(`<svg width="${mask.width}" height="${mask.height}"><rect width="100%" height="100%" fill="white"/></svg>`),
      top: mask.y,
      left: mask.x,
    }));
    pipeline = pipeline.composite(overlays);
  }

  return pipeline.jpeg({ quality: 80 }).toBuffer();
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      report: { type: 'string', default: DEFAULT_REPORT },
      decisions: { type: 'string', default: DEFAULT_DECISIONS },
      flagged: { type: 'string', default: DEFAULT_FLAGGED },
      limit: { type: 'string', default: '0' },
      concurrency: { type: 'string', default: '4' },
      'fetch-timeout-ms': { type: 'string', default: '20000' },
      'min-keep-area-ratio': { type: 'string', default: '0.72' },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '' },
      'write-cleaned-dir': { type: 'string' },
    },
  });

  const inputPath = resolveCliPath(values.input!, { mustExist: true });
  const reportPath = resolveCliPath(values.report!);
  const decisionsPath = resolveCliPath(values.decisions!);
  const flaggedPath = resolveCliPath(values.flagged!);
  const limit = Number(values.limit || '0');
  const concurrency = Number(values.concurrency || '4');
  const fetchTimeoutMs = Number(values['fetch-timeout-ms'] || '20000');
  const minKeepAreaRatio = Number(values['min-keep-area-ratio'] || '0.72');
  const publicDomain = cleanText(values['public-domain']);
  const cleanedDir = values['write-cleaned-dir'] ? resolveCliPath(values['write-cleaned-dir']) : null;

  if (!fs.existsSync(inputPath)) {
    fail(`Input file not found: ${inputPath}`);
  }

  const candidates: Candidate[] = [];
  let scanned = 0;
  let skippedNoImage = 0;

  for await (const record of readJsonl(inputPath)) {
    if (limit > 0 && scanned >= limit) break;
    scanned += 1;

    const imageUrl = resolveImageUrl(record, publicDomain);
    if (!imageUrl) {
      skippedNoImage += 1;
      continue;
    }

    candidates.push({
      id: cleanText(record.metadata_filename),
      imageKey: cleanText(record.resolved_image_filename || record.image_filename),
      imageUrl,
      name: cleanText(record.name) || undefined,
      dateValue: cleanText(record.date_value || record.attributes_map?.Date || record.portal_record?.Date) || undefined,
    });
  }

  const fetchFailures: Array<{ id: string; imageUrl: string; error: string }> = [];

  const decisionsMaybe = await runWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const originalBuffer = await readImageBuffer(candidate.imageUrl, fetchTimeoutMs);
      const meta = await sharp(originalBuffer).metadata();
      const sourceWidth = meta.width ?? 0;
      const sourceHeight = meta.height ?? 0;
      if (!sourceWidth || !sourceHeight) {
        throw new Error('Missing source dimensions');
      }

      const downsized = await sharp(originalBuffer)
        .grayscale()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const w = downsized.info.width;
      const h = downsized.info.height;
      const data = downsized.data;

      const maxRows = Math.floor(h * 0.1);
      const maxCols = Math.floor(w * 0.1);

      const topBorderRows = detectEdgeBorderRows(data, w, h, maxRows, true);
      const bottomBorderRows = detectEdgeBorderRows(data, w, h, maxRows, false);
      const leftBorderCols = detectEdgeBorderCols(data, w, h, maxCols, true);
      const rightBorderCols = detectEdgeBorderCols(data, w, h, maxCols, false);

      const headerRows = detectTemplateBandRows(data, w, h, true, topBorderRows);
      const footerRows = detectTemplateBandRows(data, w, h, false, bottomBorderRows);

      const cropLeft = scaleValue(leftBorderCols, w, sourceWidth);
      const cropTop = scaleValue(topBorderRows, h, sourceHeight);
      const cropRight = scaleValue(rightBorderCols, w, sourceWidth);
      const cropBottom = scaleValue(bottomBorderRows, h, sourceHeight);

      const cropWidth = Math.max(1, sourceWidth - cropLeft - cropRight);
      const cropHeight = Math.max(1, sourceHeight - cropTop - cropBottom);

      const originalArea = sourceWidth * sourceHeight;
      const cropArea = cropWidth * cropHeight;
      const cropAreaRatio = originalArea > 0 ? cropArea / originalArea : 1;

      const actions: string[] = [];
      const masks: Decision['masks'] = [];
      let crop: Decision['crop'] | undefined;
      let warning: string | undefined;

      const borderDetected = topBorderRows + bottomBorderRows + leftBorderCols + rightBorderCols > 0;
      if (borderDetected) {
        if (cropAreaRatio >= minKeepAreaRatio) {
          crop = { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight };
          actions.push('crop_border');
        } else {
          warning = `skip_crop_low_keep_ratio(${cropAreaRatio.toFixed(3)})`;
          actions.push('flag_border_unsafe_crop');
        }
      }

      if (headerRows > 0) {
        const maskHeight = scaleValue(headerRows, h, crop ? crop.height : sourceHeight);
        const maskWidth = crop ? crop.width : sourceWidth;
        masks.push({ x: 0, y: 0, width: maskWidth, height: Math.max(1, maskHeight), kind: 'header' });
        actions.push('mask_header_template');
      }

      if (footerRows > 0) {
        const baseHeight = crop ? crop.height : sourceHeight;
        const maskHeight = scaleValue(footerRows, h, baseHeight);
        const maskWidth = crop ? crop.width : sourceWidth;
        masks.push({ x: 0, y: Math.max(0, baseHeight - Math.max(1, maskHeight)), width: maskWidth, height: Math.max(1, maskHeight), kind: 'footer' });
        actions.push('mask_footer_template');
      }

      if (actions.length === 0) {
        actions.push('unchanged');
      }

      const decision: Decision = {
        id: candidate.id,
        imageUrl: candidate.imageUrl,
        imageKey: candidate.imageKey,
        sourceSize: { width: sourceWidth, height: sourceHeight },
        crop,
        masks,
        actions,
        metrics: {
          cropAreaRatio,
          borderPx: {
            top: cropTop,
            bottom: cropBottom,
            left: cropLeft,
            right: cropRight,
          },
          headerRows,
          footerRows,
        },
        warning,
      };

      if (cleanedDir && actions.some((a) => a !== 'unchanged')) {
        ensureDir(path.join(cleanedDir, 'dummy.txt'));
        const previewBuffer = await applyDecisionPreview(originalBuffer, decision);
        const outFile = path.join(cleanedDir, `${candidate.id.replace(/\.json$/i, '')}.jpg`);
        fs.writeFileSync(outFile, previewBuffer);
      }

      return decision;
    } catch (error) {
      fetchFailures.push({
        id: candidate.id,
        imageUrl: candidate.imageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  });

  const decisions = decisionsMaybe.filter((d): d is Decision => d !== null);
  const flagged = decisions.filter((d) => !d.actions.includes('unchanged'));

  let cropCount = 0;
  let maskCount = 0;
  let unchangedCount = 0;
  let unsafeCropSkipped = 0;
  let cropRatioSum = 0;

  for (const decision of decisions) {
    if (decision.actions.includes('crop_border')) cropCount += 1;
    if (decision.actions.includes('mask_header_template') || decision.actions.includes('mask_footer_template')) maskCount += 1;
    if (decision.actions.includes('unchanged')) unchangedCount += 1;
    if (decision.actions.includes('flag_border_unsafe_crop')) unsafeCropSkipped += 1;
    cropRatioSum += decision.metrics.cropAreaRatio;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    params: {
      limit,
      concurrency,
      fetchTimeoutMs,
      minKeepAreaRatio,
      publicDomain: publicDomain || null,
      cleanedDir,
    },
    counts: {
      scanned,
      candidates: candidates.length,
      processed: decisions.length,
      skippedNoImage,
      failures: fetchFailures.length,
      flagged: flagged.length,
      cropCount,
      maskCount,
      unchangedCount,
      unsafeCropSkipped,
    },
    aggregate: {
      meanCropKeepRatio: decisions.length ? Number((cropRatioSum / decisions.length).toFixed(4)) : 0,
    },
    outputs: {
      reportPath,
      decisionsPath,
      flaggedPath,
    },
    sampleFailures: fetchFailures.slice(0, 40),
  };

  ensureDir(reportPath);
  ensureDir(decisionsPath);
  ensureDir(flaggedPath);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(decisionsPath, decisions.map((row) => JSON.stringify(row)).join('\n') + (decisions.length ? '\n' : ''));
  fs.writeFileSync(
    flaggedPath,
    flagged
      .map((row) =>
        JSON.stringify({
          id: row.id,
          imageUrl: row.imageUrl,
          imageKey: row.imageKey,
          actions: row.actions,
          warning: row.warning,
          sourceSize: row.sourceSize,
          crop: row.crop,
          masks: row.masks,
          metrics: row.metrics,
        })
      )
      .join('\n') + (flagged.length ? '\n' : ''),
  );

  console.log(`[image-artifacts:audit] scanned=${scanned}`);
  console.log(`[image-artifacts:audit] candidates=${candidates.length}, processed=${decisions.length}, failures=${fetchFailures.length}`);
  console.log(`[image-artifacts:audit] flagged=${flagged.length}, crop=${cropCount}, mask=${maskCount}, unchanged=${unchangedCount}`);
  console.log(`[image-artifacts:audit] report=${reportPath}`);
  console.log(`[image-artifacts:audit] decisions=${decisionsPath}`);
  console.log(`[image-artifacts:audit] flagged-samples=${flaggedPath}`);
  if (cleanedDir) {
    console.log(`[image-artifacts:audit] cleaned-previews=${cleanedDir}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
