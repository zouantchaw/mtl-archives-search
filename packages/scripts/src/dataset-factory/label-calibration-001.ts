import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { requireArtifact } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_packet.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50',
);
const SCHEMA_VERSION = 'dataset_factory_label_v0';
const RIGHTS_CHECKED_AT = '2026-06-29';
const LICENSE_ID = 'cc-by-4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

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

type CalibrationRow = {
  calibration_id: string;
  lane: 'ground_text_entity' | 'aerial_land_use_geo';
  selection_bucket: string;
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
    image_mode: ImageMode;
    likely_land_use: LandUse;
    scene_text_candidate: boolean;
    entity_candidate: boolean;
    geo_candidate: boolean;
    low_information_candidate: boolean;
    ml_tasks: string[];
  };
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

const R2_PUBLIC_MISSING = new Set([
  'mtl_archives_metadata_0.json',
  'mtl_archives_metadata_1.json',
  'mtl_archives_metadata_107.json',
  'mtl_archives_metadata_1122.json',
]);

const IMAGE_MODE_OVERRIDES: Record<string, ImageMode> = {
  'mtl_archives_metadata_23.json': 'ground_object',
  'mtl_archives_metadata_45.json': 'ground_street',
  'mtl_archives_metadata_53.json': 'ground_interior',
  'mtl_archives_metadata_62.json': 'ground_street',
  'mtl_archives_metadata_80.json': 'ground_street',
  'mtl_archives_metadata_94.json': 'ground_street',
};

const LAND_USE_OVERRIDES: Record<string, LandUse> = {
  'mtl_archives_metadata_1122.json': 'road_infrastructure',
  'mtl_archives_metadata_310.json': 'low_information',
  'mtl_archives_metadata_6374.json': 'low_information',
  'mtl_archives_metadata_4716.json': 'residential',
  'mtl_archives_metadata_700.json': 'mixed_urban',
  'mtl_archives_metadata_8518.json': 'mixed_urban',
  'mtl_archives_metadata_9100.json': 'industrial',
};

const ENTITY_OVERRIDES: Record<string, EntityMention[]> = {
  'mtl_archives_metadata_0.json': [
    entity('Magic Baking Powder', 'brand', 'observed_text', 0.86, ['obs_visual', 'ocr_magic_baking_powder']),
    entity('The Gazette', 'business', 'observed_text', 0.82, ['obs_visual', 'ocr_the_gazette']),
    entity('Rue Saint-Antoine', 'street', 'source_metadata', 0.9, ['meta_title_description']),
    entity('Rue Saint-David', 'street', 'source_metadata', 0.76, ['meta_title_description']),
  ],
  'mtl_archives_metadata_1.json': [entity('Parc Lafontaine', 'landmark', 'source_metadata', 0.82, ['meta_title_description'])],
  'mtl_archives_metadata_13.json': [
    entity('Buckingham cigarettes', 'brand', 'source_metadata', 0.72, ['meta_title_description'], ['ocr_uncertain']),
    entity('Turret cigarettes', 'brand', 'source_metadata', 0.72, ['meta_title_description'], ['ocr_uncertain']),
    entity("Matthew's Lunch", 'business', 'source_metadata', 0.72, ['meta_title_description'], ['ocr_uncertain']),
  ],
  'mtl_archives_metadata_18.json': [entity('Marché Saint-Jacques', 'landmark', 'source_metadata', 0.86, ['meta_title_description'])],
  'mtl_archives_metadata_26.json': [entity('Chinese Paradise Chop Suey', 'business', 'observed_text', 0.8, ['obs_visual', 'ocr_paradise'])],
  'mtl_archives_metadata_32.json': [entity("Eaton's", 'business', 'source_metadata', 0.9, ['meta_title_description'])],
  'mtl_archives_metadata_40.json': [entity('Bain Gallery', 'institution', 'source_metadata', 0.82, ['meta_title_description'])],
  'mtl_archives_metadata_53.json': [entity('école primaire', 'institution', 'source_metadata', 0.68, ['meta_title_description'], ['entity_resolution_needed'])],
  'mtl_archives_metadata_57.json': [entity('Église Saint-Pierre-Apôtre', 'institution', 'source_metadata', 0.86, ['meta_title_description'])],
  'mtl_archives_metadata_59.json': [entity('Metropolitain Stores', 'business', 'observed_text', 0.88, ['obs_visual', 'ocr_metropolitain_stores'])],
  'mtl_archives_metadata_62.json': [entity('Hôpital Saint-Luc', 'institution', 'source_metadata', 0.86, ['meta_title_description'])],
  'mtl_archives_metadata_80.json': [entity('Marché Saint-Jean-Baptiste', 'landmark', 'source_metadata', 0.84, ['meta_title_description'])],
  'mtl_archives_metadata_86.json': [entity('Université McGill', 'institution', 'source_metadata', 0.88, ['meta_title_description'])],
  'mtl_archives_metadata_94.json': [entity('Dominion Square Building', 'landmark', 'source_metadata', 0.88, ['meta_title_description'])],
  'mtl_archives_metadata_97.json': [entity('Le Château', 'landmark', 'source_metadata', 0.84, ['meta_title_description'])],
  'mtl_archives_metadata_98.json': [entity('Parc La Fontaine', 'landmark', 'source_metadata', 0.86, ['meta_title_description'])],
  'mtl_archives_metadata_99.json': [entity('Rue Saint-Hubert', 'street', 'source_metadata', 0.82, ['meta_title_description'])],
  'mtl_archives_metadata_107.json': [
    entity('Rue Saint-Luc', 'street', 'source_metadata', 0.78, ['meta_title_description']),
    entity('Rue Saint-Mathieu', 'street', 'source_metadata', 0.78, ['meta_title_description']),
  ],
};

const SCENE_TEXT_OVERRIDES: Record<string, SceneText[]> = {
  'mtl_archives_metadata_0.json': [
    sceneText('MAGIC BAKING POWDER', 'billboard', 'left billboard', 0.86, ['obs_visual', 'ocr_magic_baking_powder']),
    sceneText('The Gazette', 'inscription', 'roof sign on right building', 0.82, ['obs_visual', 'ocr_the_gazette']),
  ],
  'mtl_archives_metadata_26.json': [
    sceneText('PARADISE', 'storefront', 'vertical storefront sign', 0.78, ['obs_visual', 'ocr_paradise']),
  ],
  'mtl_archives_metadata_59.json': [
    sceneText('METROPOLITAIN STORES', 'storefront', 'storefront sign', 0.88, ['obs_visual', 'ocr_metropolitain_stores']),
  ],
};

function entity(
  name: string,
  entityType: EntityType,
  source: EntityMention['source'],
  confidence: number,
  evidenceRefs: string[],
  reviewFlags: ReviewFlag[] = [],
): EntityMention {
  return {
    name,
    entity_type: entityType,
    source,
    canonical_id: null,
    confidence,
    evidence_refs: evidenceRefs,
    review_flags: reviewFlags,
  };
}

function sceneText(
  text: string,
  textType: SceneText['text_type'],
  locationHint: string,
  confidence: number,
  evidenceRefs: string[],
): SceneText {
  return {
    text,
    text_type: textType,
    normalized_text: normalizeText(text),
    location_hint: locationHint,
    confidence,
    evidence_refs: evidenceRefs,
    review_flags: confidence < 0.85 ? ['ocr_uncertain'] : [],
  };
}

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeText(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function sourceRights(row: CalibrationRow): LabelRow['source'] {
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
    rights_notes: packageSlug ? notes : 'Source package not recognized by calibration mapper.',
  };
}

function observedEvidence(row: CalibrationRow, mode: ImageMode, landUse: LandUse): EvidenceItem[] {
  const observed: EvidenceItem[] = [
    {
      id: 'obs_visual',
      claim: row.lane === 'aerial_land_use_geo'
        ? `Contact-sheet review shows ${mode} imagery with apparent ${landUse} visual character.`
        : `Contact-sheet review shows a ${mode} archive image with visible subject matter.`,
      evidence_type: 'visual_observation',
      source_field: null,
      source_url: row.record.image_url,
      confidence: R2_PUBLIC_MISSING.has(row.record.id) ? 0.72 : 0.82,
      review_flags: R2_PUBLIC_MISSING.has(row.record.id) ? ['quality_repair_needed'] : [],
    },
  ];
  for (const scene of SCENE_TEXT_OVERRIDES[row.record.id] ?? []) {
    observed.push({
      id: scene.evidence_refs[1] ?? `ocr_${normalizeText(scene.text).replace(/\s+/g, '_')}`,
      claim: `Visible text reads "${scene.text}".`,
      evidence_type: 'ocr_text',
      source_field: null,
      source_url: row.record.image_url,
      confidence: scene.confidence,
      review_flags: scene.review_flags,
    });
  }
  return observed;
}

function metadataEvidence(row: CalibrationRow): EvidenceItem[] {
  const flags: ReviewFlag[] = row.existing_signals.metadata_quality_flags.includes('synthetic-description')
    ? ['synthetic_description']
    : [];
  return [
    {
      id: 'meta_title_description',
      claim: `Source metadata title/description: ${row.record.title}${row.record.description ? ` — ${row.record.description}` : ''}`,
      evidence_type: 'source_metadata',
      source_field: 'title/description',
      source_url: row.record.source_url || null,
      confidence: row.record.description ? 0.82 : 0.62,
      review_flags: flags,
    },
    {
      id: 'meta_cote_date_credit',
      claim: `Source metadata date/cote/credit: ${[row.record.date, row.record.cote, row.record.credit_line].filter(Boolean).join(' | ') || 'not fully populated'}`,
      evidence_type: 'source_metadata',
      source_field: 'date/cote/credit',
      source_url: row.record.source_url || null,
      confidence: 0.78,
      review_flags: row.record.date ? [] : ['date_uncertain'],
    },
  ];
}

function inferredEvidence(row: CalibrationRow, mode: ImageMode, landUse: LandUse): EvidenceItem[] {
  const flags: ReviewFlag[] = [];
  if (row.lane === 'aerial_land_use_geo' && landUse === 'unknown') flags.push('aerial_land_use_uncertain');
  if (landUse === 'low_information' || mode === 'low_information') flags.push('low_information_image');
  return [
    {
      id: 'inf_mode_land_use',
      claim: row.lane === 'aerial_land_use_geo'
        ? `Calibration inference assigns image mode ${mode} and dominant land use ${landUse}.`
        : `Calibration inference assigns image mode ${mode}.`,
      evidence_type: 'inference',
      source_field: null,
      source_url: null,
      confidence: flags.length ? 0.62 : 0.76,
      review_flags: flags,
    },
  ];
}

function labelValues(row: CalibrationRow, mode: ImageMode, landUse: LandUse): LabelRow['labels'] {
  const isAerial = row.lane === 'aerial_land_use_geo';
  const lowInfo = mode === 'low_information' || landUse === 'low_information';
  const sceneTexts = SCENE_TEXT_OVERRIDES[row.record.id] ?? [];
  const entities = ENTITY_OVERRIDES[row.record.id] ?? inferBasicEntities(row);
  const qualityAction = R2_PUBLIC_MISSING.has(row.record.id)
    ? ['retry_fetch', 'preserve_original', 'review']
    : lowInfo
      ? ['review', 'preserve_original']
      : ['no_action'];
  return {
    human_legible: lowInfo ? 'low' : isAerial ? 'medium' : 'high',
    story_value: lowInfo ? 'low' : row.record.id === 'mtl_archives_metadata_0.json' ? 'high' : isAerial ? 'medium' : 'medium',
    print_value: lowInfo ? 'none' : isAerial ? 'low' : row.selection_bucket === 'ground_scene_text_entity' ? 'medium' : 'low',
    partner_fit: isAerial
      ? ['urbanism_planning', 'education', landUse === 'waterfront' ? 'environmental' : 'civic_infrastructure'].filter(unique)
      : ['museum_archive', 'education', ...(entities.some((item) => ['street', 'landmark', 'institution'].includes(item.entity_type)) ? ['tourism_local'] : [])],
    search_value: row.record.id === 'mtl_archives_metadata_0.json' ? 'priority' : lowInfo ? 'low' : row.selection_bucket.includes('scene_text') ? 'high' : 'medium',
    quality_action: qualityAction,
    geo_time_extractable: {
      geo: isAerial ? 'broad_area' : entities.some((item) => ['street', 'landmark', 'institution'].includes(item.entity_type)) ? 'specific_place' : 'broad_area',
      time: row.record.date ? row.record.date.includes('-') ? 'date' : 'year_range' : 'none',
      public_safe_exact_location: !isAerial,
      notes: isAerial
        ? 'Aerial calibration row needs georeferencing before exact coordinates or acreage claims.'
        : 'Location claim is source-metadata supported when title/description includes a place or address.',
    },
    provenance_depth: row.record.description ? 'metadata_supported' : 'inferred',
    commercial_surface: lowInfo
      ? ['dataset_eval']
      : row.record.id === 'mtl_archives_metadata_0.json'
        ? ['search_feature', 'dataset_eval', 'partner_brief']
        : isAerial
          ? ['dataset_eval', 'partner_brief']
          : ['search_feature', 'dataset_eval'],
    image_mode: mode,
    scene_text: sceneTexts,
    entities,
    aerial_land_use: isAerial ? aerialLandUse(row, landUse, lowInfo) : undefined,
    geo_hypotheses: geoHypotheses(row, isAerial, entities),
    search_expectations: searchExpectations(row, isAerial, landUse),
    ml_tasks: row.proposed_label_focus.ml_tasks,
  };
}

function unique<T>(item: T, index: number, array: T[]): boolean {
  return array.indexOf(item) === index;
}

function inferBasicEntities(row: CalibrationRow): EntityMention[] {
  if (row.lane === 'aerial_land_use_geo') return [];
  const title = row.record.title;
  const entities: EntityMention[] = [];
  if (/rue|boulevard|avenue/i.test(title)) entities.push(entity(title, 'street', 'source_metadata', 0.68, ['meta_title_description'], ['entity_resolution_needed']));
  if (/parc|fontaine|square/i.test(title)) entities.push(entity(title, 'landmark', 'source_metadata', 0.72, ['meta_title_description'], ['entity_resolution_needed']));
  if (/église|eglise|hôpital|hopital|université|universite|marché|marche|magasin|building|bain/i.test(title)) entities.push(entity(title, 'institution', 'source_metadata', 0.72, ['meta_title_description'], ['entity_resolution_needed']));
  return entities;
}

function aerialLandUse(row: CalibrationRow, landUse: LandUse, lowInfo: boolean): Record<string, unknown> {
  return {
    dominant_land_use: landUse,
    land_use_mix: lowInfo
      ? [{ class: 'low_information', approx_share: null, confidence: 0.76 }]
      : [
        { class: landUse, approx_share: null, confidence: landUse === 'unknown' ? 0.45 : 0.72 },
        ...(landUse !== 'water' && row.selection_bucket.includes('water') ? [{ class: 'water', approx_share: null, confidence: 0.62 }] : []),
      ],
    urbanization_stage: lowInfo
      ? 'unknown'
      : landUse === 'farmland'
        ? 'rural'
        : ['residential', 'road_infrastructure', 'mixed_urban'].includes(landUse)
          ? 'suburbanizing'
          : landUse === 'industrial'
            ? 'industrial'
            : landUse === 'waterfront'
              ? 'transitional'
              : 'unknown',
    segmentation_candidate: !lowInfo && landUse !== 'unknown',
    georeference_candidate: !lowInfo,
    notes: lowInfo
      ? 'Feature-poor or damaged aerial frame; useful as low-information detector, not as a georeference target.'
      : 'Calibration estimate from contact-sheet visual review; no measured acreage until georeferenced.',
  };
}

function geoHypotheses(row: CalibrationRow, isAerial: boolean, entities: EntityMention[]): Record<string, unknown>[] {
  if (isAerial) {
    return [{
      place_label: 'Montreal aerial survey area',
      latitude: null,
      longitude: null,
      precision: 'city',
      method: 'source_metadata',
      confidence: 0.45,
      evidence_refs: ['meta_cote_date_credit', 'inf_mode_land_use'],
      public_safe_exact_location: false,
      review_flags: ['geo_reference_needed'],
    }];
  }
  const bestEntity = entities.find((item) => ['street', 'landmark', 'institution'].includes(item.entity_type));
  if (!bestEntity) return [];
  return [{
    place_label: bestEntity.name,
    latitude: null,
    longitude: null,
    precision: bestEntity.entity_type === 'street' ? 'corridor' : 'specific_place',
    method: 'source_metadata',
    confidence: bestEntity.confidence,
    evidence_refs: bestEntity.evidence_refs,
    public_safe_exact_location: true,
    review_flags: bestEntity.review_flags.includes('entity_resolution_needed') ? ['external_verification_needed'] : [],
  }];
}

function searchExpectations(row: CalibrationRow, isAerial: boolean, landUse: LandUse): Record<string, unknown>[] {
  if (row.record.id === 'mtl_archives_metadata_0.json') {
    return [
      {
        query: 'Magic baking powder',
        expected_rank_bucket: 'top_1',
        mode: 'ocr_lexical',
        rationale: 'Billboard text is visible and source metadata names Magic Baking Powder.',
        evidence_refs: ['ocr_magic_baking_powder', 'meta_title_description'],
      },
      {
        query: 'The Gazette',
        expected_rank_bucket: 'top_3',
        mode: 'reranked',
        rationale: 'The Gazette sign is visible on the building and source metadata names the Gazette Printing Co.',
        evidence_refs: ['ocr_the_gazette', 'meta_title_description'],
      },
    ];
  }
  if (isAerial) {
    return [{
      query: `${landUse.replace(/_/g, ' ')} Montreal aerial`,
      expected_rank_bucket: landUse === 'low_information' || landUse === 'unknown' ? 'discoverable' : 'top_10',
      mode: 'semantic',
      rationale: 'Aerial calibration labels should support land-use retrieval and evaluation.',
      evidence_refs: ['inf_mode_land_use'],
    }];
  }
  return [{
    query: row.record.title,
    expected_rank_bucket: row.selection_bucket.includes('scene_text') ? 'top_3' : 'top_10',
    mode: 'semantic',
    rationale: 'Source title should retrieve the record after text/reranking improvements.',
    evidence_refs: ['meta_title_description'],
  }];
}

function reviewFlags(row: CalibrationRow, landUse: LandUse): ReviewFlag[] {
  const flags = new Set<ReviewFlag>();
  if (row.existing_signals.metadata_quality_flags.includes('synthetic-description')) flags.add('synthetic_description');
  if (row.existing_signals.taxonomy_review_required) flags.add('model_disagreement');
  if (R2_PUBLIC_MISSING.has(row.record.id)) flags.add('quality_repair_needed');
  if (row.lane === 'aerial_land_use_geo') {
    flags.add('geo_reference_needed');
    if (landUse === 'unknown') flags.add('aerial_land_use_uncertain');
    if (landUse === 'low_information') flags.add('low_information_image');
  }
  if ((SCENE_TEXT_OVERRIDES[row.record.id] ?? []).some((item) => item.review_flags.includes('ocr_uncertain'))) flags.add('ocr_uncertain');
  return Array.from(flags);
}

function toLabel(row: CalibrationRow, labeledAt: string): LabelRow {
  const mode = IMAGE_MODE_OVERRIDES[row.record.id] ?? row.proposed_label_focus.image_mode;
  const landUse = LAND_USE_OVERRIDES[row.record.id] ?? row.proposed_label_focus.likely_land_use;
  const flags = reviewFlags(row, landUse);
  const labels = labelValues(row, mode, landUse);
  return {
    schema_version: SCHEMA_VERSION,
    record_id: row.record.id,
    image_filename: row.record.image_filename,
    source: sourceRights(row),
    review: {
      labeler_type: 'codex',
      labeler_id: 'codex-calibration-001-contact-sheet-review',
      labeled_at: labeledAt,
      review_stage: 'batch',
    },
    labels,
    evidence: {
      observed: observedEvidence(row, mode, landUse),
      metadata: metadataEvidence(row),
      inferred: inferredEvidence(row, mode, landUse),
      verified: [],
    },
    confidence: {
      overall: flags.includes('low_information_image') || flags.includes('aerial_land_use_uncertain') ? 0.62 : 0.76,
      field_confidence: {
        human_legible: 0.78,
        story_value: 0.7,
        print_value: 0.66,
        partner_fit: 0.7,
        search_value: 0.72,
        quality_action: R2_PUBLIC_MISSING.has(row.record.id) ? 0.9 : 0.7,
        geo_time_extractable: row.lane === 'aerial_land_use_geo' ? 0.45 : 0.7,
        provenance_depth: 0.78,
        image_mode: 0.82,
        scene_text: (SCENE_TEXT_OVERRIDES[row.record.id] ?? []).length ? 0.8 : 0.5,
        entities: (ENTITY_OVERRIDES[row.record.id] ?? []).length ? 0.78 : 0.55,
        aerial_land_use: row.lane === 'aerial_land_use_geo' ? (landUse === 'unknown' ? 0.45 : 0.72) : 0.5,
        geo_hypotheses: row.lane === 'aerial_land_use_geo' ? 0.42 : 0.68,
        search_expectations: 0.72,
      },
      needs_human_review: flags.length > 0 || row.lane === 'aerial_land_use_geo',
      review_flags: flags,
    },
    pairwise_preferences: [],
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values.output!);
  requireArtifact(inputPath, 'calibration packet');
  const rows = readJsonl<CalibrationRow>(inputPath);
  const labeledAt = new Date().toISOString();
  const labels = rows.map((row) => toLabel(row, labeledAt));

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'calibration_labels.jsonl'), labels);

  const summary = {
    generated_at: labeledAt,
    input: path.relative(MONOREPO_ROOT, inputPath),
    output: path.relative(MONOREPO_ROOT, path.join(outputDir, 'calibration_labels.jsonl')),
    counts: {
      total: labels.length,
      by_image_mode: countLabels(labels, (label) => String(label.labels.image_mode ?? 'unknown')),
      by_land_use: countLabels(labels, (label) => String((label.labels.aerial_land_use as { dominant_land_use?: string } | undefined)?.dominant_land_use ?? 'not_aerial')),
      with_scene_text: labels.filter((label) => Array.isArray(label.labels.scene_text) && label.labels.scene_text.length > 0).length,
      with_entities: labels.filter((label) => Array.isArray(label.labels.entities) && label.labels.entities.length > 0).length,
      with_search_expectations: labels.filter((label) => Array.isArray(label.labels.search_expectations) && label.labels.search_expectations.length > 0).length,
      r2_public_missing_source_fallback: labels.filter((label) => label.labels.quality_action instanceof Array && label.labels.quality_action.includes('retry_fetch')).length,
      needs_human_review: labels.filter((label) => label.confidence.needs_human_review).length,
    },
    caveats: [
      'Calibration labels were produced from source metadata plus contact-sheet visual review.',
      'They are not adjudicated gold labels until spot-checked.',
      'Exact coordinates and acreage are intentionally not claimed for aerial rows.',
    ],
  };
  fs.writeFileSync(path.join(outputDir, 'calibration_label_summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  console.log(`Wrote ${labels.length} calibration labels to ${path.relative(MONOREPO_ROOT, path.join(outputDir, 'calibration_labels.jsonl'))}`);
  console.log(`- with_scene_text: ${summary.counts.with_scene_text}`);
  console.log(`- with_entities: ${summary.counts.with_entities}`);
  console.log(`- needs_human_review: ${summary.counts.needs_human_review}`);
  console.log(`- r2_public_missing_source_fallback: ${summary.counts.r2_public_missing_source_fallback}`);
}

function countLabels(labels: LabelRow[], keyFn: (label: LabelRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) {
    const key = keyFn(label);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
