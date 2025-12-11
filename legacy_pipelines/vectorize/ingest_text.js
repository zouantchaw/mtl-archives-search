#!/usr/bin/env node
/**
 * Batch-ingest manifest entries into Cloudflare Vectorize using Workers AI embeddings.
 *
 * Required environment variables:
 * - CLOUDFLARE_AI_TOKEN       (token with AI:*, Vectorize write permissions)
 * - CLOUDFLARE_R2_ACCOUNT_ID  (account ID, reused for AI/Vectorize calls)
 * Optional:
 * - CLOUDFLARE_VECTORIZE_INDEX (defaults to "mtl-archives")
 * - CLOUDFLARE_EMBEDDING_MODEL (defaults to "@cf/baai/bge-large-en-v1.5")
 * - VECTORIZE_BATCH_SIZE       (defaults to 16)
 * - VECTORIZE_LIMIT            (limit number of records ingested for testing)
 */

const fs = require('fs');
const path = require('path');
loadDotEnv();

function loadDotEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const original of lines) {
    const line = original.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    process.env[key] = value;
  }
}

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN =
  process.env.CLOUDFLARE_AI_TOKEN ||
  process.env.CF_AI_TOKEN ||
  process.env.CLOUDFLARE_API_TOKEN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || 'mtl-archives';
const EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/baai/bge-large-en-v1.5';
const BATCH_SIZE = Number(process.env.VECTORIZE_BATCH_SIZE || '16');
const LIMIT = process.env.VECTORIZE_LIMIT ? Number(process.env.VECTORIZE_LIMIT) : undefined;

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_R2_ACCOUNT_ID.');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Set CLOUDFLARE_AI_TOKEN (preferred), CF_AI_TOKEN, or CLOUDFLARE_API_TOKEN before running this script.');
  process.exit(1);
}

// Use cleaned manifest if it exists, otherwise fall back to enriched
const cleanPath = path.resolve('data/mtl_archives/manifest_clean.jsonl');
const enrichedPath = path.resolve('data/mtl_archives/export/manifest_enriched.ndjson');
const manifestPath = fs.existsSync(cleanPath) ? cleanPath : enrichedPath;

if (!fs.existsSync(manifestPath)) {
  console.error(`Cannot find manifest file at ${manifestPath}`);
  process.exit(1);
}

console.log(`Reading manifest from: ${manifestPath}`);
const raw = fs.readFileSync(manifestPath, 'utf-8');
const lines = raw.split('\n').filter(Boolean);
let records = lines.map((line) => JSON.parse(line));
if (Number.isFinite(LIMIT)) {
  records = records.slice(0, LIMIT);
}

const total = records.length;
if (!total) {
  console.log('No records to ingest.');
  process.exit(0);
}

const encodedModel = encodeURIComponent(EMBEDDING_MODEL).replace(/%2F/g, '/');
const aiEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodedModel}`;
const vectorEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${encodeURIComponent(VECTORIZE_INDEX)}/upsert`;

async function generateEmbeddings(texts) {
  const response = await postRequest(aiEndpoint, { text: texts }, 'Workers AI');

  const json = await response.json();
  const vectors = json.result?.data || json.result?.output || json.result;
  if (!Array.isArray(vectors)) {
    throw new Error('Unexpected embeddings response shape.');
  }
  return vectors.map((entry) => {
    if (Array.isArray(entry?.embedding)) return entry.embedding;
    if (Array.isArray(entry)) return entry;
    throw new Error('Missing embedding array in response.');
  });
}

async function upsertVectors(vectors) {
  const ndjson = vectors
    .map((vector) => JSON.stringify(vector))
    .join('\n');

  await postRequest(
    vectorEndpoint,
    ndjson,
    'Vectorize upsert',
    { contentType: 'application/x-ndjson', serializeBody: false }
  );
}

function buildText(record) {
  const parts = [record.name, record.description, record.portal_title, record.portal_description]
    .filter(Boolean)
    .map((value) => String(value));
  return parts.length ? parts.join('\n') : record.metadata_filename;
}

async function postRequest(url, payload, label, options = {}) {
  const { contentType = 'application/json', serializeBody = true } = options;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${API_TOKEN}`);
  headers.set('Content-Type', contentType);
  headers.set('Accept', 'application/json');

  let bodyString;
  if (serializeBody) {
    bodyString = JSON.stringify(payload);
  } else {
    bodyString = typeof payload === 'string' ? payload : String(payload);
  }

  if (process.env.DEBUG_VECTORIZE_HEADERS) {
    console.debug(`[debug] ${label} request headers`, Object.fromEntries(headers.entries()));
    const preview = bodyString;
    console.debug(
      `[debug] ${label} payload preview`,
      preview.length > 500 ? `${preview.slice(0, 500)}…` : preview
    );
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.VECTORIZE_REQUEST_TIMEOUT_MS || '60000');
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyString,
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`${label} request failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await safeReadBody(response);
    throw new Error(`${label} failed: ${response.status} ${errorText}`);
  }

  return response;
}

async function safeReadBody(response) {
  try {
    const text = await response.text();
    return text || '<empty body>';
  } catch (error) {
    return `<failed to read body: ${error.message}>`;
  }
}

(async () => {
  console.log(`Ingesting ${total} records into Vectorize index "${VECTORIZE_INDEX}" using model ${EMBEDDING_MODEL}.`);
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildText);
    const embeddings = await generateEmbeddings(texts);

    if (embeddings.length !== batch.length) {
      throw new Error('Embedding count mismatch.');
    }

    const vectors = batch.map((record, idx) => {
      const metadata = {};
      if (record.name) metadata.name = record.name;
      if (record.date_value) metadata.date = record.date_value;
      const imageKey = record.resolved_image_filename || record.image_filename;
      if (imageKey) metadata.image = imageKey;

      const vector = {
        id: record.metadata_filename,
        values: embeddings[idx],
      };

      if (Object.keys(metadata).length > 0) {
        vector.metadata = metadata;
      }

      return vector;
    });

    await upsertVectors(vectors);
    console.log(`Upserted ${Math.min(i + BATCH_SIZE, total)}/${total}`);

    // gentle rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('Vectorize ingestion complete.');
})();
