import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PhashFeatureRow } from '../visual-family-graph-v1/model.js';

export const RECOVERY_SCHEMA_VERSION = 'canonical_image_recovery_v1.0.0' as const;
export const RECOVERY_TRANSFORM_CONTRACT = {
  version: 'canonical_image_recovery_transform_v1',
  accepted_sources: ['public_thumbnail', 'direct_public_r2', 'known_alias', 'registered_quality_derivative'],
  authoritative_source_transport: 'https_only_with_vetted_depot_upgrade',
  inspection_derivative: 'auto-oriented white-flattened contain-fit 256x256 JPEG q88 4:4:4',
  normalized_pixels: 'auto-oriented, white-flattened, contain-fit RGB 256x256',
  phash: '64-bit DCT pHash over auto-oriented, white-flattened, contain-fit grayscale 32x32',
  max_source_response_bytes: 134_217_728,
  source_payload_equality_claimed: false,
} as const;
export const RECOVERY_CONTRACT_ID = stableId('derivative-contract', [stableJson(RECOVERY_TRANSFORM_CONTRACT)]);
export const HISTORICAL_FAILURE_COUNT = 209;
export const HISTORICAL_FAILURE_STREAM_SHA256 = '62f266e28e26fe97d03c5bc17169e319f70a2ab07f7d87c4a5eaeb0bea4f046b';
export const HISTORICAL_ACQUISITION_SNAPSHOT_ID = '9235eb841d379f55973aa52f5558b264857bf35800871c85515a84bb227cb154';
export const HISTORICAL_CORPUS_INPUT_SHA256 = '0f9971c70ac242c44ee80835b4c71e9f771e742d8c80603cf39bc1163cc951cc';
export const HISTORICAL_FEATURE_SHA256 = '9210a6459275ce8ec571577eeab97abc50a6468c73cca988edaa7ccd554a732a';
export const PINNED_BASELINE_FEATURE_SHA256 = 'a50b8800b4cef7c57bc85169b152ab835687a7e9fe7dba2cc1664c3320718460';
export const PINNED_BASELINE_FAILURE_SHA256 = '283d8e519ef7a97d08976c3781cce26adeadc17f0369d24b3cab2cb46e276822';
export const PINNED_BASELINE_REPORT_SHA256 = '4646f74487bdec7a3a4b47494dc8eb88fe45111cc6111fe402e1770541d2757c';
export const BASELINE_DERIVATIVE_CONTRACT_ID = 'derivative-contract:870f1b571e0ecf6ea5e289dd63561c4fdc04a8c1a273ea87b684e14ba6070999';

export const ROOT_CAUSES = [
  'transient_thumbnail_api_failure',
  'incorrect_or_stale_image_key',
  'r2_object_absent',
  'source_object_reachable_but_r2_derivative_unavailable',
  'unsupported_non_image_payload',
  'corrupt_or_undecodable_image',
  'bounded_response_size_failure',
  'source_archive_unavailable',
  'rights_or_access_blocked',
  'indeterminate',
] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];
export type LaneName = 'public_thumbnail' | 'direct_public_r2' | 'known_alias' | 'authoritative_source' | 'registered_quality_derivative';
export type LaneOutcome = 'success' | 'http_error' | 'timeout' | 'size_cap' | 'unsafe_url' | 'non_image' | 'decode_failure' | 'not_attempted';

export type LaneEvidence = {
  attempt: number;
  lane: LaneName;
  outcome: LaneOutcome;
  url_class: string;
  http_status: number | null;
  content_type: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  evidence_code: string;
};

export type RecoveryRow = {
  schema_version: typeof RECOVERY_SCHEMA_VERSION;
  recovery_contract_id: string;
  baseline_failure_stream_sha256: string;
  corpus_input_sha256: string;
  record_id: string;
  image_key: string;
  canonical_identity: string;
  source_datasets: string[];
  source_record_ids: string[];
  attempted_lanes: LaneEvidence[];
  root_cause: RootCause;
  root_cause_evidence: string;
  disposition: 'recovered_public_r2' | 'recovered_alias' | 'recovered_authoritative_source' | 'reviewed_unavailable' | 'indeterminate' | 'held_over_contract';
  recovered: boolean;
  recovered_lane: LaneName | null;
  recovered_payload_sha256: string | null;
  recovery_payload_reuse_group_id: string | null;
  recovery_payload_hash_verified: boolean;
  derivative_path: string | null;
  derivative_sha256: string | null;
  normalized_pixel_sha256: string | null;
  phash64: string | null;
  source_payload_equality_claimed: false;
  negative_visual_label: false;
};

export function sha256(value: string | Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableId(prefix: string, values: string[]): string {
  return `${prefix}:${sha256(`${values.join('\0')}\n`)}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function failureIdStream(ids: string[]): string {
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  if (new Set(sorted).size !== sorted.length) throw new Error('baseline failure stream contains duplicate record IDs');
  return `${sorted.join('\n')}\n`;
}

export function verifyHistoricalBaseline(ids: string[]): string {
  const digest = sha256(failureIdStream(ids));
  if (ids.length !== HISTORICAL_FAILURE_COUNT || digest !== HISTORICAL_FAILURE_STREAM_SHA256) {
    throw new Error(`historical baseline drift: count=${ids.length} sha256=${digest}`);
  }
  return digest;
}

export function validateTrustedMixedContracts(features: PhashFeatureRow[], report: Record<string, any>, actualFeatureSha256: string): void {
  const lineage = report.recovery_lineage;
  if (!lineage || report.transform_contract?.derivative_contract_id !== BASELINE_DERIVATIVE_CONTRACT_ID
    || lineage.baseline_failure_record_id_stream_sha256 !== HISTORICAL_FAILURE_STREAM_SHA256
    || lineage.recovery_contract_id !== RECOVERY_CONTRACT_ID
    || stableJson(lineage.recovery_transform_contract) !== stableJson(RECOVERY_TRANSFORM_CONTRACT)
    || lineage.recovered_rows !== HISTORICAL_FAILURE_COUNT
    || report.lineage?.features?.sha256 !== actualFeatureSha256) throw new Error('trusted mixed-contract lineage mismatch');
  const baseline = features.filter((row) => row.derivative_contract_id === BASELINE_DERIVATIVE_CONTRACT_ID).length;
  const recovery = features.filter((row) => row.derivative_contract_id === RECOVERY_CONTRACT_ID).length;
  if (baseline !== 18_253 || recovery !== HISTORICAL_FAILURE_COUNT || baseline + recovery !== features.length) throw new Error('trusted mixed-contract distribution mismatch');
}

export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stable(value), null, 2)}\n`);
}

export function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(stable(row))).join('\n') + (rows.length ? '\n' : ''));
}

export function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as T; } catch { throw new Error(`${filePath}:${index + 1}: invalid JSON`); }
  });
}

export function validateResumeRows(rows: RecoveryRow[], expectedIds: string[], corpusInputSha256: string): void {
  const expected = new Set(expectedIds);
  if (new Set(rows.map((row) => row.record_id)).size !== rows.length) throw new Error('stale resume checkpoint: duplicate row');
  for (const row of rows) {
    if (!expected.has(row.record_id)) throw new Error(`${row.record_id}: stale resume checkpoint: record outside baseline`);
    if (row.schema_version !== RECOVERY_SCHEMA_VERSION) throw new Error(`${row.record_id}: stale resume checkpoint: schema mismatch`);
    if (row.recovery_contract_id !== RECOVERY_CONTRACT_ID) throw new Error(`${row.record_id}: stale resume checkpoint: contract mismatch`);
    if (row.baseline_failure_stream_sha256 !== HISTORICAL_FAILURE_STREAM_SHA256) throw new Error(`${row.record_id}: stale resume checkpoint: baseline mismatch`);
    if (row.corpus_input_sha256 !== corpusInputSha256) throw new Error(`${row.record_id}: stale resume checkpoint: corpus mismatch`);
    if (row.recovered !== true || !row.recovered_lane || !row.recovered_payload_sha256 || !row.derivative_path
      || !row.derivative_sha256 || !row.normalized_pixel_sha256 || !row.phash64) throw new Error(`${row.record_id}: stale resume checkpoint: inconsistent recovered row`);
    if (row.disposition === 'indeterminate' || row.disposition === 'held_over_contract' || row.disposition === 'reviewed_unavailable') throw new Error(`${row.record_id}: stale resume checkpoint: recovered disposition mismatch`);
    if (!/^[a-f0-9]{64}$/.test(row.recovered_payload_sha256) || !/^[a-f0-9]{64}$/.test(row.derivative_sha256)
      || !/^[a-f0-9]{64}$/.test(row.normalized_pixel_sha256) || !/^[a-f0-9]{16}$/.test(row.phash64)) throw new Error(`${row.record_id}: stale resume checkpoint: malformed hashes`);
  }
}

export function assertCompleteLedger(rows: RecoveryRow[], expectedIds: string[]): void {
  validateResumeRows(rows, expectedIds, HISTORICAL_CORPUS_INPUT_SHA256);
  const actual = rows.map((row) => row.record_id).sort();
  const expected = [...expectedIds].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) throw new Error('recovery ledger has omitted or unexpected rows');
  for (const row of rows) {
    if (!ROOT_CAUSES.includes(row.root_cause)) throw new Error(`${row.record_id}: invalid root cause`);
    if (!row.root_cause_evidence || row.attempted_lanes.length === 0) throw new Error(`${row.record_id}: unexplained outcome`);
    if (row.negative_visual_label !== false) throw new Error(`${row.record_id}: unavailable pixels cannot be a negative visual label`);
  }
}
