import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { datasetFactoryNowIso } from '../dataset-factory/clock.js';
import {
  CANONICAL_COUNTS,
  VFG_SCHEMA_VERSION,
  clean,
  countBy,
  fileEvidence,
  readJsonl,
  sha256,
  stableId,
  writeJson,
  writeJsonl,
  type CorpusInputRow,
  type PhashFeatureRow,
} from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_CORPUS = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/input/corpus-input-v1.jsonl');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/phash');
const DEFAULT_THUMB_API = 'https://mtl-archives-worker.wiel.workers.dev';
const FEATURE_VERSION = 'phash_dct64_normalized_derivative_v1' as const;
const PHASH_SIZE = 32;
const COSINE = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: PHASH_SIZE }, (_, coordinate) => Math.cos(((2 * coordinate + 1) * frequency * Math.PI) / (2 * PHASH_SIZE))),
);

type ExtractOptions = {
  thumbApiOrigin: string;
  width: number;
  height: number;
  quality: number;
  format: 'jpeg' | 'png' | 'webp';
  fit: 'contain' | 'scale-down';
  timeoutMs: number;
  fetchAttempts: number;
  maxResponseBytes: number;
  derivativeContractId: string;
};

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function repoEvidence(filePath: string, rowCount?: number): Record<string, unknown> {
  return { ...fileEvidence(filePath, rowCount), path: path.relative(ROOT, filePath).split(path.sep).join('/') };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function phashDct64(pixels: Uint8Array, size = 32): string {
  if (pixels.length !== size * size) throw new Error(`pHash expected ${size * size} grayscale pixels, received ${pixels.length}`);
  if (size !== PHASH_SIZE) throw new Error(`pHash implementation supports only ${PHASH_SIZE}x${PHASH_SIZE}`);
  const rowProjection = Array.from({ length: size }, () => new Float64Array(8));
  for (let y = 0; y < size; y += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let x = 0; x < size; x += 1) sum += pixels[y * size + x] * COSINE[u][x];
      rowProjection[y][u] = sum;
    }
  }
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < size; y += 1) sum += rowProjection[y][u] * COSINE[v][y];
      const alphaU = u === 0 ? 1 / Math.sqrt(2) : 1;
      const alphaV = v === 0 ? 1 / Math.sqrt(2) : 1;
      coefficients.push(0.25 * alphaU * alphaV * sum);
    }
  }
  const threshold = median(coefficients.slice(1));
  let hash = 0n;
  for (const coefficient of coefficients) hash = (hash << 1n) | (coefficient > threshold ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

export async function computeVisualFeature(buffer: Buffer): Promise<{
  derivativeWidth: number;
  derivativeHeight: number;
  normalizedPixelSha256: string;
  phash64: string;
}> {
  const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  const derivativeWidth = metadata.width ?? 0;
  const derivativeHeight = metadata.height ?? 0;
  if (!derivativeWidth || !derivativeHeight) throw new Error('decoded image has no dimensions');
  const normalizedPixels = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(256, 256, { fit: 'contain', background: '#ffffff', withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer();
  const phashPixels = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(32, 32, { fit: 'contain', background: '#ffffff', withoutEnlargement: false })
    .grayscale()
    .raw()
    .toBuffer();
  return {
    derivativeWidth,
    derivativeHeight,
    normalizedPixelSha256: sha256(Buffer.concat([Buffer.from('rgb256x256\0'), normalizedPixels])),
    phash64: phashDct64(phashPixels),
  };
}

function thumbUrl(row: CorpusInputRow, options: ExtractOptions): URL {
  const url = new URL('/api/thumb', options.thumbApiOrigin);
  url.searchParams.set('src', row.image_url);
  url.searchParams.set('w', String(options.width));
  url.searchParams.set('h', String(options.height));
  url.searchParams.set('fit', options.fit);
  url.searchParams.set('q', String(options.quality));
  url.searchParams.set('format', options.format);
  return url;
}

async function fetchDerivative(row: CorpusInputRow, options: ExtractOptions): Promise<{ buffer: Buffer; attempts: number }> {
  let last = 'unknown fetch failure';
  for (let attempt = 1; attempt <= options.fetchAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(thumbUrl(row, options), { signal: controller.signal, headers: { accept: 'image/*' } });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > options.maxResponseBytes) throw new Error(`response_too_large_declared_${declared}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > options.maxResponseBytes) throw new Error(`response_too_large_actual_${buffer.byteLength}`);
      return { buffer, attempts: attempt };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < options.fetchAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(last);
}

function failureCode(message: string): string {
  if (/http_404/.test(message)) return 'http_404';
  if (/http_502/.test(message)) return 'thumbnail_source_unavailable';
  if (/too_large/.test(message)) return 'bounded_response_exceeded';
  if (/abort|timeout/i.test(message)) return 'timeout';
  if (/Input buffer|decode|dimensions|unsupported/i.test(message)) return 'decode_failure';
  return 'fetch_or_decode_failure';
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      corpus: { type: 'string', default: DEFAULT_CORPUS },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'thumb-api-origin': { type: 'string', default: DEFAULT_THUMB_API },
      width: { type: 'string', default: '256' },
      height: { type: 'string', default: '256' },
      quality: { type: 'string', default: '80' },
      format: { type: 'string', default: 'jpeg' },
      fit: { type: 'string', default: 'scale-down' },
      concurrency: { type: 'string', default: '8' },
      'timeout-ms': { type: 'string', default: '30000' },
      'fetch-attempts': { type: 'string', default: '3' },
      'max-response-bytes': { type: 'string', default: '1048576' },
      'retry-failures': { type: 'boolean', default: false },
      mode: { type: 'string', default: 'live' },
    },
  });
  const corpusPath = resolvePath(values.corpus!);
  const outputDir = resolvePath(values.output!);
  const featurePath = path.join(outputDir, 'phash-features-v1.jsonl');
  const startedAt = datasetFactoryNowIso();
  const startedMs = Date.now();
  const width = Number.parseInt(values.width!, 10);
  const height = Number.parseInt(values.height!, 10);
  const quality = Number.parseInt(values.quality!, 10);
  const concurrency = Number.parseInt(values.concurrency!, 10);
  const timeoutMs = Number.parseInt(values['timeout-ms']!, 10);
  const fetchAttempts = Number.parseInt(values['fetch-attempts']!, 10);
  const maxResponseBytes = Number.parseInt(values['max-response-bytes']!, 10);
  const format = values.format as ExtractOptions['format'];
  const fit = values.fit as ExtractOptions['fit'];
  if (![width, height].every((value) => Number.isInteger(value) && value >= 64 && value <= 512)) throw new Error('width/height must be 64..512');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('quality must be 1..100');
  if (!['jpeg', 'png', 'webp'].includes(format)) throw new Error('format must be jpeg, png, or webp');
  if (!['contain', 'scale-down'].includes(fit)) throw new Error('fit must be contain or scale-down');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be 1..16');
  if (!Number.isInteger(fetchAttempts) || fetchAttempts < 1 || fetchAttempts > 5) throw new Error('fetch-attempts must be 1..5');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 65536 || maxResponseBytes > 4 * 1024 * 1024) throw new Error('max-response-bytes must be 65536..4194304');
  const transformContract = {
    source: 'public_read_only_thumb_api',
    endpoint: new URL('/api/thumb', values['thumb-api-origin']!).origin,
    width,
    height,
    fit,
    quality,
    format,
    max_response_bytes: maxResponseBytes,
    resize_enforcement: 'decoded derivative dimensions must not exceed requested dimensions by more than 5 percent',
    normalized_pixels: 'auto-oriented, white-flattened, contain-fit RGB 256x256',
    phash: '64-bit DCT pHash over auto-oriented, white-flattened, contain-fit grayscale 32x32; median excludes DC coefficient',
    source_payload_equality_claimed: false,
  };
  const options: ExtractOptions = {
    thumbApiOrigin: values['thumb-api-origin']!, width, height, quality, format, fit, timeoutMs, fetchAttempts, maxResponseBytes,
    derivativeContractId: stableId('derivative-contract', [JSON.stringify(transformContract)]),
  };

  const corpus = readJsonl<CorpusInputRow>(corpusPath);
  if (new Set(corpus.map((row) => row.record_id)).size !== corpus.length) throw new Error('Corpus has duplicate record IDs');
  if (values.mode === 'live' && corpus.length !== CANONICAL_COUNTS.corpus) throw new Error(`Corpus count drift: ${corpus.length}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const existing = fs.existsSync(featurePath) ? readJsonl<PhashFeatureRow>(featurePath) : [];
  const byId = new Map(existing.map((row) => [row.record_id, row]));
  const pending = corpus.filter((row) => !byId.has(row.record_id) || (values['retry-failures'] && byId.get(row.record_id)?.status === 'failure'));
  let completed = 0;
  let responseBytes = 0;
  await mapConcurrent(pending, concurrency, async (row) => {
    const rowStarted = Date.now();
    try {
      const fetched = await fetchDerivative(row, options);
      responseBytes += fetched.buffer.byteLength;
      const feature = await computeVisualFeature(fetched.buffer);
      const maxReturned = Math.max(feature.derivativeWidth, feature.derivativeHeight);
      if (maxReturned > Math.max(width, height) * 1.05) throw new Error(`unbounded_derivative_${feature.derivativeWidth}x${feature.derivativeHeight}`);
      byId.set(row.record_id, {
        schema_version: VFG_SCHEMA_VERSION,
        feature_version: FEATURE_VERSION,
        record_id: row.record_id,
        image_key: row.image_key,
        status: 'success',
        derivative_contract_id: options.derivativeContractId,
        derivative_sha256: sha256(fetched.buffer),
        normalized_pixel_sha256: feature.normalizedPixelSha256,
        phash64: feature.phash64,
        derivative_width: feature.derivativeWidth,
        derivative_height: feature.derivativeHeight,
        derivative_bytes: fetched.buffer.byteLength,
        elapsed_ms: Date.now() - rowStarted,
        attempts: fetched.attempts,
        failure_code: null,
        failure_detail: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      byId.set(row.record_id, {
        schema_version: VFG_SCHEMA_VERSION,
        feature_version: FEATURE_VERSION,
        record_id: row.record_id,
        image_key: row.image_key,
        status: 'failure',
        derivative_contract_id: options.derivativeContractId,
        derivative_sha256: null,
        normalized_pixel_sha256: null,
        phash64: null,
        derivative_width: null,
        derivative_height: null,
        derivative_bytes: 0,
        elapsed_ms: Date.now() - rowStarted,
        attempts: fetchAttempts,
        failure_code: failureCode(message),
        failure_detail: message.slice(0, 240),
      });
    }
    completed += 1;
    if (completed % 250 === 0) {
      const rows = [...byId.values()].sort((a, b) => a.record_id.localeCompare(b.record_id));
      writeJsonl(featurePath, rows);
      console.log(`[vfg-v1:phash] ${completed}/${pending.length} fetched`);
    }
  });
  const features = [...byId.values()].sort((a, b) => a.record_id.localeCompare(b.record_id));
  writeJsonl(featurePath, features);
  const failures = features.filter((row) => row.status === 'failure');
  writeJsonl(path.join(outputDir, 'phash-failures-v1.jsonl'), failures);
  if (features.length !== corpus.length) throw new Error(`Feature coverage mismatch: ${features.length} != ${corpus.length}`);
  if (features.some((row, index) => row.record_id !== corpus[index]?.record_id)) throw new Error('Feature rows do not align one-to-one with corpus records');
  const successes = features.filter((row) => row.status === 'success');
  const completedAt = datasetFactoryNowIso();
  const report = {
    schema_version: VFG_SCHEMA_VERSION,
    feature_version: FEATURE_VERSION,
    generated_at: completedAt,
    transform_contract: { ...transformContract, derivative_contract_id: options.derivativeContractId },
    coverage: {
      corpus_records: corpus.length,
      feature_rows: features.length,
      successful: successes.length,
      failures: failures.length,
      success_rate_percent: Number(((successes.length / corpus.length) * 100).toFixed(6)),
      failure_codes: countBy(failures, (row) => row.failure_code ?? 'unknown'),
      individually_reported: failures.length,
    },
    runtime_storage_cost: {
      started_at: startedAt,
      completed_at: completedAt,
      elapsed_ms: Date.now() - startedMs,
      fetched_this_run: pending.length,
      derivative_response_bytes_this_run: responseBytes,
      derivative_response_bytes_all_successes: successes.reduce((sum, row) => sum + row.derivative_bytes, 0),
      aggregate_record_elapsed_ms: features.reduce((sum, row) => sum + row.elapsed_ms, 0),
      total_attempts_recorded: features.reduce((sum, row) => sum + row.attempts, 0),
      feature_bytes: fs.statSync(featurePath).size,
      cost_usd: 0,
      paid_compute: false,
      original_object_transfer_avoided: true,
    },
    lineage: { corpus: repoEvidence(corpusPath, corpus.length), features: repoEvidence(featurePath, features.length) },
  };
  writeJson(path.join(outputDir, 'phash-report-v1.json'), report);
  console.log(JSON.stringify({ status: 'ok', coverage: report.coverage, output: outputDir }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[vfg-v1:phash] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
