#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.resolve('data/mtl_archives/export/manifest_enriched.ndjson');
const OUTPUT_PATH = path.resolve('cloudflare/d1/seed_manifest.sql');
const CHUNK_SIZE = 250;

function escapeValue(value) {
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

function loadRecords() {
  const text = fs.readFileSync(INPUT_PATH, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function buildInsertStatement(rows) {
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
    const recordValues = [
      escapeValue(row.metadata_filename),
      escapeValue(row.image_filename),
      escapeValue(row.resolved_image_filename || row.image_filename),
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
  const records = loadRecords();
  const statements = [];

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    statements.push(buildInsertStatement(chunk));
  }

  fs.writeFileSync(OUTPUT_PATH, statements.join('\n\n'));
  console.log(`Wrote ${records.length} records to ${OUTPUT_PATH}`);
}

main();
