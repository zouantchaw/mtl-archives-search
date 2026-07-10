import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CORPUS_VERSION,
  PRIMARY_STATES,
  RIGHTS_LICENSE_ID,
  RIGHTS_NOTES,
  SCHEMA_VERSION,
  cleanText,
  deriveSourceDataset,
  fileEvidence,
  idRange,
  parseArchiveImageKey,
  parseMetadataIdentity,
  readJson,
  readJsonl,
  sha256,
  sortedUnique,
  stableJson,
  writeJson,
  writeJsonl,
  type LocalInventoryRow,
  type PrimaryState,
  type R2InventoryRow,
  type R2SampleRow,
} from './model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_INPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/canonical_corpus_v1/live');
const DEFAULT_OUTPUT = DEFAULT_INPUT;

function resolveCliPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

type D1Row = Record<string, unknown> & {
  metadata_filename: string;
  image_filename: string;
  resolved_image_filename?: string | null;
  external_url?: string | null;
  credits?: string | null;
  cote?: string | null;
};

type VectorRow = {
  schema_version: string;
  id: string;
  normalized_identity: string | null;
  valid_identity: boolean;
};

type SnapshotIndex = {
  started_at?: string;
  completed_at?: string;
  pagination?: { enumerated_count?: number; reported_total_count?: number; unique_count?: number; count_agreement?: boolean };
  index?: { name?: string; config?: { dimensions?: number; metric?: string } };
  model_contract?: string;
};

type D1Snapshot = {
  started_at?: string;
  completed_at?: string;
  schema?: Array<{ name?: string }>;
  aggregate_before?: Record<string, unknown>;
  selected_columns?: string[];
};

type R2Snapshot = {
  started_at?: string;
  completed_at?: string;
  counts?: { objects?: number; bytes?: number; by_class?: Record<string, number>; samples?: number; sample_failures?: number };
  sample_design?: Record<string, unknown>;
};

type Coverage = {
  rotation: boolean;
  vlm_caption: boolean;
  ocr_text: boolean;
  geocode: boolean;
  trust_score: boolean;
  taxonomy: boolean;
  image_quality: boolean;
};

export type ReconciliationRow = {
  schema_version: typeof SCHEMA_VERSION;
  corpus_version: typeof CORPUS_VERSION;
  observed_identity: string;
  entity_kind: 'record' | 'r2_non_corpus' | 'invalid_identity';
  numeric_id: number | null;
  primary_state: PrimaryState;
  state_reason: string;
  secondary_flags: string[];
  media_type: 'archive_image' | 'document' | 'social_content' | 'content_asset' | 'other' | 'unknown';
  source_identity: string | null;
  source_datasets: string[];
  source_urls: string[];
  source_record_ids: string[];
  name: string;
  cote: string;
  rights: {
    license_id: string;
    attribution: string;
    notes: string;
    complete: boolean;
  };
  systems: {
    local: boolean;
    d1: boolean;
    r2: boolean;
    text_vector: boolean;
    clip_vector: boolean;
  };
  image: {
    expected_key: string | null;
    observed_r2_keys: string[];
    sampled_content_type: string | null;
    sampled_magic_kind: string | null;
    sampled_etag: string | null;
    sampled_size_bytes: number | null;
  };
  d1_enrichment: Coverage | null;
  d1_lineage: { created_at: string | null } | null;
  alias: {
    canonical_identity: string;
    basis: string;
    source_identity: string;
    payload_etag_match: boolean | null;
  } | null;
};

type AliasRow = {
  schema_version: typeof SCHEMA_VERSION;
  alias_identity: string;
  canonical_identity: string;
  source_identity: string;
  basis: 'exact_source_identity_single_d1_member';
  alias_systems: ReconciliationRow['systems'];
  canonical_systems: ReconciliationRow['systems'];
  payload_etag_match: boolean | null;
};

type R2DuplicateCandidateRow = {
  schema_version: typeof SCHEMA_VERSION;
  candidate_group_id: string;
  basis: 'same_etag_and_size_candidate_only';
  etag: string;
  etag_kind: 'single_part_or_opaque' | 'multipart';
  size_bytes: number;
  object_classes: string[];
  keys: string[];
  payload_equality_claimed: false;
};

function normalizeSourceUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return text;
  }
}

function d1Coverage(row: D1Row): Coverage {
  const nonEmptyJsonArray = (value: unknown): boolean => {
    const text = cleanText(value);
    if (!text || text === '[]') return false;
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? parsed.length > 0 : true;
    } catch {
      return true;
    }
  };
  return {
    rotation: row.rotation_degrees !== null && row.rotation_degrees !== undefined,
    vlm_caption: cleanText(row.vlm_caption).length > 0,
    ocr_text: cleanText(row.ocr_text).length > 0,
    geocode: typeof row.latitude === 'number' && typeof row.longitude === 'number',
    trust_score: typeof row.trust_score === 'number',
    taxonomy: cleanText(row.taxonomy_primary_category).length > 0
      || nonEmptyJsonArray(row.taxonomy_themes)
      || nonEmptyJsonArray(row.taxonomy_search_facets)
      || Number(row.taxonomy_review_required) !== 0
      || Number(row.taxonomy_exclude_default_visual) !== 0,
    image_quality: nonEmptyJsonArray(row.image_quality_labels)
      || cleanText(row.image_quality_severity).length > 0
      || cleanText(row.image_quality_action).length > 0,
  };
}

function d1SourceDatasets(row: D1Row): string[] {
  const url = cleanText(row.external_url);
  return url ? [deriveSourceDataset(url)] : [];
}

function expectedImageKey(identity: string, local: LocalInventoryRow | undefined, d1: D1Row | undefined): string | null {
  if (local) return local.resolved_image_filename || local.image_filename;
  const d1Key = cleanText(d1?.resolved_image_filename) || cleanText(d1?.image_filename);
  if (d1Key) return d1Key;
  const parsed = parseMetadataIdentity(identity);
  return parsed ? `mtl_archives_image_${parsed.numericId}.jpg` : null;
}

function systemsFor(
  identity: string,
  localById: Map<string, LocalInventoryRow>,
  d1ById: Map<string, D1Row>,
  r2ById: Map<string, R2InventoryRow[]>,
  textIds: Set<string>,
  clipIds: Set<string>,
): ReconciliationRow['systems'] {
  return {
    local: localById.has(identity),
    d1: d1ById.has(identity),
    r2: (r2ById.get(identity)?.length ?? 0) > 0,
    text_vector: textIds.has(identity),
    clip_vector: clipIds.has(identity),
  };
}

function stateFor(args: {
  entityKind: ReconciliationRow['entity_kind'];
  identity: string;
  systems: ReconciliationRow['systems'];
  objectClass: R2InventoryRow['object_class'] | null;
  malformedArchiveKey: boolean;
  aliasTarget: string | null;
  ambiguousAlias: boolean;
  mediaType: ReconciliationRow['media_type'];
  rightsComplete: boolean;
  sourceIdentity: string | null;
  multipleR2Objects: boolean;
  imageKeyMismatch: boolean;
}): { state: PrimaryState; reason: string } {
  if (args.entityKind === 'r2_non_corpus') {
    if (args.malformedArchiveKey) return { state: 'unresolved_blocker', reason: 'R2 key resembles an archive image key but violates the identity contract.' };
    return { state: 'excluded_with_reason', reason: `R2 ${args.objectClass ?? 'other'} object is outside the archive corpus identity namespace.` };
  }
  if (args.entityKind === 'invalid_identity') {
    if (args.systems.text_vector || args.systems.clip_vector) {
      return { state: 'vector_only_or_stale', reason: 'Vector ID does not satisfy the canonical metadata identity contract.' };
    }
    return { state: 'unresolved_blocker', reason: 'Observed identity does not satisfy the canonical metadata identity contract.' };
  }
  if (args.aliasTarget) return { state: 'duplicate_or_alias', reason: `Exact source identity aliases production-backed record ${args.aliasTarget}.` };
  if (args.ambiguousAlias) return { state: 'unresolved_blocker', reason: 'Duplicate source identity has zero or multiple production D1 members; no primary is inferred from numeric order.' };
  if (args.multipleR2Objects) return { state: 'unresolved_blocker', reason: 'Multiple archive-image R2 keys map to one metadata identity.' };
  if (args.imageKeyMismatch) return { state: 'unresolved_blocker', reason: 'Manifest image identity and observed R2 archive key disagree.' };
  if (!args.systems.local && !args.systems.d1) {
    if (args.systems.r2) return { state: 'orphan_r2_object', reason: 'Archive-image R2 object has no local or production D1 metadata row.' };
    return { state: 'vector_only_or_stale', reason: 'Vector identity has no local manifest, production D1, or archive-image R2 record.' };
  }
  if (args.systems.local && !args.systems.d1) return { state: 'local_only_candidate', reason: 'Local manifest identity is absent from production D1.' };
  if (!args.systems.local && args.systems.d1) return { state: 'production_only_candidate', reason: 'Production D1 identity is absent from the local manifest snapshot.' };
  if (!args.rightsComplete || !args.sourceIdentity) return { state: 'unresolved_blocker', reason: 'Source or rights attribution required for canonical status is incomplete.' };
  if (args.mediaType === 'document') return { state: 'canonical_document', reason: 'Source URL or sampled object magic identifies a document; retained as an explicit non-photo corpus record.' };
  if (!args.systems.r2) return { state: 'missing_r2_object', reason: 'Local and D1 metadata agree, but the expected archive-image object is absent from exact R2 enumeration.' };
  if (!args.systems.text_vector) return { state: 'text_vector_missing', reason: 'Canonical record is absent from the exact text Vectorize inventory.' };
  if (!args.systems.clip_vector) return { state: 'clip_vector_missing', reason: 'Canonical record is absent from the exact CLIP Vectorize inventory.' };
  return { state: 'canonical_active', reason: 'Identity is present in local, D1, R2, text Vectorize, and CLIP Vectorize with complete source/rights evidence.' };
}

function artifactEntry(filePath: string, root: string, rowCount?: number): ReturnType<typeof fileEvidence> {
  const evidence = fileEvidence(filePath, rowCount);
  return { ...evidence, path: path.relative(root, filePath).split(path.sep).join('/') };
}

function artifactSchemaVersion(filePath: string): string {
  const name = path.basename(filePath);
  if (name === 'alias-map-v1.jsonl') return 'canonical_corpus_alias_v1';
  if (name === 'r2-payload-duplicate-candidates-v1.jsonl') return 'canonical_corpus_r2_duplicate_candidate_v1';
  if (name === 'summary-v1.json') return 'canonical_corpus_summary_v1';
  return 'canonical_corpus_row_v1';
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function sampleBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => string, size = 3): Record<string, string[]> {
  const samples = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = samples.get(key(row)) ?? [];
    if (bucket.length < size) bucket.push(value(row));
    samples.set(key(row), bucket);
  }
  return Object.fromEntries([...samples.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(6));
}

export function buildCanonicalCorpus(inputDir: string, outputDir: string, compactSummaryPath?: string): {
  rows: ReconciliationRow[];
  summary: Record<string, unknown>;
} {
  const localRows = readJsonl<LocalInventoryRow>(path.join(inputDir, 'local-manifest.jsonl'));
  const localSnapshot = readJson<Record<string, unknown>>(path.join(inputDir, 'local-snapshot.json'));
  const d1Rows = readJsonl<D1Row>(path.join(inputDir, 'd1-manifest.jsonl'));
  const r2Rows = readJsonl<R2InventoryRow>(path.join(inputDir, 'r2-objects.jsonl'));
  const r2Samples = readJsonl<R2SampleRow>(path.join(inputDir, 'r2-samples.jsonl'));
  const textRows = readJsonl<VectorRow>(path.join(inputDir, 'text-vector-ids.jsonl'));
  const clipRows = readJsonl<VectorRow>(path.join(inputDir, 'clip-vector-ids.jsonl'));
  const d1Snapshot = readJson<D1Snapshot>(path.join(inputDir, 'd1-snapshot.json'));
  const r2Snapshot = readJson<R2Snapshot>(path.join(inputDir, 'r2-snapshot.json'));
  const textIndex = readJson<SnapshotIndex>(path.join(inputDir, 'text-vector-index.json'));
  const clipIndex = readJson<SnapshotIndex>(path.join(inputDir, 'clip-vector-index.json'));

  const localById = new Map(localRows.map((row) => [row.identity, row]));
  const d1ById = new Map<string, D1Row>();
  const invalidD1Ids: string[] = [];
  for (const row of d1Rows) {
    const parsed = parseMetadataIdentity(row.metadata_filename);
    if (!parsed) invalidD1Ids.push(cleanText(row.metadata_filename));
    else d1ById.set(parsed.identity, row);
  }
  const r2ById = new Map<string, R2InventoryRow[]>();
  const nonCorpusR2 = r2Rows.filter((row) => !row.normalized_identity);
  for (const row of r2Rows) {
    if (!row.normalized_identity) continue;
    const group = r2ById.get(row.normalized_identity) ?? [];
    group.push(row);
    r2ById.set(row.normalized_identity, group);
  }
  const textIds = new Set(textRows.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const clipIds = new Set(clipRows.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const invalidVectorIds = sortedUnique([
    ...textRows.filter((row) => !row.valid_identity).map((row) => row.id),
    ...clipRows.filter((row) => !row.valid_identity).map((row) => row.id),
  ]);
  const r2SampleByKey = new Map(r2Samples.map((row) => [row.key, row]));

  const recordIds = sortedUnique([
    ...localById.keys(), ...d1ById.keys(), ...r2ById.keys(), ...textIds, ...clipIds,
  ]);
  const sourceGroups = new Map<string, Set<string>>();
  for (const identity of sortedUnique([...localById.keys(), ...d1ById.keys()])) {
    const local = localById.get(identity);
    const d1 = d1ById.get(identity);
    const source = normalizeSourceUrl(local?.primary_source_url || d1?.external_url);
    if (!source) continue;
    const group = sourceGroups.get(source) ?? new Set<string>();
    group.add(identity);
    sourceGroups.set(source, group);
  }
  const aliasTargets = new Map<string, { canonical: string; source: string }>();
  const ambiguousAliasIds = new Set<string>();
  for (const [source, ids] of sourceGroups) {
    if (ids.size < 2) continue;
    const d1Members = [...ids].filter((id) => d1ById.has(id));
    if (d1Members.length === 1) {
      for (const id of ids) if (id !== d1Members[0]) aliasTargets.set(id, { canonical: d1Members[0], source });
    } else {
      for (const id of ids) ambiguousAliasIds.add(id);
    }
  }

  const rows: ReconciliationRow[] = [];
  for (const identity of recordIds) {
    const parsed = parseMetadataIdentity(identity);
    if (!parsed) throw new Error(`Internal record identity is invalid: ${identity}`);
    const local = localById.get(identity);
    const d1 = d1ById.get(identity);
    const r2Objects = (r2ById.get(identity) ?? []).sort((a, b) => a.key.localeCompare(b.key));
    const systems = systemsFor(identity, localById, d1ById, r2ById, textIds, clipIds);
    const sourceUrls = sortedUnique([...(local?.source_urls ?? []), cleanText(d1?.external_url)]);
    const sourceIdentity = normalizeSourceUrl(local?.primary_source_url || d1?.external_url);
    const sourceDatasets = local?.source_datasets.length
      ? local.source_datasets
      : sortedUnique(d1 ? d1SourceDatasets(d1) : []);
    const sourceRecordIds = local?.source_record_ids ?? [];
    const attribution = cleanText(local?.attribution) || cleanText(d1?.credits);
    const rightsComplete = sourceUrls.length > 0 && attribution.length > 0;
    const expectedKey = expectedImageKey(identity, local, d1);
    const samples = r2Objects.map((object) => r2SampleByKey.get(object.key)).filter((sample): sample is R2SampleRow => Boolean(sample));
    const pdfSample = samples.find((sample) => sample.magic_kind === 'pdf');
    const primarySample = pdfSample ?? samples[0];
    const sourceDocument = sourceUrls.some((url) => /\.pdf(?:$|[?#])/i.test(url));
    const mediaType: ReconciliationRow['media_type'] = sourceDocument || pdfSample ? 'document' : 'archive_image';
    const imageKeyMismatch = Boolean(expectedKey && r2Objects.length === 1 && r2Objects[0].key !== expectedKey);
    const aliasTarget = aliasTargets.get(identity) ?? null;
    const result = stateFor({
      entityKind: 'record',
      identity,
      systems,
      objectClass: 'archive_image',
      malformedArchiveKey: false,
      aliasTarget: aliasTarget?.canonical ?? null,
      ambiguousAlias: ambiguousAliasIds.has(identity),
      mediaType,
      rightsComplete,
      sourceIdentity,
      multipleR2Objects: r2Objects.length > 1,
      imageKeyMismatch,
    });
    const secondaryFlags = sortedUnique([
      ...(!systems.local ? ['local_missing'] : []),
      ...(!systems.d1 ? ['d1_missing'] : []),
      ...(!systems.r2 ? ['r2_missing'] : []),
      ...(!systems.text_vector ? ['text_vector_missing'] : []),
      ...(!systems.clip_vector ? ['clip_vector_missing'] : []),
      ...(!sourceIdentity ? ['source_identity_missing'] : []),
      ...(!rightsComplete ? ['rights_incomplete'] : []),
      ...(r2Objects.length > 1 ? ['multiple_r2_objects'] : []),
      ...(imageKeyMismatch ? ['image_key_mismatch'] : []),
      ...(primarySample && primarySample.content_type?.startsWith('image/') && primarySample.magic_kind === 'pdf'
        ? ['sampled_content_type_magic_mismatch'] : []),
      ...(mediaType === 'document' ? ['document_payload'] : []),
      ...(aliasTarget ? ['alias_identity'] : []),
      ...(ambiguousAliasIds.has(identity) ? ['ambiguous_alias_group'] : []),
    ]);
    const canonicalR2 = aliasTarget ? (r2ById.get(aliasTarget.canonical) ?? []) : [];
    const aliasEtags = r2Objects.map((row) => row.etag).filter(Boolean);
    const canonicalEtags = canonicalR2.map((row) => row.etag).filter(Boolean);
    const etagMatch = aliasEtags.length && canonicalEtags.length
      ? aliasEtags.some((etag) => canonicalEtags.includes(etag))
      : null;
    rows.push({
      schema_version: SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      observed_identity: identity,
      entity_kind: 'record',
      numeric_id: parsed.numericId,
      primary_state: result.state,
      state_reason: result.reason,
      secondary_flags: secondaryFlags,
      media_type: mediaType,
      source_identity: sourceIdentity,
      source_datasets: sourceDatasets,
      source_urls: sourceUrls,
      source_record_ids: sourceRecordIds,
      name: cleanText(local?.name) || cleanText(d1?.name),
      cote: cleanText(local?.cote) || cleanText(d1?.cote),
      rights: { license_id: RIGHTS_LICENSE_ID, attribution, notes: RIGHTS_NOTES, complete: rightsComplete },
      systems,
      image: {
        expected_key: expectedKey,
        observed_r2_keys: r2Objects.map((row) => row.key),
        sampled_content_type: primarySample?.content_type ?? null,
        sampled_magic_kind: primarySample?.magic_kind ?? null,
        sampled_etag: primarySample?.etag ?? r2Objects[0]?.etag ?? null,
        sampled_size_bytes: primarySample?.content_length ?? r2Objects[0]?.size_bytes ?? null,
      },
      d1_enrichment: d1 ? d1Coverage(d1) : null,
      d1_lineage: d1 ? { created_at: cleanText(d1.created_at) || null } : null,
      alias: aliasTarget ? {
        canonical_identity: aliasTarget.canonical,
        basis: 'exact_source_identity_single_d1_member',
        source_identity: aliasTarget.source,
        payload_etag_match: etagMatch,
      } : null,
    });
  }

  for (const object of nonCorpusR2.sort((a, b) => a.key.localeCompare(b.key))) {
    const identity = `r2:${object.key}`;
    const malformed = /^mtl_archives_image_/i.test(object.key);
    const sample = r2SampleByKey.get(object.key);
    const systems = { local: false, d1: false, r2: true, text_vector: false, clip_vector: false };
    const result = stateFor({
      entityKind: 'r2_non_corpus', identity, systems, objectClass: object.object_class,
      malformedArchiveKey: malformed, aliasTarget: null, ambiguousAlias: false,
      mediaType: object.object_class === 'social_content' ? 'social_content' : object.object_class === 'content_asset' ? 'content_asset' : 'other',
      rightsComplete: false, sourceIdentity: null, multipleR2Objects: false, imageKeyMismatch: false,
    });
    rows.push({
      schema_version: SCHEMA_VERSION, corpus_version: CORPUS_VERSION, observed_identity: identity,
      entity_kind: 'r2_non_corpus', numeric_id: null, primary_state: result.state, state_reason: result.reason,
      secondary_flags: sortedUnique(['outside_archive_identity_namespace', ...(malformed ? ['malformed_archive_key'] : [])]),
      media_type: object.object_class === 'social_content' ? 'social_content' : object.object_class === 'content_asset' ? 'content_asset' : 'other',
      source_identity: null, source_datasets: [], source_urls: [], source_record_ids: [], name: '', cote: '',
      rights: { license_id: 'not_applicable', attribution: '', notes: 'Non-corpus R2 object.', complete: false },
      systems,
      image: { expected_key: null, observed_r2_keys: [object.key], sampled_content_type: sample?.content_type ?? null,
        sampled_magic_kind: sample?.magic_kind ?? null, sampled_etag: sample?.etag ?? object.etag,
        sampled_size_bytes: sample?.content_length ?? object.size_bytes },
      d1_enrichment: null, d1_lineage: null, alias: null,
    });
  }

  for (const invalidId of sortedUnique([...invalidD1Ids, ...invalidVectorIds])) {
    const identity = `${invalidD1Ids.includes(invalidId) ? 'd1' : 'vector'}:${invalidId}`;
    const systems = {
      local: false,
      d1: invalidD1Ids.includes(invalidId),
      r2: false,
      text_vector: textRows.some((row) => row.id === invalidId),
      clip_vector: clipRows.some((row) => row.id === invalidId),
    };
    const result = stateFor({
      entityKind: 'invalid_identity', identity, systems, objectClass: null, malformedArchiveKey: false,
      aliasTarget: null, ambiguousAlias: false, mediaType: 'unknown', rightsComplete: false,
      sourceIdentity: null, multipleR2Objects: false, imageKeyMismatch: false,
    });
    rows.push({
      schema_version: SCHEMA_VERSION, corpus_version: CORPUS_VERSION, observed_identity: identity,
      entity_kind: 'invalid_identity', numeric_id: null, primary_state: result.state, state_reason: result.reason,
      secondary_flags: ['invalid_identity_format'], media_type: 'unknown', source_identity: null,
      source_datasets: [], source_urls: [], source_record_ids: [], name: '', cote: '',
      rights: { license_id: 'unknown', attribution: '', notes: 'Identity cannot be joined to archive source evidence.', complete: false },
      systems, image: { expected_key: null, observed_r2_keys: [], sampled_content_type: null,
        sampled_magic_kind: null, sampled_etag: null, sampled_size_bytes: null },
      d1_enrichment: null, d1_lineage: null, alias: null,
    });
  }
  rows.sort((a, b) => a.observed_identity.localeCompare(b.observed_identity));

  const aliases: AliasRow[] = rows.filter((row) => row.alias).map<AliasRow>((row) => {
    const canonical = rows.find((candidate) => candidate.observed_identity === row.alias!.canonical_identity);
    if (!canonical) throw new Error(`${row.observed_identity}: alias target is absent`);
    return {
      schema_version: SCHEMA_VERSION,
      alias_identity: row.observed_identity,
      canonical_identity: row.alias!.canonical_identity,
      source_identity: row.alias!.source_identity,
      basis: 'exact_source_identity_single_d1_member' as const,
      alias_systems: row.systems,
      canonical_systems: canonical.systems,
      payload_etag_match: row.alias!.payload_etag_match,
    };
  }).sort((a, b) => a.alias_identity.localeCompare(b.alias_identity));
  const r2PayloadGroups = new Map<string, R2InventoryRow[]>();
  for (const row of r2Rows) {
    if (!row.etag) continue;
    const key = `${row.etag}\0${row.size_bytes}`;
    const group = r2PayloadGroups.get(key) ?? [];
    group.push(row);
    r2PayloadGroups.set(key, group);
  }
  const r2DuplicateCandidates: R2DuplicateCandidateRow[] = [...r2PayloadGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map<R2DuplicateCandidateRow>(([groupKey, group]) => ({
      schema_version: SCHEMA_VERSION,
      candidate_group_id: `r2-etag-size:${sha256(groupKey)}`,
      basis: 'same_etag_and_size_candidate_only' as const,
      etag: group[0].etag!,
      etag_kind: /-\d+$/.test(group[0].etag!) ? 'multipart' as const : 'single_part_or_opaque' as const,
      size_bytes: group[0].size_bytes,
      object_classes: sortedUnique(group.map((row) => row.object_class)),
      keys: group.map((row) => row.key).sort((a, b) => a.localeCompare(b)),
      payload_equality_claimed: false as const,
    }))
    .sort((a, b) => a.candidate_group_id.localeCompare(b.candidate_group_id));
  const corpusRows = rows.filter((row) => row.entity_kind === 'record');
  const unresolved = rows.filter((row) => row.primary_state === 'unresolved_blocker');

  fs.mkdirSync(outputDir, { recursive: true });
  const corpusPath = path.join(outputDir, 'corpus-manifest-v1.jsonl');
  const reconciliationPath = path.join(outputDir, 'reconciliation-v1.jsonl');
  const aliasPath = path.join(outputDir, 'alias-map-v1.jsonl');
  const unresolvedPath = path.join(outputDir, 'unresolved-v1.jsonl');
  const r2DuplicatesPath = path.join(outputDir, 'r2-payload-duplicate-candidates-v1.jsonl');
  writeJsonl(corpusPath, corpusRows);
  writeJsonl(reconciliationPath, rows);
  writeJsonl(aliasPath, aliases);
  writeJsonl(unresolvedPath, unresolved);
  writeJsonl(r2DuplicatesPath, r2DuplicateCandidates);

  const canonicalEligible = corpusRows.filter((row) => row.systems.local || row.systems.d1)
    .filter((row) => row.primary_state !== 'duplicate_or_alias');
  const textMissing = canonicalEligible.filter((row) => !row.systems.text_vector).length;
  const clipMissing = canonicalEligible.filter((row) => !row.systems.clip_vector).length;
  const textStale = textRows.filter((vector) => !localById.has(vector.id) && !d1ById.has(vector.id)).length;
  const clipStale = clipRows.filter((vector) => !localById.has(vector.id) && !d1ById.has(vector.id)).length;
  const schemaColumns = sortedUnique((d1Snapshot.schema ?? []).map((column) => cleanText(column.name)));
  const enrichmentFields: Array<keyof Coverage> = ['rotation', 'vlm_caption', 'ocr_text', 'geocode', 'trust_score', 'taxonomy', 'image_quality'];
  const d1CoverageCounts = Object.fromEntries(enrichmentFields.map((field) => [field, corpusRows.filter((row) => row.d1_enrichment?.[field]).length]));
  const stateCounts = countBy(rows, (row) => row.primary_state);
  for (const state of PRIMARY_STATES) if (!(state in stateCounts)) stateCounts[state] = 0;
  const sortedStateCounts = Object.fromEntries(Object.entries(stateCounts).sort(([a], [b]) => a.localeCompare(b)));
  const rowSamples = sampleBy(rows, (row) => row.primary_state, (row) => row.observed_identity);
  const missingSamples = sampleBy(
    rows.flatMap((row) => row.secondary_flags.map((flag) => ({ flag, identity: row.observed_identity }))),
    (row) => row.flag,
    (row) => row.identity,
  );
  const row9696 = rows.find((row) => row.observed_identity === 'mtl_archives_metadata_9696.json');
  const row9247 = rows.find((row) => row.observed_identity === 'mtl_archives_metadata_9247.json');
  const summary: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    identity_rule: {
      canonical_metadata: '^mtl_archives_metadata_(\\d+)\\.json$',
      archive_image: '^mtl_archives_image_(\\d+)\\.[A-Za-z0-9]+$',
      join: 'The identical captured decimal token joins metadata and archive-image identities; state precedence never uses numeric order.',
      alias_precedence: 'Exact normalized source identity with exactly one production D1 member; zero or multiple D1 members remain unresolved.',
    },
    counts: {
      observed_identities: rows.length,
      corpus_identities: corpusRows.length,
      local_rows: localRows.length,
      d1_rows: d1Rows.length,
      r2_objects: r2Rows.length,
      r2_archive_images: r2Rows.filter((row) => row.object_class === 'archive_image').length,
      r2_social_content: r2Rows.filter((row) => row.object_class === 'social_content').length,
      r2_content_assets: r2Rows.filter((row) => row.object_class === 'content_asset').length,
      r2_other: r2Rows.filter((row) => row.object_class === 'other').length,
      text_vectors: textRows.length,
      clip_vectors: clipRows.length,
      aliases: aliases.length,
      unresolved: unresolved.length,
    },
    states: sortedStateCounts,
    by_media_type: countBy(rows, (row) => row.media_type),
    by_id_range: countBy(corpusRows, (row) => idRange(row.numeric_id)),
    by_source_dataset: countBy(
      corpusRows.flatMap((row) => row.source_datasets.length ? row.source_datasets.map((dataset) => ({ dataset })) : [{ dataset: 'unknown' }]),
      (row) => row.dataset,
    ),
    system_presence_matrix: countBy(corpusRows, (row) => [
      `local=${Number(row.systems.local)}`,
      `d1=${Number(row.systems.d1)}`,
      `r2=${Number(row.systems.r2)}`,
      `text=${Number(row.systems.text_vector)}`,
      `clip=${Number(row.systems.clip_vector)}`,
    ].join(',')),
    secondary_flags: countBy(rows.flatMap((row) => row.secondary_flags.map((flag) => ({ flag }))), (row) => row.flag),
    rights_and_attribution: {
      eligible_records: canonicalEligible.length,
      complete: canonicalEligible.filter((row) => row.rights.complete).length,
      incomplete: canonicalEligible.filter((row) => !row.rights.complete).length,
      complete_rate_percent: percentage(canonicalEligible.filter((row) => row.rights.complete).length, canonicalEligible.length),
      license_id: RIGHTS_LICENSE_ID,
    },
    d1: {
      schema_columns: schemaColumns,
      schema_existence: Object.fromEntries([
        'rotation_degrees', 'vlm_caption', 'ocr_text', 'latitude', 'longitude', 'trust_score',
        'taxonomy_primary_category', 'taxonomy_themes', 'taxonomy_search_facets', 'image_quality_labels',
        'image_quality_severity', 'image_quality_action',
      ].map((name) => [name, schemaColumns.includes(name)])),
      populated_row_coverage: d1CoverageCounts,
      aggregate: d1Snapshot.aggregate_before ?? {},
    },
    vector_coverage: {
      denominator: 'local_or_d1_non_alias_record_identities',
      eligible_records: canonicalEligible.length,
      text_missing: textMissing,
      text_missing_rate_percent: percentage(textMissing, canonicalEligible.length),
      clip_missing: clipMissing,
      clip_missing_rate_percent: percentage(clipMissing, canonicalEligible.length),
      text_vector_only_or_stale: textStale,
      text_stale_rate_percent: percentage(textStale, textRows.length),
      clip_vector_only_or_stale: clipStale,
      clip_stale_rate_percent: percentage(clipStale, clipRows.length),
      text_index: textIndex,
      clip_index: clipIndex,
    },
    r2: {
      exact_inventory: r2Snapshot.counts ?? {},
      sample_design: r2Snapshot.sample_design ?? {},
      sampled_magic: countBy(r2Samples, (row) => row.magic_kind),
      sampled_content_type_magic_mismatches: r2Samples.filter((row) => row.content_type?.startsWith('image/') && row.magic_kind === 'pdf').map((row) => row.key),
      duplicate_etag_size_candidates: {
        basis: 'Same ETag and size is a duplicate-payload candidate, not a byte-equality claim. Multipart and opaque ETags are labeled explicitly.',
        groups: r2DuplicateCandidates.length,
        objects: r2DuplicateCandidates.reduce((sum, group) => sum + group.keys.length, 0),
        by_etag_kind: countBy(r2DuplicateCandidates, (row) => row.etag_kind),
        samples: r2DuplicateCandidates.slice(0, 3).map((row) => ({ candidate_group_id: row.candidate_group_id, keys: row.keys.slice(0, 5) })),
      },
      inference_boundary: 'Content type and magic-byte evidence apply only to enumerated sample keys; object existence/key/size/ETag/last-modified counts are exact.',
    },
    source_snapshots: {
      local: { source_artifact: localSnapshot.source_artifact ?? null },
      d1: { started_at: d1Snapshot.started_at ?? null, completed_at: d1Snapshot.completed_at ?? null },
      r2: { started_at: r2Snapshot.started_at ?? null, completed_at: r2Snapshot.completed_at ?? null },
      text_vector: { started_at: textIndex.started_at ?? null, completed_at: textIndex.completed_at ?? null },
      clip_vector: { started_at: clipIndex.started_at ?? null, completed_at: clipIndex.completed_at ?? null },
    },
    samples: { by_primary_state: rowSamples, by_secondary_flag: missingSamples },
    decision_9696: {
      decision: row9696?.primary_state ?? 'not_observed',
      canonical_identity: row9696?.alias?.canonical_identity ?? null,
      evidence: {
        exact_source_identity_match: Boolean(row9696?.source_identity && row9696.source_identity === row9247?.source_identity),
        production_d1_member_9696: row9696?.systems.d1 ?? false,
        production_d1_member_9247: row9247?.systems.d1 ?? false,
        r2_payload_etag_match: row9696?.alias?.payload_etag_match ?? null,
        r2_magic_9696: row9696?.image.sampled_magic_kind ?? null,
        r2_magic_9247: row9247?.image.sampled_magic_kind ?? null,
      },
      rationale: 'Preserve 9696 as a source-identity alias of the production-backed 9247 document. The current sampled R2 payloads differ (9247 JPEG, 9696 PDF), so both object keys remain explicit and no payload equivalence or numeric-order precedence is claimed.',
    },
  };
  const summaryPath = path.join(outputDir, 'summary-v1.json');
  writeJson(summaryPath, summary);

  const inputNames = [
    'local-manifest.jsonl', 'local-snapshot.json', 'd1-manifest.jsonl', 'd1-query-manifest.json', 'd1-snapshot.json',
    'r2-objects.jsonl', 'r2-samples.jsonl', 'r2-snapshot.json', 'text-vector-ids.jsonl', 'text-vector-index.json',
    'clip-vector-ids.jsonl', 'clip-vector-index.json',
  ];
  const outputFiles = [
    [corpusPath, corpusRows.length], [reconciliationPath, rows.length], [aliasPath, aliases.length],
    [unresolvedPath, unresolved.length], [r2DuplicatesPath, r2DuplicateCandidates.length], [summaryPath, undefined],
  ] as Array<[string, number | undefined]>;
  const inputs = inputNames.map((name) => artifactEntry(path.join(inputDir, name), inputDir, /\.jsonl$/.test(name) ? readJsonl(path.join(inputDir, name)).length : undefined));
  const sourceSnapshotId = sha256(`${inputs.map((entry) => `${entry.path}\t${entry.sha256}`).join('\n')}\n`);
  const artifactManifest = {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    artifact_manifest_version: 'canonical_corpus_artifact_manifest_v1',
    source_snapshot_id: sourceSnapshotId,
    lineage: {
      description: 'Deterministic reconciliation of the captured local, production D1, R2, text Vectorize, and CLIP Vectorize inventories.',
      inputs,
      build_command: 'npm run canonical-corpus-v1:build',
      code_ref: 'codex/66-canonical-corpus-v1',
    },
    artifacts: outputFiles.map(([filePath, rowCount]) => ({
      schema_version: artifactSchemaVersion(filePath),
      ...artifactEntry(filePath, outputDir, rowCount),
    })),
    arithmetic: {
      observed_identity_rows: rows.length,
      state_total: Object.values(sortedStateCounts).reduce((sum, value) => sum + value, 0),
      corpus_rows: corpusRows.length,
      unresolved_rows: unresolved.length,
      alias_rows: aliases.length,
    },
  };
  writeJson(path.join(outputDir, 'artifact-manifest-v1.json'), artifactManifest);
  if (compactSummaryPath) {
    writeJson(compactSummaryPath, {
      schema_version: SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      source_snapshot_id: sourceSnapshotId,
      counts: summary.counts,
      states: summary.states,
      by_media_type: summary.by_media_type,
      by_id_range: summary.by_id_range,
      by_source_dataset: summary.by_source_dataset,
      system_presence_matrix: summary.system_presence_matrix,
      secondary_flags: summary.secondary_flags,
      rights_and_attribution: summary.rights_and_attribution,
      d1: summary.d1,
      vector_coverage: summary.vector_coverage,
      r2: summary.r2,
      source_snapshots: summary.source_snapshots,
      source_artifacts: artifactManifest.lineage.inputs,
      samples: summary.samples,
      decision_9696: summary.decision_9696,
      artifacts: artifactManifest.artifacts,
    });
  }
  return { rows, summary };
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'compact-summary': { type: 'string' },
    },
  });
  const result = buildCanonicalCorpus(
    resolveCliPath(values.input!),
    resolveCliPath(values.output!),
    values['compact-summary'] ? resolveCliPath(values['compact-summary']) : undefined,
  );
  console.log(stableJson({
    status: 'ok',
    observed_identities: result.rows.length,
    states: (result.summary.states ?? {}),
    output: resolveCliPath(values.output!),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
