import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import {
  PRIMARY_STATES,
  SCHEMA_VERSION,
  parseArchiveImageKey,
  parseMetadataIdentity,
  readJson,
  readJsonl,
  sha256,
  stableJson,
  type LocalInventoryRow,
  type R2InventoryRow,
  type R2SampleRow,
} from './model.js';
import type { ReconciliationRow } from './build-canonical-corpus-v1.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_INPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/canonical_corpus_v1/live');
const ROW_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-row.schema.v1.json');
const ARTIFACT_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-artifact-manifest.schema.v1.json');
const ALIAS_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-alias.schema.v1.json');
const R2_DUPLICATE_SCHEMA_PATH = path.join(MONOREPO_ROOT, 'docs/dataset-factory/canonical-corpus-r2-duplicate-candidate.schema.v1.json');

function resolveCliPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

type VectorRow = { id: string; normalized_identity: string | null; valid_identity: boolean };
type D1Row = { metadata_filename: string; image_filename: string; resolved_image_filename?: string | null } & Record<string, unknown>;
type IndexSnapshot = { pagination?: { enumerated_count?: number; reported_total_count?: number; unique_count?: number; count_agreement?: boolean } };
type D1Snapshot = { aggregate_before?: { row_count?: number; metadata_id_count?: number; image_id_count?: number } };
type R2Snapshot = { counts?: { objects?: number; bytes?: number; by_class?: Record<string, number>; samples?: number; sample_failures?: number } };
type Summary = {
  counts?: Record<string, number>;
  states?: Record<string, number>;
  samples?: { by_primary_state?: Record<string, string[]> };
  decision_9696?: { decision?: string; canonical_identity?: string | null; evidence?: Record<string, unknown> };
};
type ArtifactManifest = {
  schema_version: string;
  arithmetic: { observed_identity_rows: number; state_total: number; corpus_rows: number; unresolved_rows: number; alias_rows: number };
  artifacts: Array<{ path: string; sha256: string; byte_count: number; row_count?: number }>;
};
type AliasRow = { alias_identity: string; canonical_identity: string; source_identity: string; payload_etag_match: boolean | null };
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

export function checkCanonicalCorpus(inputDir: string): Record<string, unknown> {
  const local = readJsonl<LocalInventoryRow>(path.join(inputDir, 'local-manifest.jsonl'));
  const d1 = readJsonl<D1Row>(path.join(inputDir, 'd1-manifest.jsonl'));
  const r2 = readJsonl<R2InventoryRow>(path.join(inputDir, 'r2-objects.jsonl'));
  const r2Samples = readJsonl<R2SampleRow>(path.join(inputDir, 'r2-samples.jsonl'));
  const text = readJsonl<VectorRow>(path.join(inputDir, 'text-vector-ids.jsonl'));
  const clip = readJsonl<VectorRow>(path.join(inputDir, 'clip-vector-ids.jsonl'));
  const textIndex = readJson<IndexSnapshot>(path.join(inputDir, 'text-vector-index.json'));
  const clipIndex = readJson<IndexSnapshot>(path.join(inputDir, 'clip-vector-index.json'));
  const d1Snapshot = readJson<D1Snapshot>(path.join(inputDir, 'd1-snapshot.json'));
  const r2Snapshot = readJson<R2Snapshot>(path.join(inputDir, 'r2-snapshot.json'));
  const corpus = readJsonl<ReconciliationRow>(path.join(inputDir, 'corpus-manifest-v1.jsonl'));
  const reconciliation = readJsonl<ReconciliationRow>(path.join(inputDir, 'reconciliation-v1.jsonl'));
  const aliases = readJsonl<AliasRow>(path.join(inputDir, 'alias-map-v1.jsonl'));
  const unresolved = readJsonl<ReconciliationRow>(path.join(inputDir, 'unresolved-v1.jsonl'));
  const r2DuplicateCandidates = readJsonl<R2DuplicateCandidateRow>(path.join(inputDir, 'r2-payload-duplicate-candidates-v1.jsonl'));
  const summary = readJson<Summary>(path.join(inputDir, 'summary-v1.json'));
  const artifactManifest = readJson<ArtifactManifest>(path.join(inputDir, 'artifact-manifest-v1.json'));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateRow = ajv.compile<ReconciliationRow>(readJson<Record<string, unknown>>(ROW_SCHEMA_PATH));
  const validateArtifact = ajv.compile<ArtifactManifest>(readJson<Record<string, unknown>>(ARTIFACT_SCHEMA_PATH));
  const validateAlias = ajv.compile<AliasRow>(readJson<Record<string, unknown>>(ALIAS_SCHEMA_PATH));
  const validateR2Duplicate = ajv.compile<R2DuplicateCandidateRow>(readJson<Record<string, unknown>>(R2_DUPLICATE_SCHEMA_PATH));
  for (const row of reconciliation) {
    assert(validateRow(row), `${row.observed_identity}: row schema failed: ${schemaError(validateRow.errors)}`);
  }
  assert(validateArtifact(artifactManifest), `artifact manifest schema failed: ${schemaError(validateArtifact.errors)}`);
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
  }

  const expectedUnresolved = reconciliation.filter((row) => row.primary_state === 'unresolved_blocker');
  assert(stableJson(unresolved) === stableJson(expectedUnresolved), 'unresolved rows must be individually and exactly enumerated');
  const stateCounts = Object.fromEntries(PRIMARY_STATES.map((state) => [state, reconciliation.filter((row) => row.primary_state === state).length]));
  assert(stableJson(summary.states) === stableJson(stateCounts), 'summary state arithmetic drifted');
  assert(Object.values(stateCounts).reduce((sum, count) => sum + count, 0) === reconciliation.length, 'state arithmetic does not sum to observed identities');
  for (const [state, count] of Object.entries(stateCounts)) {
    const samples = summary.samples?.by_primary_state?.[state] ?? [];
    assert(count === 0 || samples.length > 0, `${state}: populated state lacks a sample`);
    for (const identity of samples) assert(byId.get(identity)?.primary_state === state, `${state}: invalid state sample ${identity}`);
  }

  assert(artifactManifest.schema_version === SCHEMA_VERSION, 'artifact manifest schema version mismatch');
  for (const artifact of artifactManifest.artifacts) {
    const filePath = path.resolve(inputDir, artifact.path);
    assert(fs.existsSync(filePath), `artifact file is missing: ${artifact.path}`);
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
    options: { input: { type: 'string', default: DEFAULT_INPUT } },
  });
  console.log(stableJson(checkCanonicalCorpus(resolveCliPath(values.input!))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
