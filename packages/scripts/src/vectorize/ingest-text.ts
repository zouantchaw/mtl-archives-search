import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

// Configuration
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_AI_TOKEN || process.env.CF_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || 'mtl-archives';
// Using bge-m3 for multilingual support (French/English for Quebec users)
const EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/baai/bge-m3';
const BATCH_SIZE = Number(process.env.VECTORIZE_BATCH_SIZE || '16');

// Defaults - prefer VLM-captioned manifest
const DEFAULT_VLM_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_CLEAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_ENRICHED_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/export/manifest_enriched.ndjson');

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

async function postRequest(url: string, payload: any, label: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': typeof payload === 'string' ? 'application/x-ndjson' : 'application/json',
      },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${label} failed: ${response.status} ${text}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateEmbeddings(texts: string[]) {
  const response = await postRequest(aiEndpoint, { text: texts }, 'Workers AI');
  const json = await response.json() as any;
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
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  await postRequest(vectorEndpoint, ndjson, 'Vectorize upsert');
}

function buildText(record: any): string {
  // Prefer VLM caption if available (actual description of image content)
  if (record.vlm_caption) {
    // Combine name + VLM caption for richer context
    const name = record.name || '';
    return name ? `${name}\n${record.vlm_caption}` : record.vlm_caption;
  }

  // Fallback to original metadata (for non-synthetic records)
  const parts = [
    record.name,
    record.description,
    record.portal_title,
    record.portal_description
  ]
  .filter(Boolean)
  .map(v => String(v));

  return parts.length ? parts.join('\n') : record.metadata_filename;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string' },
      limit: { type: 'string' },
    },
  });

  // Prefer VLM-captioned manifest > clean > enriched
  const manifestPath = values.input
    ? path.resolve(process.cwd(), values.input)
    : (fs.existsSync(DEFAULT_VLM_PATH) ? DEFAULT_VLM_PATH
       : fs.existsSync(DEFAULT_CLEAN_PATH) ? DEFAULT_CLEAN_PATH
       : DEFAULT_ENRICHED_PATH);

  const limit = values.limit ? parseInt(values.limit, 10) : undefined;

  if (!fs.existsSync(manifestPath)) {
    console.error(`Cannot find manifest at ${manifestPath}`);
    process.exit(1);
  }

  console.log(`Reading manifest from: ${manifestPath}`);
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  let records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));

  if (limit) {
    records = records.slice(0, limit);
  }

  const total = records.length;
  const withVlmCaption = records.filter(r => r.vlm_caption).length;
  console.log(`Ingesting ${total} records into index "${VECTORIZE_INDEX}"...`);
  console.log(`  - ${withVlmCaption} with VLM captions (will use vlm_caption)`);
  console.log(`  - ${total - withVlmCaption} without (will use original metadata)`);

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildText);
    
    try {
      const embeddings = await generateEmbeddings(texts);

      if (embeddings.length !== batch.length) {
        throw new Error('Embedding count mismatch.');
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
      console.log(`Upserted ${Math.min(i + BATCH_SIZE, total)}/${total}`);
      
      // Gentle rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err: any) {
      console.error(`Batch ${i} failed:`, err.message);
    }
  }

  console.log('Ingestion complete.');
}

main().catch(console.error);
