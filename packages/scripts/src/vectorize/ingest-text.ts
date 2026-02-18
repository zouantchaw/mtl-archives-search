import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { classifySearchQualityRecord } from '../analysis/search-quality-rules.js';

type Checkpoint = {
  nextIndex: number;
  total: number;
  manifestPath: string;
  selectionKey?: string;
  updatedAt: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_AI_TOKEN || process.env.CF_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || 'mtl-archives';
const EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/baai/bge-m3';
const BATCH_SIZE = Number(process.env.VECTORIZE_BATCH_SIZE || '16');
const MAX_RETRIES = Number(process.env.VECTORIZE_MAX_RETRIES || '4');

const DEFAULT_VLM_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_CLEAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_ENRICHED_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/export/manifest_enriched.ndjson');
const DEFAULT_CHECKPOINT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.checkpoints/vectorize-text.json');
const DEFAULT_FAILURE_LOG = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/.logs/vectorize-text-failures.ndjson');

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN (needs AI and Vectorize permissions).');
  process.exit(1);
}

const encodedModel = encodeURIComponent(EMBEDDING_MODEL).replace(/%2F/g, '/');
const aiEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodedModel}`;
const vectorEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${encodeURIComponent(VECTORIZE_INDEX)}/upsert`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
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

function buildSelectionKey(limit?: number, excludeDocumentLikely = false) {
  return `limit=${limit ?? 'all'};excludeDocumentLikely=${excludeDocumentLikely ? '1' : '0'}`;
}

async function* readManifestLines(manifestPath: string): AsyncGenerator<string> {
  const fileStream = fs.createReadStream(manifestPath);
  const rl = (await import('readline')).createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield line;
  }
}

async function summarizeManifest(manifestPath: string, limit?: number, excludeDocumentLikely = false) {
  let total = 0;
  let withVlmCaption = 0;
  let skippedDocumentLikely = 0;

  for await (const line of readManifestLines(manifestPath)) {
    if (limit && total >= limit) break;
    const record = JSON.parse(line);
    if (excludeDocumentLikely && classifySearchQualityRecord(record).label === 'document_likely') {
      skippedDocumentLikely += 1;
      continue;
    }
    if (record.vlm_caption) withVlmCaption += 1;
    total += 1;
  }

  return { total, withVlmCaption, skippedDocumentLikely };
}

async function* iterateSelectedRecords(
  manifestPath: string,
  limit: number | undefined,
  startIndex: number,
  excludeDocumentLikely = false
) {
  let selectedIndex = 0;

  for await (const line of readManifestLines(manifestPath)) {
    if (limit && selectedIndex >= limit) break;

    const record = JSON.parse(line);
    if (excludeDocumentLikely && classifySearchQualityRecord(record).label === 'document_likely') {
      continue;
    }

    if (selectedIndex < startIndex) {
      selectedIndex += 1;
      continue;
    }

    yield { index: selectedIndex, record };
    selectedIndex += 1;
  }
}

async function postRequest(url: string, payload: unknown, label: string) {
  if (process.env.VECTORIZE_FORCE_FAILURE === '1') {
    throw new Error(`Forced failure for smoke test (${label})`);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': typeof payload === 'string' ? 'application/x-ndjson' : 'application/json',
        },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = (await response.text()).slice(0, 400);
        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
          const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
          console.warn(`${label} retry ${attempt}/${MAX_RETRIES} after HTTP ${response.status} (${backoffMs}ms)`);
          await sleep(backoffMs);
          continue;
        }
        throw new Error(`${label} failed: ${response.status} ${text}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        console.warn(`${label} retry ${attempt}/${MAX_RETRIES} after network error (${backoffMs}ms): ${lastError.message}`);
        await sleep(backoffMs);
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`${label} failed unexpectedly`);
}

async function generateEmbeddings(texts: string[]) {
  const response = await postRequest(aiEndpoint, { text: texts }, 'Workers AI');
  const json = (await response.json()) as any;
  const vectors = json.result?.data || json.result?.output || json.result;

  if (!Array.isArray(vectors)) {
    throw new Error('Unexpected embeddings response shape.');
  }

  return vectors.map((entry: any) => {
    if (Array.isArray(entry?.embedding)) return entry.embedding;
    if (Array.isArray(entry)) return entry;
    throw new Error('Missing embedding array in response.');
  });
}

async function upsertVectors(vectors: any[]) {
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n');
  await postRequest(vectorEndpoint, ndjson, 'Vectorize upsert');
}

function buildText(record: any): string {
  if (record.vlm_caption) {
    const name = record.name || '';
    return name ? `${name}\n${record.vlm_caption}` : record.vlm_caption;
  }

  const parts = [record.name, record.description, record.portal_title, record.portal_description]
    .filter(Boolean)
    .map((v) => String(v));

  return parts.length ? parts.join('\n') : record.metadata_filename;
}

async function processBatch(batch: any[], batchStartIndex: number, total: number, manifestPath: string, checkpointPath: string, selectionKey: string) {
  const texts = batch.map(buildText);
  const embeddings = await generateEmbeddings(texts);

  if (embeddings.length !== batch.length) {
    throw new Error(`Embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`);
  }

  const vectors = batch.map((record, idx) => {
    const metadata: any = {};
    if (record.name) metadata.name = record.name;
    if (record.date_value) metadata.date = record.date_value;
    const imageKey = record.resolved_image_filename || record.image_filename;
    if (imageKey) metadata.image = imageKey;

    return {
      id: record.metadata_filename,
      values: embeddings[idx],
      metadata: Object.keys(metadata).length ? metadata : undefined,
    };
  });

  await upsertVectors(vectors);

  const completed = Math.min(batchStartIndex + batch.length, total);
  saveCheckpoint(checkpointPath, {
    nextIndex: completed,
    total,
    manifestPath,
    selectionKey,
    updatedAt: new Date().toISOString(),
  });

  console.log(`Upserted ${completed}/${total}`);
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string' },
      limit: { type: 'string' },
      checkpoint: { type: 'string' },
      'failure-log': { type: 'string' },
      'from-batch': { type: 'string' },
      'exclude-document-likely': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
    },
  });

  const manifestPath = values.input
    ? path.resolve(process.cwd(), values.input)
    : fs.existsSync(DEFAULT_VLM_PATH)
      ? DEFAULT_VLM_PATH
      : fs.existsSync(DEFAULT_CLEAN_PATH)
        ? DEFAULT_CLEAN_PATH
        : DEFAULT_ENRICHED_PATH;

  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const checkpointPath = values.checkpoint
    ? path.resolve(process.cwd(), values.checkpoint)
    : DEFAULT_CHECKPOINT;
  const failureLogPath = values['failure-log']
    ? path.resolve(process.cwd(), values['failure-log'])
    : DEFAULT_FAILURE_LOG;
  const excludeDocumentLikely = values['exclude-document-likely'];
  const selectionKey = buildSelectionKey(limit, excludeDocumentLikely);

  if (!fs.existsSync(manifestPath)) {
    console.error(`Cannot find manifest at ${manifestPath}`);
    process.exit(1);
  }

  console.log(`Reading manifest from: ${manifestPath}`);
  console.log('Manifest ingestion mode: streaming (no full-file in-memory load)');

  const summary = await summarizeManifest(manifestPath, limit, excludeDocumentLikely);
  const total = summary.total;
  const withVlmCaption = summary.withVlmCaption;

  console.log(`Ingesting ${total} records into index "${VECTORIZE_INDEX}"...`);
  console.log(`  - ${withVlmCaption} with VLM captions (will use vlm_caption)`);
  console.log(`  - ${total - withVlmCaption} without (will use original metadata)`);
  if (excludeDocumentLikely) {
    console.log(`  - skipped ${summary.skippedDocumentLikely} records classified as document_likely`);
  }

  let startIndex = 0;
  const fromBatch = values['from-batch'] ? parseInt(values['from-batch'], 10) : undefined;

  if (!values.reset) {
    const checkpoint = loadCheckpoint(checkpointPath);
    if (checkpoint && checkpoint.manifestPath === manifestPath && checkpoint.selectionKey === selectionKey) {
      startIndex = Math.min(checkpoint.nextIndex, total);
      console.log(`Resuming from checkpoint: ${startIndex}/${total}`);
    }
  }

  if (Number.isFinite(fromBatch)) {
    startIndex = Math.max(0, (fromBatch as number) * BATCH_SIZE);
    console.log(`Manual resume override from batch ${(fromBatch as number)} -> index ${startIndex}`);
  }

  let batch: any[] = [];
  let batchStartIndex = startIndex;

  for await (const item of iterateSelectedRecords(manifestPath, limit, startIndex, excludeDocumentLikely)) {
    if (batch.length === 0) {
      batchStartIndex = item.index;
    }

    batch.push(item.record);

    if (batch.length < BATCH_SIZE) continue;

    try {
      await processBatch(batch, batchStartIndex, total, manifestPath, checkpointPath, selectionKey);
      await sleep(200);
      batch = [];
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendFailureLog(failureLogPath, {
        timestamp: new Date().toISOString(),
        batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
        startIndex: batchStartIndex,
        batchSize: batch.length,
        checkpointPath,
        manifestPath,
        selectionKey,
        error: err.message,
      });
      throw err;
    }
  }

  if (batch.length > 0) {
    try {
      await processBatch(batch, batchStartIndex, total, manifestPath, checkpointPath, selectionKey);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendFailureLog(failureLogPath, {
        timestamp: new Date().toISOString(),
        batchIndex: Math.floor(batchStartIndex / BATCH_SIZE),
        startIndex: batchStartIndex,
        batchSize: batch.length,
        checkpointPath,
        manifestPath,
        selectionKey,
        error: err.message,
      });
      throw err;
    }
  }

  saveCheckpoint(checkpointPath, {
    nextIndex: total,
    total,
    manifestPath,
    selectionKey,
    updatedAt: new Date().toISOString(),
  });
  console.log(`Ingestion complete. Coverage: ${total}/${total}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
