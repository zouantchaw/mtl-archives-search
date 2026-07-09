import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_TAXONOMY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001',
);
const DEFAULT_PUBLIC_R2_DOMAIN = 'pub-6a29793ea7664738880d1cc5afb21b87.r2.dev';
const DEFAULT_SEED = 'dataset-factory-batch-001-2026-06-28';

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  name?: string;
  description?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  credits?: string;
  cote?: string;
  portal_record?: Record<string, unknown>;
  aerial_matches?: Array<{ dataset?: string; record?: Record<string, unknown> }>;
  metadata_quality?: { quality_flags?: string[]; description_source?: string };
  vlm_caption?: string | null;
  vlm_metadata?: {
    caption?: string;
    scene_type?: string;
    visual_subjects?: string[];
    setting?: string;
    aerial_ground_document?: string;
    search_terms?: string[];
    quality_notes?: string;
  } | null;
  vlm_metadata_valid?: boolean;
};

type TaxonomyRow = {
  id?: string;
  primaryCategory?: string;
  primaryConfidence?: number;
  vantage?: string;
  mediaType?: string;
  themes?: string[];
  searchFacets?: string[];
  reviewRequired?: boolean;
};

type ImageMode =
  | 'ground_street'
  | 'ground_interior'
  | 'ground_object'
  | 'aerial_vertical'
  | 'aerial_oblique'
  | 'document_map'
  | 'low_information'
  | 'unknown';

type Lane = 'ground_text_entity' | 'aerial_land_use_geo';

type LandUse =
  | 'farmland'
  | 'residential'
  | 'industrial'
  | 'commercial'
  | 'waterfront'
  | 'rail'
  | 'road_infrastructure'
  | 'park_green_space'
  | 'institutional'
  | 'water'
  | 'forest'
  | 'mixed_urban'
  | 'low_information'
  | 'unknown';

type BatchPacket = {
  batch_id: 'dataset_factory_batch_001';
  packet_id: string;
  selected_at: string;
  seed: string;
  lane: Lane;
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
    marker_image_mode: ImageMode;
    taxonomy_primary_category: string;
    taxonomy_confidence: number | null;
    taxonomy_review_required: boolean;
    aerial_dataset: string;
    vlm_caption: string;
    metadata_quality_flags: string[];
  };
  proposed_label_focus: {
    image_mode: ImageMode;
    likely_land_use: LandUse;
    scene_text_candidate: boolean;
    entity_candidate: boolean;
    geo_candidate: boolean;
    low_information_candidate: boolean;
    ml_tasks: string[];
  };
  review_task: {
    instructions: string[];
    required_optional_fields: string[];
    cautions: string[];
  };
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
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

function recordId(record: ArchiveRecord): string {
  return cleanText(record.metadata_filename);
}

function imageFilename(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, publicR2Domain: string): string {
  const image = imageFilename(record);
  if (!image) return cleanText(record.external_url);
  return `https://${publicR2Domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(image)}`;
}

function attr(record: ArchiveRecord, key: string): string {
  return cleanText(record.attributes_map?.[key]);
}

function titleValue(record: ArchiveRecord): string {
  return cleanText(record.name) || recordId(record);
}

function dateValue(record: ArchiveRecord): string {
  return attr(record, 'Date');
}

function coteValue(record: ArchiveRecord): string {
  const aerial = record.aerial_matches?.[0]?.record;
  return cleanText(record.cote)
    || attr(record, 'Cote')
    || cleanText(record.portal_record?.Cote)
    || cleanText(aerial?.['Cote/Titre'])
    || cleanText(aerial?.['Cote (reportage)']);
}

function sourceCredit(record: ArchiveRecord): string {
  const aerialCredit = cleanText(record.aerial_matches?.[0]?.record?.['Mention de crédits']);
  return cleanText(record.credits) || attr(record, 'Credits') || aerialCredit || 'Archives de la Ville de Montréal';
}

function aerialDataset(record: ArchiveRecord): string {
  return cleanText(record.aerial_matches?.[0]?.dataset);
}

function metadataQualityFlags(record: ArchiveRecord): string[] {
  return Array.isArray(record.metadata_quality?.quality_flags) ? record.metadata_quality.quality_flags.map(cleanText).filter(Boolean) : [];
}

function taxonomyById(rows: TaxonomyRow[]): Map<string, TaxonomyRow> {
  const map = new Map<string, TaxonomyRow>();
  for (const row of rows) {
    const id = cleanText(row.id);
    if (id) map.set(id, row);
  }
  return map;
}

function textForRecord(record: ArchiveRecord, taxonomy?: TaxonomyRow): string {
  const metadata = record.vlm_metadata;
  return normalize([
    record.name,
    record.description,
    record.vlm_caption,
    metadata?.caption,
    metadata?.scene_type,
    metadata?.setting,
    metadata?.aerial_ground_document,
    metadata?.quality_notes,
    taxonomy?.primaryCategory,
    taxonomy?.vantage,
    taxonomy?.mediaType,
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
    ...(taxonomy?.themes ?? []),
    ...(taxonomy?.searchFacets ?? []),
  ].filter(Boolean).join(' '));
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function inferImageMode(record: ArchiveRecord, taxonomy?: TaxonomyRow): ImageMode {
  const text = textForRecord(record, taxonomy);
  const dataset = aerialDataset(record);
  const category = normalize(taxonomy?.primaryCategory);
  if (record.aerial_matches?.length) {
    if (includesAny(text, ['blank', 'water only', 'cloud', 'featureless', 'low information'])) return 'low_information';
    if (dataset === 'aerial_obliques_1960_1992') return 'aerial_oblique';
    return 'aerial_vertical';
  }
  if (category === 'document_map' || includesAny(text, ['map', 'document', 'plan'])) return 'document_map';
  if (includesAny(text, ['interior', 'classroom', 'inside', 'salle'])) return 'ground_interior';
  if (includesAny(text, ['vehicle', 'truck', 'fire engine', 'chasse neige', 'autopompe', 'traineau'])) return 'ground_object';
  if (category === 'uncertain' && !text) return 'unknown';
  return 'ground_street';
}

function inferLandUse(record: ArchiveRecord, taxonomy?: TaxonomyRow): LandUse {
  const text = textForRecord(record, taxonomy);
  const category = normalize(taxonomy?.primaryCategory);
  if (!record.aerial_matches?.length) return 'unknown';
  if (includesAny(text, ['blank', 'featureless', 'cloud', 'film', 'low information'])) return 'low_information';
  if (includesAny(text, ['farm', 'farmland', 'field', 'fields', 'crops', 'rural'])) return 'farmland';
  if (category.includes('waterfront') || includesAny(text, ['waterfront', 'shoreline', 'harbor', 'port', 'canal'])) return 'waterfront';
  if (includesAny(text, ['river', 'lake', 'water'])) return 'water';
  if (category.includes('industrial') || includesAny(text, ['industrial', 'factory', 'warehouse', 'port'])) return 'industrial';
  if (includesAny(text, ['rail', 'railway', 'yard'])) return 'rail';
  if (includesAny(text, ['highway', 'road', 'interchange', 'bridge'])) return 'road_infrastructure';
  if (category.includes('residential') || includesAny(text, ['residential', 'houses', 'neighborhood', 'suburb'])) return 'residential';
  if (includesAny(text, ['park', 'green space', 'forest', 'trees'])) return includesAny(text, ['forest']) ? 'forest' : 'park_green_space';
  if (includesAny(text, ['stadium', 'school', 'hospital', 'university'])) return 'institutional';
  if (category.includes('aerial')) return 'mixed_urban';
  return 'unknown';
}

function hasSceneTextCandidate(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  return includesAny(textForRecord(record, taxonomy), [
    'sign',
    'signage',
    'billboard',
    'poster',
    'advertisement',
    'panneau',
    'reclame',
    'storefront',
    'magasin',
    'restaurant',
    'gazette',
    'magic baking powder',
    'coca cola',
    'street sign',
    'tramway',
  ]);
}

function hasEntityCandidate(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  return hasSceneTextCandidate(record, taxonomy)
    || includesAny(textForRecord(record, taxonomy), [
      'church',
      'eglise',
      'hotel',
      'market',
      'marche',
      'hospital',
      'school',
      'parc',
      'gare',
      'bridge',
      'pont',
      'factory',
      'usine',
      'rue',
      'boulevard',
      'avenue',
    ]);
}

function isLowInformation(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  const text = textForRecord(record, taxonomy);
  return includesAny(text, ['blank', 'featureless', 'cloud', 'water only', 'low information'])
    || (record.aerial_matches?.length ? inferLandUse(record, taxonomy) === 'low_information' : false);
}

function mlTasks(lane: Lane, record: ArchiveRecord, taxonomy?: TaxonomyRow): string[] {
  const tasks = new Set<string>(['active_learning']);
  if (lane === 'ground_text_entity') {
    tasks.add('search_reranking');
    if (hasSceneTextCandidate(record, taxonomy)) tasks.add('ocr_scene_text');
    if (hasEntityCandidate(record, taxonomy)) tasks.add('entity_linking');
    if (hasEntityCandidate(record, taxonomy)) tasks.add('landmark_recognition');
    tasks.add('geo_estimation');
    tasks.add('reward_preference');
  } else {
    tasks.add('aerial_land_use');
    tasks.add('geo_estimation');
    if (!isLowInformation(record, taxonomy)) tasks.add('aerial_segmentation');
    tasks.add('reward_preference');
  }
  return Array.from(tasks).sort();
}

function bucketForRecord(record: ArchiveRecord, taxonomy?: TaxonomyRow): string {
  if (!record.aerial_matches?.length) {
    if (hasSceneTextCandidate(record, taxonomy)) return 'ground_scene_text_entity';
    if (hasEntityCandidate(record, taxonomy)) return 'ground_landmark_entity';
    return 'ground_general';
  }
  const mode = inferImageMode(record, taxonomy);
  if (mode === 'aerial_oblique') return 'aerial_oblique';
  const landUse = inferLandUse(record, taxonomy);
  if (landUse === 'farmland') return 'aerial_farmland';
  if (['waterfront', 'water'].includes(landUse)) return 'aerial_waterfront_water';
  if (['industrial', 'rail', 'road_infrastructure'].includes(landUse)) return 'aerial_infrastructure_industrial';
  if (landUse === 'residential') return 'aerial_residential';
  if (landUse === 'low_information') return 'aerial_low_information';
  return 'aerial_mixed_unknown';
}

function chooseRecords(
  records: ArchiveRecord[],
  taxonomyMap: Map<string, TaxonomyRow>,
  seed: string,
  aerialLimit: number,
  includeAllGround: boolean,
): Array<{ record: ArchiveRecord; bucket: string; reasons: string[] }> {
  const rng = makeRng(seed);
  const byBucket = new Map<string, ArchiveRecord[]>();
  for (const record of records) {
    const taxonomy = taxonomyMap.get(recordId(record));
    const bucket = bucketForRecord(record, taxonomy);
    const group = byBucket.get(bucket) ?? [];
    group.push(record);
    byBucket.set(bucket, group);
  }

  const selected = new Map<string, { record: ArchiveRecord; bucket: string; reasons: string[] }>();
  const add = (record: ArchiveRecord, bucket: string, reason: string) => {
    const id = recordId(record);
    const existing = selected.get(id) ?? { record, bucket, reasons: [] };
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    selected.set(id, existing);
  };

  const groundBuckets = ['ground_scene_text_entity', 'ground_landmark_entity', 'ground_general'];
  for (const bucket of groundBuckets) {
    const rows = byBucket.get(bucket) ?? [];
    const picked = includeAllGround ? rows : shuffled(rows, rng).slice(0, Math.min(rows.length, 120));
    for (const record of picked) add(record, bucket, includeAllGround ? 'all non-aerial/ground rows included' : 'ground lane sample');
  }

  const magic = records.find((record) => recordId(record) === 'mtl_archives_metadata_0.json');
  if (magic) add(magic, bucketForRecord(magic, taxonomyMap.get(recordId(magic))), 'named search regression: Magic Baking Powder');

  const quotas: Array<[string, number]> = [
    ['aerial_farmland', Math.round(aerialLimit * 0.22)],
    ['aerial_residential', Math.round(aerialLimit * 0.16)],
    ['aerial_waterfront_water', Math.round(aerialLimit * 0.16)],
    ['aerial_infrastructure_industrial', Math.round(aerialLimit * 0.16)],
    ['aerial_oblique', Math.round(aerialLimit * 0.14)],
    ['aerial_low_information', Math.round(aerialLimit * 0.06)],
    ['aerial_mixed_unknown', aerialLimit],
  ];

  let aerialCount = 0;
  for (const [bucket, quota] of quotas) {
    if (aerialCount >= aerialLimit) break;
    const remaining = aerialLimit - aerialCount;
    const limit = Math.min(quota, remaining);
    const rows = shuffled(byBucket.get(bucket) ?? [], rng).slice(0, limit);
    for (const record of rows) {
      add(record, bucket, `aerial lane quota: ${bucket}`);
      aerialCount += 1;
    }
  }

  return Array.from(selected.values())
    .sort((a, b) => {
      const laneA = a.record.aerial_matches?.length ? 1 : 0;
      const laneB = b.record.aerial_matches?.length ? 1 : 0;
      return laneA - laneB || a.bucket.localeCompare(b.bucket) || recordId(a.record).localeCompare(recordId(b.record));
    });
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function toPacket(
  selected: { record: ArchiveRecord; bucket: string; reasons: string[] },
  index: number,
  seed: string,
  selectedAt: string,
  taxonomyMap: Map<string, TaxonomyRow>,
  publicR2Domain: string,
): BatchPacket {
  const taxonomy = taxonomyMap.get(recordId(selected.record));
  const lane: Lane = selected.record.aerial_matches?.length ? 'aerial_land_use_geo' : 'ground_text_entity';
  const mode = inferImageMode(selected.record, taxonomy);
  const landUse = inferLandUse(selected.record, taxonomy);
  const sceneText = hasSceneTextCandidate(selected.record, taxonomy);
  const entity = hasEntityCandidate(selected.record, taxonomy);
  const lowInfo = isLowInformation(selected.record, taxonomy);
  return {
    batch_id: 'dataset_factory_batch_001',
    packet_id: `df-b001-${String(index + 1).padStart(4, '0')}`,
    selected_at: selectedAt,
    seed,
    lane,
    selection_bucket: selected.bucket,
    selection_reasons: selected.reasons,
    record: {
      id: recordId(selected.record),
      title: titleValue(selected.record),
      description: cleanText(selected.record.description),
      date: dateValue(selected.record),
      cote: coteValue(selected.record),
      image_filename: imageFilename(selected.record),
      image_url: imageUrl(selected.record, publicR2Domain),
      source_url: cleanText(selected.record.external_url),
      credit_line: sourceCredit(selected.record),
      source_dataset: aerialDataset(selected.record) || 'phototheque_archives_or_unknown',
    },
    existing_signals: {
      marker_image_mode: mode,
      taxonomy_primary_category: cleanText(taxonomy?.primaryCategory),
      taxonomy_confidence: typeof taxonomy?.primaryConfidence === 'number' ? taxonomy.primaryConfidence : null,
      taxonomy_review_required: Boolean(taxonomy?.reviewRequired),
      aerial_dataset: aerialDataset(selected.record),
      vlm_caption: cleanText(selected.record.vlm_caption || selected.record.vlm_metadata?.caption),
      metadata_quality_flags: metadataQualityFlags(selected.record),
    },
    proposed_label_focus: {
      image_mode: mode,
      likely_land_use: landUse,
      scene_text_candidate: sceneText,
      entity_candidate: entity,
      geo_candidate: Boolean(selected.record.aerial_matches?.length) || entity || sceneText,
      low_information_candidate: lowInfo,
      ml_tasks: mlTasks(lane, selected.record, taxonomy),
    },
    review_task: {
      instructions: lane === 'ground_text_entity'
        ? [
          'Extract visible text only when it can be read or is source-metadata supported.',
          'Resolve brands, businesses, streets, landmarks, institutions, transit, and neighborhood mentions as entities.',
          'Add search_expectations for queries this image should satisfy.',
          'Separate observed, metadata, inferred, and verified evidence.',
        ]
        : [
          'Classify image_mode as aerial_vertical, aerial_oblique, low_information, document_map, or unknown.',
          'Estimate dominant_land_use and land_use_mix without fake precision.',
          'Mark segmentation and georeference candidacy separately.',
          'Add geo_hypotheses only when visual/source evidence supports them.',
        ],
      required_optional_fields: lane === 'ground_text_entity'
        ? ['image_mode', 'scene_text', 'entities', 'geo_hypotheses', 'search_expectations', 'ml_tasks']
        : ['image_mode', 'aerial_land_use', 'geo_hypotheses', 'search_expectations', 'ml_tasks'],
      cautions: [
        'Do not treat VLM captions as truth.',
        'Prefer uncertainty over false precision.',
        'Do not claim exact acreage or exact coordinates from pixels without scale/georeferencing evidence.',
      ],
    },
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath: string, rows: BatchPacket[]): void {
  const headers = [
    'packet_id',
    'lane',
    'selection_bucket',
    'record_id',
    'title',
    'date',
    'source_dataset',
    'image_mode',
    'likely_land_use',
    'scene_text_candidate',
    'entity_candidate',
    'geo_candidate',
    'low_information_candidate',
    'ml_tasks',
    'image_url',
    'source_url',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.packet_id,
      row.lane,
      row.selection_bucket,
      row.record.id,
      row.record.title,
      row.record.date,
      row.record.source_dataset,
      row.proposed_label_focus.image_mode,
      row.proposed_label_focus.likely_land_use,
      row.proposed_label_focus.scene_text_candidate,
      row.proposed_label_focus.entity_candidate,
      row.proposed_label_focus.geo_candidate,
      row.proposed_label_focus.low_information_candidate,
      row.proposed_label_focus.ml_tasks.join('|'),
      row.record.image_url,
      row.record.source_url,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderContactSheet(rows: BatchPacket[]): string {
  const cards = rows.map((row) => `
    <article class="card ${row.lane}">
      <img src="${row.record.image_url}" alt="${escapeHtml(row.record.title)}" loading="lazy">
      <div class="body">
        <div class="meta">${escapeHtml(row.packet_id)} · ${escapeHtml(row.lane)}</div>
        <h2>${escapeHtml(row.record.title || row.record.id)}</h2>
        <p>${escapeHtml(row.record.id)} · ${escapeHtml(row.record.date || 'undated')}</p>
        <p><strong>Bucket:</strong> ${escapeHtml(row.selection_bucket)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(row.proposed_label_focus.image_mode)} · <strong>Land:</strong> ${escapeHtml(row.proposed_label_focus.likely_land_use)}</p>
        <p><strong>Signals:</strong> text=${row.proposed_label_focus.scene_text_candidate ? 'yes' : 'no'}, entity=${row.proposed_label_focus.entity_candidate ? 'yes' : 'no'}, geo=${row.proposed_label_focus.geo_candidate ? 'yes' : 'no'}, low-info=${row.proposed_label_focus.low_information_candidate ? 'yes' : 'no'}</p>
        <p><strong>Tasks:</strong> ${escapeHtml(row.proposed_label_focus.ml_tasks.join(', '))}</p>
        <p class="desc">${escapeHtml(row.record.description.slice(0, 220))}</p>
      </div>
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MTL Archives Dataset Factory Batch 001</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f2eb; color: #20201d; }
    header { position: sticky; top: 0; z-index: 1; padding: 16px 20px; background: rgba(245,242,235,.95); border-bottom: 1px solid #d8d1c3; backdrop-filter: blur(12px); }
    h1 { margin: 0 0 4px; font-size: 18px; }
    header p { margin: 0; color: #666; font-size: 13px; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; padding: 14px; }
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
    <h1>MTL Archives Dataset Factory Batch 001</h1>
    <p>${rows.length} records · ground text/entity lane + aerial land-use/geo lane · not gold labels yet</p>
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
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      seed: { type: 'string', default: DEFAULT_SEED },
      'aerial-limit': { type: 'string', default: '420' },
      'include-all-ground': { type: 'boolean', default: true },
      'public-r2-domain': { type: 'string', default: DEFAULT_PUBLIC_R2_DOMAIN },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const taxonomyPath = resolveRepoPath(values.taxonomy!);
  const outputDir = resolveRepoPath(values.output!);
  const seed = values.seed!;
  const aerialLimit = Math.max(1, Number(values['aerial-limit'] ?? 420));
  const includeAllGround = Boolean(values['include-all-ground']);
  const publicR2Domain = cleanText(values['public-r2-domain']);
  requireArtifacts([
    { path: manifestPath, label: 'VLM structured manifest' },
    { path: taxonomyPath, label: 'taxonomy downstream rows' },
  ]);

  const records = readJsonl<ArchiveRecord>(manifestPath).filter((record) => Boolean(recordId(record)));
  const taxonomyRows = readJsonl<TaxonomyRow>(taxonomyPath);
  const taxonomyMap = taxonomyById(taxonomyRows);
  const selectedAt = new Date().toISOString();
  const selected = chooseRecords(records, taxonomyMap, seed, aerialLimit, includeAllGround);
  const packetRows = selected.map((row, index) => toPacket(row, index, seed, selectedAt, taxonomyMap, publicR2Domain));

  fs.mkdirSync(outputDir, { recursive: true });
  const packetPath = path.join(outputDir, 'batch_001_review_packet.jsonl');
  const csvPath = path.join(outputDir, 'batch_001_review_packet.csv');
  const sheetPath = path.join(outputDir, 'batch_001_contact_sheet.html');
  const profilePath = path.join(outputDir, 'batch_001_profile.json');
  const manifestOutPath = path.join(outputDir, 'batch_001_manifest.json');

  writeJsonl(packetPath, packetRows);
  writeCsv(csvPath, packetRows);
  fs.writeFileSync(sheetPath, renderContactSheet(packetRows), 'utf-8');

  const profile = {
    generated_at: selectedAt,
    input_counts: {
      manifest_records: records.length,
      taxonomy_rows: taxonomyRows.length,
      aerial_marker: records.filter((record) => Boolean(record.aerial_matches?.length)).length,
      non_aerial_marker: records.filter((record) => !record.aerial_matches?.length).length,
    },
    source_dataset_counts: countBy(records, aerialDataset),
    inferred_image_mode_counts: countBy(records, (record) => inferImageMode(record, taxonomyMap.get(recordId(record)))),
    inferred_aerial_land_use_counts: countBy(
      records.filter((record) => Boolean(record.aerial_matches?.length)),
      (record) => inferLandUse(record, taxonomyMap.get(recordId(record))),
    ),
    taxonomy_primary_category_counts: countBy(taxonomyRows, (row) => cleanText(row.primaryCategory)),
    selected_counts: {
      total: packetRows.length,
      by_lane: countBy(packetRows, (row) => row.lane),
      by_bucket: countBy(packetRows, (row) => row.selection_bucket),
      by_image_mode: countBy(packetRows, (row) => row.proposed_label_focus.image_mode),
      by_land_use: countBy(packetRows, (row) => row.proposed_label_focus.likely_land_use),
      scene_text_candidates: packetRows.filter((row) => row.proposed_label_focus.scene_text_candidate).length,
      entity_candidates: packetRows.filter((row) => row.proposed_label_focus.entity_candidate).length,
      geo_candidates: packetRows.filter((row) => row.proposed_label_focus.geo_candidate).length,
      low_information_candidates: packetRows.filter((row) => row.proposed_label_focus.low_information_candidate).length,
    },
    named_regressions: [
      {
        query: 'Magic baking powder',
        expected_record_id: 'mtl_archives_metadata_0.json',
        included: packetRows.some((row) => row.record.id === 'mtl_archives_metadata_0.json'),
      },
    ],
  };

  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');

  const manifest = {
    batch_id: 'dataset_factory_batch_001',
    generated_at: selectedAt,
    seed,
    goal: 'Two-lane Dataset Factory review packet for ground text/entity intelligence and aerial land-use/geolocation intelligence.',
    status: 'review_packet_ready_not_gold_labels',
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, manifestPath),
      taxonomy: path.relative(MONOREPO_ROOT, taxonomyPath),
    },
    outputs: {
      review_packet_jsonl: path.relative(MONOREPO_ROOT, packetPath),
      review_packet_csv: path.relative(MONOREPO_ROOT, csvPath),
      contact_sheet_html: path.relative(MONOREPO_ROOT, sheetPath),
      profile_json: path.relative(MONOREPO_ROOT, profilePath),
    },
    profile_summary: profile.selected_counts,
    next_steps: [
      'Run Codex/human labeling against batch_001_review_packet.jsonl.',
      'Validate labels against docs/dataset-factory/label-schema.v0.json.',
      'Promote spot-checked labels into gold-labels-batch-001.jsonl.',
      'Feed search_expectations into #49 and pairwise preferences into #52/#57.',
    ],
  };

  fs.writeFileSync(manifestOutPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Wrote ${packetRows.length} Batch 001 packet rows to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- ground_text_entity: ${profile.selected_counts.by_lane.ground_text_entity ?? 0}`);
  console.log(`- aerial_land_use_geo: ${profile.selected_counts.by_lane.aerial_land_use_geo ?? 0}`);
  console.log(`- scene_text_candidates: ${profile.selected_counts.scene_text_candidates}`);
  console.log(`- entity_candidates: ${profile.selected_counts.entity_candidates}`);
  console.log(`- low_information_candidates: ${profile.selected_counts.low_information_candidates}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
