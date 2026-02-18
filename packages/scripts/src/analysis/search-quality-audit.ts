import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/search_quality_audit.json');
const DEFAULT_DOC_SAMPLES = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/search_quality_document_samples.ndjson');
const DEFAULT_DUP_SAMPLES = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/search_quality_duplicate_samples.ndjson');

const DOC_KEYWORDS = [
  'document', 'dossier', 'registre', 'rapport', 'lettre', 'formulaire', 'tableau', 'newspaper', 'journal', 'article',
  'plan', 'blueprint', 'carte', 'map', 'dessin', 'drawing', 'gravure', 'poster', 'affiche', 'acte', 'certificat',
  'invoice', 'facture', 'catalogue', 'index', 'texte', 'typed', 'manuscrit',
];

const PHOTO_KEYWORDS = [
  'photo', 'photographie', 'vue', 'street', 'rue', 'parc', 'avenue', 'boulevard', 'église', 'church', 'pont', 'bridge',
  'bâtiment', 'building', 'façade', 'aerial', 'tramway', 'car', 'voiture', 'neige', 'hiver',
];

type Report = {
  generatedAt: string;
  inputPath: string;
  totalRecords: number;
  classified: {
    photoLikely: number;
    documentLikely: number;
    unknown: number;
  };
  duplicates: {
    exactImageGroups: number;
    exactImageRecords: number;
    nearTextGroups: number;
    nearTextRecords: number;
  };
  outputs: {
    reportPath: string;
    documentSamplesPath: string;
    duplicateSamplesPath: string;
  };
};

type DuplicateGroup = {
  type: 'exact_image' | 'near_text';
  signature: string;
  records: Array<Record<string, unknown>>;
};

function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeTokenText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëîïôöùûüç\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenScore(haystack: string, keywords: string[]) {
  let score = 0;
  for (const word of keywords) {
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

function classifyRecord(record: any): 'photo_likely' | 'document_likely' | 'unknown' {
  const text = [
    cleanText(record.name),
    cleanText(record.description),
    cleanText(record.portal_record?.Titre),
    cleanText(record.portal_record?.Description),
    cleanText(record.vlm_caption),
  ].join(' ');

  const docScore = tokenScore(text, DOC_KEYWORDS);
  const photoScore = tokenScore(text, PHOTO_KEYWORDS);

  if (docScore >= 2 && docScore > photoScore) return 'document_likely';
  if (photoScore >= 1 && photoScore >= docScore) return 'photo_likely';
  return 'unknown';
}

function extractYear(record: any): string {
  const dateValue = cleanText(record.date_value || record.attributes_map?.Date || record.portal_record?.Date || '');
  const match = dateValue.match(/(18\d{2}|19\d{2}|20\d{2})/);
  return match ? match[1] : 'unknown';
}

function buildNearTextSignature(record: any): string | null {
  const baseName = normalizeTokenText(cleanText(record.name || record.portal_record?.Titre || ''));
  if (!baseName || baseName.length < 8) return null;

  const desc = normalizeTokenText(cleanText(record.description || record.portal_record?.Description || ''));
  const descHead = desc.split(' ').slice(0, 10).join(' ');
  const year = extractYear(record);

  const signature = `${baseName}|${year}|${descHead}`.trim();
  if (signature.replace(/[|\s]/g, '').length < 14) return null;
  return signature;
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function makeSample(record: any, classification: string) {
  return {
    metadata_filename: record.metadata_filename,
    name: record.name ?? null,
    date_value: record.date_value ?? null,
    cote: record.cote ?? null,
    resolved_image_filename: record.resolved_image_filename ?? null,
    classification,
    description: record.description ?? null,
    portal_title: record.portal_record?.Titre ?? null,
    portal_description: record.portal_record?.Description ?? null,
  };
}

async function* readJsonl(inputPath: string): AsyncGenerator<any> {
  const stream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const readline = await import('readline');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      report: { type: 'string', default: DEFAULT_REPORT },
      'document-samples': { type: 'string', default: DEFAULT_DOC_SAMPLES },
      'duplicate-samples': { type: 'string', default: DEFAULT_DUP_SAMPLES },
      limit: { type: 'string', default: '0' },
      'sample-limit': { type: 'string', default: '150' },
    },
  });

  const inputPath = path.resolve(process.cwd(), values.input!);
  const reportPath = path.resolve(process.cwd(), values.report!);
  const docSamplesPath = path.resolve(process.cwd(), values['document-samples']!);
  const dupSamplesPath = path.resolve(process.cwd(), values['duplicate-samples']!);
  const limit = Number(values.limit || '0');
  const sampleLimit = Number(values['sample-limit'] || '150');

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const exactImageGroups = new Map<string, any[]>();
  const nearTextGroups = new Map<string, any[]>();

  const documentSamples: any[] = [];
  const duplicateSamples: DuplicateGroup[] = [];

  let totalRecords = 0;
  let photoLikely = 0;
  let documentLikely = 0;
  let unknown = 0;

  for await (const record of readJsonl(inputPath)) {
    if (limit > 0 && totalRecords >= limit) break;

    totalRecords += 1;
    const classification = classifyRecord(record);

    if (classification === 'photo_likely') photoLikely += 1;
    else if (classification === 'document_likely') {
      documentLikely += 1;
      if (documentSamples.length < sampleLimit) {
        documentSamples.push(makeSample(record, classification));
      }
    } else {
      unknown += 1;
    }

    const imageKey = cleanText(record.resolved_image_filename || record.image_filename || '');
    if (imageKey) {
      const group = exactImageGroups.get(imageKey) ?? [];
      group.push(makeSample(record, classification));
      exactImageGroups.set(imageKey, group);
    }

    const nearSig = buildNearTextSignature(record);
    if (nearSig) {
      const group = nearTextGroups.get(nearSig) ?? [];
      group.push(makeSample(record, classification));
      nearTextGroups.set(nearSig, group);
    }
  }

  const exactDuplicateGroups = Array.from(exactImageGroups.entries())
    .filter(([, records]) => records.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  const nearDuplicateGroups = Array.from(nearTextGroups.entries())
    .filter(([, records]) => records.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [signature, records] of exactDuplicateGroups.slice(0, sampleLimit)) {
    duplicateSamples.push({ type: 'exact_image', signature, records });
  }
  for (const [signature, records] of nearDuplicateGroups.slice(0, sampleLimit)) {
    duplicateSamples.push({ type: 'near_text', signature, records });
  }

  const exactImageRecords = exactDuplicateGroups.reduce((sum, [, records]) => sum + records.length, 0);
  const nearTextRecords = nearDuplicateGroups.reduce((sum, [, records]) => sum + records.length, 0);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    totalRecords,
    classified: {
      photoLikely,
      documentLikely,
      unknown,
    },
    duplicates: {
      exactImageGroups: exactDuplicateGroups.length,
      exactImageRecords,
      nearTextGroups: nearDuplicateGroups.length,
      nearTextRecords,
    },
    outputs: {
      reportPath,
      documentSamplesPath: docSamplesPath,
      duplicateSamplesPath: dupSamplesPath,
    },
  };

  ensureDir(reportPath);
  ensureDir(docSamplesPath);
  ensureDir(dupSamplesPath);

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(docSamplesPath, documentSamples.map((row) => JSON.stringify(row)).join('\n') + (documentSamples.length ? '\n' : ''));
  fs.writeFileSync(dupSamplesPath, duplicateSamples.map((row) => JSON.stringify(row)).join('\n') + (duplicateSamples.length ? '\n' : ''));

  console.log(`[search-quality:audit] total=${totalRecords}`);
  console.log(`[search-quality:audit] class photo=${photoLikely}, document=${documentLikely}, unknown=${unknown}`);
  console.log(`[search-quality:audit] exact-dup groups=${exactDuplicateGroups.length}, records=${exactImageRecords}`);
  console.log(`[search-quality:audit] near-dup groups=${nearDuplicateGroups.length}, records=${nearTextRecords}`);
  console.log(`[search-quality:audit] report=${reportPath}`);
  console.log(`[search-quality:audit] document-samples=${docSamplesPath}`);
  console.log(`[search-quality:audit] duplicate-samples=${dupSamplesPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
