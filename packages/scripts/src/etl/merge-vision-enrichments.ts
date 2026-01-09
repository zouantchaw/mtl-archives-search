import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_BASE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_linked.jsonl');
const DEFAULT_TAGS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_structured.jsonl');
const DEFAULT_OCR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_ocr.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_v3.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_v3_summary.json');

function loadJsonlMap(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Missing file: ${filePath}`);
    return new Map<string, any>();
  }
  const map = new Map<string, any>();
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const key = record.metadata_filename;
    if (key) {
      map.set(key, record);
    }
  }
  return map;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: 'string', default: DEFAULT_BASE },
      tags: { type: 'string', default: DEFAULT_TAGS },
      ocr: { type: 'string', default: DEFAULT_OCR },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
    },
  });

  const basePath = values.base!;
  const tagsPath = values.tags!;
  const ocrPath = values.ocr!;
  const outputPath = values.output!;
  const summaryPath = values.summary!;

  if (!fs.existsSync(basePath)) {
    console.error(`Base manifest not found: ${basePath}`);
    process.exit(1);
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tagsMap = loadJsonlMap(tagsPath);
  const ocrMap = loadJsonlMap(ocrPath);

  const summary = {
    generated_at: new Date().toISOString(),
    base_path: basePath,
    tags_path: tagsPath,
    ocr_path: ocrPath,
    output_path: outputPath,
    total_records: 0,
    tags_merged: 0,
    tags_missing: 0,
    ocr_merged: 0,
    ocr_missing: 0,
  };

  const inputStream = fs.createReadStream(basePath, { encoding: 'utf-8' });
  const outputStream = fs.createWriteStream(outputPath, { encoding: 'utf-8' });

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    summary.total_records += 1;

    try {
      const record = JSON.parse(line);
      const key = record.metadata_filename;
      const tags = key ? tagsMap.get(key) : null;
      const ocr = key ? ocrMap.get(key) : null;

      if (tags && tags.vlm_tags) {
        summary.tags_merged += 1;
      } else {
        summary.tags_missing += 1;
      }

      if (ocr && (ocr.ocr_text || ocr.ocr_error)) {
        summary.ocr_merged += 1;
      } else {
        summary.ocr_missing += 1;
      }

      const enriched = {
        ...record,
        metadata_schema_version: Math.max(record.metadata_schema_version || 0, 4),
        vlm_tags: tags?.vlm_tags ?? record.vlm_tags ?? null,
        vlm_tags_source: tags?.vlm_tags_source ?? record.vlm_tags_source ?? null,
        vlm_tags_generated_at: tags?.vlm_tags_generated_at ?? record.vlm_tags_generated_at ?? null,
        vlm_tags_confidence: tags?.vlm_tags_confidence ?? record.vlm_tags_confidence ?? null,
        vlm_tags_error: tags?.vlm_tags_error ?? record.vlm_tags_error ?? null,
        ocr_text: ocr?.ocr_text ?? record.ocr_text ?? null,
        ocr_confidence: ocr?.ocr_confidence ?? record.ocr_confidence ?? null,
        ocr_word_count: ocr?.ocr_word_count ?? record.ocr_word_count ?? null,
        ocr_language: ocr?.ocr_language ?? record.ocr_language ?? null,
        ocr_source: ocr?.ocr_source ?? record.ocr_source ?? null,
        ocr_generated_at: ocr?.ocr_generated_at ?? record.ocr_generated_at ?? null,
        ocr_error: ocr?.ocr_error ?? record.ocr_error ?? null,
      };

      outputStream.write(JSON.stringify(enriched) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote enriched manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
