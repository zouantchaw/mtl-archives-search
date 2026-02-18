import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@xenova/transformers';
import { classifySearchQualityRecord } from '../analysis/search-quality-rules.js';

type Checkpoint = {
  nextIndex: number;
  total: number;
  inputPath: string;
  selectionKey?: string;
  updatedAt: string;
};

type ClipVectorRecord = {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN;
const R2_PUBLIC_DOMAIN = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || 'mtl-archives-clip';
const BATCH_SIZE = parseInt(process.env.CLIP_BATCH_SIZE || '8', 10);
const MAX_RETRIES = Number(process.env.CLIP_MAX_RETRIES || '4');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_CHECKPOINT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.checkpoints/vectorize-clip.json');
const DEFAULT_FAILURE_LOG = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.logs/vectorize-clip-failures.ndjson');
const VECTORIZE_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Error: Missing Cloudflare credentials (ACCOUNT_ID, API_TOKEN)');
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendFailureLog(failureLogPath: string, payload: Record<string, unknown>) {
  ensureParentDir(failureLogPath);
  fs.appendFileSync(failureLogPath, `${JSON.stringify(payload)}\n`);
}

function loadCheckpoint(checkpointPath: string): Checkpoint | null {
  if (!fs.existsSync(checkpointPath)) return null;
  try {
    const raw = fs.readFileSync(checkpointPath, 'utf-8');
    const parsed = JSON.parse(raw) as Checkpoint;
    if (!Number.isFinite(parsed.nextIndex) || parsed.nextIndex < 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCheckpoint(checkpointPath: string, checkpoint: Checkpoint) {
  ensureParentDir(checkpointPath);
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function buildSelectionKey(offset: number, limit: number, excludeDocumentLikely = false) {
  return `offset=${offset};limit=${limit};excludeDocumentLikely=${excludeDocumentLikely ? '1' : '0'}`;
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= maxRetries) break;
      const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.warn(`${label} retry ${attempt}/${maxRetries} (${backoffMs}ms): ${lastError.message}`);
      await sleep(backoffMs);
    }
  }
  throw lastError ?? new Error(`${label} failed unexpectedly`);
}

async function* readManifestLines(inputPath: string): AsyncGenerator<string> {
  const fileStream = fs.createReadStream(inputPath);
  const rl = (await import('readline')).createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield line;
  }
}

async function countSelectedRecords(inputPath: string, offset: number, limit: number, excludeDocumentLikely = false) {
  let rawIndex = 0;
  let selected = 0;

  for await (const _line of readManifestLines(inputPath)) {
    if (rawIndex < offset) {
      rawIndex += 1;
      continue;
    }
    if (limit > 0 && selected >= limit) break;
    const record = JSON.parse(_line);
    if (excludeDocumentLikely && classifySearchQualityRecord(record).label === 'document_likely') {
      rawIndex += 1;
      continue;
    }
    selected += 1;
    rawIndex += 1;
  }

  return selected;
}

async function* iterateSelectedRecords(
  inputPath: string,
  offset: number,
  limit: number,
  startIndex: number,
  excludeDocumentLikely = false
) {
  let rawIndex = 0;
  let selectedIndex = 0;

  for await (const line of readManifestLines(inputPath)) {
    if (rawIndex < offset) {
      rawIndex += 1;
      continue;
    }

    if (limit > 0 && selectedIndex >= limit) break;

    const record = JSON.parse(line);
    if (excludeDocumentLikely && classifySearchQualityRecord(record).label === 'document_likely') {
      rawIndex += 1;
      continue;
    }

    if (selectedIndex < startIndex) {
      selectedIndex += 1;
      rawIndex += 1;
      continue;
    }

    yield { index: selectedIndex, record };
    selectedIndex += 1;
    rawIndex += 1;
  }
}

async function upsertVectors(vectors: ClipVectorRecord[]) {
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n');

  await withRetries('Vectorize upsert', async () => {
    const response = await fetch(VECTORIZE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    });

    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      if (isRetryableStatus(response.status)) {
        throw new Error(`retryable status ${response.status}: ${text}`);
      }
      throw new Error(`non-retryable status ${response.status}: ${text}`);
    }
  });
}

async function vectorizeRecord(record: any, model: CLIPVisionModelWithProjection, processor: any): Promise<ClipVectorRecord> {
  let url = record.external_url;
  if (!url && R2_PUBLIC_DOMAIN) {
    const img = record.resolved_image_filename || record.image_filename;
    if (img) url = `https://${R2_PUBLIC_DOMAIN}/${img}`;
  }
  if (!url) {
    throw new Error('Missing image URL for record');
  }

  const image = await withRetries('Image read', async () => RawImage.read(url), 3);
  const imageInputs = await processor(image);
  const { image_embeds } = await model(imageInputs);

  const raw = image_embeds.data as Float32Array;
  let sumSq = 0;
  for (let k = 0; k < raw.length; k += 1) sumSq += raw[k] * raw[k];
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('Invalid CLIP embedding norm');
  }

  const values: number[] = [];
  for (let k = 0; k < raw.length; k += 1) values.push(raw[k] / norm);

  const metadata: Record<string, unknown> = {};
  if (record.name) metadata.name = record.name;
  if (record.attributes_map?.Date) metadata.date = record.attributes_map.Date;
  const imageKey = record.resolved_image_filename || record.image_filename;
  if (imageKey) metadata.image = imageKey;

  return {
    id: record.metadata_filename,
    values,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      limit: { type: 'string', default: '0' },
      offset: { type: 'string', default: '0' },
      checkpoint: { type: 'string' },
      'failure-log': { type: 'string' },
      'from-batch': { type: 'string' },
      'allow-skips': { type: 'boolean', default: false },
      'exclude-document-likely': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
    },
  });

  const inputPath = path.resolve(process.cwd(), values.input!);
  const limit = parseInt(values.limit!, 10);
  const offset = parseInt(values.offset!, 10);
  const checkpointPath = values.checkpoint
    ? path.resolve(process.cwd(), values.checkpoint)
    : DEFAULT_CHECKPOINT;
  const failureLogPath = values['failure-log']
    ? path.resolve(process.cwd(), values['failure-log'])
    : DEFAULT_FAILURE_LOG;
  const excludeDocumentLikely = values['exclude-document-likely'];
  const selectionKey = buildSelectionKey(offset, limit, excludeDocumentLikely);

  if (!fs.existsSync(inputPath)) {
    console.error(`Manifest not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('Loading CLIP model (Xenova/clip-vit-base-patch32)...');
  const model = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32');
  const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');

  console.log('Model loaded. Manifest ingestion mode: streaming (no full-file in-memory load)');

  const total = await countSelectedRecords(inputPath, offset, limit, excludeDocumentLikely);
  let startIndex = 0;
  const fromBatch = values['from-batch'] ? parseInt(values['from-batch'], 10) : undefined;

  if (!values.reset) {
    const checkpoint = loadCheckpoint(checkpointPath);
    if (checkpoint && checkpoint.inputPath === inputPath && checkpoint.selectionKey === selectionKey) {
      startIndex = Math.min(checkpoint.nextIndex, total);
      console.log(`Resuming from checkpoint: ${startIndex}/${total}`);
    }
  }

  if (Number.isFinite(fromBatch)) {
    startIndex = Math.max(0, (fromBatch as number) * BATCH_SIZE);
    console.log(`Manual resume override from batch ${(fromBatch as number)} -> index ${startIndex}`);
  }

  console.log(`Processing ${total} records (starting at ${startIndex})...`);
  if (excludeDocumentLikely) {
    console.log('Document-likely records are excluded from this ingest run.');
  }

  let processed = 0;
  let skipped = 0;
  let batch: { index: number; record: any }[] = [];

  for await (const item of iterateSelectedRecords(inputPath, offset, limit, startIndex, excludeDocumentLikely)) {
    batch.push(item);
    if (batch.length < BATCH_SIZE) continue;

    const batchStartIndex = batch[0].index;

    try {
      const results = await Promise.all(batch.map(async ({ record }) => {
        try {
          return await vectorizeRecord(record, model, processor);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          appendFailureLog(failureLogPath, {
            timestamp: new Date().toISOString(),
            batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
            startIndex: batchStartIndex,
            recordId: record.metadata_filename,
            inputPath,
            selectionKey,
            error: err.message,
          });
          return null;
        }
      }));

      const validVectors = results.filter((v): v is ClipVectorRecord => v !== null);
      const skippedInBatch = batch.length - validVectors.length;

      if (validVectors.length > 0) {
        await upsertVectors(validVectors);
        processed += validVectors.length;
      }
      skipped += skippedInBatch;

      const completed = Math.min(batchStartIndex + batch.length, total);
      saveCheckpoint(checkpointPath, {
        nextIndex: completed,
        total,
        inputPath,
        selectionKey,
        updatedAt: new Date().toISOString(),
      });

      process.stdout.write(`\rProcessed: ${processed}, Skipped: ${skipped}, Progress: ${completed}/${total}`);
      batch = [];
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendFailureLog(failureLogPath, {
        timestamp: new Date().toISOString(),
        batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
        startIndex: batchStartIndex,
        batchSize: batch.length,
        inputPath,
        selectionKey,
        error: err.message,
      });
      throw err;
    }
  }

  if (batch.length > 0) {
    const batchStartIndex = batch[0].index;

    try {
      const results = await Promise.all(batch.map(async ({ record }) => {
        try {
          return await vectorizeRecord(record, model, processor);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          appendFailureLog(failureLogPath, {
            timestamp: new Date().toISOString(),
            batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
            startIndex: batchStartIndex,
            recordId: record.metadata_filename,
            inputPath,
            selectionKey,
            error: err.message,
          });
          return null;
        }
      }));

      const validVectors = results.filter((v): v is ClipVectorRecord => v !== null);
      const skippedInBatch = batch.length - validVectors.length;

      if (validVectors.length > 0) {
        await upsertVectors(validVectors);
        processed += validVectors.length;
      }
      skipped += skippedInBatch;

      const completed = Math.min(batchStartIndex + batch.length, total);
      saveCheckpoint(checkpointPath, {
        nextIndex: completed,
        total,
        inputPath,
        selectionKey,
        updatedAt: new Date().toISOString(),
      });

      process.stdout.write(`\rProcessed: ${processed}, Skipped: ${skipped}, Progress: ${completed}/${total}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendFailureLog(failureLogPath, {
        timestamp: new Date().toISOString(),
        batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
        startIndex: batchStartIndex,
        batchSize: batch.length,
        inputPath,
        selectionKey,
        error: err.message,
      });
      throw err;
    }
  }

  console.log('\nIngestion complete.');
  console.log(`Summary -> Processed: ${processed}, Skipped: ${skipped}, Total: ${total}`);

  if (skipped > 0 && !values['allow-skips']) {
    console.error(`Run failed integrity gate: skipped ${skipped} records. See ${failureLogPath}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
