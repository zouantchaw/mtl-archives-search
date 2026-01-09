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
const DEFAULT_BATCH_SIZE = Number(process.env.LINK_BGE_BATCH || '16');
const DEFAULT_DELAY_MS = Number(process.env.LINK_BGE_DELAY_MS || '200');
const DEFAULT_MIN_TEXT = Number(process.env.LINK_BGE_MIN_TEXT || '12');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_dated.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/record_linkage_report.json');
const DEFAULT_MARKDOWN = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/record_linkage_report.md');
const PORTAL_DATASTORE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/phototheque_datastore.json');

const THRESHOLDS = [0.7, 0.75, 0.8, 0.82, 0.85, 0.9];

type PortalCandidate = {
  record: any;
  text: string;
  embedding?: number[];
};

type ExistingEntry = {
  record: any;
  portalRecord: any;
  linkMethod: string;
  text: string;
  embedding?: number[];
};

type UnmatchedEntry = {
  record: any;
  text: string;
  embedding?: number[];
};

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeCote(value: string): string {
  return cleanText(value).toUpperCase().replace(/\s+/g, '');
}

function filenameFromUrl(url: string): string {
  if (!url) return '';
  const parts = url.split('/');
  const last = parts[parts.length - 1] || '';
  const clean = last.split('?')[0];
  return decodeURIComponent(clean);
}

function loadPortalRecords() {
  if (!fs.existsSync(PORTAL_DATASTORE)) {
    throw new Error(`Portal datastore not found: ${PORTAL_DATASTORE}`);
  }
  const raw = fs.readFileSync(PORTAL_DATASTORE, 'utf-8');
  const json = JSON.parse(raw);
  return json?.result?.records || [];
}

function buildPortalIndexes(records: any[]) {
  const byCote = new Map<string, any>();
  const byFilename = new Map<string, any>();

  for (const record of records) {
    const cote = normalizeCote(record?.Cote || '');
    if (cote && !byCote.has(cote)) {
      byCote.set(cote, record);
    }

    const jpgUrl = record?.['Fichier jpg - 200 dpi'] || '';
    const tifUrl = record?.['Fichier tif - 300 dpi'] || '';
    const jpgName = filenameFromUrl(jpgUrl);
    const tifName = filenameFromUrl(tifUrl);

    if (jpgName && !byFilename.has(jpgName)) {
      byFilename.set(jpgName, record);
    }
    if (tifName && !byFilename.has(tifName)) {
      byFilename.set(tifName, record);
    }
  }

  return { byCote, byFilename };
}

function buildPortalText(record: any): string {
  const parts = [
    record?.Titre,
    record?.Description,
    record?.Date,
    record?.Cote,
  ]
    .map(cleanText)
    .filter(Boolean);

  return parts.join('\n');
}

function buildQueryText(record: any): string {
  const parts = [
    record?.name,
    record?.description,
    record?.date_raw || record?.date_value,
    record?.cote,
  ]
    .map(cleanText)
    .filter(Boolean);

  return parts.join('\n');
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

async function generateEmbeddings(endpoint: string, texts: string[]) {
  const response = await postRequest(endpoint, { text: texts }, 'Workers AI');
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
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function truncate(value: string, max = 160): string {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function delay(ms: number) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function summarize(values: number[]) {
  return {
    mean: Number(mean(values).toFixed(4)),
    p10: Number(quantile(values, 0.1).toFixed(4)),
    p50: Number(quantile(values, 0.5).toFixed(4)),
    p90: Number(quantile(values, 0.9).toFixed(4)),
    p95: Number(quantile(values, 0.95).toFixed(4)),
    p99: Number(quantile(values, 0.99).toFixed(4)),
  };
}

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      markdown: { type: 'string', default: DEFAULT_MARKDOWN },
      batch: { type: 'string', default: String(DEFAULT_BATCH_SIZE) },
      delay: { type: 'string', default: String(DEFAULT_DELAY_MS) },
      'min-text': { type: 'string', default: String(DEFAULT_MIN_TEXT) },
      top: { type: 'string', default: '25' },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const markdownPath = values.markdown!;
  const batchSize = Math.max(1, Math.floor(toNumber(values.batch, DEFAULT_BATCH_SIZE)));
  const delayMs = Math.max(0, Math.floor(toNumber(values.delay, DEFAULT_DELAY_MS)));
  const minText = Math.max(0, Math.floor(toNumber(values['min-text'], DEFAULT_MIN_TEXT)));
  const topCount = Math.max(1, Math.floor(toNumber(values.top, 25)));

  if (!ACCOUNT_ID) {
    console.error('Missing CLOUDFLARE_ACCOUNT_ID.');
    process.exit(1);
  }

  if (!API_TOKEN) {
    console.error('Missing CLOUDFLARE_API_TOKEN (needs Workers AI permissions).');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input manifest not found: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const portalRecords = loadPortalRecords();
  const { byCote, byFilename } = buildPortalIndexes(portalRecords);
  const portalCandidates: PortalCandidate[] = portalRecords
    .map(record => ({
      record,
      text: buildPortalText(record),
    }))
    .filter(entry => entry.text.length >= minText);

  const encodedModel = encodeURIComponent(EMBEDDING_MODEL).replace(/%2F/g, '/');
  const aiEndpoint = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodedModel}`;

  console.log(`Embedding portal candidates: ${portalCandidates.length}`);
  const portalEmbeddings: number[][] = [];
  for (let i = 0; i < portalCandidates.length; i += batchSize) {
    const batch = portalCandidates.slice(i, i + batchSize);
    const embeddings = await generateEmbeddings(aiEndpoint, batch.map(entry => entry.text));
    portalEmbeddings.push(...embeddings);
    if (i + batchSize < portalCandidates.length) {
      await delay(delayMs);
    }
  }

  portalCandidates.forEach((entry, idx) => {
    entry.embedding = portalEmbeddings[idx];
  });

  const portalEmbeddingById = new Map<string, number[]>();
  for (const candidate of portalCandidates) {
    const portalId = candidate.record?._id;
    if (portalId !== undefined) {
      portalEmbeddingById.set(String(portalId), candidate.embedding || []);
    }
  }

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));

  const existingEntries: ExistingEntry[] = [];
  const unmatchedEntries: UnmatchedEntry[] = [];

  for (const record of records) {
    const existingPortal = record.portal_record && Object.keys(record.portal_record).length > 0;
    let portalRecord = existingPortal ? record.portal_record : null;
    let linkMethod = existingPortal ? 'existing' : '';

    if (!portalRecord) {
      const cote = normalizeCote(record.cote || record.portal_cote_raw || '');
      if (cote && byCote.has(cote)) {
        portalRecord = byCote.get(cote);
        linkMethod = 'cote';
      }
    }

    if (!portalRecord) {
      const fileName = filenameFromUrl(record.external_url || '')
        || record.resolved_image_filename
        || record.image_filename
        || '';
      if (fileName && byFilename.has(fileName)) {
        portalRecord = byFilename.get(fileName);
        linkMethod = 'file';
      }
    }

    const queryText = buildQueryText(record);
    if (queryText.length < minText) continue;

    if (portalRecord) {
      existingEntries.push({ record, portalRecord, linkMethod, text: queryText });
    } else {
      unmatchedEntries.push({ record, text: queryText });
    }
  }

  console.log(`Embedding existing records: ${existingEntries.length}`);
  for (let i = 0; i < existingEntries.length; i += batchSize) {
    const batch = existingEntries.slice(i, i + batchSize);
    const embeddings = await generateEmbeddings(aiEndpoint, batch.map(entry => entry.text));
    embeddings.forEach((embedding, index) => {
      batch[index].embedding = embedding;
    });
    if (i + batchSize < existingEntries.length) {
      await delay(delayMs);
    }
  }

  console.log(`Embedding unmatched records: ${unmatchedEntries.length}`);
  for (let i = 0; i < unmatchedEntries.length; i += batchSize) {
    const batch = unmatchedEntries.slice(i, i + batchSize);
    const embeddings = await generateEmbeddings(aiEndpoint, batch.map(entry => entry.text));
    embeddings.forEach((embedding, index) => {
      batch[index].embedding = embedding;
    });
    if (i + batchSize < unmatchedEntries.length) {
      await delay(delayMs);
    }
  }

  const existingSimilarities: number[] = [];
  const existingBestMatches: any[] = [];
  let existingTop1Matches = 0;

  for (const entry of existingEntries) {
    const embedding = entry.embedding || [];
    const portalId = String(entry.portalRecord?._id ?? '');
    const portalEmbedding = portalEmbeddingById.get(portalId) || [];
    const linkedSimilarity = cosineSimilarity(embedding, portalEmbedding);
    existingSimilarities.push(linkedSimilarity);

    let bestScore = -1;
    let bestPortal: any = null;
    for (const candidate of portalCandidates) {
      const score = cosineSimilarity(embedding, candidate.embedding || []);
      if (score > bestScore) {
        bestScore = score;
        bestPortal = candidate.record;
      }
    }

    if (bestPortal && String(bestPortal._id) === portalId) {
      existingTop1Matches += 1;
    }

    existingBestMatches.push({
      metadata_filename: entry.record.metadata_filename,
      link_method: entry.linkMethod,
      portal_id: portalId,
      portal_title: entry.portalRecord?.Titre || null,
      similarity: Number(linkedSimilarity.toFixed(4)),
      best_portal_id: bestPortal?._id ?? null,
      best_similarity: Number(bestScore.toFixed(4)),
    });
  }

  const unmatchedBest: any[] = [];
  const unmatchedScores: number[] = [];

  for (const entry of unmatchedEntries) {
    const embedding = entry.embedding || [];
    let bestScore = -1;
    let bestPortal: any = null;
    for (const candidate of portalCandidates) {
      const score = cosineSimilarity(embedding, candidate.embedding || []);
      if (score > bestScore) {
        bestScore = score;
        bestPortal = candidate.record;
      }
    }

    const bestScoreRounded = Number(bestScore.toFixed(4));
    unmatchedScores.push(bestScore);

    unmatchedBest.push({
      metadata_filename: entry.record.metadata_filename,
      name: truncate(cleanText(entry.record.name || ''), 120),
      description: truncate(cleanText(entry.record.description || ''), 140),
      date_value: entry.record.date_value || null,
      cote: entry.record.cote || null,
      best_similarity: bestScoreRounded,
      portal_id: bestPortal?._id ?? null,
      portal_title: truncate(cleanText(bestPortal?.Titre || ''), 120),
      portal_date: bestPortal?.Date || null,
      portal_cote: bestPortal?.Cote || null,
    });
  }

  const unmatchedAboveThresholds: Record<string, number> = {};
  for (const threshold of THRESHOLDS) {
    unmatchedAboveThresholds[threshold.toFixed(2)] = unmatchedScores.filter(score => score >= threshold).length;
  }

  const existingReport = {
    total: existingEntries.length,
    similarity: summarize(existingSimilarities),
    top1_accuracy: existingEntries.length
      ? Number((existingTop1Matches / existingEntries.length).toFixed(4))
      : 0,
  };

  const unmatchedReport = {
    total: unmatchedEntries.length,
    similarity: summarize(unmatchedScores),
    above_thresholds: unmatchedAboveThresholds,
  };

  const topUnmatched = [...unmatchedBest]
    .sort((a, b) => b.best_similarity - a.best_similarity)
    .slice(0, topCount);

  const lowestExisting = [...existingBestMatches]
    .sort((a, b) => a.similarity - b.similarity)
    .slice(0, Math.min(topCount, existingBestMatches.length));

  const report = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    embedding_model: EMBEDDING_MODEL,
    portal_candidates: portalCandidates.length,
    existing_links: existingReport,
    unmatched_candidates: unmatchedReport,
    thresholds: THRESHOLDS,
    top_unmatched: topUnmatched,
    lowest_existing: lowestExisting,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  const markdownLines: string[] = [];
  markdownLines.push('# Record Linkage Report');
  markdownLines.push('');
  markdownLines.push(`Generated: ${report.generated_at}`);
  markdownLines.push(`Input: ${inputPath}`);
  markdownLines.push(`Embedding model: ${EMBEDDING_MODEL}`);
  markdownLines.push(`Portal candidates: ${portalCandidates.length}`);
  markdownLines.push('');
  markdownLines.push('## Existing Links');
  markdownLines.push(`Total: ${existingReport.total}`);
  markdownLines.push(`Top-1 accuracy: ${existingReport.top1_accuracy}`);
  markdownLines.push(`Similarity mean: ${existingReport.similarity.mean}`);
  markdownLines.push(`Similarity p10/p50/p90: ${existingReport.similarity.p10} / ${existingReport.similarity.p50} / ${existingReport.similarity.p90}`);
  markdownLines.push('');
  markdownLines.push('## Unmatched Candidates');
  markdownLines.push(`Total: ${unmatchedReport.total}`);
  markdownLines.push(`Similarity mean: ${unmatchedReport.similarity.mean}`);
  markdownLines.push(`Similarity p10/p50/p90: ${unmatchedReport.similarity.p10} / ${unmatchedReport.similarity.p50} / ${unmatchedReport.similarity.p90}`);
  markdownLines.push('');
  markdownLines.push('### Unmatched Counts Above Thresholds');
  for (const [threshold, count] of Object.entries(unmatchedAboveThresholds)) {
    markdownLines.push(`- ${threshold}: ${count}`);
  }
  markdownLines.push('');
  markdownLines.push(`## Top ${topUnmatched.length} Unmatched Candidates`);
  markdownLines.push('| rank | metadata_filename | similarity | portal_id | portal_title |');
  markdownLines.push('| --- | --- | --- | --- | --- |');
  topUnmatched.forEach((row, idx) => {
    markdownLines.push(`| ${idx + 1} | ${row.metadata_filename} | ${row.best_similarity} | ${row.portal_id ?? ''} | ${row.portal_title || ''} |`);
  });

  if (lowestExisting.length) {
    markdownLines.push('');
    markdownLines.push(`## Lowest ${lowestExisting.length} Existing Matches`);
    markdownLines.push('| rank | metadata_filename | similarity | portal_id | portal_title | best_portal_id | best_similarity |');
    markdownLines.push('| --- | --- | --- | --- | --- | --- | --- |');
    lowestExisting.forEach((row, idx) => {
      markdownLines.push(`| ${idx + 1} | ${row.metadata_filename} | ${row.similarity} | ${row.portal_id ?? ''} | ${row.portal_title || ''} | ${row.best_portal_id ?? ''} | ${row.best_similarity ?? ''} |`);
    });
  }

  fs.writeFileSync(markdownPath, `${markdownLines.join('\n')}\n`, 'utf-8');

  console.log(`Wrote report JSON to ${outputPath}`);
  console.log(`Wrote report markdown to ${markdownPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
