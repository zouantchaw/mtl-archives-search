import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

// Prefer scored manifest (with OCR + VLM) > VLM-captioned > clean > enriched
const SCORED_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_scored.jsonl');
const VLM_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const CLEAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const ENRICHED_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/export/manifest_enriched.ndjson');
const INPUT_PATH = fs.existsSync(SCORED_PATH) ? SCORED_PATH
  : fs.existsSync(VLM_PATH) ? VLM_PATH
  : fs.existsSync(CLEAN_PATH) ? CLEAN_PATH
  : ENRICHED_PATH;
const TAXONOMY_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl');
const QUALITY_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl');

// Ensure output directory exists
const INFRA_DIR = path.resolve(MONOREPO_ROOT, 'infrastructure/d1');
if (!fs.existsSync(INFRA_DIR)) {
  fs.mkdirSync(INFRA_DIR, { recursive: true });
}
const OUTPUT_PATH = path.resolve(INFRA_DIR, 'seed_manifest.sql');

const CHUNK_SIZE = 10; // Moderate chunks with truncated OCR text
const MAX_OCR_LENGTH = 8000; // Truncate OCR text to avoid huge statements

function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value.toString();
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  const str = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${str}'`;
}

function readJsonlMap(filePath: string): Map<string, any> {
  if (!fs.existsSync(filePath)) return new Map();
  const rows = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return new Map(rows.filter((row) => row.id).map((row) => [String(row.id), row]));
}

function buildInsertStatement(rows: any[], taxonomyById: Map<string, any>, qualityById: Map<string, any>) {
  const columns = [
    'metadata_filename',
    'image_filename',
    'resolved_image_filename',
    'image_size_bytes',
    'rotation_degrees',
    'name',
    'description',
    'vlm_caption',
    'ocr_text',
    'trust_score',
    'date_value',
    'credits',
    'cote',
    'external_url',
    'portal_match',
    'portal_title',
    'portal_description',
    'portal_date',
    'portal_cote',
    'aerial_datasets',
    'taxonomy_primary_category',
    'taxonomy_themes',
    'taxonomy_search_facets',
    'taxonomy_review_required',
    'taxonomy_exclude_default_visual',
    'image_quality_labels',
    'image_quality_severity',
    'image_quality_action'
  ];

  const values = rows.map((row) => {
    const aerial = Array.isArray(row.aerial_datasets) ? row.aerial_datasets : [];
    const portalMatch = row.portal_match ? 1 : 0;
    const taxonomy = taxonomyById.get(String(row.metadata_filename)) ?? {};
    const quality = qualityById.get(String(row.metadata_filename)) ?? {};
    
    // Fallback logic matches the original Python script to ensure data integrity
    const resolvedImage = row.resolved_image_filename || row.image_filename;

    const recordValues = [
      escapeValue(row.metadata_filename),
      escapeValue(row.image_filename),
      escapeValue(resolvedImage),
      escapeValue(row.image_size_bytes ?? null),
      escapeValue(row.rotation_degrees ?? null),
      escapeValue(row.name ?? null),
      escapeValue(row.description ?? null),
      escapeValue(row.vlm_caption ?? null),
      escapeValue(null), // OCR text omitted for initial seed - too large
      escapeValue(row.trust_score ?? null),
      escapeValue(row.date_value ?? null),
      escapeValue(row.credits ?? null),
      escapeValue(row.cote ?? null),
      escapeValue(row.external_url ?? null),
      escapeValue(portalMatch),
      escapeValue(row.portal_title ?? null),
      escapeValue(row.portal_description ?? null),
      escapeValue(row.portal_date ?? null),
      escapeValue(row.portal_cote ?? null),
      escapeValue(JSON.stringify(aerial)),
      escapeValue(taxonomy.primaryCategory ?? null),
      escapeValue(JSON.stringify(Array.isArray(taxonomy.themes) ? taxonomy.themes : [])),
      escapeValue(JSON.stringify(Array.isArray(taxonomy.searchFacets) ? taxonomy.searchFacets : [])),
      escapeValue(Boolean(taxonomy.reviewRequired) ? 1 : 0),
      escapeValue(Boolean(taxonomy.excludeFromDefaultVisualSearch) ? 1 : 0),
      escapeValue(JSON.stringify(Array.isArray(quality.labels) ? quality.labels : [])),
      escapeValue(quality.severity ?? null),
      escapeValue(quality.recommendedAction ?? null)
    ];

    return `  (${recordValues.join(', ')})`;
  });

  return `INSERT INTO manifest (${columns.join(', ')})\nVALUES\n${values.join(',\n')}\n;`;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Input file not found: ${INPUT_PATH}`);
    process.exit(1);
  }

  console.log(`Reading from: ${INPUT_PATH}`);
  const text = fs.readFileSync(INPUT_PATH, 'utf-8');
  const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const taxonomyById = readJsonlMap(TAXONOMY_PATH);
  const qualityById = readJsonlMap(QUALITY_PATH);
  
  const statements: string[] = [];

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    statements.push(buildInsertStatement(chunk, taxonomyById, qualityById));
  }

  fs.writeFileSync(OUTPUT_PATH, statements.join('\n\n'));
  console.log(`Generated ${statements.length} INSERT statements (${CHUNK_SIZE} records each)`);
  console.log(`Wrote ${records.length} records to ${OUTPUT_PATH}`);
  console.log(`Joined taxonomy rows: ${taxonomyById.size}`);
  console.log(`Joined quality rows: ${qualityById.size}`);
}

main();
