import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import {
  CORPUS_VERSION,
  PRIMARY_STATES,
  RIGHTS_LICENSE_ID,
  SCHEMA_VERSION,
  cleanText,
  idRange,
  parseArchiveImageKey,
  parseMetadataIdentity,
  readJson,
  readJsonl,
  sha256,
  sortedUnique,
  stableJson,
  type LocalInventoryRow,
  type R2InventoryRow,
  type R2SampleRow,
} from './model.js';
import type { ReconciliationRow } from './build-canonical-corpus-v1.js';
import {
  GENERATED_OUTPUT_FILES,
  assertRelativeLocator,
  resolveContainedFile,
  verifySourceSnapshot,
  type CorpusMode,
  type SourceInputEvidence,
} from './snapshot-contract.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_INPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/canonical_corpus_v1/live');
const ROW_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-row.schema.v1.json');
const ARTIFACT_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-artifact-manifest.schema.v1.json');
const ALIAS_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-alias.schema.v1.json');
const R2_DUPLICATE_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-r2-duplicate-candidate.schema.v1.json');
const SUMMARY_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-summary.schema.v1.json');
const INPUT_MANIFEST_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-input-manifest.schema.v1.json');

function resolveCliPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

type VectorRow = { id: string; normalized_identity: string | null; valid_identity: boolean };
type D1Row = { metadata_filename: string; image_filename: string; resolved_image_filename?: string | null } & Record<string, unknown>;
type IndexSnapshot = Record<string, unknown> & {
  started_at?: string;
  completed_at?: string;
  pagination?: { enumerated_count?: number; reported_total_count?: number; unique_count?: number; count_agreement?: boolean };
};
type D1Snapshot = Record<string, unknown> & {
  started_at?: string;
  completed_at?: string;
  schema?: Array<{ name?: string }>;
  aggregate_before?: { row_count?: number; metadata_id_count?: number; image_id_count?: number } & Record<string, unknown>;
};
type R2Snapshot = Record<string, unknown> & {
  started_at?: string;
  completed_at?: string;
  counts?: { objects?: number; bytes?: number; by_class?: Record<string, number>; samples?: number; sample_failures?: number };
  sample_design?: Record<string, unknown>;
};
type Summary = Record<string, unknown> & {
  counts?: Record<string, number>;
  states?: Record<string, number>;
  samples?: { by_primary_state?: Record<string, string[]>; by_secondary_flag?: Record<string, string[]> };
  decision_9696?: { decision?: string; canonical_identity?: string | null; evidence?: Record<string, unknown>; rationale?: string };
};
type ArtifactManifest = {
  schema_version: string;
  source_snapshot_id: string;
  lineage: { inputs: SourceInputEvidence[] };
  arithmetic: { observed_identity_rows: number; state_total: number; corpus_rows: number; unresolved_rows: number; alias_rows: number };
  artifacts: Array<{ path: string; sha256: string; byte_count: number; row_count?: number; schema_version: string }>;
};
type AliasRow = {
  alias_identity: string;
  canonical_identity: string;
  source_identity: string;
  payload_etag_match: boolean | null;
  alias_systems: ReconciliationRow['systems'];
  canonical_systems: ReconciliationRow['systems'];
};
type R2DuplicateCandidateRow = {
  candidate_group_id: string;
  basis: string;
  etag: string;
  etag_kind: string;
  size_bytes: number;
  object_classes: string[];
  keys: string[];
  payload_equality_claimed: boolean;
};

type AjvLike = { compile<T>(schema: Record<string, unknown>): ValidateFunction<T> };
const Ajv2020 = Ajv2020Import as unknown as new (options: Record<string, unknown>) => AjvLike;
const addFormats = addFormatsImport as unknown as (instance: AjvLike) => void;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertUnique(values: string[], label: string): void {
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

function assertSorted(values: string[], label: string): void {
  assert(values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) <= 0), `${label} must be sorted`);
}

function schemaError(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ');
}

function buildObservedUniverse(
  local: LocalInventoryRow[],
  d1: D1Row[],
  r2: R2InventoryRow[],
  text: VectorRow[],
  clip: VectorRow[],
): Set<string> {
  const values = new Set<string>();
  for (const row of local) values.add(row.identity);
  const invalidD1 = new Set<string>();
  for (const row of d1) {
    const parsed = parseMetadataIdentity(row.metadata_filename);
    if (parsed) values.add(parsed.identity);
    else invalidD1.add(row.metadata_filename);
  }
  for (const row of r2) values.add(row.normalized_identity ?? `r2:${row.key}`);
  for (const row of [...text, ...clip]) {
    if (row.valid_identity && row.normalized_identity) values.add(row.normalized_identity);
    else values.add(`${invalidD1.has(row.id) ? 'd1' : 'vector'}:${row.id}`);
  }
  for (const id of invalidD1) values.add(`d1:${id}`);
  return values;
}

function fileRowCount(filePath: string): number | undefined {
  if (!/\.(jsonl|ndjson)$/i.test(filePath)) return undefined;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).length;
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

function deriveExpectedSummary(args: {
  local: LocalInventoryRow[];
  localSnapshot: Record<string, unknown>;
  d1: D1Row[];
  d1Snapshot: D1Snapshot;
  r2: R2InventoryRow[];
  r2Samples: R2SampleRow[];
  r2Snapshot: R2Snapshot;
  text: VectorRow[];
  clip: VectorRow[];
  textIndex: IndexSnapshot;
  clipIndex: IndexSnapshot;
  corpus: ReconciliationRow[];
  reconciliation: ReconciliationRow[];
  aliases: AliasRow[];
  unresolved: ReconciliationRow[];
  r2DuplicateCandidates: R2DuplicateCandidateRow[];
}): Summary {
  const canonicalEligible = args.corpus
    .filter((row) => row.systems.local || row.systems.d1)
    .filter((row) => row.primary_state !== 'duplicate_or_alias');
  const localIds = new Set(args.local.map((row) => row.identity));
  const d1Ids = new Set(args.d1.map((row) => parseMetadataIdentity(row.metadata_filename)?.identity).filter(Boolean));
  const textMissing = canonicalEligible.filter((row) => !row.systems.text_vector).length;
  const clipMissing = canonicalEligible.filter((row) => !row.systems.clip_vector).length;
  const textStale = args.text.filter((vector) => !localIds.has(vector.id) && !d1Ids.has(vector.id)).length;
  const clipStale = args.clip.filter((vector) => !localIds.has(vector.id) && !d1Ids.has(vector.id)).length;
  const schemaColumns = sortedUnique((args.d1Snapshot.schema ?? []).map((column) => cleanText(column.name)));
  const enrichmentFields = ['rotation', 'vlm_caption', 'ocr_text', 'geocode', 'trust_score', 'taxonomy', 'image_quality'] as const;
  const d1CoverageCounts = Object.fromEntries(
    enrichmentFields.map((field) => [field, args.corpus.filter((row) => row.d1_enrichment?.[field]).length]),
  );
  const stateCounts = countBy(args.reconciliation, (row) => row.primary_state);
  for (const state of PRIMARY_STATES) if (!(state in stateCounts)) stateCounts[state] = 0;
  const sortedStateCounts = Object.fromEntries(Object.entries(stateCounts).sort(([a], [b]) => a.localeCompare(b)));
  const row9696 = args.reconciliation.find((row) => row.observed_identity === 'mtl_archives_metadata_9696.json');
  const row9247 = args.reconciliation.find((row) => row.observed_identity === 'mtl_archives_metadata_9247.json');

  return {
    schema_version: SCHEMA_VERSION,
    summary_version: 'canonical_corpus_summary_v1',
    corpus_version: CORPUS_VERSION,
    identity_rule: {
      canonical_metadata: '^mtl_archives_metadata_(\\d+)\\.json$',
      archive_image: '^mtl_archives_image_(\\d+)\\.[A-Za-z0-9]+$',
      join: 'The identical captured decimal token joins metadata and archive-image identities; state precedence never uses numeric order.',
      alias_precedence: 'Exact normalized source identity with exactly one production D1 member; zero or multiple D1 members remain unresolved.',
    },
    counts: {
      observed_identities: args.reconciliation.length,
      corpus_identities: args.corpus.length,
      local_rows: args.local.length,
      d1_rows: args.d1.length,
      r2_objects: args.r2.length,
      r2_archive_images: args.r2.filter((row) => row.object_class === 'archive_image').length,
      r2_social_content: args.r2.filter((row) => row.object_class === 'social_content').length,
      r2_content_assets: args.r2.filter((row) => row.object_class === 'content_asset').length,
      r2_other: args.r2.filter((row) => row.object_class === 'other').length,
      text_vectors: args.text.length,
      clip_vectors: args.clip.length,
      aliases: args.aliases.length,
      unresolved: args.unresolved.length,
    },
    states: sortedStateCounts,
    by_media_type: countBy(args.reconciliation, (row) => row.media_type),
    by_id_range: countBy(args.corpus, (row) => idRange(row.numeric_id)),
    by_source_dataset: countBy(
      args.corpus.flatMap((row) => row.source_datasets.length
        ? row.source_datasets.map((dataset) => ({ dataset }))
        : [{ dataset: 'unknown' }]),
      (row) => row.dataset,
    ),
    system_presence_matrix: countBy(args.corpus, (row) => [
      `local=${Number(row.systems.local)}`,
      `d1=${Number(row.systems.d1)}`,
      `r2=${Number(row.systems.r2)}`,
      `text=${Number(row.systems.text_vector)}`,
      `clip=${Number(row.systems.clip_vector)}`,
    ].join(',')),
    secondary_flags: countBy(
      args.reconciliation.flatMap((row) => row.secondary_flags.map((flag) => ({ flag }))),
      (row) => row.flag,
    ),
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
      aggregate: args.d1Snapshot.aggregate_before ?? {},
    },
    vector_coverage: {
      denominator: 'local_or_d1_non_alias_record_identities',
      eligible_records: canonicalEligible.length,
      text_missing: textMissing,
      text_missing_rate_percent: percentage(textMissing, canonicalEligible.length),
      clip_missing: clipMissing,
      clip_missing_rate_percent: percentage(clipMissing, canonicalEligible.length),
      text_vector_only_or_stale: textStale,
      text_stale_rate_percent: percentage(textStale, args.text.length),
      clip_vector_only_or_stale: clipStale,
      clip_stale_rate_percent: percentage(clipStale, args.clip.length),
      text_index: args.textIndex,
      clip_index: args.clipIndex,
    },
    r2: {
      exact_inventory: args.r2Snapshot.counts ?? {},
      sample_design: args.r2Snapshot.sample_design ?? {},
      sampled_magic: countBy(args.r2Samples, (row) => row.magic_kind),
      sampled_content_type_magic_mismatches: args.r2Samples
        .filter((row) => row.content_type?.startsWith('image/') && row.magic_kind === 'pdf')
        .map((row) => row.key),
      duplicate_etag_size_candidates: {
        basis: 'Same ETag and size is a duplicate-payload candidate, not a byte-equality claim. Multipart and opaque ETags are labeled explicitly.',
        groups: args.r2DuplicateCandidates.length,
        objects: args.r2DuplicateCandidates.reduce((sum, group) => sum + group.keys.length, 0),
        by_etag_kind: countBy(args.r2DuplicateCandidates, (row) => row.etag_kind),
        samples: args.r2DuplicateCandidates.slice(0, 3).map((row) => ({
          candidate_group_id: row.candidate_group_id,
          keys: row.keys.slice(0, 5),
        })),
      },
      inference_boundary: 'Content type and magic-byte evidence apply only to enumerated sample keys; object existence/key/size/ETag/last-modified counts are exact.',
    },
    source_snapshots: {
      local: { source_artifact: args.localSnapshot.source_artifact ?? null },
      d1: { started_at: args.d1Snapshot.started_at ?? null, completed_at: args.d1Snapshot.completed_at ?? null },
      r2: { started_at: args.r2Snapshot.started_at ?? null, completed_at: args.r2Snapshot.completed_at ?? null },
      text_vector: { started_at: args.textIndex.started_at ?? null, completed_at: args.textIndex.completed_at ?? null },
      clip_vector: { started_at: args.clipIndex.started_at ?? null, completed_at: args.clipIndex.completed_at ?? null },
    },
    samples: {
      by_primary_state: sampleBy(args.reconciliation, (row) => row.primary_state, (row) => row.observed_identity),
      by_secondary_flag: sampleBy(
        args.reconciliation.flatMap((row) => row.secondary_flags.map((flag) => ({ flag, identity: row.observed_identity }))),
        (row) => row.flag,
        (row) => row.identity,
      ),
    },
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
}

function expectedState(
  row: ReconciliationRow,
  aliasTarget: string | null,
  ambiguousAlias: boolean,
): ReconciliationRow['primary_state'] {
  if (row.entity_kind === 'r2_non_corpus') {
    return row.secondary_flags.includes('malformed_archive_key') ? 'unresolved_blocker' : 'excluded_with_reason';
  }
  if (row.entity_kind === 'invalid_identity') return 'vector_only_or_stale';
  if (aliasTarget) return 'duplicate_or_alias';
  if (ambiguousAlias) return 'unresolved_blocker';
  if (row.image.observed_r2_keys.length > 1) return 'unresolved_blocker';
  if (row.image.expected_key && row.image.observed_r2_keys.length === 1
    && row.image.observed_r2_keys[0] !== row.image.expected_key) return 'unresolved_blocker';
  if (!row.systems.local && !row.systems.d1) return row.systems.r2 ? 'orphan_r2_object' : 'vector_only_or_stale';
  if (row.systems.local && !row.systems.d1) return 'local_only_candidate';
  if (!row.systems.local && row.systems.d1) return 'production_only_candidate';
  if (!row.rights.complete || !row.source_identity) return 'unresolved_blocker';
  if (row.media_type === 'document') return 'canonical_document';
  if (!row.systems.r2) return 'missing_r2_object';
  if (!row.systems.text_vector) return 'text_vector_missing';
  if (!row.systems.clip_vector) return 'clip_vector_missing';
  return 'canonical_active';
}

function assertRowConsistency(args: {
  reconciliation: ReconciliationRow[];
  local: LocalInventoryRow[];
  d1: D1Row[];
  r2: R2InventoryRow[];
  r2Samples: R2SampleRow[];
  text: VectorRow[];
  clip: VectorRow[];
}): void {
  const localById = new Map(args.local.map((row) => [row.identity, row]));
  const d1ById = new Map(
    args.d1.map((row) => [parseMetadataIdentity(row.metadata_filename)?.identity, row] as const)
      .filter((entry): entry is [string, D1Row] => Boolean(entry[0])),
  );
  const r2ById = new Map<string, R2InventoryRow[]>();
  for (const object of args.r2) {
    if (!object.normalized_identity) continue;
    const group = r2ById.get(object.normalized_identity) ?? [];
    group.push(object);
    r2ById.set(object.normalized_identity, group);
  }
  const textIds = new Set(args.text.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const clipIds = new Set(args.clip.filter((row) => row.valid_identity).map((row) => row.normalized_identity!));
  const sampleByKey = new Map(args.r2Samples.map((row) => [row.key, row]));
  const byId = new Map(args.reconciliation.map((row) => [row.observed_identity, row]));

  const sourceGroups = new Map<string, ReconciliationRow[]>();
  for (const row of args.reconciliation) {
    if (row.entity_kind !== 'record' || !row.source_identity) continue;
    const group = sourceGroups.get(row.source_identity) ?? [];
    group.push(row);
    sourceGroups.set(row.source_identity, group);
  }
  const aliasTargets = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  for (const group of sourceGroups.values()) {
    if (group.length < 2) continue;
    const d1Members = group.filter((row) => row.systems.d1);
    if (d1Members.length === 1) {
      for (const row of group) if (row !== d1Members[0]) aliasTargets.set(row.observed_identity, d1Members[0].observed_identity);
    } else {
      for (const row of group) ambiguousAliases.add(row.observed_identity);
    }
  }

  for (const row of args.reconciliation) {
    if (row.entity_kind === 'record') {
      const local = localById.get(row.observed_identity);
      const d1 = d1ById.get(row.observed_identity);
      const r2Objects = (r2ById.get(row.observed_identity) ?? []).sort((a, b) => a.key.localeCompare(b.key));
      const expectedSystems = {
        local: Boolean(local),
        d1: Boolean(d1),
        r2: r2Objects.length > 0,
        text_vector: textIds.has(row.observed_identity),
        clip_vector: clipIds.has(row.observed_identity),
      };
      assert(stableJson(row.systems) === stableJson(expectedSystems), `${row.observed_identity}: systems disagree with verified snapshots`);
      const expectedKey = local?.resolved_image_filename || local?.image_filename
        || cleanText(d1?.resolved_image_filename) || cleanText(d1?.image_filename)
        || `mtl_archives_image_${row.numeric_id}.jpg`;
      assert(row.image.expected_key === expectedKey, `${row.observed_identity}: expected R2 key drifted`);
      assert(stableJson(row.image.observed_r2_keys) === stableJson(r2Objects.map((object) => object.key)),
        `${row.observed_identity}: observed R2 keys disagree with verified inventory`);
      const samples = r2Objects.map((object) => sampleByKey.get(object.key)).filter((sample): sample is R2SampleRow => Boolean(sample));
      const primarySample = samples.find((sample) => sample.magic_kind === 'pdf') ?? samples[0];
      const expectedMedia = row.source_urls.some((url) => /\.pdf(?:$|[?#])/i.test(url)) || primarySample?.magic_kind === 'pdf'
        ? 'document'
        : 'archive_image';
      assert(row.media_type === expectedMedia, `${row.observed_identity}: media type disagrees with source/magic evidence`);
      assert(row.rights.complete === (row.source_urls.length > 0 && row.rights.attribution.length > 0),
        `${row.observed_identity}: rights completeness is inconsistent`);

      const aliasTarget = aliasTargets.get(row.observed_identity) ?? null;
      const ambiguousAlias = ambiguousAliases.has(row.observed_identity);
      const imageKeyMismatch = Boolean(expectedKey && r2Objects.length === 1 && r2Objects[0].key !== expectedKey);
      const expectedFlags = sortedUnique([
        ...(!row.systems.local ? ['local_missing'] : []),
        ...(!row.systems.d1 ? ['d1_missing'] : []),
        ...(!row.systems.r2 ? ['r2_missing'] : []),
        ...(!row.systems.text_vector ? ['text_vector_missing'] : []),
        ...(!row.systems.clip_vector ? ['clip_vector_missing'] : []),
        ...(!row.source_identity ? ['source_identity_missing'] : []),
        ...(!row.rights.complete ? ['rights_incomplete'] : []),
        ...(r2Objects.length > 1 ? ['multiple_r2_objects'] : []),
        ...(imageKeyMismatch ? ['image_key_mismatch'] : []),
        ...(primarySample?.content_type?.startsWith('image/') && primarySample.magic_kind === 'pdf'
          ? ['sampled_content_type_magic_mismatch'] : []),
        ...(expectedMedia === 'document' ? ['document_payload'] : []),
        ...(aliasTarget ? ['alias_identity'] : []),
        ...(ambiguousAlias ? ['ambiguous_alias_group'] : []),
      ]);
      assert(stableJson(row.secondary_flags) === stableJson(expectedFlags),
        `${row.observed_identity}: secondary flags disagree with systems/state evidence`);
      assert(row.primary_state === expectedState(row, aliasTarget, ambiguousAlias),
        `${row.observed_identity}: primary state conflicts with systems and secondary evidence`);
      assert(Boolean(row.alias) === Boolean(aliasTarget), `${row.observed_identity}: alias object presence drifted`);
      if (aliasTarget) {
        assert(row.alias?.canonical_identity === aliasTarget, `${row.observed_identity}: alias target drifted`);
        assert(row.alias?.source_identity === row.source_identity, `${row.observed_identity}: alias source identity drifted`);
        assert(byId.has(aliasTarget), `${row.observed_identity}: alias target is absent`);
      }
      continue;
    }

    if (row.entity_kind === 'r2_non_corpus') {
      const key = row.observed_identity.replace(/^r2:/, '');
      const object = args.r2.find((candidate) => candidate.key === key && candidate.normalized_identity === null);
      assert(object, `${row.observed_identity}: non-corpus R2 object is absent from inventory`);
      assert(stableJson(row.systems) === stableJson({ local: false, d1: false, r2: true, text_vector: false, clip_vector: false }),
        `${row.observed_identity}: non-corpus systems are incoherent`);
      const expectedFlags = sortedUnique([
        'outside_archive_identity_namespace',
        ...(/^mtl_archives_image_/i.test(key) ? ['malformed_archive_key'] : []),
      ]);
      assert(stableJson(row.secondary_flags) === stableJson(expectedFlags), `${row.observed_identity}: non-corpus flags drifted`);
      assert(row.primary_state === expectedState(row, null, false), `${row.observed_identity}: non-corpus state drifted`);
      assert(row.alias === null && row.image.expected_key === null, `${row.observed_identity}: non-corpus identity carries record linkage`);
      continue;
    }

    assert(row.observed_identity.startsWith('vector:'), `${row.observed_identity}: invalid identity must be a vector record`);
    const invalidId = row.observed_identity.slice('vector:'.length);
    const expectedSystems = {
      local: false,
      d1: false,
      r2: false,
      text_vector: args.text.some((vector) => vector.id === invalidId && !vector.valid_identity),
      clip_vector: args.clip.some((vector) => vector.id === invalidId && !vector.valid_identity),
    };
    assert(expectedSystems.text_vector || expectedSystems.clip_vector, `${row.observed_identity}: invalid identity is not an invalid vector record`);
    assert(stableJson(row.systems) === stableJson(expectedSystems), `${row.observed_identity}: invalid vector systems drifted`);
    assert(stableJson(row.secondary_flags) === stableJson(['invalid_identity_format']), `${row.observed_identity}: invalid vector flags drifted`);
    assert(row.primary_state === 'vector_only_or_stale', `${row.observed_identity}: invalid vector state drifted`);
    assert(row.media_type === 'unknown' && row.alias === null && row.image.expected_key === null,
      `${row.observed_identity}: invalid vector carries record payload`);
  }
}

export type CheckCanonicalCorpusOptions = {
  mode?: CorpusMode;
  inputManifestPath?: string;
};

export function checkCanonicalCorpus(
  inputDir: string,
  options: CheckCanonicalCorpusOptions = {},
): Record<string, unknown> {
  const mode = options.mode ?? 'live';
  const verifiedSource = verifySourceSnapshot(inputDir, mode, options.inputManifestPath);
  const generatedPaths = Object.fromEntries(
    GENERATED_OUTPUT_FILES.map((name) => [name, resolveContainedFile(inputDir, name)]),
  ) as Record<(typeof GENERATED_OUTPUT_FILES)[number], string>;
  const local = readJsonl<LocalInventoryRow>(path.join(inputDir, 'local-manifest.jsonl'));
  const localSnapshot = readJson<Record<string, unknown>>(path.join(inputDir, 'local-snapshot.json'));
  const d1 = readJsonl<D1Row>(path.join(inputDir, 'd1-manifest.jsonl'));
  const r2 = readJsonl<R2InventoryRow>(path.join(inputDir, 'r2-objects.jsonl'));
  const r2Samples = readJsonl<R2SampleRow>(path.join(inputDir, 'r2-samples.jsonl'));
  const text = readJsonl<VectorRow>(path.join(inputDir, 'text-vector-ids.jsonl'));
  const clip = readJsonl<VectorRow>(path.join(inputDir, 'clip-vector-ids.jsonl'));
  const textIndex = readJson<IndexSnapshot>(path.join(inputDir, 'text-vector-index.json'));
  const clipIndex = readJson<IndexSnapshot>(path.join(inputDir, 'clip-vector-index.json'));
  const d1Snapshot = readJson<D1Snapshot>(path.join(inputDir, 'd1-snapshot.json'));
  const r2Snapshot = readJson<R2Snapshot>(path.join(inputDir, 'r2-snapshot.json'));
  const corpus = readJsonl<ReconciliationRow>(generatedPaths['corpus-manifest-v1.jsonl']);
  const reconciliation = readJsonl<ReconciliationRow>(generatedPaths['reconciliation-v1.jsonl']);
  const aliases = readJsonl<AliasRow>(generatedPaths['alias-map-v1.jsonl']);
  const unresolved = readJsonl<ReconciliationRow>(generatedPaths['unresolved-v1.jsonl']);
  const r2DuplicateCandidates = readJsonl<R2DuplicateCandidateRow>(generatedPaths['r2-payload-duplicate-candidates-v1.jsonl']);
  const summary = readJson<Summary>(generatedPaths['summary-v1.json']);
  const artifactManifest = readJson<ArtifactManifest>(generatedPaths['artifact-manifest-v1.json']);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateRow = ajv.compile<ReconciliationRow>(readJson<Record<string, unknown>>(ROW_SCHEMA_PATH));
  const validateArtifact = ajv.compile<ArtifactManifest>(readJson<Record<string, unknown>>(ARTIFACT_SCHEMA_PATH));
  const validateAlias = ajv.compile<AliasRow>(readJson<Record<string, unknown>>(ALIAS_SCHEMA_PATH));
  const validateR2Duplicate = ajv.compile<R2DuplicateCandidateRow>(readJson<Record<string, unknown>>(R2_DUPLICATE_SCHEMA_PATH));
  const validateSummary = ajv.compile<Summary>(readJson<Record<string, unknown>>(SUMMARY_SCHEMA_PATH));
  const validateInputManifest = ajv.compile(readJson<Record<string, unknown>>(INPUT_MANIFEST_SCHEMA_PATH));
  assert(validateInputManifest(verifiedSource.manifest), `input manifest schema failed: ${schemaError(validateInputManifest.errors)}`);
  for (const row of reconciliation) {
    assert(validateRow(row), `${row.observed_identity}: row schema failed: ${schemaError(validateRow.errors)}`);
  }
  assert(validateArtifact(artifactManifest), `artifact manifest schema failed: ${schemaError(validateArtifact.errors)}`);
  assert(validateSummary(summary), `summary schema failed: ${schemaError(validateSummary.errors)}`);
  for (const row of aliases) assert(validateAlias(row), `${row.alias_identity}: alias schema failed: ${schemaError(validateAlias.errors)}`);
  for (const row of r2DuplicateCandidates) {
    assert(validateR2Duplicate(row), `${row.candidate_group_id}: R2 duplicate schema failed: ${schemaError(validateR2Duplicate.errors)}`);
  }

  const reconciliationIds = reconciliation.map((row) => row.observed_identity);
  assertUnique(reconciliationIds, 'reconciliation observed identities');
  assertSorted(reconciliationIds, 'reconciliation observed identities');
  const universe = buildObservedUniverse(local, d1, r2, text, clip);
  assert(universe.size === reconciliation.length, `observed universe ${universe.size} != reconciliation rows ${reconciliation.length}`);
  for (const identity of universe) assert(reconciliationIds.includes(identity), `observed identity is not reconciled: ${identity}`);
  for (const row of reconciliation) assert(universe.has(row.observed_identity), `reconciliation row was not observed: ${row.observed_identity}`);

  for (const row of reconciliation) {
    assert(PRIMARY_STATES.includes(row.primary_state), `${row.observed_identity}: invalid primary state`);
    assert(typeof row.primary_state === 'string', `${row.observed_identity}: primary state must be scalar`);
    assertUnique(row.secondary_flags, `${row.observed_identity} secondary flags`);
    assertSorted(row.secondary_flags, `${row.observed_identity} secondary flags`);
    if (row.entity_kind === 'record') assert(parseMetadataIdentity(row.observed_identity), `${row.observed_identity}: record identity is invalid`);
    if (row.primary_state === 'canonical_active' || row.primary_state === 'canonical_document') {
      assert(row.source_identity, `${row.observed_identity}: canonical state requires source identity`);
      assert(row.rights.complete, `${row.observed_identity}: canonical state requires complete rights/attribution`);
      assert(row.rights.attribution.length > 0, `${row.observed_identity}: canonical state requires attribution`);
    }
    if (row.systems.r2 && row.entity_kind === 'record') {
      assert(row.image.observed_r2_keys.length > 0, `${row.observed_identity}: R2 presence lacks an object key`);
    }
    if (!row.systems.r2 && row.entity_kind === 'record') {
      assert(row.image.observed_r2_keys.length === 0, `${row.observed_identity}: R2 absence has an object key`);
    }
  }
  assertRowConsistency({ reconciliation, local, d1, r2, r2Samples, text, clip });

  const corpusIds = corpus.map((row) => row.observed_identity);
  const expectedCorpusIds = reconciliation.filter((row) => row.entity_kind === 'record').map((row) => row.observed_identity);
  assert(stableJson(corpusIds) === stableJson(expectedCorpusIds), 'corpus manifest must exactly equal record-kind reconciliation rows');
  assertUnique(local.map((row) => row.metadata_filename), 'local metadata IDs');
  assertUnique(local.map((row) => row.image_filename), 'local image filenames');
  assertUnique(local.map((row) => row.resolved_image_filename), 'local resolved image filenames');
  for (const row of local) {
    const metadata = parseMetadataIdentity(row.metadata_filename);
    const image = parseArchiveImageKey(row.image_filename);
    const resolved = parseArchiveImageKey(row.resolved_image_filename);
    assert(metadata && image && resolved, `${row.metadata_filename}: local identity format failed`);
    assert(image.identity === metadata.identity && resolved.identity === metadata.identity, `${row.metadata_filename}: local image identity mismatch`);
    assert(row.source_urls.length > 0, `${row.metadata_filename}: local source URL is required`);
    assert(row.rights.attribution.length > 0, `${row.metadata_filename}: local attribution is required`);
  }

  assertUnique(d1.map((row) => row.metadata_filename), 'D1 metadata IDs');
  assertUnique(d1.map((row) => row.image_filename), 'D1 image filenames');
  assert(Number(d1Snapshot.aggregate_before?.row_count) === d1.length, 'D1 snapshot row count drifted');
  assert(Number(d1Snapshot.aggregate_before?.metadata_id_count) === new Set(d1.map((row) => row.metadata_filename)).size, 'D1 metadata distinct count drifted');
  assert(Number(d1Snapshot.aggregate_before?.image_id_count) === new Set(d1.map((row) => row.image_filename)).size, 'D1 image distinct count drifted');

  assertUnique(r2.map((row) => row.key), 'R2 keys');
  assert(Number(r2Snapshot.counts?.objects) === r2.length, 'R2 object count drifted');
  assert(Number(r2Snapshot.counts?.bytes) === r2.reduce((sum, row) => sum + row.size_bytes, 0), 'R2 byte count drifted');
  for (const kind of ['archive_image', 'social_content', 'content_asset', 'other']) {
    assert(Number(r2Snapshot.counts?.by_class?.[kind]) === r2.filter((row) => row.object_class === kind).length, `R2 ${kind} count drifted`);
  }
  assertUnique(r2Samples.map((row) => row.key), 'R2 sample keys');
  assert(Number(r2Snapshot.counts?.samples) === r2Samples.length, 'R2 sample count drifted');
  assert(Number(r2Snapshot.counts?.sample_failures) === r2Samples.filter((row) => !row.head_ok || !row.range_get_ok).length,
    'R2 sample failure count drifted');
  for (const sample of r2Samples) {
    assert(r2.some((row) => row.key === sample.key), `${sample.key}: sample is absent from exact R2 inventory`);
    if (sample.head_ok) assert(sample.content_length !== null, `${sample.key}: successful HEAD lacks content length`);
    if (sample.range_get_ok) assert(sample.sampled_bytes > 0 && sample.magic_kind !== 'unavailable', `${sample.key}: successful range GET lacks magic evidence`);
    const mapped = reconciliation.find((row) => row.image.observed_r2_keys.includes(sample.key));
    assert(mapped, `${sample.key}: sample does not map to reconciliation`);
    if (sample.content_type?.startsWith('image/') && sample.magic_kind === 'pdf') {
      assert(mapped.secondary_flags.includes('sampled_content_type_magic_mismatch'), `${sample.key}: content-type/magic mismatch is not flagged`);
    }
  }
  const expectedR2DuplicateGroups = new Map<string, R2InventoryRow[]>();
  for (const row of r2) {
    if (!row.etag) continue;
    const key = `${row.etag}\0${row.size_bytes}`;
    const group = expectedR2DuplicateGroups.get(key) ?? [];
    group.push(row);
    expectedR2DuplicateGroups.set(key, group);
  }
  const expectedDuplicateKeys = [...expectedR2DuplicateGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map((row) => row.key).sort())
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const actualDuplicateKeys = r2DuplicateCandidates.map((row) => {
    assert(row.basis === 'same_etag_and_size_candidate_only', `${row.candidate_group_id}: invalid R2 duplicate basis`);
    assert(row.payload_equality_claimed === false, `${row.candidate_group_id}: ETag candidate must not claim payload equality`);
    assertUnique(row.keys, `${row.candidate_group_id} keys`);
    assertSorted(row.keys, `${row.candidate_group_id} keys`);
    for (const key of row.keys) {
      const object = r2.find((candidate) => candidate.key === key);
      assert(object?.etag === row.etag && object.size_bytes === row.size_bytes, `${row.candidate_group_id}: key evidence mismatch`);
    }
    return row.keys;
  }).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  assert(stableJson(actualDuplicateKeys) === stableJson(expectedDuplicateKeys), 'R2 duplicate ETag+size candidates are not exactly enumerated');

  for (const [rows, snapshot, label] of [[text, textIndex, 'text'], [clip, clipIndex, 'clip']] as const) {
    assertUnique(rows.map((row) => row.id), `${label} vector IDs`);
    assertSorted(rows.map((row) => row.id), `${label} vector IDs`);
    assert(snapshot.pagination?.count_agreement === true, `${label} Vectorize pagination did not prove count agreement`);
    assert(snapshot.pagination?.enumerated_count === rows.length, `${label} Vectorize enumerated count drifted`);
    assert(snapshot.pagination?.reported_total_count === rows.length, `${label} Vectorize metadata count drifted`);
    assert(snapshot.pagination?.unique_count === rows.length, `${label} Vectorize unique count drifted`);
  }

  assertUnique(aliases.map((row) => row.alias_identity), 'alias identities');
  const byId = new Map(reconciliation.map((row) => [row.observed_identity, row]));
  for (const alias of aliases) {
    assert(alias.alias_identity !== alias.canonical_identity, `${alias.alias_identity}: self alias`);
    const alternate = byId.get(alias.alias_identity);
    const canonical = byId.get(alias.canonical_identity);
    assert(alternate?.primary_state === 'duplicate_or_alias', `${alias.alias_identity}: alias row state mismatch`);
    assert(canonical, `${alias.alias_identity}: alias target missing`);
    assert(canonical.primary_state !== 'duplicate_or_alias', `${alias.alias_identity}: alias target cannot be an alias`);
    assert(alternate.source_identity === canonical.source_identity && canonical.source_identity === alias.source_identity,
      `${alias.alias_identity}: alias source identity mismatch`);
    assert(stableJson(alias.alias_systems) === stableJson(alternate.systems), `${alias.alias_identity}: alias systems drifted`);
    assert(stableJson(alias.canonical_systems) === stableJson(canonical.systems), `${alias.alias_identity}: canonical alias systems drifted`);
    assert(alternate.alias?.canonical_identity === alias.canonical_identity, `${alias.alias_identity}: alias-map target drifted`);
    assert(alternate.secondary_flags.includes('alias_identity'), `${alias.alias_identity}: alias flag is missing`);
  }
  assert(aliases.length === reconciliation.filter((row) => row.alias !== null).length, 'alias map does not exactly enumerate row aliases');

  const expectedUnresolved = reconciliation.filter((row) => row.primary_state === 'unresolved_blocker');
  assert(stableJson(unresolved) === stableJson(expectedUnresolved), 'unresolved rows must be individually and exactly enumerated');
  const stateCounts = Object.fromEntries(PRIMARY_STATES.map((state) => [state, reconciliation.filter((row) => row.primary_state === state).length]));
  assert(Object.values(stateCounts).reduce((sum, count) => sum + count, 0) === reconciliation.length, 'state arithmetic does not sum to observed identities');
  for (const [state, count] of Object.entries(stateCounts)) {
    const samples = summary.samples?.by_primary_state?.[state] ?? [];
    assert(count === 0 || samples.length > 0, `${state}: populated state lacks a sample`);
    for (const identity of samples) assert(byId.get(identity)?.primary_state === state, `${state}: invalid state sample ${identity}`);
  }

  const expectedSummary = deriveExpectedSummary({
    local,
    localSnapshot,
    d1,
    d1Snapshot,
    r2,
    r2Samples,
    r2Snapshot,
    text,
    clip,
    textIndex,
    clipIndex,
    corpus,
    reconciliation,
    aliases,
    unresolved,
    r2DuplicateCandidates,
  });
  assert(stableJson(summary) === stableJson(expectedSummary), 'summary does not match complete derivation from verified snapshots and reconciliation artifacts');

  assert(artifactManifest.schema_version === SCHEMA_VERSION, 'artifact manifest schema version mismatch');
  assert(artifactManifest.source_snapshot_id === verifiedSource.source_snapshot_id, 'artifact source_snapshot_id drifted from verified source manifest');
  assert(stableJson(artifactManifest.lineage.inputs) === stableJson(verifiedSource.inputs),
    'artifact lineage inputs drifted from verified source manifest');
  const expectedArtifactPaths = GENERATED_OUTPUT_FILES.filter((name) => name !== 'artifact-manifest-v1.json');
  for (const artifact of artifactManifest.artifacts) assertRelativeLocator(artifact.path);
  assertUnique(artifactManifest.artifacts.map((artifact) => artifact.path), 'artifact manifest output paths');
  assert(stableJson(artifactManifest.artifacts.map((artifact) => artifact.path).sort()) === stableJson([...expectedArtifactPaths].sort()),
    'artifact manifest has unexpected or missing generated output');
  for (const artifact of artifactManifest.artifacts) {
    const filePath = resolveContainedFile(inputDir, artifact.path);
    const bytes = fs.readFileSync(filePath);
    assert(sha256(bytes) === artifact.sha256, `${artifact.path}: artifact SHA-256 drifted`);
    assert(bytes.byteLength === artifact.byte_count, `${artifact.path}: artifact byte count drifted`);
    if (artifact.row_count !== undefined) assert(fileRowCount(filePath) === artifact.row_count, `${artifact.path}: artifact row count drifted`);
  }
  assert(artifactManifest.arithmetic.observed_identity_rows === reconciliation.length, 'artifact observed row arithmetic drifted');
  assert(artifactManifest.arithmetic.state_total === reconciliation.length, 'artifact state arithmetic drifted');
  assert(artifactManifest.arithmetic.corpus_rows === corpus.length, 'artifact corpus arithmetic drifted');
  assert(artifactManifest.arithmetic.unresolved_rows === unresolved.length, 'artifact unresolved arithmetic drifted');
  assert(artifactManifest.arithmetic.alias_rows === aliases.length, 'artifact alias arithmetic drifted');

  const row9696 = byId.get('mtl_archives_metadata_9696.json');
  if (row9696) {
    assert(summary.decision_9696?.decision === row9696.primary_state, '9696 decision summary drifted');
    if (row9696.primary_state === 'duplicate_or_alias') {
      assert(summary.decision_9696?.canonical_identity === 'mtl_archives_metadata_9247.json', '9696 alias target must be 9247');
    }
  }

  return {
    status: 'ok',
    observed_identities: reconciliation.length,
    corpus_identities: corpus.length,
    aliases: aliases.length,
    unresolved: unresolved.length,
    states: stateCounts,
    artifact_count: artifactManifest.artifacts.length,
  };
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      mode: { type: 'string', default: 'live' },
      'input-manifest': { type: 'string' },
    },
  });
  assert(values.mode === 'live' || values.mode === 'fixture', `invalid mode: ${values.mode}`);
  console.log(stableJson(checkCanonicalCorpus(resolveCliPath(values.input!), {
    mode: values.mode,
    inputManifestPath: values['input-manifest'] ? resolveCliPath(values['input-manifest']) : undefined,
  })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
