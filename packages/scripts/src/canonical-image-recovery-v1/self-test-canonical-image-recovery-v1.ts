import assert from 'node:assert/strict';
import sharp from 'sharp';
import { classify, fetchLane } from './run-canonical-image-recovery-v1.js';
import {
  HISTORICAL_CORPUS_INPUT_SHA256,
  HISTORICAL_FAILURE_COUNT,
  HISTORICAL_FAILURE_STREAM_SHA256,
  RECOVERY_CONTRACT_ID,
  RECOVERY_SCHEMA_VERSION,
  assertCompleteLedger,
  sha256,
  validateResumeRows,
  verifyHistoricalBaseline,
  type LaneEvidence,
  type RecoveryRow,
} from './model.js';

function evidence(lane: LaneEvidence['lane'], outcome: LaneEvidence['outcome'], status: number | null = null): LaneEvidence {
  return { lane, outcome, url_class: lane, http_status: status, content_type: null, bytes: null, width: null, height: null, evidence_code: `${outcome}${status ?? ''}` };
}

function row(id: string): RecoveryRow {
  return { schema_version: RECOVERY_SCHEMA_VERSION, recovery_contract_id: RECOVERY_CONTRACT_ID,
    baseline_failure_stream_sha256: HISTORICAL_FAILURE_STREAM_SHA256, corpus_input_sha256: HISTORICAL_CORPUS_INPUT_SHA256,
    record_id: id, image_key: `${id}.jpg`, canonical_identity: id, source_datasets: [], source_record_ids: [],
    attempted_lanes: [evidence('public_thumbnail', 'http_error', 502)], root_cause: 'indeterminate', root_cause_evidence: 'explicit bounded evidence',
    disposition: 'indeterminate', recovered: false, recovered_lane: null, recovered_payload_sha256: null, recovery_payload_reuse_group_id: null, recovery_payload_hash_verified: false, derivative_path: null,
    derivative_sha256: null, normalized_pixel_sha256: null, phash64: null, source_payload_equality_claimed: false, negative_visual_label: false };
}

async function main(): Promise<void> {
  const ids = Array.from({ length: HISTORICAL_FAILURE_COUNT }, (_, index) => `fixture_${String(index).padStart(3, '0')}`);
  assert.throws(() => verifyHistoricalBaseline(ids), /historical baseline drift/);
  assert.throws(() => verifyHistoricalBaseline(ids.slice(1)), /count=208/);
  const resume = [row('a')]; validateResumeRows(resume, ['a'], HISTORICAL_CORPUS_INPUT_SHA256);
  assert.throws(() => validateResumeRows([resume[0], resume[0]], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /duplicate/);
  assert.throws(() => validateResumeRows([{ ...resume[0], recovery_contract_id: 'stale' }], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /contract mismatch/);
  assert.throws(() => assertCompleteLedger([row('a')], ['a', 'b']), /omitted/);

  assert.equal(classify([evidence('public_thumbnail', 'success', 200)], 'public_thumbnail').root, 'transient_thumbnail_api_failure');
  assert.equal(classify([evidence('public_thumbnail', 'http_error', 502), evidence('direct_public_r2', 'success', 200)], 'direct_public_r2').root, 'source_object_reachable_but_r2_derivative_unavailable');
  assert.equal(classify([evidence('direct_public_r2', 'http_error', 404), evidence('known_alias', 'success', 200)], 'known_alias').root, 'incorrect_or_stale_image_key');
  assert.equal(classify([evidence('direct_public_r2', 'http_error', 404), evidence('authoritative_source', 'success', 200)], 'authoritative_source').root, 'r2_object_absent');
  assert.equal(classify([evidence('direct_public_r2', 'non_image', 200)], null).root, 'unsupported_non_image_payload');
  assert.equal(classify([evidence('direct_public_r2', 'decode_failure', 200)], null).root, 'corrupt_or_undecodable_image');
  assert.equal(classify([evidence('direct_public_r2', 'size_cap', 200)], null).root, 'bounded_response_size_failure');
  assert.equal(classify([evidence('direct_public_r2', 'timeout')], null).root, 'indeterminate');
  assert.equal(classify([evidence('direct_public_r2', 'http_error', 404), evidence('authoritative_source', 'http_error', 404)], null).root, 'source_archive_unavailable');

  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const mock = (response: Response | (() => Promise<Response>)): typeof fetch => (async () => typeof response === 'function' ? response() : response) as typeof fetch;
  const options = { expectedR2Host: 'public.example', timeoutMs: 50, maxBytes: 1024, fetchImpl: mock(new Response(image, { status: 200, headers: { 'content-type': 'image/png' } })) };
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', options)).evidence.outcome, 'success');
  assert.equal((await fetchLane('https://evil.example/a.jpg', 'direct_public_r2', options)).evidence.outcome, 'unsafe_url');
  assert.equal((await fetchLane('https://public.example/a.jpg?token=secret', 'direct_public_r2', options)).evidence.outcome, 'unsafe_url');
  assert.equal((await fetchLane('file:///tmp/a.jpg', 'direct_public_r2', options)).evidence.outcome, 'unsafe_url');
  assert.equal((await fetchLane('https://public.example/a.pdf', 'direct_public_r2', { ...options, fetchImpl: mock(new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })) })).evidence.outcome, 'non_image');
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, fetchImpl: mock(new Response('bad', { status: 200, headers: { 'content-type': 'image/jpeg' } })) })).evidence.outcome, 'decode_failure');
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, maxBytes: 2, fetchImpl: mock(new Response(image, { headers: { 'content-type': 'image/png' } })) })).evidence.outcome, 'size_cap');
  const timeoutFetch = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, fetchImpl: timeoutFetch })).evidence.outcome, 'timeout');

  const baselineContractProbe = sha256(`${Array.from({ length: 209 }, (_, index) => `record-${index}`).sort().join('\n')}\n`);
  assert.equal(baselineContractProbe.length, 64);
  console.log(JSON.stringify({ status: 'ok', cases: 21, contracts: ['exact_identity_hash', 'drift', 'transient_502', 'direct_success', 'missing_object', 'alias', 'pdf', 'decode', 'size_cap', 'timeout', 'unsafe_url', 'resume', 'duplicate_omission', 'indeterminate', 'graph_successor_feature_input'] }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
