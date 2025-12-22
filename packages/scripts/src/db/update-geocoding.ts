import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const INPUT_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_geocoded.jsonl');
const OUTPUT_PATH = path.resolve(MONOREPO_ROOT, 'infrastructure/d1/update_geocoding.sql');

function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value.toString();
    return 'NULL';
  }
  const str = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
  return `'${str}'`;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`Input file not found: ${INPUT_PATH}`);
    console.error('Run the geocoding pipeline first: python3 pipelines/geocoding/geocode_streets.py');
    process.exit(1);
  }

  console.log(`Reading from: ${INPUT_PATH}`);
  const text = fs.readFileSync(INPUT_PATH, 'utf-8');
  const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line));

  // Filter to only geocoded records
  const geocoded = records.filter(r => r.latitude != null && r.longitude != null);

  console.log(`Found ${geocoded.length} geocoded records out of ${records.length} total`);

  const statements: string[] = [
    '-- Update geocoding data',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Geocoded records: ${geocoded.length}`,
    '',
  ];

  for (const record of geocoded) {
    const stmt = `UPDATE manifest SET
  latitude = ${escapeValue(record.latitude)},
  longitude = ${escapeValue(record.longitude)},
  geocode_confidence = ${escapeValue(record.geocode_confidence)},
  geocode_source = ${escapeValue(record.geocode_source || 'name')}
WHERE metadata_filename = ${escapeValue(record.metadata_filename)};`;
    statements.push(stmt);
  }

  fs.writeFileSync(OUTPUT_PATH, statements.join('\n\n'));
  console.log(`Wrote ${geocoded.length} UPDATE statements to ${OUTPUT_PATH}`);
}

main();
