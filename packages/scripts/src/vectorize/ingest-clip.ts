import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@xenova/transformers';

type Checkpoint = {
  nextIndex: number;
  total: number;
  inputPath: string;
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

async function upsertVectors(vectors: any[]) {
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

  if (!fs.existsSync(inputPath)) {
    console.error(`Manifest not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('Loading CLIP model (Xenova/clip-vit-base-patch32)...');
  const model = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32');
  const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');

  console.log('Model loaded. Reading manifest...');
  const records: any[] = [];
  const fileStream = fs.createReadStream(inputPath);
  const rl = (await import('readline')).createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim()) records.push(JSON.parse(line));
  }

  let subset = records.slice(offset);
  if (limit > 0) subset = subset.slice(0, limit);

  const total = subset.length;
  let startIndex = 0;
  const fromBatch = values['from-batch'] ? parseInt(values['from-batch'], 10) : undefined;

  if (!values.reset) {
    const checkpoint = loadCheckpoint(checkpointPath);
    if (checkpoint && checkpoint.inputPath === inputPath) {
      startIndex = Math.min(checkpoint.nextIndex, total);
      console.log(`Resuming from checkpoint: ${startIndex}/${total}`);
    }
  }

  if (Number.isFinite(fromBatch)) {
    startIndex = Math.max(0, (fromBatch as number) * BATCH_SIZE);
    console.log(`Manual resume override from batch ${(fromBatch as number)} -> index ${startIndex}`);
  }

  console.log(`Processing ${total} records (starting at ${startIndex})...`);

  let processed = 0;
  let skipped = 0;

  for (let i = startIndex; i < total; i += BATCH_SIZE) {
    const batch = subset.slice(i, i + BATCH_SIZE);

  const results = await Promise.all(batch.map(async (record) => {
      try {
        return await vectorizeRecord(record, model, processor);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        appendFailureLog(failureLogPath, {
          timestamp: new Date().toISOString(),
          batchIndex: Math.floor(i / BATCH_SIZE),
          startIndex: i,
          recordId: record.metadata_filename,
          inputPath,
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

    const completed = Math.min(i + batch.length, total);
    saveCheckpoint(checkpointPath, {
      nextIndex: completed,
      total,
      inputPath,
      updatedAt: new Date().toISOString(),
    });

    process.stdout.write(`\rProcessed: ${processed}, Skipped: ${skipped}, Progress: ${completed}/${total}`);
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
