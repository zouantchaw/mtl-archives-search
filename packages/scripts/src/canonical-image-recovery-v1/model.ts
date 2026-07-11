import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RECOVERY_SCHEMA_VERSION = 'canonical_image_recovery_v1.0.0' as const;
export const RECOVERY_CONTRACT_ID = 'canonical-image-recovery-contract:5cb12956cc58a0bc7ff9d4e1e32350fb58e26eb0471f059736ef1bb4b09e30dd';
export const HISTORICAL_FAILURE_COUNT = 209;
export const HISTORICAL_FAILURE_STREAM_SHA256 = '62f266e28e26fe97d03c5bc17169e319f70a2ab07f7d87c4a5eaeb0bea4f046b';
export const HISTORICAL_ACQUISITION_SNAPSHOT_ID = '9235eb841d379f55973aa52f5558b264857bf35800871c85515a84bb227cb154';
export const HISTORICAL_CORPUS_INPUT_SHA256 = '0f9971c70ac242c44ee80835b4c71e9f771e742d8c80603cf39bc1163cc951cc';
export const HISTORICAL_FEATURE_SHA256 = '9210a6459275ce8ec571577eeab97abc50a6468c73cca988edaa7ccd554a732a';

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
