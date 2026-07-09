import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
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
const DEFAULT_QUALITY = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
);
const DEFAULT_COLLECTIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
);
const DEFAULT_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl',
);
const DEFAULT_SEARCH_BASELINE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0/search_baseline_current.jsonl',
);
const DEFAULT_ARTIFACT_DECISIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/image_artifact_decisions.ndjson',
);
const DEFAULT_CLEANUP_ROWS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_rows.jsonl',
);
const DEFAULT_MODEL_BASELINE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_report.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_active_learning_v0',
);
const DEFAULT_PUBLIC_R2_DOMAIN = 'pub-6a29793ea7664738880d1cc5afb21b87.r2.dev';
const DEFAULT_SEED = 'dataset-factory-active-learning-v0-2026-06-29';
const DEFAULT_QUEUE_SIZE = 300;
const DEFAULT_MAX_PER_FAMILY = 6;

type VlmMetadata = {
  caption?: string;
  scene_type?: string;
  visual_subjects?: string[];
  setting?: string;
  season?: string;
  aerial_ground_document?: string;
  search_terms?: string[];
  social_hook?: string;
  print_quality?: string;
  quality_notes?: string;
};

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
  vlm_error?: string | null;
  vlm_metadata?: VlmMetadata | null;
  vlm_metadata_valid?: boolean;
  vlm_metadata_error?: string | null;
};

type TaxonomyRow = {
  id?: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  primaryCategory?: string;
  primaryConfidence?: number;
  vantage?: string;
  mediaType?: string;
  themes?: string[];
  searchFacets?: string[];
  socialTags?: string[];
  productTags?: string[];
  reviewRequired?: boolean;
  excludeFromDefaultVisualSearch?: boolean;
};

type QualityRow = {
  id?: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
  confidence?: number;
  notes?: string[];
};

type CandidateRow = {
  candidate_type?: string;
  rank?: number;
  id?: string;
  title?: string;
  date?: string;
  cote?: string;
  imageUrl?: string;
  imagePath?: string;
  score?: number;
  reasons?: string[];
  vlmCaption?: string | null;
  socialHook?: string | null;
};

type CollectionRow = {
  collection_id?: string;
  collection_title?: string;
  collection_type?: string;
  rank?: number;
  id?: string;
  score?: number;
  matchReasons?: string[];
};

type LabelRow = {
  record_id: string;
  image_filename?: string;
  labels?: {
    image_mode?: string;
    scene_text?: Array<Record<string, unknown>>;
    entities?: Array<Record<string, unknown>>;
    aerial_land_use?: {
      dominant_land_use?: string;
      segmentation_candidate?: boolean;
      georeference_candidate?: boolean;
    };
    search_expectations?: Array<Record<string, unknown>>;
  };
};

type SearchBaselineRow = {
  task_id?: string;
  slice?: string;
  query?: string;
  expected_rank_bucket?: string;
  source_expectation_mode?: string;
  mode?: string;
  expected_record_id?: string;
  rank?: number | null;
  found?: boolean;
  pass_expected_bucket?: boolean;
  result_count?: number;
  error?: string | null;
};

type ArtifactDecisionRow = {
  id?: string;
  actions?: string[];
  metrics?: {
    cropAreaRatio?: number;
    borderPx?: Record<string, number>;
    headerRows?: number;
    footerRows?: number;
  };
};

type CleanupRow = {
  id?: string;
  labels?: string[];
  cleanupMethod?: string;
  embeddingShift?: number;
  categoryBefore?: string;
  categoryAfter?: string;
  categoryChanged?: boolean;
  recommendation?: string;
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

type Lane = 'ground_text_entity' | 'aerial_land_use_geo';

type AcquisitionStratum =
  | 'benchmark_aerial_land_use_gap'
  | 'ground_text_entity_gap'
  | 'model_baseline_gap'
  | 'taxonomy_uncertainty'
  | 'rare_cluster_diversity'
  | 'quality_repair_risk'
  | 'commercial_reward_candidate'
  | 'hard_negative'
  | 'coverage_backfill';

type ScoreComponent = {
  stratum: AcquisitionStratum;
  score: number;
  reason: string;
};

type FailureContext = {
  failedRows: SearchBaselineRow[];
  failedSlices: Record<string, number>;
  failedSliceModes: Record<string, number>;
  failedQueries: string[];
  failedTerms: Set<string>;
};

type CurrentLabelProfile = {
  labeledIds: Set<string>;
  imageModeCounts: Record<string, number>;
  landUseCounts: Record<string, number>;
  sceneTextLabels: number;
  entityLabels: number;
  searchExpectationLabels: number;
};

type ModelBaselineLabelReport = {
  label_name: string;
  status: string;
  leave_one_out?: {
    accuracy: number;
    majority_accuracy: number;
    lift_vs_majority: number;
    macro_f1: number;
  };
};

type ModelBaselineContext = {
  available: boolean;
  weakTargets: Set<string>;
  singleClassTargets: Set<string>;
  promisingTargets: Set<string>;
  summary: Record<string, {
    status: string;
    lift_vs_majority: number | null;
    macro_f1: number | null;
  }>;
};

type ScoredRecord = {
  record: ArchiveRecord;
  taxonomy: TaxonomyRow | null;
  quality: QualityRow | null;
  candidates: CandidateRow[];
  collections: CollectionRow[];
  artifact: ArtifactDecisionRow | null;
  cleanup: CleanupRow | null;
  record_id: string;
  image_url: string;
  image_filename: string;
  title: string;
  description: string;
  date: string;
  cote: string;
  source_url: string;
  credit_line: string;
  source_dataset: string;
  lane: Lane;
  image_mode: ImageMode;
  likely_land_use: LandUse;
  family_key: string;
  taxonomy_category: string;
  taxonomy_confidence: number | null;
  scene_text_candidate: boolean;
  entity_candidate: boolean;
  geo_candidate: boolean;
  low_information_candidate: boolean;
  model_baseline_gap_matches: string[];
  components: ScoreComponent[];
  strata: AcquisitionStratum[];
  primary_stratum: AcquisitionStratum;
  score: number;
};

type QueueRow = {
  active_learning_batch_id: 'active_learning_batch_001';
  queue_id: string;
  rank: number;
  selected_at: string;
  seed: string;
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
  acquisition: {
    score: number;
    primary_stratum: AcquisitionStratum;
    strata: AcquisitionStratum[];
    family_key: string;
    family_count_in_queue: number;
    score_components: ScoreComponent[];
    reasons: string[];
  };
  current_signals: {
    lane: Lane;
    image_mode: ImageMode;
    likely_land_use: LandUse;
    taxonomy_primary_category: string;
    taxonomy_confidence: number | null;
    taxonomy_review_required: boolean;
    metadata_quality_flags: string[];
    quality_labels: string[];
    quality_action: string;
    candidate_types: string[];
    collection_ids: string[];
    artifact_actions: string[];
    cleanup_labels: string[];
    search_failure_matches: string[];
    model_baseline_gap_matches: string[];
  };
  label_task: {
    priority: 'critical' | 'high' | 'medium';
    required_fields: string[];
    ml_tasks: string[];
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

function canonicalId(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  return text.endsWith('.json') ? text : `${text}.json`;
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

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: ${message}`);
  }
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
  return canonicalId(record.metadata_filename);
}

function imageFilename(record: ArchiveRecord): string {
  return cleanText(record.resolved_image_filename || record.image_filename);
}

function imageUrl(record: ArchiveRecord, publicR2Domain: string, candidates: CandidateRow[], taxonomy?: TaxonomyRow): string {
  const candidateUrl = cleanText(candidates.find((row) => row.imageUrl)?.imageUrl);
  if (candidateUrl) return candidateUrl;
  const image = imageFilename(record);
  if (image) return `https://${publicR2Domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/${encodeURIComponent(image)}`;
  return cleanText(taxonomy?.imageUrl) || cleanText(record.external_url);
}

function attr(record: ArchiveRecord, key: string): string {
  return cleanText(record.attributes_map?.[key]);
}

function titleValue(record: ArchiveRecord, taxonomy?: TaxonomyRow, candidates: CandidateRow[] = []): string {
  return cleanText(record.name)
    || cleanText(taxonomy?.title)
    || cleanText(candidates.find((row) => row.title)?.title)
    || recordId(record);
}

function dateValue(record: ArchiveRecord, taxonomy?: TaxonomyRow, candidates: CandidateRow[] = []): string {
  return attr(record, 'Date')
    || cleanText(taxonomy?.date)
    || cleanText(candidates.find((row) => row.date)?.date);
}

function coteValue(record: ArchiveRecord, candidates: CandidateRow[] = []): string {
  const aerial = record.aerial_matches?.[0]?.record;
  return cleanText(record.cote)
    || attr(record, 'Cote')
    || cleanText(record.portal_record?.Cote)
    || cleanText(aerial?.['Cote/Titre'])
    || cleanText(aerial?.['Cote (reportage)'])
    || cleanText(candidates.find((row) => row.cote)?.cote);
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

function textForRecord(record: ArchiveRecord, taxonomy?: TaxonomyRow): string {
  const metadata = record.vlm_metadata;
  return normalize([
    record.name,
    record.description,
    record.vlm_caption,
    metadata?.caption,
    metadata?.scene_type,
    metadata?.setting,
    metadata?.season,
    metadata?.aerial_ground_document,
    metadata?.quality_notes,
    taxonomy?.primaryCategory,
    taxonomy?.vantage,
    taxonomy?.mediaType,
    ...(metadata?.visual_subjects ?? []),
    ...(metadata?.search_terms ?? []),
    ...(taxonomy?.themes ?? []),
    ...(taxonomy?.searchFacets ?? []),
    ...(taxonomy?.socialTags ?? []),
    ...(taxonomy?.productTags ?? []),
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
  if (category === 'document_map' || includesAny(text, ['map', 'document', 'plan', 'carte'])) return 'document_map';
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
      'station',
    ]);
}

function isLowInformation(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  return includesAny(textForRecord(record, taxonomy), ['blank', 'featureless', 'cloud', 'water only', 'low information'])
    || (record.aerial_matches?.length ? inferLandUse(record, taxonomy) === 'low_information' : false);
}

function rowLooksHardForHumanLegibility(record: ArchiveRecord, taxonomy?: TaxonomyRow): boolean {
  return isLowInformation(record, taxonomy)
    || includesAny(textForRecord(record, taxonomy), ['blur', 'dark', 'overexposed', 'underexposed', 'damaged', 'document', 'map', 'plan'])
    || Boolean(cleanText(record.vlm_error) || cleanText(record.vlm_metadata_error));
}

function searchFailureTermsForRecord(record: ArchiveRecord, taxonomy: TaxonomyRow | undefined, failures: FailureContext): string[] {
  const text = textForRecord(record, taxonomy);
  return Array.from(failures.failedTerms).filter((term) => text.includes(term)).slice(0, 5);
}

function familyKey(record: ArchiveRecord): string {
  const id = recordId(record);
  const source = `${record.external_url ?? ''} ${imageFilename(record)} ${titleValue(record)} ${coteValue(record)}`;
  const aerialStrip = /VM97-3_7P(\d+)/i.exec(source);
  if (aerialStrip) return `aerial_7p_${aerialStrip[1]}`;
  const aerialSeries = /(VM97,S3,D\d+)/i.exec(source);
  if (aerialSeries) return `aerial_series_${aerialSeries[1].toLowerCase()}`;
  const oblique = /(VM94-B\d+)/i.exec(source);
  if (oblique) return `oblique_${oblique[1].toLowerCase()}`;
  const reportage = /(VM94-[A-Z0-9]+|VM94,SY,[A-Z0-9,]+)/i.exec(source);
  if (reportage) return `ground_${reportage[1].toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return id;
}

function byId<T extends { id?: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = canonicalId(row.id);
    if (id) map.set(id, row);
  }
  return map;
}

function groupById<T extends { id?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = canonicalId(row.id);
    if (!id) continue;
    const current = map.get(id) ?? [];
    current.push(row);
    map.set(id, current);
  }
  return map;
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean))).sort();
}

function buildCurrentLabelProfile(labels: LabelRow[]): CurrentLabelProfile {
  const labeledIds = new Set<string>();
  let sceneTextLabels = 0;
  let entityLabels = 0;
  let searchExpectationLabels = 0;
  const imageModeCounts: Record<string, number> = {};
  const landUseCounts: Record<string, number> = {};

  for (const label of labels) {
    const id = canonicalId(label.record_id);
    if (id) labeledIds.add(id);
    const imageMode = cleanText(label.labels?.image_mode) || 'unknown';
    imageModeCounts[imageMode] = (imageModeCounts[imageMode] ?? 0) + 1;
    const landUse = cleanText(label.labels?.aerial_land_use?.dominant_land_use);
    if (landUse) landUseCounts[landUse] = (landUseCounts[landUse] ?? 0) + 1;
    if ((label.labels?.scene_text ?? []).length) sceneTextLabels += 1;
    if ((label.labels?.entities ?? []).length) entityLabels += 1;
    if ((label.labels?.search_expectations ?? []).length) searchExpectationLabels += 1;
  }

  return { labeledIds, imageModeCounts, landUseCounts, sceneTextLabels, entityLabels, searchExpectationLabels };
}

function buildFailureContext(rows: SearchBaselineRow[]): FailureContext {
  const failedRows = rows.filter((row) => !row.error && row.pass_expected_bucket === false);
  const failedQueries = uniqueSorted(failedRows.map((row) => cleanText(row.query)));
  const failedTerms = new Set<string>();
  const stopTerms = new Set(['montreal', 'archive', 'archives', 'aerial', 'photo', 'image', 'historical', 'the']);
  for (const query of failedQueries) {
    for (const term of normalize(query).split(' ')) {
      if (term.length >= 4 && !stopTerms.has(term)) failedTerms.add(term);
    }
  }
  return {
    failedRows,
    failedQueries,
    failedTerms,
    failedSlices: countBy(failedRows, (row) => cleanText(row.slice)),
    failedSliceModes: countBy(failedRows, (row) => `${cleanText(row.slice)}:${cleanText(row.mode)}`),
  };
}

function buildModelBaselineContext(report: { labels?: ModelBaselineLabelReport[] } | null): ModelBaselineContext {
  const labels = report?.labels ?? [];
  const weakTargets = new Set<string>();
  const singleClassTargets = new Set<string>();
  const promisingTargets = new Set<string>();
  const summary: ModelBaselineContext['summary'] = {};

  for (const label of labels) {
    const lift = label.leave_one_out?.lift_vs_majority ?? null;
    const macroF1 = label.leave_one_out?.macro_f1 ?? null;
    summary[label.label_name] = {
      status: label.status,
      lift_vs_majority: lift,
      macro_f1: macroF1,
    };

    if (label.status === 'single_class') {
      singleClassTargets.add(label.label_name);
      weakTargets.add(label.label_name);
      continue;
    }
    if (lift === null || macroF1 === null || lift <= 0 || macroF1 < 0.55) {
      weakTargets.add(label.label_name);
      continue;
    }
    promisingTargets.add(label.label_name);
  }

  return {
    available: labels.length > 0,
    weakTargets,
    singleClassTargets,
    promisingTargets,
    summary,
  };
}

function candidateTypes(rows: CandidateRow[]): string[] {
  return uniqueSorted(rows.map((row) => cleanText(row.candidate_type)));
}

function collectionIds(rows: CollectionRow[]): string[] {
  return uniqueSorted(rows.map((row) => cleanText(row.collection_id)));
}

function scoreRecord(
  record: ArchiveRecord,
  context: {
    taxonomy: TaxonomyRow | undefined;
    quality: QualityRow | undefined;
    candidates: CandidateRow[];
    collections: CollectionRow[];
    artifact: ArtifactDecisionRow | undefined;
    cleanup: CleanupRow | undefined;
    categoryCounts: Record<string, number>;
    totalRecords: number;
    labels: CurrentLabelProfile;
    failures: FailureContext;
    modelBaseline: ModelBaselineContext;
    publicR2Domain: string;
  },
): ScoredRecord {
  const taxonomy = context.taxonomy;
  const quality = context.quality;
  const candidates = context.candidates;
  const collections = context.collections;
  const artifact = context.artifact;
  const cleanup = context.cleanup;
  const id = recordId(record);
  const text = textForRecord(record, taxonomy);
  const imageMode = inferImageMode(record, taxonomy);
  const landUse = inferLandUse(record, taxonomy);
  const lane: Lane = imageMode.startsWith('aerial') || imageMode === 'low_information' ? 'aerial_land_use_geo' : 'ground_text_entity';
  const sceneText = hasSceneTextCandidate(record, taxonomy);
  const entity = hasEntityCandidate(record, taxonomy);
  const confidence = typeof taxonomy?.primaryConfidence === 'number' ? taxonomy.primaryConfidence : null;
  const taxonomyCategory = cleanText(taxonomy?.primaryCategory) || 'missing_taxonomy';
  const components: ScoreComponent[] = [];
  const add = (stratum: AcquisitionStratum, score: number, reason: string) => {
    if (score <= 0) return;
    components.push({ stratum, score, reason });
  };

  if (confidence === null) {
    add('taxonomy_uncertainty', 5, 'missing taxonomy confidence');
  } else if (confidence < 0.25) {
    add('taxonomy_uncertainty', 9, `very low taxonomy confidence ${confidence.toFixed(2)}`);
  } else if (confidence < 0.5) {
    add('taxonomy_uncertainty', 6, `low taxonomy confidence ${confidence.toFixed(2)}`);
  } else if (confidence < 0.7) {
    add('taxonomy_uncertainty', 3, `medium taxonomy confidence ${confidence.toFixed(2)}`);
  }
  if (taxonomy?.reviewRequired || taxonomyCategory === 'uncertain') {
    add('taxonomy_uncertainty', 5, 'taxonomy review required or uncertain');
  }

  if (lane === 'aerial_land_use_geo' && context.failures.failedSlices.aerial_land_use) {
    add('benchmark_aerial_land_use_gap', 9, 'benchmark gap: aerial land-use retrieval currently fails');
    const currentLandUseLabels = context.labels.landUseCounts[landUse] ?? 0;
    if (currentLandUseLabels < 4) add('benchmark_aerial_land_use_gap', 4, `under-labeled aerial land use: ${landUse}`);
    if (['farmland', 'residential', 'industrial', 'mixed_urban', 'waterfront', 'water'].includes(landUse)) {
      add('benchmark_aerial_land_use_gap', 3, `matches failed aerial query family: ${landUse}`);
    }
  }
  if (lane === 'ground_text_entity') {
    add('ground_text_entity_gap', 8, 'rare non-aerial lane in aerial-heavy corpus');
    const currentModeLabels = context.labels.imageModeCounts[imageMode] ?? 0;
    if (currentModeLabels < 12) add('ground_text_entity_gap', 3, `under-labeled image mode: ${imageMode}`);
  }
  if (sceneText) {
    const scarcity = context.labels.sceneTextLabels < 25 ? 6 : 3;
    add('ground_text_entity_gap', scarcity, 'scene-text/OCR candidate');
    if (context.failures.failedSlices.text_in_image || context.failures.failedSlices.scene_text) {
      add('ground_text_entity_gap', 3, 'benchmark has text-in-image or scene-text failures');
    }
  }
  if (entity) {
    const scarcity = context.labels.entityLabels < 60 ? 4 : 2;
    add('ground_text_entity_gap', scarcity, 'entity or landmark candidate');
  }
  if (context.labels.searchExpectationLabels < 200 && (sceneText || entity || lane === 'aerial_land_use_geo')) {
    add(lane === 'aerial_land_use_geo' ? 'benchmark_aerial_land_use_gap' : 'ground_text_entity_gap', 2, 'needs more query-to-image expectations');
  }

  const categoryCount = context.categoryCounts[taxonomyCategory] ?? 0;
  const rarity = Math.log2(Math.max(2, context.totalRecords / Math.max(1, categoryCount)));
  if (rarity >= 4) add('rare_cluster_diversity', Math.min(6, rarity), `rare taxonomy category ${taxonomyCategory}`);
  const types = candidateTypes(candidates);
  if (types.includes('rare_find')) add('rare_cluster_diversity', 7, 'rare-find candidate from embedding isolation');
  if (collections.length) add('rare_cluster_diversity', Math.min(4, collections.length), `collection overlap: ${collectionIds(collections).slice(0, 3).join(', ')}`);

  const qualityLabels = quality?.labels ?? [];
  const qualityAction = cleanText(quality?.recommendedAction);
  if (qualityLabels.length) add('quality_repair_risk', Math.min(6, qualityLabels.length * 2), `quality labels: ${qualityLabels.join(', ')}`);
  if (qualityAction && qualityAction !== 'none') add('quality_repair_risk', 4, `quality action: ${qualityAction}`);
  const artifactActions = artifact?.actions?.filter((action) => action !== 'unchanged') ?? [];
  if (artifactActions.length) add('quality_repair_risk', 4, `artifact actions: ${artifactActions.join(', ')}`);
  if (cleanup?.recommendation === 'manual_review') add('quality_repair_risk', 5, 'cleanup experiment recommends manual review');
  if (cleanup?.categoryChanged) add('quality_repair_risk', 3, `cleanup changed category ${cleanup.categoryBefore} -> ${cleanup.categoryAfter}`);
  if (typeof cleanup?.embeddingShift === 'number' && cleanup.embeddingShift >= 0.35) {
    add('quality_repair_risk', 2, `large cleanup embedding shift ${cleanup.embeddingShift.toFixed(3)}`);
  }

  const modelBaseline = context.modelBaseline;
  const modelGapMatches: string[] = [];
  const addModelGap = (target: string, score: number, reason: string) => {
    if (!modelBaseline.available || score <= 0) return;
    modelGapMatches.push(target);
    add('model_baseline_gap', score, reason);
  };

  if (modelBaseline.singleClassTargets.has('human_legible') && (rowLooksHardForHumanLegibility(record, taxonomy) || artifactActions.length || qualityLabels.length)) {
    addModelGap('human_legible', 5, 'model gap: human_legible has no low/negative examples yet');
  }
  if (modelBaseline.singleClassTargets.has('needs_human_review') && (qualityLabels.length || artifactActions.length || cleanup?.recommendation === 'manual_review' || cleanText(record.vlm_error))) {
    addModelGap('needs_human_review', 5, 'model gap: needs_human_review has no positive examples yet');
  }
  if (modelBaseline.weakTargets.has('image_mode') && (imageMode === 'ground_object' || imageMode === 'document_map' || imageMode === 'low_information' || (imageMode.startsWith('aerial') && (confidence === null || confidence < 0.5 || landUse === 'low_information')))) {
    addModelGap('image_mode', 3, `model gap: image_mode baseline underperformed; candidate mode ${imageMode}`);
  }
  if (modelBaseline.weakTargets.has('search_value') && (sceneText || entity || searchFailureTermsForRecord(record, taxonomy, context.failures).length)) {
    addModelGap('search_value', 4, 'model gap: search_value needs more scene-text/entity/search-failure examples');
  }
  if (modelBaseline.weakTargets.has('story_value') && (entity || types.includes('social') || cleanText(record.vlm_metadata?.social_hook))) {
    addModelGap('story_value', 3, 'model gap: story_value needs stronger positives and negatives');
  }
  if (modelBaseline.promisingTargets.has('print_value') && (types.includes('print') || normalize(record.vlm_metadata?.print_quality).includes('excellent'))) {
    addModelGap('print_value', 3, 'model signal: print_value showed early lift; collect balanced examples');
  }
  if (modelBaseline.promisingTargets.has('partner_fit_tourism_local') && (entity || includesAny(text, ['landmark', 'church', 'hotel', 'market', 'square', 'rue', 'saint']))) {
    addModelGap('partner_fit_tourism_local', 2, 'model signal: tourism/local partner fit showed early lift');
  }

  if (types.includes('print') || types.includes('social')) {
    add('commercial_reward_candidate', 4, `candidate types: ${types.join(', ')}`);
  }
  if (normalize(record.vlm_metadata?.print_quality).includes('excellent')) {
    add('commercial_reward_candidate', 2, 'VLM print quality marked excellent');
  }
  if (cleanText(record.vlm_metadata?.social_hook) || cleanText(candidates.find((row) => row.socialHook)?.socialHook)) {
    add('commercial_reward_candidate', 1.5, 'has social/story hook');
  }

  if (imageMode === 'document_map' && record.aerial_matches?.length) {
    add('hard_negative', 5, 'aerial metadata but document/map visual signal');
  }
  if (taxonomy?.excludeFromDefaultVisualSearch) {
    add('hard_negative', 3, 'excluded from default visual search');
  }
  if (cleanText(record.vlm_error) || cleanText(record.vlm_metadata_error)) {
    add('hard_negative', 2.5, 'VLM error present');
  }
  if (metadataQualityFlags(record).length) {
    add('hard_negative', Math.min(3, metadataQualityFlags(record).length), `metadata flags: ${metadataQualityFlags(record).join(', ')}`);
  }
  if (context.failures.failedTerms.size) {
    const matched = Array.from(context.failures.failedTerms).filter((term) => text.includes(term)).slice(0, 4);
    if (matched.length) {
      add(lane === 'aerial_land_use_geo' ? 'benchmark_aerial_land_use_gap' : 'ground_text_entity_gap', Math.min(4, matched.length * 1.5), `matches failed query terms: ${matched.join(', ')}`);
    }
  }

  add('coverage_backfill', 0.5, 'deterministic coverage fallback');

  const strata = uniqueSorted(components.map((component) => component.stratum)) as AcquisitionStratum[];
  const score = components.reduce((sum, component) => sum + component.score, 0);
  const stratumScores = new Map<AcquisitionStratum, number>();
  for (const component of components) {
    stratumScores.set(component.stratum, (stratumScores.get(component.stratum) ?? 0) + component.score);
  }
  const primary = Array.from(stratumScores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'coverage_backfill';

  return {
    record,
    taxonomy: taxonomy ?? null,
    quality: quality ?? null,
    candidates,
    collections,
    artifact: artifact ?? null,
    cleanup: cleanup ?? null,
    record_id: id,
    image_url: imageUrl(record, context.publicR2Domain, candidates, taxonomy),
    image_filename: imageFilename(record),
    title: titleValue(record, taxonomy, candidates),
    description: cleanText(record.description),
    date: dateValue(record, taxonomy, candidates),
    cote: coteValue(record, candidates),
    source_url: cleanText(record.external_url),
    credit_line: sourceCredit(record),
    source_dataset: aerialDataset(record) || 'phototheque_archives_or_unknown',
    lane,
    image_mode: imageMode,
    likely_land_use: landUse,
    family_key: familyKey(record),
    taxonomy_category: taxonomyCategory,
    taxonomy_confidence: confidence,
    scene_text_candidate: sceneText,
    entity_candidate: entity,
    geo_candidate: lane === 'aerial_land_use_geo' || entity,
    low_information_candidate: isLowInformation(record, taxonomy),
    model_baseline_gap_matches: uniqueSorted(modelGapMatches),
    components,
    strata,
    primary_stratum: primary,
    score,
  };
}

function stableScoreSort(seed: string): (a: ScoredRecord, b: ScoredRecord) => number {
  return (a, b) => b.score - a.score || hashSeed(`${seed}:${a.record_id}`) - hashSeed(`${seed}:${b.record_id}`);
}

function canSelect(row: ScoredRecord, familyCounts: Map<string, number>, maxPerFamily: number): boolean {
  return (familyCounts.get(row.family_key) ?? 0) < maxPerFamily;
}

function addSelected(row: ScoredRecord, selected: Map<string, ScoredRecord>, familyCounts: Map<string, number>): void {
  selected.set(row.record_id, row);
  familyCounts.set(row.family_key, (familyCounts.get(row.family_key) ?? 0) + 1);
}

function selectQueue(scored: ScoredRecord[], queueSize: number, seed: string, maxPerFamily: number): ScoredRecord[] {
  const sorted = [...scored].sort(stableScoreSort(seed));
  const selected = new Map<string, ScoredRecord>();
  const familyCounts = new Map<string, number>();
  const groundMinimum = Math.min(
    Math.round(queueSize * 0.20),
    sorted.filter((row) => row.lane === 'ground_text_entity').length,
  );
  let groundAdded = 0;
  for (const row of sorted) {
    if (groundAdded >= groundMinimum) break;
    if (row.lane !== 'ground_text_entity') continue;
    if (selected.has(row.record_id)) continue;
    if (!canSelect(row, familyCounts, maxPerFamily * 2)) continue;
    addSelected(row, selected, familyCounts);
    groundAdded += 1;
  }

  const quotas: Array<[AcquisitionStratum, number]> = [
    ['benchmark_aerial_land_use_gap', Math.round(queueSize * 0.26)],
    ['ground_text_entity_gap', Math.round(queueSize * 0.20)],
    ['model_baseline_gap', Math.round(queueSize * 0.14)],
    ['taxonomy_uncertainty', Math.round(queueSize * 0.14)],
    ['rare_cluster_diversity', Math.round(queueSize * 0.12)],
    ['quality_repair_risk', Math.round(queueSize * 0.11)],
    ['commercial_reward_candidate', Math.round(queueSize * 0.09)],
  ];

  for (const [stratum, quota] of quotas) {
    let added = 0;
    for (const row of sorted) {
      if (selected.size >= queueSize) break;
      if (added >= quota) break;
      if (selected.has(row.record_id)) continue;
      if (!row.strata.includes(stratum)) continue;
      if (!canSelect(row, familyCounts, maxPerFamily)) continue;
      addSelected(row, selected, familyCounts);
      added += 1;
    }
    if (selected.size >= queueSize) break;
  }

  for (const row of sorted) {
    if (selected.size >= queueSize) break;
    if (selected.has(row.record_id)) continue;
    if (!canSelect(row, familyCounts, maxPerFamily)) continue;
    addSelected(row, selected, familyCounts);
  }

  for (const row of sorted) {
    if (selected.size >= queueSize) break;
    if (selected.has(row.record_id)) continue;
    if (!canSelect(row, familyCounts, maxPerFamily * 2)) continue;
    addSelected(row, selected, familyCounts);
  }

  return Array.from(selected.values()).sort(stableScoreSort(seed)).slice(0, queueSize);
}

function selectRandomBaseline(scored: ScoredRecord[], queueSize: number, seed: string, maxPerFamily: number): ScoredRecord[] {
  const rng = makeRng(`${seed}:random-baseline`);
  const selected: ScoredRecord[] = [];
  const familyCounts = new Map<string, number>();
  for (const row of shuffled(scored, rng)) {
    if (selected.length >= queueSize) break;
    if (!canSelect(row, familyCounts, maxPerFamily)) continue;
    selected.push(row);
    familyCounts.set(row.family_key, (familyCounts.get(row.family_key) ?? 0) + 1);
  }
  return selected;
}

function mlTasks(row: ScoredRecord): string[] {
  const tasks = new Set<string>(['active_learning']);
  if (row.lane === 'aerial_land_use_geo') {
    tasks.add('aerial_land_use');
    tasks.add('geo_estimation');
    tasks.add('search_retrieval_eval');
    if (!row.low_information_candidate) tasks.add('aerial_segmentation');
  } else {
    tasks.add('search_reranking');
    tasks.add('geo_estimation');
    if (row.scene_text_candidate) tasks.add('ocr_scene_text');
    if (row.entity_candidate) {
      tasks.add('entity_linking');
      tasks.add('landmark_recognition');
    }
  }
  if (row.strata.includes('commercial_reward_candidate')) tasks.add('reward_preference');
  if (row.strata.includes('quality_repair_risk')) tasks.add('quality_repair');
  if (row.strata.includes('model_baseline_gap')) tasks.add('model_baseline_eval');
  return Array.from(tasks).sort();
}

function requiredFields(row: ScoredRecord): string[] {
  const fields = new Set<string>([
    'image_mode',
    'human_legible',
    'story_value',
    'print_value',
    'search_value',
    'quality_action',
    'evidence_buckets',
    'search_expectations',
  ]);
  if (row.lane === 'aerial_land_use_geo') {
    fields.add('aerial_land_use');
    fields.add('geo_hypotheses');
    fields.add('aerial_segmentation_candidate');
    fields.add('aerial_georeference_candidate');
  } else {
    if (row.scene_text_candidate) fields.add('scene_text');
    if (row.entity_candidate) fields.add('entities');
    fields.add('geo_hypotheses');
  }
  if (row.strata.includes('commercial_reward_candidate')) fields.add('pairwise_preference_candidate');
  if (row.model_baseline_gap_matches.includes('human_legible')) fields.add('human_legible_negative_candidate');
  if (row.model_baseline_gap_matches.includes('needs_human_review')) fields.add('review_routing_signal');
  return Array.from(fields).sort();
}

function cautions(row: ScoredRecord): string[] {
  const notes: string[] = ['separate observed, metadata, inferred, and externally verified evidence'];
  if (row.taxonomy_confidence !== null && row.taxonomy_confidence < 0.5) notes.push('taxonomy is low confidence; do not copy it as ground truth');
  if (row.lane === 'aerial_land_use_geo') notes.push('do not claim exact coordinates unless independently verified');
  if (row.scene_text_candidate) notes.push('transcribe only legible scene text; mark partial or inferred text explicitly');
  if (row.strata.includes('quality_repair_risk')) notes.push('record whether labels depend on raw image defects or repairable artifacts');
  if (row.strata.includes('model_baseline_gap')) notes.push('this row was selected to fix a measured model-baseline gap; label positives and negatives explicitly');
  return notes;
}

function searchFailureMatches(row: ScoredRecord, failures: FailureContext): string[] {
  const text = textForRecord(row.record, row.taxonomy ?? undefined);
  const matches: string[] = [];
  if (row.lane === 'aerial_land_use_geo' && failures.failedSlices.aerial_land_use) matches.push('aerial_land_use');
  if (row.scene_text_candidate && (failures.failedSlices.text_in_image || failures.failedSlices.scene_text)) matches.push('scene_text_or_ocr');
  const terms = Array.from(failures.failedTerms).filter((term) => text.includes(term)).slice(0, 5);
  matches.push(...terms.map((term) => `query_term:${term}`));
  return uniqueSorted(matches);
}

function toQueueRows(rows: ScoredRecord[], seed: string, selectedAt: string, failures: FailureContext): QueueRow[] {
  const familyQueueCounts = countBy(rows, (row) => row.family_key);
  return rows.map((row, index) => {
    const priority: QueueRow['label_task']['priority'] = row.score >= 32 ? 'critical' : row.score >= 22 ? 'high' : 'medium';
    return {
      active_learning_batch_id: 'active_learning_batch_001',
      queue_id: `al-b001-${String(index + 1).padStart(4, '0')}`,
      rank: index + 1,
      selected_at: selectedAt,
      seed,
      record: {
        id: row.record_id,
        title: row.title,
        description: row.description,
        date: row.date,
        cote: row.cote,
        image_filename: row.image_filename,
        image_url: row.image_url,
        source_url: row.source_url,
        credit_line: row.credit_line,
        source_dataset: row.source_dataset,
      },
      acquisition: {
        score: Number(row.score.toFixed(2)),
        primary_stratum: row.primary_stratum,
        strata: row.strata,
        family_key: row.family_key,
        family_count_in_queue: familyQueueCounts[row.family_key] ?? 1,
        score_components: row.components.map((component) => ({
          ...component,
          score: Number(component.score.toFixed(2)),
        })),
        reasons: row.components
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((component) => component.reason),
      },
      current_signals: {
        lane: row.lane,
        image_mode: row.image_mode,
        likely_land_use: row.likely_land_use,
        taxonomy_primary_category: row.taxonomy_category,
        taxonomy_confidence: row.taxonomy_confidence,
        taxonomy_review_required: Boolean(row.taxonomy?.reviewRequired),
        metadata_quality_flags: metadataQualityFlags(row.record),
        quality_labels: row.quality?.labels ?? [],
        quality_action: cleanText(row.quality?.recommendedAction),
        candidate_types: candidateTypes(row.candidates),
        collection_ids: collectionIds(row.collections),
        artifact_actions: row.artifact?.actions ?? [],
        cleanup_labels: row.cleanup?.labels ?? [],
        search_failure_matches: searchFailureMatches(row, failures),
        model_baseline_gap_matches: row.model_baseline_gap_matches,
      },
      label_task: {
        priority,
        required_fields: requiredFields(row),
        ml_tasks: mlTasks(row),
        cautions: cautions(row),
      },
    };
  });
}

function coverage(rows: ScoredRecord[]): Record<string, unknown> {
  const familyCounts = countBy(rows, (row) => row.family_key);
  const familyValues = Object.values(familyCounts);
  return {
    rows: rows.length,
    average_score: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0,
    by_primary_stratum: countBy(rows, (row) => row.primary_stratum),
    by_lane: countBy(rows, (row) => row.lane),
    by_image_mode: countBy(rows, (row) => row.image_mode),
    by_likely_land_use: countBy(rows, (row) => row.likely_land_use),
    ground_lane_records: rows.filter((row) => row.lane === 'ground_text_entity').length,
    aerial_lane_records: rows.filter((row) => row.lane === 'aerial_land_use_geo').length,
    taxonomy_categories: Object.keys(countBy(rows, (row) => row.taxonomy_category)).length,
    scene_text_candidates: rows.filter((row) => row.scene_text_candidate).length,
    entity_candidates: rows.filter((row) => row.entity_candidate).length,
    quality_repair_risk: rows.filter((row) => row.strata.includes('quality_repair_risk')).length,
    model_baseline_gap_records: rows.filter((row) => row.strata.includes('model_baseline_gap')).length,
    model_baseline_primary_records: rows.filter((row) => row.primary_stratum === 'model_baseline_gap').length,
    model_baseline_gap_targets: countBy(rows.flatMap((row) => row.model_baseline_gap_matches), (target) => target),
    benchmark_gap_records: rows.filter((row) => row.strata.includes('benchmark_aerial_land_use_gap') || row.strata.includes('ground_text_entity_gap')).length,
    rare_or_collection_records: rows.filter((row) => row.strata.includes('rare_cluster_diversity')).length,
    commercial_reward_records: rows.filter((row) => row.strata.includes('commercial_reward_candidate')).length,
    unique_families: familyValues.length,
    max_family_count: familyValues.length ? Math.max(...familyValues) : 0,
  };
}

function ratio(activeValue: unknown, randomValue: unknown): number | null {
  if (typeof activeValue !== 'number' || typeof randomValue !== 'number' || randomValue === 0) return null;
  return activeValue / randomValue;
}

function comparison(active: Record<string, unknown>, random: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'average_score',
    'ground_lane_records',
    'aerial_lane_records',
    'taxonomy_categories',
    'scene_text_candidates',
    'entity_candidates',
    'quality_repair_risk',
    'model_baseline_gap_records',
    'model_baseline_primary_records',
    'benchmark_gap_records',
    'rare_or_collection_records',
    'commercial_reward_records',
    'unique_families',
  ];
  return Object.fromEntries(keys.map((key) => [key, {
    active: active[key],
    random: random[key],
    ratio: ratio(active[key], random[key]),
  }]));
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath: string, rows: QueueRow[]): void {
  const headers = [
    'queue_id',
    'rank',
    'score',
    'primary_stratum',
    'strata',
    'record_id',
    'title',
    'lane',
    'image_mode',
    'likely_land_use',
    'taxonomy_category',
    'taxonomy_confidence',
    'candidate_types',
    'quality_labels',
    'model_baseline_gap_matches',
    'required_fields',
    'image_url',
    'source_url',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.queue_id,
      row.rank,
      row.acquisition.score,
      row.acquisition.primary_stratum,
      row.acquisition.strata.join('|'),
      row.record.id,
      row.record.title,
      row.current_signals.lane,
      row.current_signals.image_mode,
      row.current_signals.likely_land_use,
      row.current_signals.taxonomy_primary_category,
      row.current_signals.taxonomy_confidence,
      row.current_signals.candidate_types.join('|'),
      row.current_signals.quality_labels.join('|'),
      row.current_signals.model_baseline_gap_matches.join('|'),
      row.label_task.required_fields.join('|'),
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

function renderContactSheet(rows: QueueRow[]): string {
  const cards = rows.map((row) => `
    <article class="card ${row.current_signals.lane}">
      <img src="${escapeHtml(row.record.image_url)}" alt="${escapeHtml(row.record.title)}" loading="lazy">
      <div class="body">
        <div class="meta">#${row.rank} · ${escapeHtml(row.queue_id)} · ${escapeHtml(row.record.id)}</div>
        <h2>${escapeHtml(row.record.title || row.record.id)}</h2>
        <p><strong>Score:</strong> ${row.acquisition.score} · <strong>Primary:</strong> ${escapeHtml(row.acquisition.primary_stratum)}</p>
        <p><strong>Mode:</strong> ${escapeHtml(row.current_signals.image_mode)} · <strong>Land:</strong> ${escapeHtml(row.current_signals.likely_land_use)}</p>
        <p><strong>Reasons:</strong> ${escapeHtml(row.acquisition.reasons.slice(0, 3).join('; '))}</p>
        <p><strong>Fields:</strong> ${escapeHtml(row.label_task.required_fields.join(', '))}</p>
        <p class="desc">${escapeHtml(row.record.description.slice(0, 220))}</p>
      </div>
    </article>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dataset Factory Active Learning Batch 001</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f2ec; color: #1f2421; }
    header { position: sticky; top: 0; z-index: 2; padding: 18px 24px; background: rgba(245,242,236,.96); border-bottom: 1px solid #ded8ce; }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; padding: 18px; }
    .card { background: #fffdf8; border: 1px solid #ded8ce; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #e8e2d8; display: block; }
    .body { padding: 12px; }
    .meta { color: #70756e; font-size: 12px; }
    h2 { font-size: 15px; margin: 6px 0 8px; line-height: 1.25; }
    p { font-size: 13px; line-height: 1.35; margin: 6px 0; }
    .desc { color: #4f554e; }
    .aerial_land_use_geo { border-top: 4px solid #2e6f95; }
    .ground_text_entity { border-top: 4px solid #9a5b22; }
  </style>
</head>
<body>
  <header><h1>Dataset Factory Active Learning Batch 001 · ${rows.length} records</h1></header>
  <main class="grid">${cards}</main>
</body>
</html>
`;
}

function renderMarkdown(report: Record<string, unknown>, rows: QueueRow[]): string {
  const active = report.active_learning_coverage as Record<string, unknown>;
  const random = report.random_baseline_coverage as Record<string, unknown>;
  const compare = report.coverage_lift_vs_random as Record<string, { active: unknown; random: unknown; ratio: number | null }>;
  const modelProfile = report.model_baseline_profile as Record<string, unknown> | undefined;
  const topRows = rows.slice(0, 25);
  const lines = [
    '# Active Learning v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- queue size: ${report.queue_size}`,
    `- unlabeled candidates scored: ${report.unlabeled_candidates}`,
    `- labeled records excluded: ${report.labeled_records_excluded}`,
    `- family throttle: max ${report.max_per_family} per lightweight family key`,
    '',
    '## Coverage Lift vs Random',
    '',
    '| Metric | Active | Random | Ratio |',
    '|---|---:|---:|---:|',
  ];

  for (const [metric, values] of Object.entries(compare)) {
    const ratioText = values.ratio === null ? 'n/a' : values.ratio.toFixed(2);
    const activeText = typeof values.active === 'number' ? values.active.toFixed(metric === 'average_score' ? 2 : 0) : String(values.active);
    const randomText = typeof values.random === 'number' ? values.random.toFixed(metric === 'average_score' ? 2 : 0) : String(values.random);
    lines.push(`| ${metric} | ${activeText} | ${randomText} | ${ratioText} |`);
  }

  lines.push(
    '',
    '## Active Queue Strata',
    '',
    '```json',
    JSON.stringify(active.by_primary_stratum, null, 2),
    '```',
    '',
    '## Random Baseline Strata',
    '',
    '```json',
    JSON.stringify(random.by_primary_stratum, null, 2),
    '```',
    '',
    '## Model Baseline Gap Profile',
    '',
    '```json',
    JSON.stringify(modelProfile ?? {}, null, 2),
    '```',
    '',
    '## Top Queue Records',
    '',
    '| Rank | Record | Score | Primary | Mode | Land Use | Reasons |',
    '|---:|---|---:|---|---|---|---|',
  );

  for (const row of topRows) {
    lines.push(`| ${row.rank} | ${row.record.id} | ${row.acquisition.score.toFixed(2)} | ${row.acquisition.primary_stratum} | ${row.current_signals.image_mode} | ${row.current_signals.likely_land_use} | ${row.acquisition.reasons.slice(0, 3).join('; ').replace(/\|/g, '\\|')} |`);
  }

  lines.push(
    '',
    '## Caveats',
    '',
    '- This is an acquisition queue, not a final gold-label set.',
    '- Family throttling is metadata-based until the Visual Family Graph exists.',
    '- Scores are designed to prioritize labeling value, not to rank public product quality.',
    '',
  );

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      taxonomy: { type: 'string', default: DEFAULT_TAXONOMY },
      quality: { type: 'string', default: DEFAULT_QUALITY },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      collections: { type: 'string', default: DEFAULT_COLLECTIONS },
      labels: { type: 'string', default: DEFAULT_LABELS },
      'search-baseline': { type: 'string', default: DEFAULT_SEARCH_BASELINE },
      'artifact-decisions': { type: 'string', default: DEFAULT_ARTIFACT_DECISIONS },
      'cleanup-rows': { type: 'string', default: DEFAULT_CLEANUP_ROWS },
      'model-baseline': { type: 'string', default: DEFAULT_MODEL_BASELINE },
      'skip-model-baseline': { type: 'boolean', default: false },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      seed: { type: 'string', default: DEFAULT_SEED },
      'queue-size': { type: 'string', default: String(DEFAULT_QUEUE_SIZE) },
      'max-per-family': { type: 'string', default: String(DEFAULT_MAX_PER_FAMILY) },
      'public-r2-domain': { type: 'string', default: DEFAULT_PUBLIC_R2_DOMAIN },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const taxonomyPath = resolveRepoPath(values.taxonomy!);
  const qualityPath = resolveRepoPath(values.quality!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const collectionsPath = resolveRepoPath(values.collections!);
  const labelsPath = resolveRepoPath(values.labels!);
  const searchBaselinePath = resolveRepoPath(values['search-baseline']!);
  const artifactDecisionsPath = resolveRepoPath(values['artifact-decisions']!);
  const cleanupRowsPath = resolveRepoPath(values['cleanup-rows']!);
  const skipModelBaseline = values['skip-model-baseline']!;
  const modelBaselinePath = skipModelBaseline ? null : resolveRepoPath(values['model-baseline']!);
  const outputDir = resolveRepoPath(values.output!);
  const seed = values.seed!;
  const queueSize = Math.max(1, Number.parseInt(values['queue-size']!, 10) || DEFAULT_QUEUE_SIZE);
  const maxPerFamily = Math.max(1, Number.parseInt(values['max-per-family']!, 10) || DEFAULT_MAX_PER_FAMILY);
  const publicR2Domain = values['public-r2-domain']!;
  requireArtifacts([
    { path: manifestPath, label: 'VLM structured manifest' },
    { path: taxonomyPath, label: 'taxonomy downstream rows' },
    { path: qualityPath, label: 'image-quality labels' },
    { path: candidatesPath, label: 'candidate downstream rows' },
    { path: collectionsPath, label: 'collection downstream rows' },
    { path: labelsPath, label: 'existing Dataset Factory labels' },
    { path: searchBaselinePath, label: 'benchmark search baseline rows' },
    { path: artifactDecisionsPath, label: 'image artifact decisions' },
    { path: cleanupRowsPath, label: 'cleanup embedding rows' },
    ...(modelBaselinePath ? [{ path: modelBaselinePath, label: 'model baseline report' }] : []),
  ]);

  const records = readJsonl<ArchiveRecord>(manifestPath);
  const taxonomyRows = readJsonl<TaxonomyRow>(taxonomyPath);
  const qualityRows = readJsonl<QualityRow>(qualityPath);
  const candidateRows = readJsonl<CandidateRow>(candidatesPath);
  const collectionRows = readJsonl<CollectionRow>(collectionsPath);
  const labels = readJsonl<LabelRow>(labelsPath);
  const searchRows = readJsonl<SearchBaselineRow>(searchBaselinePath);
  const artifactRows = readJsonl<ArtifactDecisionRow>(artifactDecisionsPath);
  const cleanupRows = readJsonl<CleanupRow>(cleanupRowsPath);
  const modelBaselineReport = modelBaselinePath
    ? readJson<{ labels?: ModelBaselineLabelReport[] }>(modelBaselinePath)
    : {};

  const taxonomyMap = byId(taxonomyRows);
  const qualityMap = byId(qualityRows);
  const candidateMap = groupById(candidateRows);
  const collectionMap = groupById(collectionRows);
  const artifactMap = byId(artifactRows);
  const cleanupMap = byId(cleanupRows);
  const labelsProfile = buildCurrentLabelProfile(labels);
  const failures = buildFailureContext(searchRows);
  const modelBaseline = buildModelBaselineContext(modelBaselineReport);
  const categoryCounts = countBy(taxonomyRows, (row) => cleanText(row.primaryCategory) || 'missing_taxonomy');

  const scored = records
    .filter((record) => recordId(record) && !labelsProfile.labeledIds.has(recordId(record)))
    .map((record) => {
      const id = recordId(record);
      return scoreRecord(record, {
        taxonomy: taxonomyMap.get(id),
        quality: qualityMap.get(id),
        candidates: candidateMap.get(id) ?? [],
        collections: collectionMap.get(id) ?? [],
        artifact: artifactMap.get(id),
        cleanup: cleanupMap.get(id),
        categoryCounts,
        totalRecords: records.length,
        labels: labelsProfile,
        failures,
        modelBaseline,
        publicR2Domain,
      });
    });

  const selected = selectQueue(scored, Math.min(queueSize, scored.length), seed, maxPerFamily);
  const random = selectRandomBaseline(scored, Math.min(queueSize, scored.length), seed, maxPerFamily);
  const selectedAt = datasetFactoryNowIso();
  const queueRows = toQueueRows(selected, seed, selectedAt, failures);
  const randomRows = toQueueRows(random, `${seed}:random-baseline`, selectedAt, failures);
  const activeCoverage = coverage(selected);
  const randomCoverage = coverage(random);

  const report = {
    active_learning_batch_id: 'active_learning_batch_001',
    generated_at: selectedAt,
    seed,
    queue_size: queueRows.length,
    max_per_family: maxPerFamily,
    inputs: {
      manifest: path.relative(MONOREPO_ROOT, manifestPath),
      taxonomy: path.relative(MONOREPO_ROOT, taxonomyPath),
      quality: path.relative(MONOREPO_ROOT, qualityPath),
      candidates: path.relative(MONOREPO_ROOT, candidatesPath),
      collections: path.relative(MONOREPO_ROOT, collectionsPath),
      labels: path.relative(MONOREPO_ROOT, labelsPath),
      search_baseline: path.relative(MONOREPO_ROOT, searchBaselinePath),
      artifact_decisions: path.relative(MONOREPO_ROOT, artifactDecisionsPath),
      cleanup_rows: path.relative(MONOREPO_ROOT, cleanupRowsPath),
      model_baseline: modelBaselinePath ? path.relative(MONOREPO_ROOT, modelBaselinePath) : null,
    },
    input_counts: {
      records: records.length,
      taxonomy: taxonomyRows.length,
      quality: qualityRows.length,
      candidates: candidateRows.length,
      collections: collectionRows.length,
      labels: labels.length,
      search_baseline_rows: searchRows.length,
      search_failures: failures.failedRows.length,
      artifact_decisions: artifactRows.length,
      cleanup_rows: cleanupRows.length,
      model_baseline_available: modelBaseline.available,
    },
    labeled_records_excluded: labelsProfile.labeledIds.size,
    unlabeled_candidates: scored.length,
    current_label_profile: {
      image_mode_counts: labelsProfile.imageModeCounts,
      land_use_counts: labelsProfile.landUseCounts,
      scene_text_labels: labelsProfile.sceneTextLabels,
      entity_labels: labelsProfile.entityLabels,
      search_expectation_labels: labelsProfile.searchExpectationLabels,
    },
    search_failure_profile: {
      failed_slices: failures.failedSlices,
      failed_slice_modes: failures.failedSliceModes,
      failed_queries: failures.failedQueries,
    },
    model_baseline_profile: {
      weak_targets: Array.from(modelBaseline.weakTargets).sort(),
      single_class_targets: Array.from(modelBaseline.singleClassTargets).sort(),
      promising_targets: Array.from(modelBaseline.promisingTargets).sort(),
      summary: modelBaseline.summary,
    },
    active_learning_coverage: activeCoverage,
    random_baseline_coverage: randomCoverage,
    coverage_lift_vs_random: comparison(activeCoverage, randomCoverage),
    outputs: {
      queue_jsonl: 'active-learning-batch-001.jsonl',
      queue_csv: 'active-learning-batch-001.csv',
      random_baseline_jsonl: 'random-baseline-batch-001.jsonl',
      contact_sheet: 'active-learning-contact-sheet.html',
      report_json: 'active-learning-report.json',
      report_md: 'active-learning-report.md',
    },
    caveats: [
      'This is an acquisition queue, not an adjudicated label set.',
      'Lightweight family throttling uses source metadata until Visual Family Graph v0 exists.',
      'Search-failure boosts are derived from the current live API baseline and should be regenerated after search/index changes.',
    ],
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'active-learning-batch-001.jsonl'), queueRows);
  writeJsonl(path.join(outputDir, 'random-baseline-batch-001.jsonl'), randomRows);
  writeCsv(path.join(outputDir, 'active-learning-batch-001.csv'), queueRows);
  fs.writeFileSync(path.join(outputDir, 'active-learning-contact-sheet.html'), renderContactSheet(queueRows), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'active-learning-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'active-learning-report.md'), renderMarkdown(report, queueRows), 'utf-8');

  console.log(`Wrote Active Learning v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- queue rows: ${queueRows.length}`);
  console.log(`- active average score: ${(activeCoverage.average_score as number).toFixed(2)}`);
  console.log(`- random average score: ${(randomCoverage.average_score as number).toFixed(2)}`);
  console.log(`- ground lane records: ${activeCoverage.ground_lane_records} active vs ${randomCoverage.ground_lane_records} random`);
  console.log(`- scene-text candidates: ${activeCoverage.scene_text_candidates} active vs ${randomCoverage.scene_text_candidates} random`);
  console.log(`- model-baseline gap records: ${activeCoverage.model_baseline_gap_records} active vs ${randomCoverage.model_baseline_gap_records} random`);
  console.log(`- benchmark-gap records: ${activeCoverage.benchmark_gap_records} active vs ${randomCoverage.benchmark_gap_records} random`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
