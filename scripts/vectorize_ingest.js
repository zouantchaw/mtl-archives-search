#!/usr/bin/env node
/**
 * Batch-ingest manifest entries into Cloudflare Vectorize using Workers AI embeddings.
 *
 * Required environment variables:
 * - CLOUDFLARE_API_TOKEN      (token with AI:*, Vectorize write permissions)
 * - CLOUDFLARE_R2_ACCOUNT_ID  (account ID, reused for AI/Vectorize calls)
 * Optional:
 * - CLOUDFLARE_VECTORIZE_INDEX (defaults to "mtl-archives")
 * - CLOUDFLARE_EMBEDDING_MODEL (defaults to "@cf/baai/bge-large-en-v1.5")
 * - VECTORIZE_BATCH_SIZE       (defaults to 16)
 * - VECTORIZE_LIMIT            (limit number of records ingested for testing)
 */

const fs = require('fs');
const path = require('path');

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const VECTORIZE_INDEX = process.env.CLOUDFLARE_VECTORIZE_INDEX || 'mtl-archives';
const EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/baai/bge-large-en-v1.5';
const BATCH_SIZE = Number(process.env.VECTORIZE_BATCH_SIZE || '16');
const LIMIT = process.env.VECTORIZE_LIMIT ? Number(process.env.VECTORIZE_LIMIT) : undefined;

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_R2_ACCOUNT_ID.');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

const manifestPath = path.resolve('data/mtl_archives/export/manifest_enriched.ndjson');
if (!fs.existsSync(manifestPath)) {
  console.error(`Cannot find manifest file at ${manifestPath}`);
  process.exit(1);
}

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

const aiEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodeURIComponent(EMBEDDING_MODEL)}`;
const vectorEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/indexes/${encodeURIComponent(VECTORIZE_INDEX)}/upsert`;

async function generateEmbeddings(texts) {
  const response = await fetch(aiEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texts }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${error}`);
  }

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
  const response = await fetch(vectorEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vectors }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vectorize upsert failed: ${response.status} ${error}`);
  }
}

function buildText(record) {
  const parts = [record.name, record.description, record.portal_title, record.portal_description]
    .filter(Boolean)
    .map((value) => String(value));
  return parts.length ? parts.join('\n') : record.metadata_filename;
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

    const vectors = batch.map((record, idx) => ({
      id: record.metadata_filename,
      values: embeddings[idx],
      metadata: {
        name: record.name || '',
        date: record.date_value || '',
        image: record.resolved_image_filename || record.image_filename,
      },
    }));

    await upsertVectors(vectors);
    console.log(`Upserted ${Math.min(i + BATCH_SIZE, total)}/${total}`);

    // gentle rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('Vectorize ingestion complete.');
})();
