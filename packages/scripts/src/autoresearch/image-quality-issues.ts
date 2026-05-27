import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates.json',
);
const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collections.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality',
);

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  image_exists?: boolean;
  image_size_bytes?: number;
  attributes_map?: Record<string, unknown>;
  vlm_error?: string | null;
  vlm_metadata_error?: string | null;
  vlm_metadata?: {
    scene_type?: string;
    print_quality?: string;
    aerial_ground_document?: string;
    visual_subjects?: string[];
    search_terms?: string[];
  } | null;
};

type CandidateReport = {
  rare_find_candidates?: Array<{ id: string }>;
  social_candidates?: Array<{ id: string }>;
  print_candidates?: Array<{ id: string }>;
  sequence_candidates?: Array<{ records?: Array<{ id: string }> }>;
};

type CollectionReport = {
  collections?: Array<{
    representativeImages?: Array<{ id: string }>;
    records?: Array<{ id: string }>;
  }>;
};

type QualityLabel = {
  id: string;
  title: string;
  date: string;
  imageUrl: string;
  imagePath: string;
  source: 'r2' | 'external';
  audited: boolean;
  labels: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
  recommendedAction: 'none' | 'review' | 'rotate' | 'crop_or_mask' | 'lower_rank' | 'exclude_until_fixed';
  confidence: number;
  dimensions: { width: number | null; height: number | null };
  metrics?: {
    cropKeepRatio: number;
    borderPx: { top: number; bottom: number; left: number; right: number };
    headerRows: number;
    footerRows: number;
    meanBrightness: number;
    contrastStd: number;
    edgeEnergy: number;
    darkFraction: number;
    lightFraction: number;
  };
  notes: string[];
  error?: string;
};

type EdgeStats = {
  mean: number;
  std: number;
  darkFrac: number;
  whiteFrac: number;
};

class ImageFetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'http' | 'timeout' | 'network',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJsonl(filePath: string): ArchiveRecord[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ArchiveRecord;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function metadataId(record: ArchiveRecord): string {
  return cleanText(record.metadata_filename);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function r2Url(record: ArchiveRecord, publicDomain: string): string | null {
  const key = imagePath(record);
  if (!key || !publicDomain) return null;
  return `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(key)}`;
}

function imageUrl(record: ArchiveRecord, publicDomain: string): { url: string; source: 'r2' | 'external' } | null {
  const fromR2 = r2Url(record, publicDomain);
  if (fromR2) return { url: fromR2, source: 'r2' };
  const external = cleanText(record.external_url);
  return external ? { url: external, source: 'external' } : null;
}

function title(record: ArchiveRecord): string {
  return cleanText(record.name || record.metadata_filename || record.image_filename);
}

function dateValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Date);
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
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), darkFrac: dark / n, whiteFrac: white / n };
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
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), darkFrac: dark / n, whiteFrac: white / n };
}

function isBorderLike(stats: EdgeStats): boolean {
  const extreme = stats.mean < 20 || stats.mean > 236;
  const mostlyExtreme = stats.darkFrac > 0.98 || stats.whiteFrac > 0.98;
  return (extreme && stats.std < 10) || (mostlyExtreme && stats.std < 16);
}

function detectRows(data: Uint8Array, width: number, height: number, maxRows: number, fromTop: boolean): number {
  let border = 0;
  for (let i = 0; i < maxRows; i += 1) {
    const row = fromTop ? i : height - 1 - i;
    if (!isBorderLike(computeRowStats(data, width, row))) break;
    border += 1;
  }
  return border;
}

function detectCols(data: Uint8Array, width: number, height: number, maxCols: number, fromLeft: boolean): number {
  let border = 0;
  for (let i = 0; i < maxCols; i += 1) {
    const col = fromLeft ? i : width - 1 - i;
    if (!isBorderLike(computeColStats(data, width, height, col))) break;
    border += 1;
  }
  return border;
}

function detectTemplateRows(data: Uint8Array, width: number, height: number, fromTop: boolean, borderRows: number): number {
  const maxScan = Math.floor(height * 0.16);
  const minBand = Math.max(4, Math.floor(height * 0.01));
  const maxBand = Math.max(minBand + 1, Math.floor(height * 0.12));
  let band = 0;
  for (let i = borderRows; i < maxScan; i += 1) {
    const row = fromTop ? i : height - 1 - i;
    const stats = computeRowStats(data, width, row);
    const looksLikeTextOnPaper = stats.whiteFrac > 0.82 && stats.darkFrac > 0.005 && stats.darkFrac < 0.22 && stats.std > 7 && stats.std < 70;
    if (!looksLikeTextOnPaper) break;
    band += 1;
  }
  return band >= minBand && band <= maxBand ? band : 0;
}

function scale(value: number, from: number, to: number): number {
  return Math.round((value / from) * to);
}

function pixelStats(data: Uint8Array, width: number, height: number) {
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let light = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = data[y * width + x];
      sum += v;
      sumSq += v * v;
      if (v < 28) dark += 1;
      if (v > 228) light += 1;
      if (x > 0 && y > 0) {
        const gx = Math.abs(v - data[y * width + x - 1]);
        const gy = Math.abs(v - data[(y - 1) * width + x]);
        edgeSum += gx + gy;
        edgeCount += 1;
      }
    }
  }
  const n = width * height;
  const mean = sum / n;
  return {
    meanBrightness: mean,
    contrastStd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    darkFraction: dark / n,
    lightFraction: light / n,
    edgeEnergy: edgeCount ? edgeSum / edgeCount : 0,
  };
}

function rotationFromExif(value: number | undefined): number | null {
  if (value === 6) return 90;
  if (value === 3) return 180;
  if (value === 8) return 270;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readImageOnce(url: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'image/*' } });
    if (!response.ok) throw new ImageFetchError(`HTTP ${response.status}`, 'http', response.status);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof ImageFetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const timeoutLike = error instanceof DOMException && error.name === 'AbortError'
      || message.includes('aborted')
      || message.includes('AbortError')
      || message.includes('timeout');
    throw new ImageFetchError(message, timeoutLike ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
  }
}

async function readImage(url: string, timeoutMs: number): Promise<Buffer> {
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await readImageOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof ImageFetchError && error.kind === 'http') throw error;
      if (attempt < attempts) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()));
  return results;
}

function candidateIds(report: CandidateReport | null): Set<string> {
  const ids = new Set<string>();
  for (const row of report?.rare_find_candidates ?? []) ids.add(row.id);
  for (const row of report?.social_candidates ?? []) ids.add(row.id);
  for (const row of report?.print_candidates ?? []) ids.add(row.id);
  for (const sequence of report?.sequence_candidates ?? []) {
    for (const row of sequence.records ?? []) ids.add(row.id);
  }
  return ids;
}

function collectionIds(report: CollectionReport | null): Set<string> {
  const ids = new Set<string>();
  for (const collection of report?.collections ?? []) {
    for (const row of collection.representativeImages ?? []) ids.add(row.id);
    for (const row of (collection.records ?? []).slice(0, 4)) ids.add(row.id);
  }
  return ids;
}

function sampleRecords(records: ArchiveRecord[], limit: number, candidateIdSet: Set<string>, collectionIdSet: Set<string>): ArchiveRecord[] {
  const byId = new Map(records.map((record) => [metadataId(record), record]));
  const selected = new Map<string, ArchiveRecord>();
  const add = (id: string) => {
    const record = byId.get(id);
    if (record) selected.set(id, record);
  };
  for (const id of candidateIdSet) add(id);
  for (const id of collectionIdSet) add(id);
  for (const record of records) {
    if (record.vlm_error || record.vlm_metadata_error) selected.set(metadataId(record), record);
    if (selected.size >= Math.floor(limit * 0.55)) break;
  }

  const buckets = new Map<string, ArchiveRecord[]>();
  for (const record of records) {
    const key = normalize(`${record.vlm_metadata?.scene_type ?? 'unknown'}:${record.vlm_metadata?.print_quality ?? 'unknown'}:${record.vlm_metadata?.aerial_ground_document ?? 'unknown'}`);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }

  let cursor = 0;
  const bucketRows = [...buckets.values()].filter((bucket) => bucket.length);
  while (selected.size < limit && bucketRows.length) {
    for (const bucket of bucketRows) {
      const record = bucket[cursor % bucket.length];
      if (record) selected.set(metadataId(record), record);
      if (selected.size >= limit) break;
    }
    cursor += 1;
    if (cursor > records.length) break;
  }
  return [...selected.values()].filter((record) => metadataId(record));
}

async function auditRecord(record: ArchiveRecord, publicDomain: string, timeoutMs: number): Promise<QualityLabel> {
  const resolved = imageUrl(record, publicDomain);
  const base: QualityLabel = {
    id: metadataId(record),
    title: title(record),
    date: dateValue(record),
    imageUrl: resolved?.url ?? '',
    imagePath: imagePath(record),
    source: resolved?.source ?? 'r2',
    audited: false,
    labels: [],
    severity: 'none',
    recommendedAction: 'none',
    confidence: 0,
    dimensions: { width: null, height: null },
    notes: [],
  };
  if (!resolved) return { ...base, labels: ['missing_image_url'], severity: 'high', recommendedAction: 'exclude_until_fixed', confidence: 1, error: 'No image URL' };

  try {
    const buffer = await readImage(resolved.url, timeoutMs);
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    const orientationRotation = rotationFromExif(metadata.orientation);
    const downsized = await sharp(buffer, { failOn: 'none' })
      .grayscale()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = downsized.info.width;
    const h = downsized.info.height;
    const data = downsized.data;
    const maxRows = Math.floor(h * 0.1);
    const maxCols = Math.floor(w * 0.1);
    const top = detectRows(data, w, h, maxRows, true);
    const bottom = detectRows(data, w, h, maxRows, false);
    const left = detectCols(data, w, h, maxCols, true);
    const right = detectCols(data, w, h, maxCols, false);
    const headerRows = detectTemplateRows(data, w, h, true, top);
    const footerRows = detectTemplateRows(data, w, h, false, bottom);
    const borderPx = {
      top: scale(top, h, sourceHeight),
      bottom: scale(bottom, h, sourceHeight),
      left: scale(left, w, sourceWidth),
      right: scale(right, w, sourceWidth),
    };
    const cropKeepRatio = sourceWidth && sourceHeight
      ? ((sourceWidth - borderPx.left - borderPx.right) * (sourceHeight - borderPx.top - borderPx.bottom)) / (sourceWidth * sourceHeight)
      : 1;
    const stats = pixelStats(data, w, h);
    const labels: string[] = [];
    const notes: string[] = [];
    let severityScore = 0;
    let action: QualityLabel['recommendedAction'] = 'none';

    if (orientationRotation != null) {
      labels.push('orientation_exif_rotation');
      notes.push(`EXIF orientation suggests ${orientationRotation} degree rotation.`);
      severityScore += 3;
      action = 'rotate';
    }
    const borderRatio = 1 - cropKeepRatio;
    if (borderRatio > 0.12) {
      labels.push('border_heavy');
      notes.push(`Detected border area is ${(borderRatio * 100).toFixed(1)}% of image.`);
      severityScore += 2;
      action = action === 'rotate' ? action : 'crop_or_mask';
    } else if (borderRatio > 0.035) {
      labels.push('border_light');
      notes.push(`Detected light border area is ${(borderRatio * 100).toFixed(1)}% of image.`);
      severityScore += 1;
      action = action === 'none' ? 'review' : action;
    }
    if (cropKeepRatio < 0.72) {
      labels.push('unsafe_crop_candidate');
      notes.push('Border crop would remove too much image area.');
      severityScore += 3;
      action = 'review';
    }
    if (headerRows || footerRows) {
      labels.push('template_header_footer');
      notes.push(`Detected template bands header=${headerRows}, footer=${footerRows}.`);
      severityScore += 2;
      action = action === 'rotate' ? action : 'crop_or_mask';
    }
    if (stats.contrastStd < 22) {
      labels.push('low_contrast_scan');
      notes.push(`Low contrast std=${stats.contrastStd.toFixed(1)}.`);
      severityScore += 2;
      action = action === 'none' ? 'lower_rank' : action;
    }
    if (stats.meanBrightness < 35 || stats.darkFraction > 0.7) {
      labels.push('very_dark_scan');
      severityScore += 2;
      action = action === 'none' ? 'lower_rank' : action;
    }
    if (stats.meanBrightness > 220 || stats.lightFraction > 0.78) {
      labels.push('washed_out_scan');
      severityScore += 2;
      action = action === 'none' ? 'lower_rank' : action;
    }
    if (stats.edgeEnergy < 5.5 && stats.contrastStd < 35) {
      labels.push('soft_or_blurry_scan');
      severityScore += 1;
      action = action === 'none' ? 'review' : action;
    }
    if (sourceWidth < 900 || sourceHeight < 700) {
      labels.push('low_resolution_source');
      severityScore += 1;
      action = action === 'none' ? 'lower_rank' : action;
    }
    if (record.vlm_error) {
      labels.push('vlm_image_or_model_error');
      severityScore += 2;
      action = action === 'none' ? 'review' : action;
    }
    if (record.vlm_metadata_error) {
      labels.push('vlm_structured_metadata_error');
      severityScore += 1;
      action = action === 'none' ? 'review' : action;
    }

    const severity: QualityLabel['severity'] = severityScore >= 5 ? 'high' : severityScore >= 3 ? 'medium' : severityScore > 0 ? 'low' : 'none';
    return {
      ...base,
      audited: true,
      labels,
      severity,
      recommendedAction: action,
      confidence: labels.length ? 0.82 : 0.72,
      dimensions: { width: sourceWidth || null, height: sourceHeight || null },
      metrics: {
        cropKeepRatio: Number(cropKeepRatio.toFixed(4)),
        borderPx,
        headerRows,
        footerRows,
        meanBrightness: Number(stats.meanBrightness.toFixed(2)),
        contrastStd: Number(stats.contrastStd.toFixed(2)),
        edgeEnergy: Number(stats.edgeEnergy.toFixed(2)),
        darkFraction: Number(stats.darkFraction.toFixed(4)),
        lightFraction: Number(stats.lightFraction.toFixed(4)),
      },
      notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fetchKind = error instanceof ImageFetchError ? error.kind : null;
    const timeoutLike = fetchKind === 'timeout' || message.includes('aborted') || message.includes('AbortError') || message.includes('timeout');
    const networkLike = fetchKind === 'network' || message.includes('fetch failed');
    const transientLike = timeoutLike || networkLike;
    return {
      ...base,
      labels: [timeoutLike ? 'image_fetch_timeout' : networkLike ? 'image_fetch_network_failure' : 'image_fetch_or_decode_failure'],
      severity: transientLike ? 'medium' : 'high',
      recommendedAction: transientLike ? 'review' : 'exclude_until_fixed',
      confidence: transientLike ? 0.75 : 1,
      error: message,
    };
  }
}

function countBy<T extends string>(rows: QualityLabel[], getter: (row: QualityLabel) => T | T[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const values = getter(row);
    for (const value of Array.isArray(values) ? values : [values]) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Autoresearch Image Quality Audit',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Input rows: ${report.summary.input_rows}`,
    `- Audited sample rows: ${report.summary.sample_rows}`,
    `- Successful audits: ${report.summary.audited}`,
    `- Flagged rows: ${report.summary.flagged}`,
    `- High severity: ${report.summary.high_severity}`,
    `- Medium severity: ${report.summary.medium_severity}`,
    `- Low severity: ${report.summary.low_severity}`,
    '',
    '## Labels',
    '',
  ];
  for (const [label, count] of Object.entries(report.label_counts)) lines.push(`- ${label}: ${count}`);
  lines.push('', '## Recommended Actions', '');
  for (const [action, count] of Object.entries(report.action_counts)) lines.push(`- ${action}: ${count}`);
  lines.push('', '## Top Flagged Rows', '');
  for (const row of report.top_flagged) {
    lines.push(`- \`${row.id}\` ${row.title || row.id}: ${row.severity}; ${row.labels.join(', ')}; ${row.imageUrl}`);
  }
  lines.push('', '## Downstream Contract', '');
  lines.push('- `quality_labels.jsonl` has one row per audited record and can be joined by `id` / `metadata_filename`.');
  lines.push('- `quality_issues_downstream.jsonl` contains only rows with labels for filtering/scoring in search, social, print, and cleanup workflows.');
  lines.push('- `recommendedAction` is one of `none`, `review`, `rotate`, `crop_or_mask`, `lower_rank`, or `exclude_until_fixed`.');
  return `${lines.join('\n')}\n`;
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '700' },
      concurrency: { type: 'string', default: '2' },
      'fetch-timeout-ms': { type: 'string', default: '30000' },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || '' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const limit = Number.parseInt(values.limit!, 10);
  const concurrency = Number.parseInt(values.concurrency!, 10);
  const timeoutMs = Number.parseInt(values['fetch-timeout-ms']!, 10);
  const publicDomain = cleanText(values['public-domain']);

  if (!fs.existsSync(inputPath)) throw new Error(`Missing input: ${inputPath}`);
  if (!publicDomain) throw new Error('Missing R2 public domain.');
  fs.mkdirSync(outputDir, { recursive: true });

  const records = readJsonl(inputPath);
  const candidateReport = readJson<CandidateReport>(candidatesPath);
  const collectionReport = readJson<CollectionReport>(collectionsPath);
  const sample = sampleRecords(records, limit, candidateIds(candidateReport), collectionIds(collectionReport));
  const labels = await runWithConcurrency(sample, concurrency, (record) => auditRecord(record, publicDomain, timeoutMs));
  const flagged = labels.filter((row) => row.labels.length > 0);
  const high = labels.filter((row) => row.severity === 'high');
  const medium = labels.filter((row) => row.severity === 'medium');
  const low = labels.filter((row) => row.severity === 'low');

  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, inputPath),
      candidates: fs.existsSync(candidatesPath) ? path.relative(MONOREPO_ROOT, candidatesPath) : null,
      collections: fs.existsSync(collectionsPath) ? path.relative(MONOREPO_ROOT, collectionsPath) : null,
    },
    params: { limit, concurrency, timeoutMs, publicDomain },
    summary: {
      input_rows: records.length,
      sample_rows: sample.length,
      audited: labels.filter((row) => row.audited).length,
      flagged: flagged.length,
      high_severity: high.length,
      medium_severity: medium.length,
      low_severity: low.length,
    },
    label_counts: countBy(labels, (row) => row.labels),
    severity_counts: countBy(labels, (row) => row.severity),
    action_counts: countBy(labels, (row) => row.recommendedAction),
    top_flagged: flagged
      .sort((a, b) => {
        const weight = { high: 3, medium: 2, low: 1, none: 0 };
        return weight[b.severity] - weight[a.severity] || b.labels.length - a.labels.length;
      })
      .slice(0, 40),
    artifacts: {
      report: 'quality_report.json',
      markdown: 'quality_report.md',
      labels: 'quality_labels.jsonl',
      downstream: 'quality_issues_downstream.jsonl',
    },
  };

  fs.writeFileSync(path.join(outputDir, 'quality_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'quality_report.md'), renderMarkdown(report));
  writeJsonl(path.join(outputDir, 'quality_labels.jsonl'), labels);
  writeJsonl(path.join(outputDir, 'quality_issues_downstream.jsonl'), flagged);

  console.log(`[autoresearch:image-quality] output=${outputDir}`);
  console.log(`[autoresearch:image-quality] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
