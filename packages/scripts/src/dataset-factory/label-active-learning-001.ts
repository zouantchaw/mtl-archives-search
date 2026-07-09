import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_QUEUE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl',
);
const DEFAULT_EXISTING_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100',
);

const SCHEMA_VERSION = 'dataset_factory_label_v0';
const RIGHTS_CHECKED_AT = '2026-06-29';
const LICENSE_ID = 'cc-by-4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const DEFAULT_LIMIT = 100;

type ReviewFlag =
  | 'needs_human_review'
  | 'thin_metadata'
  | 'synthetic_description'
  | 'attribution_detail_missing'
  | 'exact_location_unsafe'
  | 'date_uncertain'
  | 'orientation_uncertain'
  | 'quality_repair_needed'
  | 'rights_review_needed'
  | 'model_disagreement'
  | 'external_verification_needed'
  | 'ocr_uncertain'
  | 'entity_resolution_needed'
  | 'geo_reference_needed'
  | 'aerial_land_use_uncertain'
  | 'low_information_image'
  | 'none';

type EvidenceType = 'visual_observation' | 'source_metadata' | 'vlm_output' | 'ocr_text' | 'external_source' | 'inference' | 'human_judgment';

type EvidenceItem = {
  id: string;
  claim: string;
  evidence_type: EvidenceType;
  source_field: string | null;
  source_url: string | null;
  confidence: number;
  review_flags: ReviewFlag[];
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

type EntityType =
  | 'brand'
  | 'business'
  | 'street'
  | 'landmark'
  | 'institution'
  | 'transit'
  | 'neighborhood'
  | 'person'
  | 'event'
  | 'natural_feature'
  | 'unknown';

type EntityMention = {
  name: string;
  entity_type: EntityType;
  source: 'observed_text' | 'observed_visual' | 'source_metadata' | 'external_verified' | 'inferred';
  canonical_id: string | null;
  confidence: number;
  evidence_refs: string[];
  review_flags: ReviewFlag[];
};

type SceneText = {
  text: string;
  text_type: 'billboard' | 'storefront' | 'street_sign' | 'poster' | 'vehicle' | 'document' | 'inscription' | 'caption_or_overlay' | 'unknown';
  normalized_text: string;
  location_hint: string | null;
  confidence: number;
  evidence_refs: string[];
  review_flags: ReviewFlag[];
};

type ActiveQueueRow = {
  queue_id: string;
  rank: number;
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
    primary_stratum: string;
    strata: string[];
    family_key: string;
    score_components: Array<{ stratum: string; score: number; reason: string }>;
    reasons: string[];
  };
  current_signals: {
    lane: 'ground_text_entity' | 'aerial_land_use_geo';
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
  };
  label_task: {
    priority: 'critical' | 'high' | 'medium';
    required_fields: string[];
    ml_tasks: string[];
    cautions: string[];
  };
};

type LabelRow = {
  schema_version: typeof SCHEMA_VERSION;
  record_id: string;
  image_filename: string;
  source: {
    source_system: 'montreal_open_data_ckan' | 'archives_montreal_atom' | 'r2_derivative' | 'unknown';
    package_slug: string | null;
    resource_id: string | null;
    source_url: string | null;
    license_id: string;
    license_url: string | null;
    credit_line: string;
    commercial_use_allowed: boolean;
    rights_checked_at: string;
    rights_notes: string;
  };
  review: {
    labeler_type: 'codex';
    labeler_id: string;
    labeled_at: string;
    review_stage: 'batch';
  };
  labels: Record<string, unknown>;
  evidence: {
    observed: EvidenceItem[];
    metadata: EvidenceItem[];
    inferred: EvidenceItem[];
    verified: EvidenceItem[];
  };
  confidence: {
    overall: number;
    field_confidence: Record<string, number>;
    needs_human_review: boolean;
    review_flags: ReviewFlag[];
  };
  pairwise_preferences: unknown[];
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeText(value: unknown): string {
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

function uniqueSorted<T extends string>(items: T[]): T[] {
  return Array.from(new Set(items.filter(Boolean))).sort();
}

function sourceRights(row: ActiveQueueRow): LabelRow['source'] {
  const url = row.record.source_url;
  const lowerUrl = url.toLowerCase();
  const dataset = row.record.source_dataset;
  let packageSlug: string | null = null;
  let resourceId: string | null = null;
  let notes = 'CKAN package is CC BY 4.0; package notes require Archives de la Ville de Montréal credit.';

  if (lowerUrl.includes('phototheque-archives')) {
    packageSlug = 'phototheque-archives';
    resourceId = '41f0cec9-2110-452e-a93d-8f29190ee2ae';
  } else if (lowerUrl.includes('vues-aeriennes-archives') || dataset === 'aerial_1947_1949') {
    packageSlug = 'vues-aeriennes-archives';
    resourceId = '09a0893e-3142-4950-8c54-1250540bde13';
  } else if (lowerUrl.includes('vues-aeriennes-obliques') || dataset === 'aerial_obliques_1960_1992') {
    packageSlug = 'vues-aeriennes-obliques-de-l-ile-de-montreal-1960-1992';
    resourceId = '0ef12a2f-da90-49fb-8c46-89024edece54';
    notes = 'CKAN package is CC BY 4.0; oblique rows may require cote and photographer in the credit line when available.';
  } else if (dataset.startsWith('aerial_')) {
    packageSlug = 'vues-aeriennes-de-montreal-1958-1975';
    notes = 'CKAN package is CC BY 4.0; exact resource ID varies by year and should be preserved in full exports.';
  }

  return {
    source_system: packageSlug ? 'montreal_open_data_ckan' : 'unknown',
    package_slug: packageSlug,
    resource_id: resourceId,
    source_url: url || null,
    license_id: packageSlug ? LICENSE_ID : 'unknown',
    license_url: packageSlug ? LICENSE_URL : null,
    credit_line: row.record.credit_line || 'Archives de la Ville de Montréal',
    commercial_use_allowed: Boolean(packageSlug),
    rights_checked_at: RIGHTS_CHECKED_AT,
    rights_notes: packageSlug ? notes : 'Source package not recognized by active-learning label mapper.',
  };
}

function reviewedImageMode(row: ActiveQueueRow): ImageMode {
  const title = normalizeText(`${row.record.title} ${row.record.description} ${row.record.source_url} ${row.current_signals.taxonomy_primary_category}`);
  if (title.includes('carte index') || title.includes('index generale') || row.current_signals.taxonomy_primary_category === 'document_map') {
    return 'document_map';
  }
  return row.current_signals.image_mode;
}

function reviewedLandUse(row: ActiveQueueRow, mode: ImageMode): LandUse {
  if (mode === 'document_map') return 'unknown';
  if (mode === 'low_information') return 'low_information';
  return row.current_signals.likely_land_use;
}

function qualityActions(row: ActiveQueueRow, mode: ImageMode): string[] {
  const actions = new Set<string>();
  const text = normalizeText([
    row.current_signals.quality_action,
    ...row.current_signals.quality_labels,
    ...row.current_signals.artifact_actions,
    ...row.current_signals.cleanup_labels,
    ...row.acquisition.reasons,
  ].join(' '));
  if (text.includes('rotate') || text.includes('orientation')) actions.add('rotate');
  if (text.includes('border')) actions.add('border_trim');
  if (text.includes('washed') || text.includes('tone')) actions.add('tone_normalize');
  if (text.includes('crop')) actions.add('crop');
  if (row.label_task.priority === 'critical' || text.includes('review') || mode === 'document_map') actions.add('review');
  if (mode === 'document_map' || row.current_signals.lane === 'aerial_land_use_geo') actions.add('preserve_original');
  if (!actions.size) actions.add('no_action');
  return Array.from(actions).sort();
}

function partnerFit(row: ActiveQueueRow, landUse: LandUse, mode: ImageMode): string[] {
  const fit = new Set<string>(['education']);
  if (row.current_signals.lane === 'aerial_land_use_geo' || mode === 'document_map') {
    fit.add('urbanism_planning');
    fit.add('civic_infrastructure');
    if (['waterfront', 'water', 'park_green_space', 'forest', 'farmland'].includes(landUse)) fit.add('environmental');
  } else {
    fit.add('museum_archive');
    if (row.current_signals.search_failure_matches.includes('scene_text_or_ocr')) fit.add('tourism_local');
  }
  return Array.from(fit).sort();
}

function commercialSurfaces(row: ActiveQueueRow, mode: ImageMode): string[] {
  const surfaces = new Set<string>(['dataset_eval']);
  if (row.acquisition.strata.includes('benchmark_aerial_land_use_gap') || mode === 'document_map') surfaces.add('partner_brief');
  if (row.acquisition.strata.includes('ground_text_entity_gap')) surfaces.add('search_feature');
  if (row.current_signals.candidate_types.includes('social')) surfaces.add('reel');
  if (row.current_signals.candidate_types.includes('print') && !row.current_signals.quality_labels.length) surfaces.add('print');
  return Array.from(surfaces).sort();
}

function humanLegible(row: ActiveQueueRow, mode: ImageMode, landUse: LandUse): string {
  if (mode === 'low_information' || landUse === 'low_information') return 'low';
  if (row.current_signals.quality_labels.includes('unsafe_crop_candidate')) return 'medium';
  if (mode === 'document_map') return 'medium';
  return row.current_signals.lane === 'ground_text_entity' ? 'high' : 'medium';
}

function storyValue(row: ActiveQueueRow, mode: ImageMode): string {
  if (mode === 'low_information') return 'low';
  if (row.current_signals.candidate_types.includes('social')) return 'high';
  if (row.acquisition.strata.includes('rare_cluster_diversity')) return 'medium';
  return row.current_signals.lane === 'ground_text_entity' ? 'medium' : 'low';
}

function printValue(row: ActiveQueueRow, mode: ImageMode): string {
  if (mode === 'low_information' || mode === 'document_map') return 'none';
  if (row.current_signals.quality_labels.length) return 'low';
  if (row.current_signals.candidate_types.includes('print')) return 'medium';
  return row.current_signals.lane === 'ground_text_entity' ? 'low' : 'low';
}

function searchValue(row: ActiveQueueRow): string {
  if (row.acquisition.primary_stratum === 'ground_text_entity_gap') return 'high';
  if (row.current_signals.search_failure_matches.includes('aerial_land_use')) return 'high';
  if (row.current_signals.taxonomy_review_required) return 'medium';
  return 'medium';
}

function timeExtractability(date: string): 'none' | 'year_range' | 'year' | 'date' {
  if (!date) return 'none';
  if (/^\d{4}-\d{4}$/.test(date)) return 'year_range';
  if (/^\d{4}$/.test(date)) return 'year';
  return 'date';
}

function geoTime(row: ActiveQueueRow, mode: ImageMode): Record<string, unknown> {
  const isAerial = row.current_signals.lane === 'aerial_land_use_geo';
  return {
    geo: isAerial || mode === 'document_map' ? 'broad_area' : 'specific_place',
    time: timeExtractability(row.record.date),
    public_safe_exact_location: !isAerial && mode !== 'document_map',
    notes: isAerial || mode === 'document_map'
      ? 'Exact coordinates are intentionally not claimed; this row needs georeferencing or map alignment before point-level use.'
      : 'Place is title/metadata-supported and should still be externally checked before exact geocoding.',
  };
}

function evidenceMetadata(row: ActiveQueueRow): EvidenceItem[] {
  const flags: ReviewFlag[] = row.current_signals.metadata_quality_flags.includes('synthetic-description') ? ['synthetic_description'] : [];
  return [
    {
      id: 'meta_title_description',
      claim: `Source/manifest title and description: ${row.record.title}${row.record.description ? ` — ${row.record.description}` : ''}`,
      evidence_type: 'source_metadata',
      source_field: 'title/description',
      source_url: row.record.source_url || null,
      confidence: row.record.description ? 0.76 : 0.58,
      review_flags: flags,
    },
    {
      id: 'meta_date_cote_credit',
      claim: `Source/manifest date/cote/credit: ${[row.record.date, row.record.cote, row.record.credit_line].filter(Boolean).join(' | ') || 'not fully populated'}`,
      evidence_type: 'source_metadata',
      source_field: 'date/cote/credit',
      source_url: row.record.source_url || null,
      confidence: row.record.date ? 0.78 : 0.58,
      review_flags: row.record.date ? [] : ['date_uncertain'],
    },
  ];
}

function evidenceInferred(row: ActiveQueueRow, mode: ImageMode, landUse: LandUse): EvidenceItem[] {
  const flags = reviewFlags(row, mode, landUse);
  return [
    {
      id: 'inf_active_learning_signals',
      claim: `Active-learning draft assigns image mode ${mode} and land-use/geographic target ${landUse}; primary acquisition stratum is ${row.acquisition.primary_stratum}.`,
      evidence_type: 'inference',
      source_field: 'active_learning_queue',
      source_url: null,
      confidence: flags.includes('aerial_land_use_uncertain') || flags.includes('model_disagreement') ? 0.55 : 0.68,
      review_flags: flags.filter((flag) => flag !== 'needs_human_review'),
    },
    {
      id: 'inf_acquisition_reasons',
      claim: `Selection reasons: ${row.acquisition.reasons.slice(0, 5).join('; ')}`,
      evidence_type: 'human_judgment',
      source_field: 'acquisition.reasons',
      source_url: null,
      confidence: 0.7,
      review_flags: ['needs_human_review'],
    },
  ];
}

function inferSceneText(row: ActiveQueueRow): SceneText[] {
  if (!row.label_task.required_fields.includes('scene_text')) return [];
  const text = cleanText(row.record.title);
  if (!text || /^mtl_archives_metadata_/i.test(text)) return [];
  if (!/[A-Z]{3,}|\b(Rue|Boulevard|Avenue|Market|Store|Stores|Building|Hotel|Theatre|Bain|Chateau)\b/.test(text)) return [];
  return [{
    text,
    text_type: 'unknown',
    normalized_text: normalizeText(text),
    location_hint: 'title-derived candidate; not confirmed as visible scene text',
    confidence: 0.42,
    evidence_refs: ['meta_title_description', 'inf_active_learning_signals'],
    review_flags: ['ocr_uncertain', 'needs_human_review'],
  }];
}

function entityFromTitle(row: ActiveQueueRow): EntityMention[] {
  if (row.current_signals.lane !== 'ground_text_entity') return [];
  const title = cleanText(row.record.title);
  if (!title || /^mtl_archives_metadata_/i.test(title)) return [];
  const norm = normalizeText(title);
  let entityType: EntityType = 'unknown';
  if (/\b(rue|boulevard|avenue|street|st )\b/.test(norm)) entityType = 'street';
  else if (/\b(parc|park|square|place)\b/.test(norm)) entityType = 'landmark';
  else if (/\b(hopital|hospital|ecole|school|universite|eglise|church|marche|market|building|bain)\b/.test(norm)) entityType = 'institution';
  else if (/\b(store|stores|hotel|theatre|restaurant|garage|company|co )\b/.test(norm)) entityType = 'business';
  return [{
    name: title,
    entity_type: entityType,
    source: 'source_metadata',
    canonical_id: null,
    confidence: entityType === 'unknown' ? 0.45 : 0.66,
    evidence_refs: ['meta_title_description'],
    review_flags: entityType === 'unknown' ? ['entity_resolution_needed'] : ['external_verification_needed'],
  }];
}

function aerialLandUse(row: ActiveQueueRow, landUse: LandUse, mode: ImageMode): Record<string, unknown> | undefined {
  if (row.current_signals.lane !== 'aerial_land_use_geo' && mode !== 'document_map') return undefined;
  const lowInfo = landUse === 'low_information' || mode === 'low_information';
  const documentMap = mode === 'document_map';
  return {
    dominant_land_use: landUse,
    land_use_mix: [
      {
        class: landUse,
        approx_share: null,
        confidence: documentMap || landUse === 'unknown' ? 0.35 : lowInfo ? 0.58 : 0.66,
      },
    ],
    urbanization_stage: urbanizationStage(landUse, documentMap),
    segmentation_candidate: !lowInfo && !documentMap && landUse !== 'unknown',
    georeference_candidate: !lowInfo,
    notes: documentMap
      ? 'Document/map hard negative from aerial package; useful for search filtering and georeference context, not direct photo land-use segmentation.'
      : 'Draft land-use label from active-learning signals; needs visual/adjudication review before gold use.',
  };
}

function urbanizationStage(landUse: LandUse, documentMap: boolean): string {
  if (documentMap) return 'unknown';
  if (landUse === 'farmland' || landUse === 'forest') return 'rural';
  if (['residential', 'road_infrastructure', 'park_green_space'].includes(landUse)) return 'suburbanizing';
  if (landUse === 'industrial') return 'industrial';
  if (landUse === 'mixed_urban') return 'urban';
  if (landUse === 'waterfront') return 'transitional';
  return 'unknown';
}

function geoHypotheses(row: ActiveQueueRow, mode: ImageMode, entities: EntityMention[]): Record<string, unknown>[] {
  if (row.current_signals.lane === 'aerial_land_use_geo' || mode === 'document_map') {
    return [{
      place_label: mode === 'document_map' ? 'Montreal aerial index/map sheet' : 'Montreal aerial survey area',
      latitude: null,
      longitude: null,
      precision: 'city',
      method: mode === 'document_map' ? 'source_metadata' : 'aerial_georeference',
      confidence: mode === 'document_map' ? 0.5 : 0.42,
      evidence_refs: ['meta_date_cote_credit', 'inf_active_learning_signals'],
      public_safe_exact_location: false,
      review_flags: ['geo_reference_needed'],
    }];
  }
  const entity = entities[0];
  if (!entity) return [];
  return [{
    place_label: entity.name,
    latitude: null,
    longitude: null,
    precision: entity.entity_type === 'street' ? 'corridor' : 'specific_place',
    method: 'source_metadata',
    confidence: Math.min(0.68, entity.confidence),
    evidence_refs: entity.evidence_refs,
    public_safe_exact_location: true,
    review_flags: ['external_verification_needed'],
  }];
}

function searchExpectations(row: ActiveQueueRow, landUse: LandUse, entities: EntityMention[], sceneTexts: SceneText[]): Record<string, unknown>[] {
  if (row.current_signals.lane === 'aerial_land_use_geo') {
    const query = row.current_signals.search_failure_matches.includes('aerial_land_use')
      ? `${landUse.replace(/_/g, ' ')} Montreal aerial`
      : `${row.record.title} Montreal aerial`;
    return [{
      query,
      expected_rank_bucket: landUse === 'unknown' || landUse === 'low_information' ? 'discoverable' : 'top_10',
      mode: 'semantic',
      rationale: 'Active-learning label targets current aerial land-use retrieval gaps.',
      evidence_refs: ['inf_active_learning_signals'],
    }];
  }
  const entity = entities[0];
  const sceneText = sceneTexts[0];
  return [{
    query: cleanText(sceneText?.text || entity?.name || row.record.title),
    expected_rank_bucket: sceneText ? 'top_3' : 'top_10',
    mode: sceneText ? 'ocr_lexical' : 'semantic',
    rationale: sceneText
      ? 'Scene-text candidate should become retrievable after OCR/reranking work.'
      : 'Metadata/entity candidate should remain retrievable after reranking work.',
    evidence_refs: sceneText ? sceneText.evidence_refs : ['meta_title_description'],
  }];
}

function allowedMlTasks(tasks: string[]): string[] {
  const allowed = new Set([
    'ocr_scene_text',
    'entity_linking',
    'landmark_recognition',
    'geo_estimation',
    'aerial_land_use',
    'aerial_segmentation',
    'quality_repair',
    'search_reranking',
    'reward_preference',
    'active_learning',
  ]);
  return uniqueSorted(tasks.map((task) => task === 'search_retrieval_eval' ? 'search_reranking' : task).filter((task) => allowed.has(task)));
}

function reviewFlags(row: ActiveQueueRow, mode: ImageMode, landUse: LandUse): ReviewFlag[] {
  const flags = new Set<ReviewFlag>(['needs_human_review']);
  if (row.current_signals.metadata_quality_flags.includes('synthetic-description')) flags.add('synthetic_description');
  if (row.current_signals.taxonomy_review_required) flags.add('model_disagreement');
  if (row.current_signals.quality_labels.includes('orientation_exif_rotation')) flags.add('orientation_uncertain');
  if (row.current_signals.quality_labels.length || row.current_signals.cleanup_labels.length) flags.add('quality_repair_needed');
  if (row.current_signals.lane === 'aerial_land_use_geo' || mode === 'document_map') flags.add('geo_reference_needed');
  if (landUse === 'unknown') flags.add('aerial_land_use_uncertain');
  if (landUse === 'low_information' || mode === 'low_information') flags.add('low_information_image');
  if (row.label_task.required_fields.includes('scene_text')) flags.add('ocr_uncertain');
  if (row.label_task.required_fields.includes('entities')) flags.add('entity_resolution_needed');
  return Array.from(flags).sort();
}

function labelValues(row: ActiveQueueRow, mode: ImageMode, landUse: LandUse): LabelRow['labels'] {
  const sceneTexts = inferSceneText(row);
  const entities = entityFromTitle(row);
  const quality = qualityActions(row, mode);
  const labels: LabelRow['labels'] = {
    human_legible: humanLegible(row, mode, landUse),
    story_value: storyValue(row, mode),
    print_value: printValue(row, mode),
    partner_fit: partnerFit(row, landUse, mode),
    search_value: searchValue(row),
    quality_action: quality,
    geo_time_extractable: geoTime(row, mode),
    provenance_depth: row.record.description ? 'metadata_supported' : 'inferred',
    commercial_surface: commercialSurfaces(row, mode),
    image_mode: mode,
    scene_text: sceneTexts,
    entities,
    geo_hypotheses: geoHypotheses(row, mode, entities),
    search_expectations: searchExpectations(row, landUse, entities, sceneTexts),
    ml_tasks: allowedMlTasks(row.label_task.ml_tasks),
  };
  const landUseLabel = aerialLandUse(row, landUse, mode);
  if (landUseLabel) labels.aerial_land_use = landUseLabel;
  return labels;
}

function toLabel(row: ActiveQueueRow, labeledAt: string): LabelRow {
  const mode = reviewedImageMode(row);
  const landUse = reviewedLandUse(row, mode);
  const flags = reviewFlags(row, mode, landUse);
  return {
    schema_version: SCHEMA_VERSION,
    record_id: row.record.id,
    image_filename: row.record.image_filename,
    source: sourceRights(row),
    review: {
      labeler_type: 'codex',
      labeler_id: 'codex-active-learning-top-100-draft',
      labeled_at: labeledAt,
      review_stage: 'batch',
    },
    labels: labelValues(row, mode, landUse),
    evidence: {
      observed: [],
      metadata: evidenceMetadata(row),
      inferred: evidenceInferred(row, mode, landUse),
      verified: [],
    },
    confidence: {
      overall: flags.includes('aerial_land_use_uncertain') || flags.includes('quality_repair_needed') ? 0.58 : 0.66,
      field_confidence: {
        human_legible: 0.66,
        story_value: 0.58,
        print_value: 0.54,
        partner_fit: 0.62,
        search_value: 0.68,
        quality_action: row.current_signals.quality_labels.length ? 0.78 : 0.62,
        geo_time_extractable: row.current_signals.lane === 'aerial_land_use_geo' ? 0.42 : 0.62,
        provenance_depth: 0.74,
        image_mode: mode === 'document_map' ? 0.78 : 0.68,
        scene_text: row.label_task.required_fields.includes('scene_text') ? 0.42 : 0.3,
        entities: row.label_task.required_fields.includes('entities') ? 0.5 : 0.3,
        aerial_land_use: row.current_signals.lane === 'aerial_land_use_geo' ? (landUse === 'unknown' ? 0.35 : 0.62) : 0.3,
        geo_hypotheses: row.current_signals.lane === 'aerial_land_use_geo' ? 0.38 : 0.58,
        search_expectations: 0.66,
      },
      needs_human_review: true,
      review_flags: flags,
    },
    pairwise_preferences: [],
  };
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function validateLabel(label: LabelRow): string[] {
  const errors: string[] = [];
  const requiredTop = ['schema_version', 'record_id', 'image_filename', 'source', 'review', 'labels', 'evidence', 'confidence', 'pairwise_preferences'] as const;
  for (const key of requiredTop) {
    if (!(key in label)) errors.push(`missing ${key}`);
  }
  const requiredLabels = ['human_legible', 'story_value', 'print_value', 'partner_fit', 'search_value', 'quality_action', 'geo_time_extractable', 'provenance_depth', 'commercial_surface'];
  for (const key of requiredLabels) {
    if (!(key in label.labels)) errors.push(`missing labels.${key}`);
  }
  for (const bucket of ['observed', 'metadata', 'inferred', 'verified'] as const) {
    if (!Array.isArray(label.evidence[bucket])) errors.push(`evidence.${bucket} must be array`);
  }
  if (!Array.isArray(label.pairwise_preferences)) errors.push('pairwise_preferences must be array');
  if (!Array.isArray(label.labels.search_expectations)) errors.push('labels.search_expectations must be array');
  if (!Array.isArray(label.labels.ml_tasks)) errors.push('labels.ml_tasks must be array');
  return errors;
}

function renderSummary(summary: Record<string, unknown>): string {
  return `# Active-Learning Top 100 Labels

Generated at: ${summary.generated_at}

## Counts

\`\`\`json
${JSON.stringify(summary.counts, null, 2)}
\`\`\`

## Validation

\`\`\`json
${JSON.stringify(summary.validation, null, 2)}
\`\`\`

## Known Weak Spots

- These are Codex draft labels from active-learning packets, not adjudicated human gold.
- Observed evidence is intentionally empty unless a later visual review records direct observations.
- Aerial rows preserve broad geolocation only; exact coordinates and acreage remain out of scope.
- Document/map rows from aerial packages are useful hard negatives and georeference context, not direct aerial land-use photos.
`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderContactSheet(rows: ActiveQueueRow[], labels: LabelRow[]): string {
  const labelById = new Map(labels.map((label) => [label.record_id, label]));
  const cards = rows.map((row) => {
    const label = labelById.get(row.record.id);
    return `
      <article class="card">
        <img src="${escapeHtml(row.record.image_url)}" alt="${escapeHtml(row.record.title)}" loading="lazy">
        <div class="body">
          <div class="meta">#${row.rank} · ${escapeHtml(row.record.id)} · score ${row.acquisition.score}</div>
          <h2>${escapeHtml(row.record.title || row.record.id)}</h2>
          <p><strong>Mode:</strong> ${escapeHtml(String(label?.labels.image_mode ?? 'unknown'))}</p>
          <p><strong>Land:</strong> ${escapeHtml(String((label?.labels.aerial_land_use as { dominant_land_use?: string } | undefined)?.dominant_land_use ?? 'not_aerial'))}</p>
          <p><strong>Flags:</strong> ${escapeHtml(label?.confidence.review_flags.join(', ') ?? '')}</p>
          <p>${escapeHtml(row.acquisition.reasons.slice(0, 3).join('; '))}</p>
        </div>
      </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Active-Learning Top 100 Draft Labels</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f2ec; color: #1f2421; }
    header { padding: 18px 24px; background: #fffdf8; border-bottom: 1px solid #ded8ce; position: sticky; top: 0; }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; padding: 18px; }
    .card { background: #fffdf8; border: 1px solid #ded8ce; border-radius: 8px; overflow: hidden; }
    img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #e7e1d7; display: block; }
    .body { padding: 12px; }
    .meta { font-size: 12px; color: #687068; }
    h2 { margin: 6px 0 8px; font-size: 15px; line-height: 1.25; }
    p { font-size: 13px; line-height: 1.35; margin: 6px 0; }
  </style>
</head>
<body>
  <header><h1>Active-Learning Top 100 Draft Labels</h1></header>
  <main class="grid">${cards}</main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      queue: { type: 'string', default: DEFAULT_QUEUE },
      existing: { type: 'string', default: DEFAULT_EXISTING_LABELS },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: String(DEFAULT_LIMIT) },
    },
  });

  const queuePath = resolveRepoPath(values.queue!);
  const existingPath = resolveRepoPath(values.existing!);
  const outputDir = resolveRepoPath(values.output!);
  const limit = Math.max(1, Number.parseInt(values.limit!, 10) || DEFAULT_LIMIT);
  requireArtifacts([
    { path: queuePath, label: 'active-learning queue' },
    { path: existingPath, label: 'existing label rows' },
  ]);
  const queueRows = readJsonl<ActiveQueueRow>(queuePath).slice(0, limit);
  const existingLabels = readJsonl<LabelRow>(existingPath);
  const labeledAt = datasetFactoryNowIso();
  const labels = queueRows.map((row) => toLabel(row, labeledAt));
  const combined = [...existingLabels, ...labels];
  const validationErrors = labels.flatMap((label) => validateLabel(label).map((error) => `${label.record_id}: ${error}`));
  const spotCheckRows = labels.slice(0, Math.min(50, labels.length));
  const spotCheckErrors = spotCheckRows.flatMap((label) => validateLabel(label).map((error) => `${label.record_id}: ${error}`));

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'active-learning-top-100-labels.jsonl'), labels);
  writeJsonl(path.join(outputDir, 'gold-labels-batch-001.jsonl'), combined);
  fs.writeFileSync(path.join(outputDir, 'active-learning-top-100-contact-sheet.html'), renderContactSheet(queueRows, labels), 'utf-8');

  const summary = {
    generated_at: labeledAt,
    status: 'codex_draft_candidate_gold_not_adjudicated',
    inputs: {
      queue: path.relative(MONOREPO_ROOT, queuePath),
      existing_labels: path.relative(MONOREPO_ROOT, existingPath),
      limit,
    },
    outputs: {
      active_learning_labels: 'active-learning-top-100-labels.jsonl',
      combined_candidate_gold: 'gold-labels-batch-001.jsonl',
      contact_sheet: 'active-learning-top-100-contact-sheet.html',
      summary_json: 'active-learning-top-100-label-summary.json',
      summary_md: 'active-learning-top-100-label-summary.md',
    },
    counts: {
      active_learning_labels: labels.length,
      existing_calibration_labels: existingLabels.length,
      combined_candidate_gold_labels: combined.length,
      by_image_mode: countBy(labels, (label) => String(label.labels.image_mode ?? 'unknown')),
      by_land_use: countBy(labels, (label) => String((label.labels.aerial_land_use as { dominant_land_use?: string } | undefined)?.dominant_land_use ?? 'not_aerial')),
      with_scene_text: labels.filter((label) => Array.isArray(label.labels.scene_text) && label.labels.scene_text.length > 0).length,
      with_entities: labels.filter((label) => Array.isArray(label.labels.entities) && label.labels.entities.length > 0).length,
      with_search_expectations: labels.filter((label) => Array.isArray(label.labels.search_expectations) && label.labels.search_expectations.length > 0).length,
      with_aerial_land_use: labels.filter((label) => Boolean(label.labels.aerial_land_use)).length,
      needs_human_review: labels.filter((label) => label.confidence.needs_human_review).length,
      review_flags: countBy(labels.flatMap((label) => label.confidence.review_flags), (flag) => flag),
    },
    validation: {
      lightweight_contract_errors: validationErrors.length,
      lightweight_contract_error_examples: validationErrors.slice(0, 10),
      spot_checked_rows: spotCheckRows.length,
      spot_check_errors: spotCheckErrors.length,
      spot_check_error_examples: spotCheckErrors.slice(0, 10),
    },
    caveats: [
      'Draft labels were generated from active-learning packet evidence, source metadata, and current signals.',
      'Observed visual evidence is intentionally empty until direct visual review/adjudication is recorded.',
      'Review stage remains batch, not gold/adjudicated.',
      'Use the combined candidate gold file for baseline experiments only with review-stage filtering.',
    ],
  };

  fs.writeFileSync(path.join(outputDir, 'active-learning-top-100-label-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'active-learning-top-100-label-summary.md'), renderSummary(summary), 'utf-8');

  console.log(`Wrote ${labels.length} active-learning draft labels to ${path.relative(MONOREPO_ROOT, path.join(outputDir, 'active-learning-top-100-labels.jsonl'))}`);
  console.log(`- combined candidate labels: ${combined.length}`);
  console.log(`- with_search_expectations: ${summary.counts.with_search_expectations}`);
  console.log(`- with_aerial_land_use: ${summary.counts.with_aerial_land_use}`);
  console.log(`- with_entities: ${summary.counts.with_entities}`);
  console.log(`- lightweight_contract_errors: ${summary.validation.lightweight_contract_errors}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
