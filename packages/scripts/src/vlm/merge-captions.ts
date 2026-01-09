import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_BASE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_APPEND = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_missing.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_merge_summary.json');

function loadJsonl(filePath: string) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function shouldReplace(existing: any, incoming: any): boolean {
  if (!existing) return true;
  if (!existing.vlm_caption && incoming.vlm_caption) return true;
  if (existing.vlm_caption && incoming.vlm_caption) {
    const existingDate = existing.vlm_captioned_at || '';
    const incomingDate = incoming.vlm_captioned_at || '';
    return incomingDate > existingDate;
  }
  return false;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string', default: DEFAULT_BASE },
      append: { type: 'string', default: DEFAULT_APPEND },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
    },
  });

  const basePath = values.base!;
  const appendPath = values.append!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;

  if (!fs.existsSync(basePath)) {
    console.error(`Base VLM file not found: ${basePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(appendPath)) {
    console.error(`Append VLM file not found: ${appendPath}`);
    process.exit(1);
  }

  const baseRecords = loadJsonl(basePath);
  const appendRecords = loadJsonl(appendPath);

  const order: string[] = [];
  const map = new Map<string, any>();
  for (const record of baseRecords) {
    const key = record.metadata_filename;
    if (!key) continue;
    map.set(key, record);
    order.push(key);
  }

  let added = 0;
  let replaced = 0;
  let skipped = 0;

  for (const record of appendRecords) {
    const key = record.metadata_filename;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, record);
      order.push(key);
      added += 1;
      continue;
    }
    if (shouldReplace(existing, record)) {
      map.set(key, record);
      replaced += 1;
    } else {
      skipped += 1;
    }
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });
  for (const key of order) {
    const record = map.get(key);
    if (record) {
      outputStream.write(`${JSON.stringify(record)}\n`);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    base_path: basePath,
    append_path: appendPath,
    output_path: outputPath,
    base_records: baseRecords.length,
    append_records: appendRecords.length,
    added,
    replaced,
    skipped,
    output_records: map.size,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Wrote merged VLM to ${outputPath}`);
  console.log(`Wrote summary to ${summaryPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
