import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_enriched_v2.jsonl');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_scored.jsonl');
const DEFAULT_SUMMARY = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_scored_summary.json');

const HEDGE_TERMS = ['likely', 'possibly', 'appears', 'seems', 'suggests'];

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function containsHedge(text: string) {
  const lower = text.toLowerCase();
  return HEDGE_TERMS.some(term => lower.includes(term));
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

  const summary = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    output_path: outputPath,
    total_records: 0,
    show_description: 0,
    show_vlm_caption: 0,
    show_location: 0,
    trust_score_stats: {} as Record<string, number | null>,
  };

  const trustScores: number[] = [];

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

    try {
      const record = JSON.parse(line);

      const titleNormalized = record.title_normalized || '';
      const titleIsCodeLike = Boolean(record.title_is_code_like);
      const descriptionNormalized = record.description_normalized || '';
      const descriptionSource = record.description_source || 'missing';
      const dateValue = record.date_value || '';
      const dateRaw = record.date_raw || '';
      const vlmCaption = record.vlm_caption || '';

      const geoLat = record.geo_lat ?? record.latitude;
      const geoLng = record.geo_lng ?? record.longitude;
      const geoConfidence = typeof record.geo_confidence === 'number'
        ? record.geo_confidence
        : null;

      const titleConfidence = titleNormalized && !titleIsCodeLike ? 0.8 : 0.1;
      let descriptionConfidence = 0;
      if (descriptionSource === 'original' || descriptionSource === 'portal' || descriptionSource === 'aerial') {
        descriptionConfidence = descriptionNormalized.length >= 50 ? 0.9 : 0.7;
      }

      let vlmConfidence = 0;
      if (vlmCaption) {
        vlmConfidence = containsHedge(vlmCaption) ? 0.4 : 0.5;
        if (vlmCaption.length < 60) {
          vlmConfidence = Math.min(vlmConfidence, 0.35);
        }
      }

      const dateConfidence = dateValue ? 0.7 : dateRaw ? 0.5 : 0;
      const locationConfidence = geoLat !== null && geoLng !== null
        ? clamp(geoConfidence ?? 0.6)
        : 0;

      const weights = {
        title: 0.15,
        description: 0.45,
        date: 0.2,
        location: 0.2,
      };

      const trustScore = clamp(
        titleConfidence * weights.title
        + descriptionConfidence * weights.description
        + dateConfidence * weights.date
        + locationConfidence * weights.location
      );

      trustScores.push(trustScore);

      const showDescription = (descriptionSource === 'original' || descriptionSource === 'portal')
        && Boolean(descriptionNormalized);
      const showVlmCaption = !showDescription && Boolean(vlmCaption);
      const showLocation = geoLat !== null && geoLng !== null && (geoConfidence ?? 0.6) >= 0.6;

      if (showDescription) summary.show_description += 1;
      if (showVlmCaption) summary.show_vlm_caption += 1;
      if (showLocation) summary.show_location += 1;

      const scored = {
        ...record,
        trust_score: trustScore,
        field_confidence: {
          title: titleConfidence,
          description: descriptionConfidence,
          date: dateConfidence,
          location: locationConfidence,
          vlm_caption: vlmConfidence,
        },
        display_policy: {
          show_description: showDescription,
          show_vlm_caption: showVlmCaption,
          show_location: showLocation,
        },
      };

      outputStream.write(JSON.stringify(scored) + '\n');
    } catch (err) {
      console.error('Failed to process line:', err);
    }
  }

  summary.trust_score_stats = {
    min: trustScores.length ? Math.min(...trustScores) : null,
    p10: percentile(trustScores, 0.1),
    median: percentile(trustScores, 0.5),
    mean: trustScores.length ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length : null,
    p90: percentile(trustScores, 0.9),
    max: trustScores.length ? Math.max(...trustScores) : null,
  };

  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote scored manifest to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
