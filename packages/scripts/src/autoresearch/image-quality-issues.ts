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
  originalImageUrl?: string;
  auditImageUrl?: string;
  auditImagePath?: string;
  auditImageSource?: 'original' | 'thumb-api' | 'cloudflare-transform' | 'local-derivative';
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
    exifOrientation: number | null;
    recommendedRotationDegrees: number | null;
    auditWidth: number;
    auditHeight: number;
    sourceWidth: number | null;
    sourceHeight: number | null;
    meanBrightness: number;
    contrastStd: number;
    edgeEnergy: number;
    darkFraction: number;
    lightFraction: number;
  };
  notes: string[];
  error?: string;
};

type AuditImageMode = 'original' | 'thumb-api' | 'cloudflare-transform' | 'local-derivative';
type MetadataMode = 'audit' | 'range' | 'full' | 'skip';

type DerivativeReference = {
  id: string;
  derivativePath?: string;
  derivative_path?: string;
  outputPath?: string;
  output_path?: string;
  imagePath?: string;
  image_path?: string;
  derivativeUrl?: string;
  derivative_url?: string;
};

type AuditOptions = {
  publicDomain: string;
  timeoutMs: number;
  fetchAttempts: number;
  auditImageMode: AuditImageMode;
  thumbApiOrigin: string;
  imageTransformZone: string;
  auditWidth: number;
  auditHeight: number;
  auditFit: 'cover' | 'contain' | 'scale-down';
  auditQuality: number;
  auditFormat: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png';
  metadataMode: MetadataMode;
  metadataRangeBytes: number;
  requireDerivativeResize: boolean;
  derivativeById: Map<string, DerivativeReference>;
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

class ImageDerivativeError extends Error {
  constructor(message: string, readonly kind: 'missing' | 'unresized') {
    super(message);
    this.name = 'ImageDerivativeError';
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

function readJsonl<T = ArchiveRecord>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
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

function parseAllowedValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = cleanText(value);
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function thumbApiUrl(originalUrl: string, options: AuditOptions): string {
  const origin = options.thumbApiOrigin.replace(/\/+$/, '');
  const url = new URL('/api/thumb', origin);
  url.searchParams.set('src', originalUrl);
  url.searchParams.set('w', String(options.auditWidth));
  url.searchParams.set('h', String(options.auditHeight));
  url.searchParams.set('fit', options.auditFit);
  url.searchParams.set('q', String(options.auditQuality));
  url.searchParams.set('format', options.auditFormat);
  return url.toString();
}

function cloudflareTransformUrl(originalUrl: string, options: AuditOptions): string {
  const zone = options.imageTransformZone.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const formatOption = options.auditFormat === 'auto' ? 'format=auto' : `format=${options.auditFormat}`;
  const transformOptions = [
    `width=${options.auditWidth}`,
    `height=${options.auditHeight}`,
    `quality=${options.auditQuality}`,
    `fit=${options.auditFit}`,
    formatOption,
  ].join(',');
  return `https://${zone}/cdn-cgi/image/${transformOptions}/${originalUrl}`;
}

function derivativeLocalPath(reference: DerivativeReference | undefined): string {
  if (!reference) return '';
  const value = cleanText(reference.derivativePath ?? reference.derivative_path ?? reference.outputPath ?? reference.output_path ?? reference.imagePath ?? reference.image_path);
  return value ? resolveRepoPath(value) : '';
}

function derivativeUrl(reference: DerivativeReference | undefined): string {
  return cleanText(reference?.derivativeUrl ?? reference?.derivative_url);
}

function resolveAuditImage(originalUrl: string, recordId: string, options: AuditOptions): { url: string; source: QualityLabel['auditImageSource']; localPath?: string } {
  if (options.auditImageMode === 'local-derivative') {
    const reference = options.derivativeById.get(recordId);
    const localPath = derivativeLocalPath(reference);
    if (localPath) return { url: derivativeUrl(reference) || localPath, source: 'local-derivative', localPath };
    const url = derivativeUrl(reference);
    if (url) return { url, source: 'local-derivative' };
    throw new ImageDerivativeError(`Missing local derivative for ${recordId}.`, 'missing');
  }
  if (options.auditImageMode === 'thumb-api') return { url: thumbApiUrl(originalUrl, options), source: 'thumb-api' };
  if (options.auditImageMode === 'cloudflare-transform') {
    if (!options.imageTransformZone) throw new Error('Missing --image-transform-zone for cloudflare-transform audit mode.');
    return { url: cloudflareTransformUrl(originalUrl, options), source: 'cloudflare-transform' };
  }
  return { url: originalUrl, source: 'original' };
}

function assertDerivativeResized(auditMetadata: sharp.Metadata, options: AuditOptions): void {
  if (!options.requireDerivativeResize || options.auditImageMode === 'original') return;
  const width = auditMetadata.width ?? 0;
  const height = auditMetadata.height ?? 0;
  if (!width || !height) return;
  const maxReturnedEdge = Math.max(width, height);
  const maxRequestedEdge = Math.max(options.auditWidth, options.auditHeight);
  if (maxReturnedEdge > maxRequestedEdge * 1.05) {
    throw new ImageDerivativeError(`Derivative endpoint returned ${width}x${height}, above requested max edge ${maxRequestedEdge}.`, 'unresized');
  }
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

async function readImageRange(url: string, timeoutMs: number, bytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'image/*',
        range: `bytes=0-${Math.max(0, bytes - 1)}`,
      },
    });
    if (!response.ok && response.status !== 206) throw new ImageFetchError(`HTTP ${response.status}`, 'http', response.status);
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

async function readImage(url: string, timeoutMs: number, attempts: number): Promise<Buffer> {
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

async function readAuditImage(image: { url: string; localPath?: string }, timeoutMs: number, attempts: number): Promise<Buffer> {
  if (image.localPath) return fs.readFileSync(image.localPath);
  return readImage(image.url, timeoutMs, attempts);
}

async function readMetadata(buffer: Buffer): Promise<sharp.Metadata> {
  return sharp(buffer, { failOn: 'none' }).metadata();
}

async function readOriginalMetadata(originalUrl: string, auditMetadata: sharp.Metadata, options: AuditOptions): Promise<sharp.Metadata | null> {
  if (options.metadataMode === 'skip') return null;
  if (options.metadataMode === 'audit' || options.auditImageMode === 'original') return auditMetadata;
  try {
    if (options.metadataMode === 'full') {
      return await readMetadata(await readImage(originalUrl, options.timeoutMs, options.fetchAttempts));
    }
    const header = await readImageRange(originalUrl, options.timeoutMs, options.metadataRangeBytes);
    return await readMetadata(header);
  } catch {
    return null;
  }
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
    if (selected.size >= limit) return;
    const record = byId.get(id);
    if (record) selected.set(id, record);
  };
  for (const id of candidateIdSet) add(id);
  for (const id of collectionIdSet) add(id);
  for (const record of records) {
    if (selected.size >= limit) break;
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

async function auditRecord(record: ArchiveRecord, options: AuditOptions): Promise<QualityLabel> {
  const resolved = imageUrl(record, options.publicDomain);
  const base: QualityLabel = {
    id: metadataId(record),
    title: title(record),
    date: dateValue(record),
    imageUrl: resolved?.url ?? '',
    originalImageUrl: resolved?.url ?? '',
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

  let auditImage: { url: string; source: QualityLabel['auditImageSource']; localPath?: string } = { url: resolved.url, source: 'original' };
  try {
    auditImage = resolveAuditImage(resolved.url, base.id, options);
    const buffer = await readAuditImage(auditImage, options.timeoutMs, options.fetchAttempts);
    const auditMetadata = await readMetadata(buffer);
    assertDerivativeResized(auditMetadata, options);
    const originalMetadata = await readOriginalMetadata(resolved.url, auditMetadata, options);
    const sourceWidth = originalMetadata?.width ?? auditMetadata.width ?? 0;
    const sourceHeight = originalMetadata?.height ?? auditMetadata.height ?? 0;
    const orientationMetadata = originalMetadata ?? auditMetadata;
    const orientationRotation = rotationFromExif(orientationMetadata.orientation);
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

    if (auditImage.source !== 'original') {
      notes.push(`Pixel audit used ${auditImage.source} derivative ${auditMetadata.width ?? '?'}x${auditMetadata.height ?? '?'}.`);
    }

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
      auditImageUrl: auditImage.url,
      auditImagePath: auditImage.localPath,
      auditImageSource: auditImage.source,
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
        exifOrientation: orientationMetadata.orientation ?? null,
        recommendedRotationDegrees: orientationRotation,
        auditWidth: auditMetadata.width ?? w,
        auditHeight: auditMetadata.height ?? h,
        sourceWidth: sourceWidth || null,
        sourceHeight: sourceHeight || null,
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
    if (error instanceof ImageDerivativeError) {
      return {
        ...base,
        auditImageUrl: auditImage.url,
        auditImagePath: auditImage.localPath,
        auditImageSource: auditImage.source,
        labels: [error.kind === 'missing' ? 'image_derivative_missing' : 'image_derivative_unresized'],
        severity: 'high',
        recommendedAction: 'review',
        confidence: 1,
        error: message,
      };
    }
    const fetchKind = error instanceof ImageFetchError ? error.kind : null;
    const timeoutLike = fetchKind === 'timeout' || message.includes('aborted') || message.includes('AbortError') || message.includes('timeout');
    const networkLike = fetchKind === 'network' || message.includes('fetch failed');
    const transientLike = timeoutLike || networkLike;
    return {
      ...base,
      auditImageUrl: auditImage.url,
      auditImagePath: auditImage.localPath,
      auditImageSource: auditImage.source,
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

function appendJsonl(filePath: string, row: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function boolValue(value: boolean | string | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function failureRows(labels: QualityLabel[]) {
  return labels
    .filter((row) => !row.audited || Boolean(row.error))
    .map((row) => ({
      id: row.id,
      title: row.title,
      imageUrl: row.imageUrl,
      originalImageUrl: row.originalImageUrl ?? row.imageUrl,
      auditImageUrl: row.auditImageUrl ?? row.imageUrl,
      auditImagePath: row.auditImagePath ?? null,
      auditImageSource: row.auditImageSource ?? 'original',
      imagePath: row.imagePath,
      labels: row.labels,
      severity: row.severity,
      recommendedAction: row.recommendedAction,
      error: row.error ?? null,
    }));
}

function isRetriableFailure(row: QualityLabel): boolean {
  return !row.audited
    || Boolean(row.error)
    || row.labels.some((label) => label.includes('fetch') || label.includes('decode'));
}

function dedupeLabels(labels: QualityLabel[]): QualityLabel[] {
  return Array.from(new Map(labels.map((row) => [row.id, row])).values());
}

function summarizeLabels(labels: QualityLabel[]) {
  const flagged = labels.filter((row) => row.labels.length > 0);
  const high = labels.filter((row) => row.severity === 'high');
  const medium = labels.filter((row) => row.severity === 'medium');
  const low = labels.filter((row) => row.severity === 'low');
  return {
    audited: labels.filter((row) => row.audited).length,
    flagged: flagged.length,
    high_severity: high.length,
    medium_severity: medium.length,
    low_severity: low.length,
    fetch_or_decode_failures: labels.filter((row) => !row.audited || row.labels.some((label) => label.includes('fetch') || label.includes('decode'))).length,
  };
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
      'fetch-attempts': { type: 'string', default: '3' },
      'progress-interval': { type: 'string', default: '250' },
      resume: { type: 'boolean', default: false },
      'retry-failures': { type: 'boolean', default: false },
      'audit-image-mode': { type: 'string', default: 'original' },
      'thumb-api-origin': { type: 'string', default: process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_ORIGIN || 'https://mtl-archives-worker.wiel.workers.dev' },
      'image-transform-zone': { type: 'string', default: process.env.IMAGE_TRANSFORM_ZONE || '' },
      'audit-width': { type: 'string', default: '1024' },
      'audit-height': { type: 'string', default: '1024' },
      'audit-fit': { type: 'string', default: 'scale-down' },
      'audit-quality': { type: 'string', default: '82' },
      'audit-format': { type: 'string', default: 'jpeg' },
      'metadata-mode': { type: 'string', default: 'range' },
      'metadata-range-bytes': { type: 'string', default: '262144' },
      'require-derivative-resize': { type: 'boolean', default: false },
      'audit-derivatives-manifest': { type: 'string', default: '' },
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
  const fetchAttempts = Number.parseInt(values['fetch-attempts']!, 10);
  const progressInterval = Number.parseInt(values['progress-interval']!, 10);
  const resume = boolValue(values.resume);
  const retryFailures = boolValue(values['retry-failures']);
  const publicDomain = cleanText(values['public-domain']);
  const auditImageMode = parseAllowedValue(values['audit-image-mode'], ['original', 'thumb-api', 'cloudflare-transform', 'local-derivative'] as const, 'original');
  const thumbApiOrigin = cleanText(values['thumb-api-origin']);
  const imageTransformZone = cleanText(values['image-transform-zone']);
  const auditWidth = clampNumber(Number.parseInt(values['audit-width']!, 10), 1, 4096);
  const auditHeight = clampNumber(Number.parseInt(values['audit-height']!, 10), 1, 4096);
  const auditFit = parseAllowedValue(values['audit-fit'], ['cover', 'contain', 'scale-down'] as const, 'scale-down');
  const auditQuality = clampNumber(Number.parseInt(values['audit-quality']!, 10), 1, 100);
  const auditFormat = parseAllowedValue(values['audit-format'], ['auto', 'webp', 'avif', 'jpeg', 'png'] as const, 'jpeg');
  const metadataMode = parseAllowedValue(values['metadata-mode'], ['audit', 'range', 'full', 'skip'] as const, auditImageMode === 'original' ? 'audit' : 'range');
  const metadataRangeBytes = clampNumber(Number.parseInt(values['metadata-range-bytes']!, 10), 4096, 10485760);
  const requireDerivativeResize = boolValue(values['require-derivative-resize']);
  const auditDerivativesManifest = cleanText(values['audit-derivatives-manifest']);
  const auditDerivativesManifestPath = auditDerivativesManifest ? resolveRepoPath(auditDerivativesManifest) : '';
  const derivativeRows = auditDerivativesManifestPath ? readJsonl<DerivativeReference>(auditDerivativesManifestPath) : [];
  const derivativeById = new Map(derivativeRows.map((row) => [row.id, row]));
  const auditOptions: AuditOptions = {
    publicDomain,
    timeoutMs,
    fetchAttempts,
    auditImageMode,
    thumbApiOrigin,
    imageTransformZone,
    auditWidth,
    auditHeight,
    auditFit,
    auditQuality,
    auditFormat,
    metadataMode,
    metadataRangeBytes,
    requireDerivativeResize,
    derivativeById,
  };

  if (!fs.existsSync(inputPath)) throw new Error(`Missing input: ${inputPath}`);
  if (!publicDomain) throw new Error('Missing R2 public domain.');
  fs.mkdirSync(outputDir, { recursive: true });
  const labelsPath = path.join(outputDir, 'quality_labels.jsonl');
  const downstreamPath = path.join(outputDir, 'quality_issues_downstream.jsonl');
  const failuresPath = path.join(outputDir, 'quality_failures.jsonl');
  const progressPath = path.join(outputDir, 'quality_progress.json');
  const reportPath = path.join(outputDir, 'quality_report.json');
  const markdownPath = path.join(outputDir, 'quality_report.md');

  if (!resume) {
    for (const filePath of [labelsPath, downstreamPath, failuresPath, progressPath, reportPath, markdownPath]) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    }
  }

  const records = readJsonl<ArchiveRecord>(inputPath);
  const candidateReport = readJson<CandidateReport>(candidatesPath);
  const collectionReport = readJson<CollectionReport>(collectionsPath);
  const sample = sampleRecords(records, limit, candidateIds(candidateReport), collectionIds(collectionReport));
  const sampleIds = new Set(sample.map(metadataId));
  const sampleOrder = new Map(sample.map((record, index) => [metadataId(record), index]));
  const existingLabels = resume
    ? dedupeLabels(readJsonl<QualityLabel>(labelsPath)
      .filter((row) => sampleIds.has(row.id))
      .filter((row) => !retryFailures || !isRetriableFailure(row)))
    : [];
  const existingById = new Map(existingLabels.map((row) => [row.id, row]));
  const pending = sample.filter((record) => !existingById.has(metadataId(record)));
  const runStartedAt = new Date().toISOString();
  const newLabels: QualityLabel[] = [];
  let completed = 0;

  const mergedLabels = () => {
    const byId = new Map<string, QualityLabel>();
    for (const row of existingLabels) byId.set(row.id, row);
    for (const row of newLabels) byId.set(row.id, row);
    return Array.from(byId.values())
      .filter((row) => sampleIds.has(row.id))
      .sort((a, b) => (sampleOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (sampleOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  };

  const writeProgress = (status: 'running' | 'completed') => {
    const labels = mergedLabels();
    const summary = summarizeLabels(labels);
    writeJsonAtomic(progressPath, {
      status,
      started_at: runStartedAt,
      updated_at: new Date().toISOString(),
      output_dir: outputDir,
      input_rows: records.length,
      sample_rows: sample.length,
      existing_rows_reused: existingLabels.length,
      pending_rows_at_start: pending.length,
      completed_this_run: completed,
      completed_total: labels.length,
      remaining: Math.max(0, sample.length - labels.length),
      summary,
      artifacts: {
        labels: 'quality_labels.jsonl',
        failures: 'quality_failures.jsonl',
        progress: 'quality_progress.json',
        report: 'quality_report.json',
        markdown: 'quality_report.md',
        downstream: 'quality_issues_downstream.jsonl',
      },
    });
  };

  if (resume && existingLabels.length) {
    console.log(`[autoresearch:image-quality] resume=true existing=${existingLabels.length} pending=${pending.length}`);
  }
  writeProgress('running');

  await runWithConcurrency(pending, concurrency, async (record) => {
    const label = await auditRecord(record, auditOptions);
    appendJsonl(labelsPath, label);
    if (!label.audited || label.error) {
      appendJsonl(failuresPath, failureRows([label])[0]);
    }
    newLabels.push(label);
    completed += 1;
    const completedTotal = existingLabels.length + completed;
    if (completed % progressInterval === 0 || completed === pending.length) {
      writeProgress('running');
      console.log(`[autoresearch:image-quality] progress=${completedTotal}/${sample.length} this_run=${completed}/${pending.length}`);
    }
    return label;
  });
  const labels = mergedLabels();
  const flagged = labels.filter((row) => row.labels.length > 0);
  const summary = summarizeLabels(labels);

  const report = {
    generated_at: new Date().toISOString(),
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, inputPath),
      candidates: fs.existsSync(candidatesPath) ? path.relative(MONOREPO_ROOT, candidatesPath) : null,
      collections: fs.existsSync(collectionsPath) ? path.relative(MONOREPO_ROOT, collectionsPath) : null,
    },
    params: {
      limit,
      concurrency,
      timeoutMs,
      fetchAttempts,
      progressInterval,
      resume,
      retryFailures,
      publicDomain,
      auditImageMode,
      thumbApiOrigin: auditImageMode === 'thumb-api' ? thumbApiOrigin : null,
      imageTransformZone: auditImageMode === 'cloudflare-transform' ? imageTransformZone : null,
      auditWidth,
      auditHeight,
      auditFit,
      auditQuality,
      auditFormat,
      metadataMode,
      metadataRangeBytes,
      requireDerivativeResize,
      auditDerivativesManifest: auditDerivativesManifestPath ? path.relative(MONOREPO_ROOT, auditDerivativesManifestPath) : null,
    },
    summary: {
      input_rows: records.length,
      sample_rows: sample.length,
      existing_rows_reused: existingLabels.length,
      completed_this_run: completed,
      ...summary,
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
      failures: 'quality_failures.jsonl',
      progress: 'quality_progress.json',
    },
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  writeJsonl(labelsPath, labels);
  writeJsonl(downstreamPath, flagged);
  writeJsonl(failuresPath, failureRows(labels));
  writeProgress('completed');

  console.log(`[autoresearch:image-quality] output=${outputDir}`);
  console.log(`[autoresearch:image-quality] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
