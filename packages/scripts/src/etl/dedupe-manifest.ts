import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_deduped.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_deduped_summary.json');

function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.split('?')[0].trim().toLowerCase();
}

function getDedupeKey(record: Record<string, unknown>): string {
  const externalUrl = normalizeUrl(String(record.external_url || ''));
  if (externalUrl) return externalUrl;
  return String(record.metadata_filename || '');
}

function selectBest(records: any[]): any {
  const sorted = [...records].sort((a, b) => {
    const sizeA = Number(a.image_size_bytes || 0);
    const sizeB = Number(b.image_size_bytes || 0);
    if (sizeA !== sizeB) return sizeB - sizeA;
    const nameA = String(a.metadata_filename || '');
    const nameB = String(b.metadata_filename || '');
    return nameA.localeCompare(nameB);
  });
  return sorted[0];
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
    },
  });

  const inputPath = values.input!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;

  if (!fs.existsSync(inputPath)) {
    console.error(`Input manifest not found: ${inputPath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const groups = new Map<string, any[]>();
  const inputStream = fs.createReadStream(inputPath, { encoding: 'utf-8' });
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const key = getDedupeKey(record);
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    unique_records: 0,
    duplicate_groups: 0,
    duplicate_records: 0,
  };

  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  for (const [key, records] of groups.entries()) {
    summary.total_records += records.length;
    summary.unique_records += 1;
    if (records.length > 1) {
      summary.duplicate_groups += 1;
      summary.duplicate_records += records.length - 1;
    }

    const best = selectBest(records);
    const metadataFiles = records
      .map(r => r.metadata_filename)
      .filter(Boolean)
      .sort();
    const imageFiles = records
      .map(r => r.image_filename)
      .filter(Boolean)
      .sort();

    const deduped = {
      ...best,
      dedupe_key: key,
      dedupe_count: records.length,
      dedupe_metadata_filenames: metadataFiles,
      dedupe_image_filenames: imageFiles,
    };

    outputStream.write(`${JSON.stringify(deduped)}\n`);
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote deduped manifest to ${outputPath}`);
  console.log(`Wrote summary to ${summaryPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
