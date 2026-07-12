import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VMI_SCHEMA_VERSION = 'verified_multimodal_packet_v1.0.0';
export const VMI_RUN_REPORT_SCHEMA_VERSION = 'verified_multimodal_run_report_v1.0.0';
export const VMI_BENCHMARK_SCHEMA_VERSION = 'verified_multimodal_benchmark_task_v1.0.0';
export const VMI_FIXED_CREATED_AT = '2026-07-12T00:00:00.000Z';
export const VMI_FIXTURE_DIR = 'docs/dataset-factory/fixtures/verified-multimodal-batch-001';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');

export type Lane = 'ground_ocr_entity_place' | 'aerial_land_use_georeference';
export type ClaimBoundary = 'visual_observation' | 'source_metadata' | 'inference' | 'externally_verified';
export type RegionKind = 'bbox' | 'polygon' | 'whole_image';
export type Confidence = 'low' | 'medium' | 'high';
export type ReviewStatus = 'accepted' | 'unresolved' | 'rejected';
export type VerifiedStatus = 'not_verified' | 'externally_verified';

export type VisualRegion = {
  region_id: string;
  kind: RegionKind;
  label: string;
  bbox_xywh_pct: [number, number, number, number] | null;
  polygon_pct: Array<[number, number]> | null;
};

export type ClaimEvidence = {
  evidence_id: string;
  boundary: ClaimBoundary;
  region_id: string | null;
  external_source_url: string | null;
  external_source_note: string | null;
  source_metadata_field: string | null;
  georeference_or_scale_basis: string | null;
};

export type Claim = {
  claim_id: string;
  lane: Lane;
  text: string;
  boundary: ClaimBoundary;
  evidence_ids: string[];
  confidence: Confidence;
  alternatives: string[];
  verified_status: VerifiedStatus;
  review_status: ReviewStatus;
  review_flags: string[];
  exact_location: boolean;
  asserts_area_or_distance: boolean;
  benchmark_eligible: boolean;
};

export type RightsAttribution = {
  source_license_id: string;
  attribution: string;
  rights_url: string;
  commercial_use_allowed: boolean;
  notes: string;
};

export type ReviewState = {
  primary_reviewer_id: string;
  independent_reviewer_id: string;
  adjudicator_id: string;
  status: 'pilot_reviewed' | 'needs_review';
  reviewer_independence_checked: boolean;
};

export type VerifiedMultimodalPacket = {
  schema_version: typeof VMI_SCHEMA_VERSION;
  batch_id: 'verified_multimodal_batch_001';
  pilot_scope: 'synthetic_hermetic_foundation';
  record_id: string;
  synthetic_fixture: true;
  lane: Lane;
  source_metadata: {
    title: string;
    archive_record_url: string;
    archive_identifier: string;
    date_label: string;
  };
  rights_attribution: RightsAttribution;
  regions: VisualRegion[];
  evidence: ClaimEvidence[];
  visual_observations: Claim[];
  source_metadata_claims: Claim[];
  inferred_hypotheses: Claim[];
  externally_verified_claims: Claim[];
  rejected_hypotheses: Claim[];
  abstentions: Array<{ target: string; reason: string; evidence_boundary: string }>;
  review_state: ReviewState;
};

export type BenchmarkTask = {
  schema_version: typeof VMI_BENCHMARK_SCHEMA_VERSION;
  task_id: string;
  record_id: string;
  lane: Lane;
  query: string;
  positive_claim_ids: string[];
  positive_record_ids: string[];
  evidence_boundary: 'externally_verified';
  source_urls: string[];
};

export type RunReport = {
  schema_version: typeof VMI_RUN_REPORT_SCHEMA_VERSION;
  batch_id: 'verified_multimodal_batch_001';
  generated_at: string;
  scope: 'synthetic_hermetic_pilot';
  acceptance_target_records: 60;
  processed_records: number;
  fully_verified_dossiers: number;
  foundation_incomplete: true;
  packet_sha256: string;
  benchmark_sha256: string;
  unresolved_sha256: string;
  rejected_sha256: string;
  counts: {
    lanes: Record<Lane, number>;
    accepted_claims: number;
    unresolved_claims: number;
    rejected_claims: number;
    benchmark_tasks: number;
    abstentions: number;
  };
  gates: Record<string, 'passed'>;
  hard_controls: string[];
  gaps: string[];
  recommended_next_slice: string;
};

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => canonicalJson(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

export function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function fileSha256(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertUrl(value: string | null, label: string): asserts value is string {
  assert(typeof value === 'string' && /^https:\/\/[^?&]+/.test(value), `${label} must be a stable HTTPS URL without query tokens`);
}

function assertConfidence(value: Confidence, label: string): void {
  assert(['low', 'medium', 'high'].includes(value), `${label} confidence is invalid`);
}

function assertRegion(region: VisualRegion): void {
  assert(region.region_id.length > 0, 'region_id is required');
  if (region.kind === 'whole_image') {
    assert(region.bbox_xywh_pct === null && region.polygon_pct === null, `${region.region_id}: whole image region cannot carry geometry`);
    return;
  }
  if (region.kind === 'bbox') {
    assert(region.bbox_xywh_pct !== null && region.polygon_pct === null, `${region.region_id}: bbox requires bbox only`);
    const [x, y, width, height] = region.bbox_xywh_pct;
    assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 100 && y + height <= 100, `${region.region_id}: bbox outside image`);
    return;
  }
  assert(region.polygon_pct !== null && region.bbox_xywh_pct === null && region.polygon_pct.length >= 3, `${region.region_id}: polygon requires at least three points`);
  for (const [x, y] of region.polygon_pct) assert(x >= 0 && x <= 100 && y >= 0 && y <= 100, `${region.region_id}: polygon point outside image`);
}

function claims(packet: VerifiedMultimodalPacket): Claim[] {
  return [
    ...packet.visual_observations,
    ...packet.source_metadata_claims,
    ...packet.inferred_hypotheses,
    ...packet.externally_verified_claims,
    ...packet.rejected_hypotheses,
  ];
}

export function validatePacket(packet: VerifiedMultimodalPacket): void {
  assert(packet.schema_version === VMI_SCHEMA_VERSION, `${packet.record_id}: packet schema mismatch`);
  assert(packet.batch_id === 'verified_multimodal_batch_001', `${packet.record_id}: batch mismatch`);
  assert(packet.pilot_scope === 'synthetic_hermetic_foundation' && packet.synthetic_fixture === true, `${packet.record_id}: this foundation slice must remain synthetic/hermetic`);
  assertUrl(packet.source_metadata.archive_record_url, `${packet.record_id}: archive_record_url`);
  assertUrl(packet.rights_attribution.rights_url, `${packet.record_id}: rights_url`);
  assert(packet.rights_attribution.source_license_id.length > 0, `${packet.record_id}: rights license required`);
  assert(packet.rights_attribution.attribution.length > 0, `${packet.record_id}: attribution required`);
  assert(packet.rights_attribution.notes.length > 0, `${packet.record_id}: rights notes required`);
  assert(packet.review_state.primary_reviewer_id !== packet.review_state.independent_reviewer_id, `${packet.record_id}: primary and independent reviewers must differ`);
  assert(packet.review_state.adjudicator_id !== packet.review_state.primary_reviewer_id, `${packet.record_id}: adjudicator must differ from primary reviewer`);
  assert(packet.review_state.adjudicator_id !== packet.review_state.independent_reviewer_id, `${packet.record_id}: adjudicator must differ from independent reviewer`);
  assert(packet.review_state.reviewer_independence_checked === true, `${packet.record_id}: reviewer independence must be checked`);

  const regionIds = new Set(packet.regions.map((region) => region.region_id));
  assert(regionIds.size === packet.regions.length, `${packet.record_id}: duplicate region ID`);
  packet.regions.forEach(assertRegion);

  const evidenceIds = new Set(packet.evidence.map((item) => item.evidence_id));
  assert(evidenceIds.size === packet.evidence.length, `${packet.record_id}: duplicate evidence ID`);
  for (const item of packet.evidence) {
    if (item.boundary === 'visual_observation') {
      assert(item.region_id !== null && regionIds.has(item.region_id), `${packet.record_id}/${item.evidence_id}: visual evidence requires a valid region`);
    }
    if (item.boundary === 'externally_verified') {
      assertUrl(item.external_source_url, `${packet.record_id}/${item.evidence_id}: external source URL`);
      assert(item.external_source_note !== null && item.external_source_note.trim().length >= 8, `${packet.record_id}/${item.evidence_id}: external source note required`);
    }
  }

  const seenClaimIds = new Set<string>();
  for (const claim of claims(packet)) {
    assert(claim.lane === packet.lane, `${packet.record_id}/${claim.claim_id}: lane mismatch`);
    assert(!seenClaimIds.has(claim.claim_id), `${packet.record_id}: duplicate claim ${claim.claim_id}`);
    seenClaimIds.add(claim.claim_id);
    assertConfidence(claim.confidence, `${packet.record_id}/${claim.claim_id}`);
    assert(claim.evidence_ids.length > 0, `${packet.record_id}/${claim.claim_id}: claim requires evidence`);
    const evidence = claim.evidence_ids.map((id) => packet.evidence.find((item) => item.evidence_id === id));
    assert(evidence.every(Boolean), `${packet.record_id}/${claim.claim_id}: claim references unknown evidence`);
    if (claim.boundary === 'visual_observation') {
      assert(evidence.some((item) => item?.boundary === 'visual_observation' && item.region_id !== null), `${packet.record_id}/${claim.claim_id}: visual claim needs region evidence`);
    }
    if (claim.boundary === 'externally_verified') {
      assert(claim.verified_status === 'externally_verified', `${packet.record_id}/${claim.claim_id}: external claim must be externally verified`);
      assert(claim.review_status === 'accepted', `${packet.record_id}/${claim.claim_id}: only accepted external claims enter verified lane`);
      assert(evidence.some((item) => item?.boundary === 'externally_verified' && item.external_source_url && item.external_source_note), `${packet.record_id}/${claim.claim_id}: external claim needs source URL and note`);
    } else {
      assert(claim.verified_status === 'not_verified', `${packet.record_id}/${claim.claim_id}: non-external claim cannot be marked verified`);
    }
    if (claim.exact_location) {
      assert(claim.boundary === 'externally_verified', `${packet.record_id}/${claim.claim_id}: exact location requires external verification`);
      assert(evidence.some((item) => item?.georeference_or_scale_basis !== null), `${packet.record_id}/${claim.claim_id}: exact location requires georeference evidence`);
    }
    if (claim.asserts_area_or_distance) {
      assert(evidence.some((item) => item?.georeference_or_scale_basis !== null), `${packet.record_id}/${claim.claim_id}: area/distance requires scale or georeference`);
    }
    if (claim.benchmark_eligible) {
      assert(claim.boundary === 'externally_verified' && claim.review_status === 'accepted', `${packet.record_id}/${claim.claim_id}: benchmark task may use accepted external evidence only`);
    }
  }
}

function basePacket(record_id: string, lane: Lane): Pick<VerifiedMultimodalPacket, 'schema_version' | 'batch_id' | 'pilot_scope' | 'record_id' | 'synthetic_fixture' | 'lane' | 'rights_attribution' | 'review_state'> {
  return {
    schema_version: VMI_SCHEMA_VERSION,
    batch_id: 'verified_multimodal_batch_001',
    pilot_scope: 'synthetic_hermetic_foundation',
    record_id,
    synthetic_fixture: true,
    lane,
    rights_attribution: {
      source_license_id: 'cc-by-4.0-derived-synthetic',
      attribution: 'Synthetic hermetic MTL Archives fixture derived for schema validation only.',
      rights_url: 'https://donnees.montreal.ca/dataset/phototheque-archives',
      commercial_use_allowed: true,
      notes: 'Synthetic packet carries no source pixels and does not expand archive rights.',
    },
    review_state: {
      primary_reviewer_id: 'vmi-primary-001',
      independent_reviewer_id: 'vmi-independent-001',
      adjudicator_id: 'vmi-adjudicator-001',
      status: 'pilot_reviewed',
      reviewer_independence_checked: true,
    },
  };
}

function claim(fields: Omit<Claim, 'confidence' | 'alternatives' | 'review_flags'> & Partial<Pick<Claim, 'confidence' | 'alternatives' | 'review_flags'>>): Claim {
  return {
    confidence: 'high',
    alternatives: [],
    review_flags: [],
    ...fields,
  };
}

export function syntheticPackets(): VerifiedMultimodalPacket[] {
  return [
    {
      ...basePacket('synthetic_ground_sign_001', 'ground_ocr_entity_place'),
      source_metadata: {
        title: 'Synthetic storefront with painted advertisement',
        archive_record_url: 'https://archivesdemontreal.ica-atom.org/synthetic-ground-sign-001',
        archive_identifier: 'SYN-GROUND-001',
        date_label: 'circa 1930',
      },
      regions: [
        { region_id: 'r-whole', kind: 'whole_image', label: 'entire storefront scene', bbox_xywh_pct: null, polygon_pct: null },
        { region_id: 'r-sign', kind: 'bbox', label: 'painted storefront sign', bbox_xywh_pct: [18, 12, 48, 16], polygon_pct: null },
      ],
      evidence: [
        { evidence_id: 'e-visual-sign', boundary: 'visual_observation', region_id: 'r-sign', external_source_url: null, external_source_note: null, source_metadata_field: null, georeference_or_scale_basis: null },
        { evidence_id: 'e-metadata-title', boundary: 'source_metadata', region_id: null, external_source_url: null, external_source_note: null, source_metadata_field: 'title', georeference_or_scale_basis: null },
        { evidence_id: 'e-directory', boundary: 'externally_verified', region_id: null, external_source_url: 'https://archivesdemontreal.ica-atom.org/synthetic-directory-source', external_source_note: 'Synthetic directory source confirms the business name and street range.', source_metadata_field: null, georeference_or_scale_basis: null },
      ],
      visual_observations: [
        claim({ claim_id: 'c-ocr-visible', lane: 'ground_ocr_entity_place', text: 'Painted sign visibly reads "Boulangerie Saint-Laurent" with high confidence.', boundary: 'visual_observation', evidence_ids: ['e-visual-sign'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      source_metadata_claims: [
        claim({ claim_id: 'c-metadata-storefront', lane: 'ground_ocr_entity_place', text: 'Archive title describes this as a storefront scene.', boundary: 'source_metadata', evidence_ids: ['e-metadata-title'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      inferred_hypotheses: [
        claim({ claim_id: 'c-inferred-commercial', lane: 'ground_ocr_entity_place', text: 'The scene is likely a small commercial bakery.', boundary: 'inference', evidence_ids: ['e-visual-sign'], confidence: 'medium', alternatives: ['restaurant storefront', 'grocery storefront'], verified_status: 'not_verified', review_status: 'unresolved', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      externally_verified_claims: [
        claim({ claim_id: 'c-verified-business', lane: 'ground_ocr_entity_place', text: 'The normalized business/entity name is Boulangerie Saint-Laurent.', boundary: 'externally_verified', evidence_ids: ['e-visual-sign', 'e-directory'], verified_status: 'externally_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: true }),
      ],
      rejected_hypotheses: [
        claim({ claim_id: 'c-reject-chain-brand', lane: 'ground_ocr_entity_place', text: 'The sign is a known national chain brand.', boundary: 'inference', evidence_ids: ['e-visual-sign'], confidence: 'low', alternatives: ['independent bakery'], verified_status: 'not_verified', review_status: 'rejected', review_flags: ['unsupported_identity_match'], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      abstentions: [{ target: 'exact_location', reason: 'No civic number or georeferenced source in the synthetic evidence.', evidence_boundary: 'insufficient_external_evidence' }],
    },
    {
      ...basePacket('synthetic_ground_notice_002', 'ground_ocr_entity_place'),
      source_metadata: {
        title: 'Synthetic public notice with partial OCR',
        archive_record_url: 'https://archivesdemontreal.ica-atom.org/synthetic-ground-notice-002',
        archive_identifier: 'SYN-GROUND-002',
        date_label: '1946',
      },
      regions: [
        { region_id: 'r-notice', kind: 'bbox', label: 'public notice board', bbox_xywh_pct: [30, 20, 32, 38], polygon_pct: null },
      ],
      evidence: [
        { evidence_id: 'e-visual-notice', boundary: 'visual_observation', region_id: 'r-notice', external_source_url: null, external_source_note: null, source_metadata_field: null, georeference_or_scale_basis: null },
      ],
      visual_observations: [
        claim({ claim_id: 'c-partial-ocr', lane: 'ground_ocr_entity_place', text: 'A notice board contains partially legible French text.', boundary: 'visual_observation', evidence_ids: ['e-visual-notice'], confidence: 'medium', alternatives: ['poster', 'legal notice'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      source_metadata_claims: [],
      inferred_hypotheses: [],
      externally_verified_claims: [],
      rejected_hypotheses: [
        claim({ claim_id: 'c-reject-event-title', lane: 'ground_ocr_entity_place', text: 'The notice announces a specific named event.', boundary: 'inference', evidence_ids: ['e-visual-notice'], confidence: 'low', alternatives: ['administrative notice'], verified_status: 'not_verified', review_status: 'rejected', review_flags: ['unreadable_detail'], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      abstentions: [{ target: 'entity_link', reason: 'No external source is present for the partial text.', evidence_boundary: 'visual_only' }],
    },
    {
      ...basePacket('synthetic_aerial_landuse_003', 'aerial_land_use_georeference'),
      source_metadata: {
        title: 'Synthetic aerial frame with rail and industrial land use',
        archive_record_url: 'https://archivesdemontreal.ica-atom.org/synthetic-aerial-landuse-003',
        archive_identifier: 'SYN-AERIAL-003',
        date_label: '1964',
      },
      regions: [
        { region_id: 'r-rail', kind: 'polygon', label: 'linear rail corridor', bbox_xywh_pct: null, polygon_pct: [[8, 70], [94, 62], [96, 67], [10, 76]] },
        { region_id: 'r-industrial', kind: 'bbox', label: 'industrial roof cluster', bbox_xywh_pct: [42, 28, 24, 20], polygon_pct: null },
      ],
      evidence: [
        { evidence_id: 'e-visual-rail', boundary: 'visual_observation', region_id: 'r-rail', external_source_url: null, external_source_note: null, source_metadata_field: null, georeference_or_scale_basis: null },
        { evidence_id: 'e-visual-industrial', boundary: 'visual_observation', region_id: 'r-industrial', external_source_url: null, external_source_note: null, source_metadata_field: null, georeference_or_scale_basis: null },
        { evidence_id: 'e-map-index', boundary: 'externally_verified', region_id: null, external_source_url: 'https://donnees.montreal.ca/dataset/synthetic-aerial-index', external_source_note: 'Synthetic index sheet links this frame to a coarse flight strip and map tile.', source_metadata_field: null, georeference_or_scale_basis: 'synthetic map index tile and two named control-point candidates' },
      ],
      visual_observations: [
        claim({ claim_id: 'c-aerial-mode', lane: 'aerial_land_use_georeference', text: 'The image mode is aerial vertical.', boundary: 'visual_observation', evidence_ids: ['e-visual-rail', 'e-visual-industrial'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
        claim({ claim_id: 'c-land-use', lane: 'aerial_land_use_georeference', text: 'Visible regions include rail corridor and industrial roof cluster.', boundary: 'visual_observation', evidence_ids: ['e-visual-rail', 'e-visual-industrial'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      source_metadata_claims: [],
      inferred_hypotheses: [
        claim({ claim_id: 'c-georef-candidate', lane: 'aerial_land_use_georeference', text: 'The frame is a georeference candidate because rail alignment and roof clusters provide candidate control points.', boundary: 'inference', evidence_ids: ['e-visual-rail', 'e-visual-industrial'], confidence: 'medium', alternatives: ['insufficient control points'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      externally_verified_claims: [
        claim({ claim_id: 'c-verified-flight-strip', lane: 'aerial_land_use_georeference', text: 'The frame belongs to a synthetic 1964 aerial index tile with coarse flight-strip context.', boundary: 'externally_verified', evidence_ids: ['e-map-index'], verified_status: 'externally_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: true }),
      ],
      rejected_hypotheses: [
        claim({ claim_id: 'c-reject-acreage', lane: 'aerial_land_use_georeference', text: 'A specific acreage estimate is rejected; no area value is asserted without scale or georeference.', boundary: 'inference', evidence_ids: ['e-visual-industrial'], confidence: 'low', alternatives: ['area withheld pending scale'], verified_status: 'not_verified', review_status: 'rejected', review_flags: ['no_scale_or_georeference_for_area'], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      abstentions: [{ target: 'exact_coordinates', reason: 'Coarse index tile is not exact coordinate evidence.', evidence_boundary: 'insufficient_georeference' }],
    },
    {
      ...basePacket('synthetic_aerial_control_004', 'aerial_land_use_georeference'),
      source_metadata: {
        title: 'Synthetic low-information aerial hard control',
        archive_record_url: 'https://archivesdemontreal.ica-atom.org/synthetic-aerial-control-004',
        archive_identifier: 'SYN-AERIAL-004',
        date_label: 'undated',
      },
      regions: [
        { region_id: 'r-whole-low-info', kind: 'whole_image', label: 'low-information aerial frame', bbox_xywh_pct: null, polygon_pct: null },
      ],
      evidence: [
        { evidence_id: 'e-low-info', boundary: 'visual_observation', region_id: 'r-whole-low-info', external_source_url: null, external_source_note: null, source_metadata_field: null, georeference_or_scale_basis: null },
      ],
      visual_observations: [
        claim({ claim_id: 'c-low-info-mode', lane: 'aerial_land_use_georeference', text: 'The frame is low-information and not suitable for exact georeferencing.', boundary: 'visual_observation', evidence_ids: ['e-low-info'], confidence: 'medium', alternatives: ['aerial oblique with insufficient detail'], verified_status: 'not_verified', review_status: 'accepted', exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      source_metadata_claims: [],
      inferred_hypotheses: [],
      externally_verified_claims: [],
      rejected_hypotheses: [
        claim({ claim_id: 'c-reject-exact-location', lane: 'aerial_land_use_georeference', text: 'The image shows a specific named neighborhood block.', boundary: 'inference', evidence_ids: ['e-low-info'], confidence: 'low', alternatives: ['unknown location'], verified_status: 'not_verified', review_status: 'rejected', review_flags: ['visual_similarity_not_identity'], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: false }),
      ],
      abstentions: [{ target: 'land_use_mask', reason: 'Low-information hard control lacks defensible land-use regions.', evidence_boundary: 'insufficient_pixels' }],
    },
  ];
}

export function deriveBenchmarkTasks(packets: VerifiedMultimodalPacket[]): BenchmarkTask[] {
  return packets.flatMap((packet) => packet.externally_verified_claims
    .filter((item) => item.review_status === 'accepted' && item.benchmark_eligible)
    .map((item, index) => {
      const sourceUrls = item.evidence_ids
        .map((id) => packet.evidence.find((evidence) => evidence.evidence_id === id)?.external_source_url)
        .filter((url): url is string => typeof url === 'string');
      assert(sourceUrls.length > 0, `${packet.record_id}/${item.claim_id}: benchmark source URL missing`);
      return {
        schema_version: VMI_BENCHMARK_SCHEMA_VERSION,
        task_id: `vmi001-${packet.record_id}-${String(index + 1).padStart(2, '0')}`,
        record_id: packet.record_id,
        lane: packet.lane,
        query: item.text,
        positive_claim_ids: [item.claim_id],
        positive_record_ids: [packet.record_id],
        evidence_boundary: 'externally_verified',
        source_urls: [...new Set(sourceUrls)].sort(),
      };
    }));
}

export function unresolvedClaims(packets: VerifiedMultimodalPacket[]): Claim[] {
  return claimsByStatus(packets, 'unresolved');
}

export function rejectedClaims(packets: VerifiedMultimodalPacket[]): Claim[] {
  return claimsByStatus(packets, 'rejected');
}

function claimsByStatus(packets: VerifiedMultimodalPacket[], status: ReviewStatus): Claim[] {
  return packets.flatMap((packet) => claims(packet)
    .filter((item) => item.review_status === status)
    .map((item) => ({ ...item, record_id: packet.record_id } as Claim & { record_id: string })));
}

export function deriveRunReport(
  packets: VerifiedMultimodalPacket[],
  benchmarkTasks: BenchmarkTask[],
  digests: Pick<RunReport, 'packet_sha256' | 'benchmark_sha256' | 'unresolved_sha256' | 'rejected_sha256'>,
): RunReport {
  const allClaims = packets.flatMap(claims);
  const laneCounts = packets.reduce<Record<Lane, number>>((acc, packet) => {
    acc[packet.lane] += 1;
    return acc;
  }, { ground_ocr_entity_place: 0, aerial_land_use_georeference: 0 });
  return {
    schema_version: VMI_RUN_REPORT_SCHEMA_VERSION,
    batch_id: 'verified_multimodal_batch_001',
    generated_at: VMI_FIXED_CREATED_AT,
    scope: 'synthetic_hermetic_pilot',
    acceptance_target_records: 60,
    processed_records: packets.length,
    fully_verified_dossiers: 0,
    foundation_incomplete: true,
    ...digests,
    counts: {
      lanes: laneCounts,
      accepted_claims: allClaims.filter((item) => item.review_status === 'accepted').length,
      unresolved_claims: allClaims.filter((item) => item.review_status === 'unresolved').length,
      rejected_claims: allClaims.filter((item) => item.review_status === 'rejected').length,
      benchmark_tasks: benchmarkTasks.length,
      abstentions: packets.reduce((sum, packet) => sum + packet.abstentions.length, 0),
    },
    gates: {
      visual_regions: 'passed',
      external_source_url_and_note: 'passed',
      rights_completeness: 'passed',
      confidence_and_verified_status: 'passed',
      exact_location_evidence: 'passed',
      scale_georeference_for_area_distance: 'passed',
      reviewer_independence: 'passed',
      accepted_evidence_only_benchmark: 'passed',
    },
    hard_controls: [
      'partial OCR without entity promotion',
      'aerial low-information abstention',
      'area claim rejected without scale/georeference',
      'exact location withheld without exact evidence',
    ],
    gaps: [
      'Synthetic pilot only: 4 records, not the required 60 canonical records.',
      'No buyer-facing verified dossiers are complete against the issue target of at least 25.',
      'No live OCR/entity/place/aerial metrics are claimed from this fixture.',
    ],
    recommended_next_slice: 'Run the same contract on 8-12 real canonical records, balanced across ground signage and aerial controls, with source URLs captured but no production index mutation.',
  };
}
