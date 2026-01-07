import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_AI_TOKEN || process.env.CF_AI_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const EMBEDDING_MODEL = process.env.CLOUDFLARE_EMBEDDING_MODEL || '@cf/baai/bge-m3';
const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_BATCH_SIZE = Number(process.env.VECTORIZE_BATCH_SIZE || '8');

if (!ACCOUNT_ID) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Missing CLOUDFLARE_API_TOKEN (needs Workers AI permissions).');
  process.exit(1);
}

const encodedModel = encodeURIComponent(EMBEDDING_MODEL).replace(/%2F/g, '/');
const aiEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodedModel}`;

type RecordInput = {
  metadata_filename?: string;
  name?: string;
  description?: string;
  vlm_caption?: string;
  description_source?: string;
};

type BenchmarkRow = {
  id: string;
  name: string;
  descriptionSource: string;
  description: string;
  descriptionClean: string;
  caption: string;
  similarityRaw: number;
  similarityClean: number;
};

function normalizeText(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function stripSyntheticFragments(value: string): string {
  if (!value) return '';
  const markers = [
    /captur\u00e9e ou dat\u00e9e/i,
    /cote archivistique/i,
    /localisation:/i,
    /photographie d'archive/i,
    /d\u00e9tails suppl\u00e9mentaires/i,
    /description g\u00e9n\u00e9r\u00e9e automatiquement/i,
  ];
  const sentences = value.split(/(?<=[.!?])\s+/);
  const filtered = sentences.filter(sentence => !markers.some(re => re.test(sentence)));
  const result = filtered.join(' ').trim();
  return result || value;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function postRequest(url: string, payload: any, label: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string' },
      limit: { type: 'string' },
      sample: { type: 'string' },
      seed: { type: 'string' },
      output: { type: 'string' },
      batch: { type: 'string' },
    },
  });

  const inputPath = values.input ? path.resolve(process.cwd(), values.input) : DEFAULT_INPUT;
  const limit = values.limit ? parseInt(values.limit, 10) : undefined;
  const sample = values.sample ? parseInt(values.sample, 10) : undefined;
  const seed = values.seed ? parseInt(values.seed, 10) : 42;
  const outputPath = values.output ? path.resolve(process.cwd(), values.output) : null;
  const batchSize = values.batch ? parseInt(values.batch, 10) : DEFAULT_BATCH_SIZE;

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as RecordInput);

  const filtered = records
    .filter(record => record.vlm_caption && record.description)
    .filter(record => (record.description_source || '').toLowerCase().includes('original'))
    .map(record => {
      const description = normalizeText(record.description);
      const caption = normalizeText(record.vlm_caption);
      const descriptionClean = stripSyntheticFragments(description);
      return {
        id: record.metadata_filename || '',
        name: normalizeText(record.name),
        descriptionSource: record.description_source || '',
        description,
        descriptionClean: descriptionClean.length >= 12 ? descriptionClean : description,
        caption,
      };
    })
    .filter(record => record.id && record.description && record.caption);

  if (!filtered.length) {
    console.log('No records with original descriptions + VLM captions found.');
    return;
  }

  let sampleSet = filtered;
  if (sample && sample > 0 && sample < filtered.length) {
    const rng = mulberry32(seed);
    const shuffled = [...filtered].sort(() => rng() - 0.5);
    sampleSet = shuffled.slice(0, sample);
  } else if (limit && limit > 0) {
    sampleSet = filtered.slice(0, limit);
  }

  console.log(`Embedding model: ${EMBEDDING_MODEL}`);
  console.log(`Records available: ${filtered.length}`);
  console.log(`Records evaluated: ${sampleSet.length}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('');

  const results: BenchmarkRow[] = [];

  for (let i = 0; i < sampleSet.length; i += batchSize) {
    const batch = sampleSet.slice(i, i + batchSize);
    const texts: string[] = [];
    const indexMap = batch.map(record => {
      const rawIndex = texts.length;
      texts.push(record.description);
      const cleanIndex = texts.length;
      texts.push(record.descriptionClean);
      const captionIndex = texts.length;
      texts.push(record.caption);
      return { rawIndex, cleanIndex, captionIndex };
    });

    const embeddings = await generateEmbeddings(texts);

    batch.forEach((record, idx) => {
      const { rawIndex, cleanIndex, captionIndex } = indexMap[idx];
      const rawEmb = embeddings[rawIndex];
      const cleanEmb = embeddings[cleanIndex];
      const captionEmb = embeddings[captionIndex];
      const similarityRaw = cosineSimilarity(rawEmb, captionEmb);
      const similarityClean = cosineSimilarity(cleanEmb, captionEmb);
      results.push({
        ...record,
        similarityRaw,
        similarityClean,
      });
    });

    console.log(`Processed ${Math.min(i + batchSize, sampleSet.length)}/${sampleSet.length}`);
  }

  const rawScores = results.map(r => r.similarityRaw);
  const cleanScores = results.map(r => r.similarityClean);
  const meanRaw = mean(rawScores);
  const meanClean = mean(cleanScores);
  const delta = meanClean - meanRaw;

  console.log('\nSummary (cosine similarity)');
  console.log(`Raw   mean ${meanRaw.toFixed(3)} | p10 ${quantile(rawScores, 0.1).toFixed(3)} | median ${quantile(rawScores, 0.5).toFixed(3)} | p90 ${quantile(rawScores, 0.9).toFixed(3)}`);
  console.log(`Clean mean ${meanClean.toFixed(3)} | p10 ${quantile(cleanScores, 0.1).toFixed(3)} | median ${quantile(cleanScores, 0.5).toFixed(3)} | p90 ${quantile(cleanScores, 0.9).toFixed(3)}`);
  console.log(`Mean delta (clean - raw): ${delta.toFixed(3)}`);

  const lowThreshold = 0.25;
  const lowCount = cleanScores.filter(score => score < lowThreshold).length;
  console.log(`Clean similarity < ${lowThreshold.toFixed(2)}: ${lowCount}/${cleanScores.length}`);

  const worst = [...results].sort((a, b) => a.similarityClean - b.similarityClean).slice(0, 10);
  console.log('\nWorst matches (by clean similarity)');
  worst.forEach((row, idx) => {
    console.log(`\n${idx + 1}. ${row.id} | ${row.name || 'Untitled'} | ${row.descriptionSource}`);
    console.log(`   similarity raw ${row.similarityRaw.toFixed(3)} | clean ${row.similarityClean.toFixed(3)}`);
    console.log(`   description: ${truncate(row.description)}`);
    if (row.descriptionClean !== row.description) {
      console.log(`   description clean: ${truncate(row.descriptionClean)}`);
    }
    console.log(`   caption: ${truncate(row.caption)}`);
  });

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2));
    console.log(`\nWrote full results to: ${outputPath}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
