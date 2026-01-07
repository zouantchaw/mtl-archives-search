import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_summary.json');

const DATASET_SOURCES = [
  { key: 'aerial_1925_1935', file: 'vues_aeriennes_1925_1935.json' },
  { key: 'aerial_1947_1949', file: 'vues_aeriennes_1947_1949.json' },
  { key: 'aerial_1958', file: 'vues_aeriennes_1958.json' },
  { key: 'aerial_1962', file: 'vues_aeriennes_1962.json' },
  { key: 'aerial_1964', file: 'vues_aeriennes_1964.json' },
  { key: 'aerial_1966', file: 'vues_aeriennes_1966.json' },
  { key: 'aerial_1969', file: 'vues_aeriennes_1969.json' },
  { key: 'aerial_1971', file: 'vues_aeriennes_1971.json' },
  { key: 'aerial_1973', file: 'vues_aeriennes_1973.json' },
  { key: 'aerial_1975', file: 'vues_aeriennes_1975.json' },
  { key: 'aerial_obliques_1960_1992', file: 'vues_aeriennes_obliques_1960_1992.json' },
];

const FILE_URL_KEYS = [
  'Fichier jpg - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier tiff - 600 dpi',
  'Fichiers TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier tif - 300 dpi',
  'Fichier jpg - 200 dpi',
];

type DatasetSource = (typeof DATASET_SOURCES)[number];

function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.split('?')[0].trim().toLowerCase();
}

function getFileUrl(record: Record<string, unknown>): string {
  for (const key of FILE_URL_KEYS) {
    const value = record[key];
    if (value) return String(value);
  }
  return '';
}

function loadDatasetRecords(source: DatasetSource, baseDir: string) {
  const filePath = path.resolve(baseDir, source.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset file missing: ${filePath}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const records = data?.result?.records || [];
  if (!Array.isArray(records)) {
    throw new Error(`Unexpected dataset format: ${filePath}`);
  }

  return records;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
      'data-dir': { type: 'string', default: path.resolve(MONOREPO_ROOT, 'data/mtl_archives') },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;
  const dataDir = values['data-dir']!;

  if (!fs.existsSync(inputPath)) {
    console.error(`Input manifest not found: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const matchMap = new Map<string, { dataset: string; record: any }[]>();
  const datasetRecordCounts: Record<string, number> = {};

  for (const source of DATASET_SOURCES) {
    const records = loadDatasetRecords(source, dataDir);
    datasetRecordCounts[source.key] = records.length;

    for (const record of records) {
      const fileUrl = getFileUrl(record);
      const normalized = normalizeUrl(fileUrl);
      if (!normalized) continue;

      const entry = { dataset: source.key, record };
      const existing = matchMap.get(normalized);
      if (existing) {
        existing.push(entry);
      } else {
        matchMap.set(normalized, [entry]);
      }
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    matched_records: 0,
    unmatched_records: 0,
    multiple_matches: 0,
    dataset_record_counts: datasetRecordCounts,
    dataset_match_counts: {} as Record<string, number>,
  };

  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    summary.total_records += 1;

    const record = JSON.parse(line);
    const normalized = normalizeUrl(record.external_url || '');
    const matches = normalized ? (matchMap.get(normalized) || []) : [];

    if (matches.length > 0) {
      summary.matched_records += 1;
      if (matches.length > 1) summary.multiple_matches += 1;
      for (const match of matches) {
        summary.dataset_match_counts[match.dataset] =
          (summary.dataset_match_counts[match.dataset] || 0) + 1;
      }
    } else {
      summary.unmatched_records += 1;
    }

    const enriched = {
      ...record,
      aerial_matches: matches,
    };
    outputStream.write(`${JSON.stringify(enriched)}\n`);
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote enriched manifest to ${outputPath}`);
  console.log(`Wrote summary to ${summaryPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
