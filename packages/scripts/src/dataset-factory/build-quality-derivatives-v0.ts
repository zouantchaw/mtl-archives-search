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

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_CANDIDATES = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_candidates/candidates.json');
const DEFAULT_COLLECTIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_collections/collections.json');
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0/audit_derivatives_v0');

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  vlm_error?: string | null;
  vlm_metadata_error?: string | null;
  vlm_metadata?: {
    scene_type?: string;
    print_quality?: string;
    aerial_ground_document?: string;
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

type DerivativeRow = {
  id: string;
  title: string;
  date: string;
  imagePath: string;
  originalImageUrl: string;
  derivativePath: string;
  originalBytes: number;
  derivativeBytes: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceOrientation: number | null;
  derivativeWidth: number | null;
  derivativeHeight: number | null;
  generatedAt: string;
};

type FailureRow = {
  id: string;
  title: string;
  imagePath: string;
  originalImageUrl: string;
  error: string;
  generatedAt: string;
};

class ImageFetchError extends Error {
  constructor(message: string, readonly kind: 'http' | 'timeout' | 'network', readonly status?: number) {
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

function readJsonl<T>(filePath: string): T[] {
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

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function appendJsonl(filePath: string, row: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
}

function metadataId(record: ArchiveRecord): string {
  return cleanText(record.metadata_filename);
}

function imagePath(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function title(record: ArchiveRecord): string {
  return cleanText(record.name || record.metadata_filename || record.image_filename);
}

function dateValue(record: ArchiveRecord): string {
  return cleanText(record.attributes_map?.Date);
}

function imageUrl(record: ArchiveRecord, publicDomain: string): string {
  const key = imagePath(record);
  if (key && publicDomain) return `https://${publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(key)}`;
  return cleanText(record.external_url);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImageOnce(url: string, timeoutMs: number): Promise<Buffer> {
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

async function fetchImage(url: string, timeoutMs: number, attempts: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImageOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof ImageFetchError && error.kind === 'http') throw error;
      if (attempt < attempts) await sleep(750 * attempt);
    }
  }
  throw lastError;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()));
}

function derivativeFileName(id: string): string {
  return `${id.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_')}.jpg`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '100' },
      concurrency: { type: 'string', default: '2' },
      width: { type: 'string', default: '1024' },
      height: { type: 'string', default: '1024' },
      quality: { type: 'string', default: '82' },
      'fetch-timeout-ms': { type: 'string', default: '60000' },
      'fetch-attempts': { type: 'string', default: '2' },
      'progress-interval': { type: 'string', default: '25' },
      resume: { type: 'boolean', default: false },
      'skip-existing-failures': { type: 'boolean', default: false },
      'public-domain': { type: 'string', default: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN || '' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  const imageDir = path.join(outputDir, 'images');
  const manifestPath = path.join(outputDir, 'derivatives_manifest.jsonl');
  const failuresPath = path.join(outputDir, 'derivatives_failures.jsonl');
  const progressPath = path.join(outputDir, 'derivatives_progress.json');
  const reportPath = path.join(outputDir, 'derivatives_report.json');
  const limit = Number.parseInt(values.limit!, 10);
  const concurrency = Number.parseInt(values.concurrency!, 10);
  const width = Number.parseInt(values.width!, 10);
  const height = Number.parseInt(values.height!, 10);
  const quality = Number.parseInt(values.quality!, 10);
  const timeoutMs = Number.parseInt(values['fetch-timeout-ms']!, 10);
  const fetchAttempts = Number.parseInt(values['fetch-attempts']!, 10);
  const progressInterval = Number.parseInt(values['progress-interval']!, 10);
  const resume = Boolean(values.resume);
  const skipExistingFailures = Boolean(values['skip-existing-failures']);
  const publicDomain = cleanText(values['public-domain']);

  fs.mkdirSync(imageDir, { recursive: true });
  if (!resume) {
    for (const filePath of [manifestPath, failuresPath, progressPath, reportPath]) {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    }
  }

  const records = readJsonl<ArchiveRecord>(inputPath);
  const sample = sampleRecords(records, limit, candidateIds(readJson<CandidateReport>(candidatesPath)), collectionIds(readJson<CollectionReport>(collectionsPath)));
  const existing = resume ? readJsonl<DerivativeRow>(manifestPath) : [];
  const existingIds = new Set(existing.map((row) => row.id));
  const existingFailures = resume && skipExistingFailures ? readJsonl<FailureRow>(failuresPath) : [];
  const existingFailureIds = new Set(existingFailures.map((row) => row.id));
  const pending = sample.filter((record) => !existingIds.has(metadataId(record)) && !existingFailureIds.has(metadataId(record)));
  const runStartedAt = new Date().toISOString();
  let completed = 0;
  let failed = 0;
  let originalBytes = existing.reduce((sum, row) => sum + row.originalBytes, 0);
  let derivativeBytes = existing.reduce((sum, row) => sum + row.derivativeBytes, 0);

  const writeProgress = (status: 'running' | 'completed') => {
    writeJsonAtomic(progressPath, {
      status,
      started_at: runStartedAt,
      updated_at: new Date().toISOString(),
      input_rows: records.length,
      sample_rows: sample.length,
      existing_rows_reused: existing.length,
      skipped_existing_failures: existingFailureIds.size,
      pending_rows_at_start: pending.length,
      completed_this_run: completed,
      failed_this_run: failed,
      completed_total: existing.length + completed,
      remaining: Math.max(0, sample.length - existing.length - existingFailureIds.size - completed - failed),
      original_gb_read: Number((originalBytes / 1e9).toFixed(4)),
      derivative_mb_written: Number((derivativeBytes / 1e6).toFixed(2)),
      artifacts: {
        manifest: 'derivatives_manifest.jsonl',
        failures: 'derivatives_failures.jsonl',
        progress: 'derivatives_progress.json',
        report: 'derivatives_report.json',
        images: 'images/',
      },
    });
  };

  writeProgress('running');

  await runWithConcurrency(pending, concurrency, async (record) => {
    const id = metadataId(record);
    const url = imageUrl(record, publicDomain);
    const derivativePath = path.join(imageDir, derivativeFileName(id));
    try {
      if (!url) throw new Error('No image URL');
      const original = await fetchImage(url, timeoutMs, fetchAttempts);
      const sourceMetadata = await sharp(original, { failOn: 'none' }).metadata();
      const derivative = await sharp(original, { failOn: 'none' })
        .resize({ width, height, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const derivativeMetadata = await sharp(derivative, { failOn: 'none' }).metadata();
      fs.writeFileSync(derivativePath, derivative);
      const row: DerivativeRow = {
        id,
        title: title(record),
        date: dateValue(record),
        imagePath: imagePath(record),
        originalImageUrl: url,
        derivativePath: path.relative(MONOREPO_ROOT, derivativePath),
        originalBytes: original.length,
        derivativeBytes: derivative.length,
        sourceWidth: sourceMetadata.width ?? null,
        sourceHeight: sourceMetadata.height ?? null,
        sourceOrientation: sourceMetadata.orientation ?? null,
        derivativeWidth: derivativeMetadata.width ?? null,
        derivativeHeight: derivativeMetadata.height ?? null,
        generatedAt: new Date().toISOString(),
      };
      appendJsonl(manifestPath, row);
      completed += 1;
      originalBytes += original.length;
      derivativeBytes += derivative.length;
    } catch (error) {
      failed += 1;
      appendJsonl(failuresPath, {
        id,
        title: title(record),
        imagePath: imagePath(record),
        originalImageUrl: url,
        error: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString(),
      });
    }
    if ((completed + failed) % progressInterval === 0 || completed + failed === pending.length) {
      writeProgress('running');
      console.log(`[quality-derivatives-v0] progress=${existing.length + completed}/${sample.length} failed=${failed}`);
    }
  });

  const finalRows = readJsonl<DerivativeRow>(manifestPath);
  const finalIds = new Set(finalRows.map((row) => row.id));
  const unresolvedFailures = readJsonl<FailureRow>(failuresPath)
    .filter((row) => !finalIds.has(row.id));
  const latestFailureById = new Map<string, FailureRow>();
  for (const row of unresolvedFailures) latestFailureById.set(row.id, row);
  const finalFailures = [...latestFailureById.values()];
  writeJsonl(failuresPath, finalFailures);
  const report = {
    generated_at: new Date().toISOString(),
    issue: 53,
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, inputPath),
      candidates: fs.existsSync(candidatesPath) ? path.relative(MONOREPO_ROOT, candidatesPath) : null,
      collections: fs.existsSync(collectionsPath) ? path.relative(MONOREPO_ROOT, collectionsPath) : null,
    },
    params: { limit, concurrency, width, height, quality, timeoutMs, fetchAttempts, progressInterval, resume, skipExistingFailures, publicDomain },
    summary: {
      input_rows: records.length,
      sample_rows: sample.length,
      derivative_rows: finalRows.length,
      failed_rows: finalFailures.length,
      skipped_existing_failures: existingFailureIds.size,
      original_gb_read: Number((finalRows.reduce((sum, row) => sum + row.originalBytes, 0) / 1e9).toFixed(4)),
      derivative_mb_written: Number((finalRows.reduce((sum, row) => sum + row.derivativeBytes, 0) / 1e6).toFixed(2)),
    },
    artifacts: {
      manifest: 'derivatives_manifest.jsonl',
      failures: 'derivatives_failures.jsonl',
      progress: 'derivatives_progress.json',
      report: 'derivatives_report.json',
      images: 'images/',
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeProgress('completed');
  console.log(`[quality-derivatives-v0] output=${outputDir}`);
  console.log(`[quality-derivatives-v0] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
