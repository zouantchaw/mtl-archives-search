import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_BASE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_aerial.jsonl');
const DEFAULT_VLM = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_vlm_complete.jsonl');
const DEFAULT_GEO = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_geocoded.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_v2.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_v2_summary.json');

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
      vlm: { type: 'string', default: DEFAULT_VLM },
      geo: { type: 'string', default: DEFAULT_GEO },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      summary: { type: 'string', default: DEFAULT_SUMMARY },
    },
  });

  const basePath = values.base!;
  const vlmPath = values.vlm!;
  const geoPath = values.geo!;
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

  const vlmMap = loadJsonlMap(vlmPath);
  const geoMap = loadJsonlMap(geoPath);

  const summary = {
    generated_at: new Date().toISOString(),
    base_path: basePath,
    vlm_path: vlmPath,
    geo_path: geoPath,
    output_path: outputPath,
    total_records: 0,
    vlm_merged: 0,
    vlm_missing: 0,
    geo_merged: 0,
    geo_missing: 0,
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
      const vlm = key ? vlmMap.get(key) : null;
      const geo = key ? geoMap.get(key) : null;

      if (vlm && vlm.vlm_caption) {
        summary.vlm_merged += 1;
      } else {
        summary.vlm_missing += 1;
      }

      if (geo && (geo.latitude !== undefined || geo.longitude !== undefined)) {
        summary.geo_merged += 1;
      } else {
        summary.geo_missing += 1;
      }

      const enriched = {
        ...record,
        metadata_schema_version: 3,
        vlm_caption: vlm?.vlm_caption ?? null,
        vlm_captioned_at: vlm?.vlm_captioned_at ?? null,
        vlm_error: vlm?.vlm_error ?? null,
        vlm_caption_source: vlm?.vlm_caption ? 'llava-1.5-7b-hf' : null,
        geo_lat: geo?.latitude ?? null,
        geo_lng: geo?.longitude ?? null,
        geo_source: geo?.geocode_source ?? null,
        geo_confidence: geo?.geocode_confidence ?? null,
        geo_place_name: geo?.geocode_place_name ?? null,
        latitude: geo?.latitude ?? record.latitude ?? null,
        longitude: geo?.longitude ?? record.longitude ?? null,
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
