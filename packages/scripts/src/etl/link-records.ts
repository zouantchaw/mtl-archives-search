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
const DEFAULT_BGE_THRESHOLD = Number(process.env.LINK_BGE_THRESHOLD || '0.82');
const DEFAULT_BGE_BATCH = Number(process.env.LINK_BGE_BATCH || '16');
const DEFAULT_BGE_DELAY_MS = Number(process.env.LINK_BGE_DELAY_MS || '200');
const MIN_BGE_TEXT_LENGTH = Number(process.env.LINK_BGE_MIN_TEXT || '12');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_dated.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked_summary.json');
const PORTAL_DATASTORE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/phototheque_datastore.json');

type PortalCandidate = {
  record: any;
  text: string;
  embedding?: number[];
};

type PendingCandidate = {
  index: number;
  text: string;
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
    console.warn(`Portal datastore not found: ${PORTAL_DATASTORE}`);
    return [];
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

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function delay(ms: number) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
      bge: { type: 'boolean', default: false },
      'bge-threshold': { type: 'string' },
      'bge-batch': { type: 'string' },
      'bge-delay': { type: 'string' },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;
  const useBge = Boolean(values.bge);
  const bgeThreshold = toNumber(values['bge-threshold'], DEFAULT_BGE_THRESHOLD);
  const bgeBatchSize = Math.max(1, Math.floor(toNumber(values['bge-batch'], DEFAULT_BGE_BATCH)));
  const bgeDelayMs = Math.max(0, Math.floor(toNumber(values['bge-delay'], DEFAULT_BGE_DELAY_MS)));

  if (!fs.existsSync(inputPath)) {
    console.error(`Input manifest not found: ${inputPath}`);
    process.exit(1);
  }

  if (useBge) {
    if (!ACCOUNT_ID) {
      console.error('Missing CLOUDFLARE_ACCOUNT_ID.');
      process.exit(1);
    }
    if (!API_TOKEN) {
      console.error('Missing CLOUDFLARE_API_TOKEN (needs Workers AI permissions).');
      process.exit(1);
    }
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const portalRecords = loadPortalRecords();
  const { byCote, byFilename } = buildPortalIndexes(portalRecords);
  const encodedModel = encodeURIComponent(EMBEDDING_MODEL).replace(/%2F/g, '/');
  const aiEndpoint = ACCOUNT_ID
    ? `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${encodedModel}`
    : '';

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    portal_linked_total: 0,
    portal_linked_existing: 0,
    portal_linked_new: 0,
    portal_linked_bge: 0,
    portal_link_methods: {} as Record<string, number>,
    bge_enabled: useBge,
    bge_threshold: useBge ? bgeThreshold : null,
    bge_batch_size: useBge ? bgeBatchSize : null,
    bge_delay_ms: useBge ? bgeDelayMs : null,
    bge_portal_candidates: 0,
    bge_candidate_records: 0,
  };

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const records = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const linkedRecords = [...records];
  const bgePending: PendingCandidate[] = [];

  if (useBge) {
    const portalCandidates: PortalCandidate[] = portalRecords
      .map(record => ({
        record,
        text: buildPortalText(record),
      }))
      .filter(entry => entry.text.length >= MIN_BGE_TEXT_LENGTH);

    summary.bge_portal_candidates = portalCandidates.length;
    console.log(`Loaded ${records.length} records.`);
    console.log(`Preparing ${portalCandidates.length} portal embeddings using ${EMBEDDING_MODEL}...`);

    const portalEmbeddings: number[][] = [];
    for (let i = 0; i < portalCandidates.length; i += bgeBatchSize) {
      const batch = portalCandidates.slice(i, i + bgeBatchSize);
      const texts = batch.map(entry => entry.text);
      const embeddings = await generateEmbeddings(aiEndpoint, texts);
      portalEmbeddings.push(...embeddings);
      if (i + bgeBatchSize < portalCandidates.length) {
        await delay(bgeDelayMs);
      }
    }

    portalCandidates.forEach((entry, idx) => {
      entry.embedding = portalEmbeddings[idx];
    });

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      summary.total_records += 1;

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

      if (portalRecord) {
        summary.portal_linked_total += 1;
        summary.portal_link_methods[linkMethod] = (summary.portal_link_methods[linkMethod] || 0) + 1;
        if (linkMethod === 'existing') {
          summary.portal_linked_existing += 1;
        } else {
          summary.portal_linked_new += 1;
        }

        const recordLinkId = `portal:${portalRecord._id}`;
        const recordLinkConfidence = linkMethod === 'file' ? 1.0 : linkMethod === 'cote' ? 0.9 : 1.0;
        linkedRecords[index] = {
          ...record,
          portal_match: record.portal_match || Boolean(portalRecord),
          portal_record: portalRecord,
          record_link_id: recordLinkId,
          record_link_confidence: recordLinkConfidence,
          record_link_evidence: {
            portal: {
              method: linkMethod,
              portal_id: portalRecord._id ?? null,
              portal_cote: portalRecord.Cote ?? null,
              portal_file_url: portalRecord['Fichier jpg - 200 dpi'] || portalRecord['Fichier tif - 300 dpi'] || null,
            },
          },
        };
      } else {
        const queryText = buildQueryText(record);
        if (queryText.length >= MIN_BGE_TEXT_LENGTH && portalCandidates.length) {
          bgePending.push({ index, text: queryText });
        }
        linkedRecords[index] = {
          ...record,
          portal_record: record.portal_record || null,
          record_link_id: record.record_link_id ?? null,
          record_link_confidence: record.record_link_confidence ?? null,
          record_link_evidence: record.record_link_evidence ?? null,
        };
      }
    }

    summary.bge_candidate_records = bgePending.length;

    if (bgePending.length && portalCandidates.length) {
      console.log(`Running BGE matching for ${bgePending.length} candidates...`);
      for (let i = 0; i < bgePending.length; i += bgeBatchSize) {
        const batch = bgePending.slice(i, i + bgeBatchSize);
        const embeddings = await generateEmbeddings(aiEndpoint, batch.map(item => item.text));

        embeddings.forEach((embedding, batchIndex) => {
          let bestScore = -1;
          let bestPortal: any = null;
          for (const entry of portalCandidates) {
            const score = cosineSimilarity(embedding, entry.embedding || []);
            if (score > bestScore) {
              bestScore = score;
              bestPortal = entry.record;
            }
          }

          if (bestPortal && bestScore >= bgeThreshold) {
            const recordIndex = batch[batchIndex].index;
            const record = linkedRecords[recordIndex];
            summary.portal_linked_total += 1;
            summary.portal_linked_new += 1;
            summary.portal_linked_bge += 1;
            summary.portal_link_methods.bge = (summary.portal_link_methods.bge || 0) + 1;

            linkedRecords[recordIndex] = {
              ...record,
              portal_match: record.portal_match || Boolean(bestPortal),
              portal_record: bestPortal,
              record_link_id: `portal:${bestPortal._id}`,
              record_link_confidence: Number(bestScore.toFixed(4)),
              record_link_evidence: {
                portal: {
                  method: 'bge',
                  portal_id: bestPortal._id ?? null,
                  portal_cote: bestPortal.Cote ?? null,
                  portal_file_url: bestPortal['Fichier jpg - 200 dpi'] || bestPortal['Fichier tif - 300 dpi'] || null,
                  bge_similarity: Number(bestScore.toFixed(4)),
                },
              },
            };
          }
        });

        if (i + bgeBatchSize < bgePending.length) {
          await delay(bgeDelayMs);
        }

        console.log(`Processed ${Math.min(i + bgeBatchSize, bgePending.length)}/${bgePending.length}`);
      }
    }
  } else {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      summary.total_records += 1;

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

      if (portalRecord) {
        summary.portal_linked_total += 1;
        summary.portal_link_methods[linkMethod] = (summary.portal_link_methods[linkMethod] || 0) + 1;
        if (linkMethod === 'existing') {
          summary.portal_linked_existing += 1;
        } else {
          summary.portal_linked_new += 1;
        }

        const recordLinkId = `portal:${portalRecord._id}`;
        const recordLinkConfidence = linkMethod === 'file' ? 1.0 : linkMethod === 'cote' ? 0.9 : 1.0;
        linkedRecords[index] = {
          ...record,
          portal_match: record.portal_match || Boolean(portalRecord),
          portal_record: portalRecord,
          record_link_id: recordLinkId,
          record_link_confidence: recordLinkConfidence,
          record_link_evidence: {
            portal: {
              method: linkMethod,
              portal_id: portalRecord._id ?? null,
              portal_cote: portalRecord.Cote ?? null,
              portal_file_url: portalRecord['Fichier jpg - 200 dpi'] || portalRecord['Fichier tif - 300 dpi'] || null,
            },
          },
        };
      } else {
        linkedRecords[index] = {
          ...record,
          portal_record: record.portal_record || null,
          record_link_id: record.record_link_id ?? null,
          record_link_confidence: record.record_link_confidence ?? null,
          record_link_evidence: record.record_link_evidence ?? null,
        };
      }
    }
  }

  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  for (const record of linkedRecords) {
    outputStream.write(JSON.stringify(record) + '\n');
  }
  outputStream.end();

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote linked manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
