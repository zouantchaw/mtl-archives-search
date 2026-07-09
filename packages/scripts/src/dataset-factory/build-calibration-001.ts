import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { requireArtifact } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_BATCH_PACKET = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/batch_001_review_packet.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50',
);
const DEFAULT_SEED = 'dataset-factory-calibration-001-2026-06-28';

type BatchPacket = {
  packet_id: string;
  lane: 'ground_text_entity' | 'aerial_land_use_geo';
  selection_bucket: string;
  selection_reasons: string[];
  record: {
    id: string;
    title: string;
    description: string;
    date: string;
    cote: string;
    image_filename: string;
    image_url: string;
    source_url: string;
    credit_line: string;
    source_dataset: string;
  };
  existing_signals: {
    taxonomy_primary_category: string;
    taxonomy_confidence: number | null;
    taxonomy_review_required: boolean;
    aerial_dataset: string;
    vlm_caption: string;
    metadata_quality_flags: string[];
  };
  proposed_label_focus: {
    image_mode: string;
    likely_land_use: string;
    scene_text_candidate: boolean;
    entity_candidate: boolean;
    geo_candidate: boolean;
    low_information_candidate: boolean;
    ml_tasks: string[];
  };
};

type CalibrationRow = BatchPacket & {
  calibration_id: string;
  calibration_selected_at: string;
  calibration_reasons: string[];
  calibration_focus: {
    priority: 'high' | 'medium';
    required_checks: string[];
  };
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filePath}:${index + 1}: ${message}`);
      }
    });
}

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function quotaRows(rows: BatchPacket[], bucket: string, count: number, rng: () => number): BatchPacket[] {
  return shuffled(rows.filter((row) => row.selection_bucket === bucket), rng).slice(0, count);
}

function requiredChecks(row: BatchPacket): string[] {
  const checks = new Set<string>(['image_mode', 'evidence_buckets']);
  if (row.lane === 'ground_text_entity') {
    checks.add('entities');
    checks.add('search_expectations');
    if (row.proposed_label_focus.scene_text_candidate) checks.add('scene_text');
    if (row.proposed_label_focus.geo_candidate) checks.add('geo_hypotheses');
  } else {
    checks.add('aerial_land_use');
    checks.add('segmentation_candidate');
    checks.add('georeference_candidate');
    if (row.proposed_label_focus.low_information_candidate) checks.add('low_information_reason');
  }
  return Array.from(checks).sort();
}

function selectCalibrationRows(rows: BatchPacket[], seed: string): BatchPacket[] {
  const rng = makeRng(seed);
  const selected = new Map<string, BatchPacket>();
  const add = (row: BatchPacket) => selected.set(row.record.id, row);

  const magic = rows.find((row) => row.record.id === 'mtl_archives_metadata_0.json');
  if (magic) add(magic);

  const quota: Array<[string, number]> = [
    ['ground_scene_text_entity', 10],
    ['ground_landmark_entity', 8],
    ['ground_general', 4],
    ['aerial_farmland', 5],
    ['aerial_residential', 4],
    ['aerial_waterfront_water', 4],
    ['aerial_infrastructure_industrial', 4],
    ['aerial_oblique', 4],
    ['aerial_low_information', 3],
    ['aerial_mixed_unknown', 4],
  ];

  for (const [bucket, count] of quota) {
    for (const row of quotaRows(rows, bucket, count, rng)) add(row);
  }

  if (selected.size < 50) {
    for (const row of shuffled(rows, rng)) {
      if (selected.size >= 50) break;
      add(row);
    }
  }

  return Array.from(selected.values())
    .slice(0, 50)
    .sort((a, b) => {
      const laneOrder = a.lane.localeCompare(b.lane);
      return laneOrder || a.selection_bucket.localeCompare(b.selection_bucket) || a.record.id.localeCompare(b.record.id);
    });
}

function toCalibrationRows(rows: BatchPacket[], selectedAt: string): CalibrationRow[] {
  return rows.map((row, index) => {
    const isMagic = row.record.id === 'mtl_archives_metadata_0.json';
    const checks = requiredChecks(row);
    return {
      ...row,
      calibration_id: `df-b001-cal-${String(index + 1).padStart(3, '0')}`,
      calibration_selected_at: selectedAt,
      calibration_reasons: [
        `bucket calibration: ${row.selection_bucket}`,
        ...(isMagic ? ['named search regression: Magic Baking Powder'] : []),
        ...(row.proposed_label_focus.low_information_candidate ? ['low-information calibration'] : []),
      ],
      calibration_focus: {
        priority: isMagic || row.proposed_label_focus.scene_text_candidate || row.proposed_label_focus.low_information_candidate ? 'high' : 'medium',
        required_checks: checks,
      },
    };
  });
}

function writeCsv(filePath: string, rows: CalibrationRow[]): void {
  const headers = [
    'calibration_id',
    'packet_id',
    'lane',
    'bucket',
    'record_id',
    'title',
    'image_mode',
    'likely_land_use',
    'scene_text_candidate',
    'entity_candidate',
    'low_information_candidate',
    'required_checks',
    'image_url',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.calibration_id,
      row.packet_id,
      row.lane,
      row.selection_bucket,
      row.record.id,
      row.record.title,
      row.proposed_label_focus.image_mode,
      row.proposed_label_focus.likely_land_use,
      row.proposed_label_focus.scene_text_candidate,
      row.proposed_label_focus.entity_candidate,
      row.proposed_label_focus.low_information_candidate,
      row.calibration_focus.required_checks.join('|'),
      row.record.image_url,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function renderContactSheet(rows: CalibrationRow[]): string {
  const cards = rows.map((row) => `
    <article class="card ${row.lane}">
      <img src="${row.record.image_url}" alt="${escapeHtml(row.record.title)}" loading="lazy">
      <div class="body">
        <div class="meta">${escapeHtml(row.calibration_id)} · ${escapeHtml(row.record.id)}</div>
        <h2>${escapeHtml(row.record.title || row.record.id)}</h2>
        <p><strong>Lane:</strong> ${escapeHtml(row.lane)}</p>
        <p><strong>Bucket:</strong> ${escapeHtml(row.selection_bucket)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(row.proposed_label_focus.image_mode)} · <strong>Land:</strong> ${escapeHtml(row.proposed_label_focus.likely_land_use)}</p>
        <p><strong>Checks:</strong> ${escapeHtml(row.calibration_focus.required_checks.join(', '))}</p>
        <p class="desc">${escapeHtml(row.record.description.slice(0, 220))}</p>
      </div>
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MTL Archives Dataset Factory Calibration 001</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f2eb; color: #20201d; }
    header { position: sticky; top: 0; z-index: 1; padding: 16px 20px; background: rgba(245,242,235,.95); border-bottom: 1px solid #d8d1c3; backdrop-filter: blur(12px); }
    h1 { margin: 0 0 4px; font-size: 18px; }
    header p { margin: 0; color: #666; font-size: 13px; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; padding: 14px; }
    .card { background: #fff; border: 1px solid #ddd7c9; border-radius: 8px; overflow: hidden; }
    .card.ground_text_entity { border-top: 4px solid #1c7ed6; }
    .card.aerial_land_use_geo { border-top: 4px solid #2b8a3e; }
    img { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #ece6da; display: block; }
    .body { padding: 10px; }
    h2 { margin: 4px 0 7px; font-size: 14px; line-height: 1.25; }
    p { margin: 5px 0; font-size: 11px; line-height: 1.35; }
    .meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #777; font-size: 10px; }
    .desc { color: #555; border-top: 1px solid #eee; padding-top: 7px; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>MTL Archives Dataset Factory Calibration 001</h1>
    <p>${rows.length} rows · balanced calibration subset from Batch 001 · labels remain calibration until spot-checked</p>
  </header>
  <main>${cards}</main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_BATCH_PACKET },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      seed: { type: 'string', default: DEFAULT_SEED },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values.output!);
  const seed = values.seed!;
  requireArtifact(inputPath, 'Batch 001 review packet');
  const rows = readJsonl<BatchPacket>(inputPath);
  const selectedAt = new Date().toISOString();
  const calibrationRows = toCalibrationRows(selectCalibrationRows(rows, seed), selectedAt);

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'calibration_packet.jsonl'), calibrationRows);
  writeCsv(path.join(outputDir, 'calibration_packet.csv'), calibrationRows);
  fs.writeFileSync(path.join(outputDir, 'calibration_contact_sheet.html'), renderContactSheet(calibrationRows), 'utf-8');

  const manifest = {
    calibration_id: 'dataset_factory_batch_001_calibration_50',
    generated_at: selectedAt,
    seed,
    input: path.relative(MONOREPO_ROOT, inputPath),
    outputs: {
      packet_jsonl: path.relative(MONOREPO_ROOT, path.join(outputDir, 'calibration_packet.jsonl')),
      packet_csv: path.relative(MONOREPO_ROOT, path.join(outputDir, 'calibration_packet.csv')),
      contact_sheet_html: path.relative(MONOREPO_ROOT, path.join(outputDir, 'calibration_contact_sheet.html')),
    },
    counts: {
      total: calibrationRows.length,
      by_lane: Object.fromEntries(['ground_text_entity', 'aerial_land_use_geo'].map((lane) => [
        lane,
        calibrationRows.filter((row) => row.lane === lane).length,
      ])),
      by_bucket: calibrationRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.selection_bucket] = (acc[row.selection_bucket] ?? 0) + 1;
        return acc;
      }, {}),
      high_priority: calibrationRows.filter((row) => row.calibration_focus.priority === 'high').length,
      magic_regression_included: calibrationRows.some((row) => row.record.id === 'mtl_archives_metadata_0.json'),
    },
  };
  fs.writeFileSync(path.join(outputDir, 'calibration_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Wrote ${calibrationRows.length} calibration rows to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- ground_text_entity: ${manifest.counts.by_lane.ground_text_entity}`);
  console.log(`- aerial_land_use_geo: ${manifest.counts.by_lane.aerial_land_use_geo}`);
  console.log(`- high_priority: ${manifest.counts.high_priority}`);
  console.log(`- magic_regression_included: ${manifest.counts.magic_regression_included}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
