import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const CLEAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const ENRICHED_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/export/manifest_enriched.ndjson');
const INPUT_PATH = fs.existsSync(CLEAN_PATH) ? CLEAN_PATH : ENRICHED_PATH;

// Ensure output directory exists
const INFRA_DIR = path.resolve(MONOREPO_ROOT, 'infrastructure/d1');
if (!fs.existsSync(INFRA_DIR)) {
  fs.mkdirSync(INFRA_DIR, { recursive: true });
}
const OUTPUT_PATH = path.resolve(INFRA_DIR, 'seed_manifest.sql');

const CHUNK_SIZE = 100;

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
  return "'"${str}'";
}

function buildInsertStatement(rows: any[]) {
  const columns = [
    'metadata_filename',
    'image_filename',
    'resolved_image_filename',
    'image_size_bytes',
    'name',
    'description',
    'date_value',
    'credits',
    'cote',
    'external_url',
    'portal_match',
    'portal_title',
    'portal_description',
    'portal_date',
    'portal_cote',
    'aerial_datasets'
  ];

  const values = rows.map((row) => {
    const aerial = Array.isArray(row.aerial_datasets) ? row.aerial_datasets : [];
    const portalMatch = row.portal_match ? 1 : 0;
    
    // Fallback logic matches the original Python script to ensure data integrity
    const resolvedImage = row.resolved_image_filename || row.image_filename;

    const recordValues = [
      escapeValue(row.metadata_filename),
      escapeValue(row.image_filename),
      escapeValue(resolvedImage),
      escapeValue(row.image_size_bytes ?? null),
      escapeValue(row.name ?? null),
      escapeValue(row.description ?? null),
      escapeValue(row.date_value ?? null),
      escapeValue(row.credits ?? null),
      escapeValue(row.cote ?? null),
      escapeValue(row.external_url ?? null),
      escapeValue(portalMatch),
      escapeValue(row.portal_title ?? null),
      escapeValue(row.portal_description ?? null),
      escapeValue(row.portal_date ?? null),
      escapeValue(row.portal_cote ?? null),
      escapeValue(JSON.stringify(aerial))
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
  
  const statements: string[] = [];

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    statements.push(buildInsertStatement(chunk));
  }

  fs.writeFileSync(OUTPUT_PATH, statements.join('\n\n'));
  console.log(`Generated ${statements.length} INSERT statements (${CHUNK_SIZE} records each)`);
  console.log(`Wrote ${records.length} records to ${OUTPUT_PATH}`);
}

main();
