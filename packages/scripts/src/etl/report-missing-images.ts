import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest.jsonl');
const DEFAULT_OUTPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/missing_images_report.json',
);
const DEFAULT_LIST = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/missing_images.jsonl',
);

const DATASET_SOURCES = [
  { key: 'phototheque_archives', file: 'phototheque_datastore.json' },
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
  'Fichier jpg - 200 dpi',
  'Fichier TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichiers TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)',
  'Fichier tiff - 600 dpi',
  'Fichier tif - 300 dpi',
];

function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.split('?')[0].trim().toLowerCase();
}

function getFileUrls(record: Record<string, unknown>): { url: string; key: string }[] {
  const results: { url: string; key: string }[] = [];
  for (const key of FILE_URL_KEYS) {
    const value = record[key];
    if (value) {
      results.push({ url: String(value), key });
    }
  }
  return results;
}

function loadDatasetRecords(dataDir: string, file: string): any[] {
  const filePath = path.resolve(dataDir, file);
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
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      list: { type: 'string', default: DEFAULT_LIST },
      'data-dir': { type: 'string', default: path.resolve(MONOREPO_ROOT, 'data/mtl_archives') },
    },
  });

  const manifestPath = values.manifest!;
  const outputPath = values.output!;
  const listPath = values.list!;
  const dataDir = values['data-dir']!;

  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const manifestUrls = new Set<string>();
  const manifestStream = fs.createReadStream(manifestPath, { encoding: 'utf-8' });
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: manifestStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const normalized = normalizeUrl(record.external_url || '');
    if (normalized) manifestUrls.add(normalized);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    manifest_input: manifestPath,
    total_records: 0,
    records_with_url: 0,
    missing_records: 0,
    datasets: {} as Record<string, { total: number; with_url: number; missing: number }>,
  };

  const listStream = fs.createWriteStream(listPath, { encoding: 'utf-8' });

  for (const dataset of DATASET_SOURCES) {
    const records = loadDatasetRecords(dataDir, dataset.file);
    const stats = { total: records.length, with_url: 0, missing: 0 };

    for (const record of records) {
      summary.total_records += 1;
      const urls = getFileUrls(record);
      if (!urls.length) continue;

      stats.with_url += 1;
      summary.records_with_url += 1;

      const hasMatch = urls.some(item => manifestUrls.has(normalizeUrl(item.url)));
      if (!hasMatch) {
        stats.missing += 1;
        summary.missing_records += 1;
        const primary = urls[0];
        listStream.write(`${JSON.stringify({
          dataset: dataset.key,
          primary_external_url: primary.url,
          primary_file_url_key: primary.key,
          external_urls: urls.map(item => item.url),
          record,
        })}\n`);
      }
    }

    summary.datasets[dataset.key] = stats;
  }

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote missing image report to ${outputPath}`);
  console.log(`Wrote missing image list to ${listPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
