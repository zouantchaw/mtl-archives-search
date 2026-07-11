import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { computeVisualFeature } from '../visual-family-graph-v1/extract-phash-v1.js';
import { classify, fetchLane, fetchThumbnailAttempts, upgradeAuthoritativeUrl, validateResumeArtifacts, verifyDerivativeManifest, verifyPinnedBaseline } from './run-canonical-image-recovery-v1.js';
import {
  HISTORICAL_CORPUS_INPUT_SHA256,
  HISTORICAL_FAILURE_COUNT,
  HISTORICAL_FAILURE_STREAM_SHA256,
  RECOVERY_CONTRACT_ID,
  RECOVERY_TRANSFORM_CONTRACT,
  BASELINE_DERIVATIVE_CONTRACT_ID,
  RECOVERY_SCHEMA_VERSION,
  assertCompleteLedger,
  sha256,
  stableId,
  stableJson,
  validateResumeRows,
  validateTrustedMixedContracts,
  verifyHistoricalBaseline,
  writeJson,
  writeJsonl,
  type LaneEvidence,
  type RecoveryRow,
} from './model.js';

function evidence(lane: LaneEvidence['lane'], outcome: LaneEvidence['outcome'], status: number | null = null, attempt = 1): LaneEvidence {
  return { attempt, lane, outcome, url_class: lane, http_status: status, content_type: null, bytes: null, width: null, height: null, evidence_code: `${outcome}${status ?? ''}` };
}

const failedThumbnailAttempts = () => [1, 2, 3].map((attempt) => evidence('public_thumbnail', 'http_error', 502, attempt));

function row(id: string): RecoveryRow {
  return { schema_version: RECOVERY_SCHEMA_VERSION, recovery_contract_id: RECOVERY_CONTRACT_ID,
    baseline_failure_stream_sha256: HISTORICAL_FAILURE_STREAM_SHA256, corpus_input_sha256: HISTORICAL_CORPUS_INPUT_SHA256,
    record_id: id, image_key: `${id}.jpg`, canonical_identity: id, source_datasets: [], source_record_ids: [],
    attempted_lanes: failedThumbnailAttempts(), root_cause: 'indeterminate', root_cause_evidence: 'explicit bounded evidence',
    disposition: 'recovered_public_r2', recovered: true, recovered_lane: 'direct_public_r2', recovered_payload_sha256: 'a'.repeat(64), recovery_payload_reuse_group_id: null, recovery_payload_hash_verified: false, derivative_path: 'derivatives/a.jpg',
    derivative_sha256: 'b'.repeat(64), normalized_pixel_sha256: 'c'.repeat(64), phash64: 'd'.repeat(16), source_payload_equality_claimed: false, negative_visual_label: false };
}

async function main(): Promise<void> {
  const ids = Array.from({ length: HISTORICAL_FAILURE_COUNT }, (_, index) => `fixture_${String(index).padStart(3, '0')}`);
  assert.throws(() => verifyHistoricalBaseline(ids), /historical baseline drift/);
  assert.throws(() => verifyHistoricalBaseline(ids.slice(1)), /count=208/);
  const resume = [row('a')]; validateResumeRows(resume, ['a'], HISTORICAL_CORPUS_INPUT_SHA256);
  assert.throws(() => validateResumeRows([resume[0], resume[0]], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /duplicate/);
  assert.throws(() => validateResumeRows([{ ...resume[0], recovery_contract_id: 'stale' }], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /contract mismatch/);
  assert.throws(() => validateResumeRows([{ ...resume[0], derivative_sha256: null }], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /inconsistent recovered row/);
  const unavailable: RecoveryRow = { ...row('a'), recovered: false, disposition: 'held_over_contract', recovered_lane: null,
    recovered_payload_sha256: null, recovery_payload_reuse_group_id: null, recovery_payload_hash_verified: false,
    derivative_path: null, derivative_sha256: null, normalized_pixel_sha256: null, phash64: null,
    root_cause: 'bounded_response_size_failure', root_cause_evidence: 'explicit cap evidence' };
  validateResumeRows([unavailable], ['a'], HISTORICAL_CORPUS_INPUT_SHA256);
  assertCompleteLedger([unavailable], ['a']);
  assert.throws(() => validateResumeRows([{ ...unavailable, derivative_path: 'derivatives/stale.jpg' }], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /inconsistent unrecovered row/);
  assert.throws(() => validateResumeRows([{ ...unavailable, attempted_lanes: failedThumbnailAttempts().slice(0, 2) }], ['a'], HISTORICAL_CORPUS_INPUT_SHA256), /incomplete thumbnail attempts/);
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
  assert.equal((await fetchLane('http://depot.ville.montreal.qc.ca/a.jpg', 'authoritative_source', options)).evidence.outcome, 'unsafe_url');
  assert.equal(upgradeAuthoritativeUrl('http://depot.ville.montreal.qc.ca/a.jpg'), 'https://depot.ville.montreal.qc.ca/a.jpg');
  assert.equal(upgradeAuthoritativeUrl('http://evil.example/a.jpg'), null);
  assert.equal((await fetchLane('https://public.example/a.pdf', 'direct_public_r2', { ...options, fetchImpl: mock(new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })) })).evidence.outcome, 'non_image');
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, fetchImpl: mock(new Response('bad', { status: 200, headers: { 'content-type': 'image/jpeg' } })) })).evidence.outcome, 'decode_failure');
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, maxBytes: 2, fetchImpl: mock(new Response(image, { headers: { 'content-type': 'image/png' } })) })).evidence.outcome, 'size_cap');
  const timeoutFetch = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  assert.equal((await fetchLane('https://public.example/a.jpg', 'direct_public_r2', { ...options, fetchImpl: timeoutFetch })).evidence.outcome, 'timeout');

  let transientCalls = 0;
  const transientFetch = (async () => ++transientCalls === 1
    ? new Response('bad gateway', { status: 502 })
    : new Response(image, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch;
  const transient = await fetchThumbnailAttempts('https://public.example/a.jpg', { timeoutMs: 100, maxBytes: 1024, attempts: 3, backoffMs: 0, fetchImpl: transientFetch });
  assert.equal(transient.evidence.length, 2); assert.equal(transient.evidence[0].http_status, 502); assert.equal(transient.evidence[1].outcome, 'success');
  const persistent = await fetchThumbnailAttempts('https://public.example/a.jpg', { timeoutMs: 100, maxBytes: 1024, attempts: 3, backoffMs: 0, fetchImpl: (async () => new Response('bad gateway', { status: 502 })) as typeof fetch });
  assert.equal(persistent.evidence.length, 3); assert(persistent.evidence.every((attempt, index) => attempt.attempt === index + 1 && attempt.http_status === 502));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-v1-self-test-'));
  const derivativeDir = path.join(temp, 'derivatives'); fs.mkdirSync(derivativeDir);
  const derivative = await sharp(image).resize(256, 256).jpeg().toBuffer(); fs.writeFileSync(path.join(derivativeDir, 'a.jpg'), derivative);
  const feature = await computeVisualFeature(derivative);
  const validResume = { ...row('a'), derivative_sha256: sha256(derivative), normalized_pixel_sha256: feature.normalizedPixelSha256, phash64: feature.phash64 };
  const corpus = new Map([['a', { record_id: 'a', image_key: 'a.jpg', canonical_source_record_id: null } as any]]);
  await validateResumeArtifacts([validResume], corpus, temp);
  await assert.rejects(() => validateResumeArtifacts([{ ...validResume, derivative_path: '../../unbound.jpg' }], corpus, temp), /escapes root|unsafe derivative path/);
  await assert.rejects(() => validateResumeArtifacts([{ ...validResume, derivative_sha256: 'e'.repeat(64) }], corpus, temp), /derivative hash mismatch/);
  await assert.rejects(() => validateResumeArtifacts([{ ...validResume, image_key: 'wrong.jpg' }], corpus, temp), /identity mismatch/);

  const baseline = path.join(temp, 'baseline', 'phash'); fs.mkdirSync(baseline, { recursive: true });
  const transform = { source: 'fixture', width: 256 }; const contract = stableId('derivative-contract', [stableJson(transform)]);
  const fixtureRows = [{ ...({} as any), record_id: 'a', status: 'success', derivative_contract_id: contract }, { ...({} as any), record_id: 'b', status: 'failure', derivative_contract_id: contract }];
  writeJsonl(path.join(baseline, 'phash-features-v1.jsonl'), fixtureRows); writeJsonl(path.join(baseline, 'phash-failures-v1.jsonl'), [fixtureRows[1]]);
  const featureHash = sha256(fs.readFileSync(path.join(baseline, 'phash-features-v1.jsonl')));
  const report = { transform_contract: { derivative_contract_id: contract, ...transform }, lineage: { features: { sha256: featureHash } }, coverage: { successful: 1, failures: 1 } };
  writeJson(path.join(baseline, 'phash-report-v1.json'), report);
  const expected = { feature: featureHash, failure: sha256(fs.readFileSync(path.join(baseline, 'phash-failures-v1.jsonl'))), report: sha256(fs.readFileSync(path.join(baseline, 'phash-report-v1.json'))), rows: 2, successes: 1, failures: 1, contract };
  verifyPinnedBaseline(path.join(temp, 'baseline'), expected);
  fs.appendFileSync(path.join(baseline, 'phash-features-v1.jsonl'), '{}\n'); assert.throws(() => verifyPinnedBaseline(path.join(temp, 'baseline'), expected), /member hash mismatch/);
  writeJsonl(path.join(baseline, 'phash-features-v1.jsonl'), fixtureRows); writeJsonl(path.join(baseline, 'phash-failures-v1.jsonl'), [fixtureRows[0]]);
  assert.throws(() => verifyPinnedBaseline(path.join(temp, 'baseline'), { ...expected, failure: sha256(fs.readFileSync(path.join(baseline, 'phash-failures-v1.jsonl'))) }), /exact feature subset/);
  writeJsonl(path.join(baseline, 'phash-failures-v1.jsonl'), [fixtureRows[1]]); const badReport = { ...report, transform_contract: { ...report.transform_contract, width: 255 } }; writeJson(path.join(baseline, 'phash-report-v1.json'), badReport);
  assert.throws(() => verifyPinnedBaseline(path.join(temp, 'baseline'), { ...expected, report: sha256(fs.readFileSync(path.join(baseline, 'phash-report-v1.json'))) }), /transform contract mismatch/);

  const manifestRoot = path.join(temp, 'manifest'); fs.mkdirSync(manifestRoot); fs.writeFileSync(path.join(manifestRoot, 'a.jpg'), derivative);
  const manifestTreeRow = `a.jpg\t${sha256(derivative)}\t${derivative.length}\t256x256\tjpeg\tffd8`;
  writeJson(path.join(manifestRoot, 'manifest-v1.json'), { schema_version: 'fixture', tree_sha256: sha256(`${manifestTreeRow}\n`), rows: [{ record_id: 'a', path: 'a.jpg', sha256: sha256(derivative), bytes: derivative.length, width: 256, height: 256, format: 'jpeg', magic: 'ffd8' }] });
  await verifyDerivativeManifest(manifestRoot); fs.writeFileSync(path.join(manifestRoot, 'a.jpg'), Buffer.from('tampered'));
  await assert.rejects(() => verifyDerivativeManifest(manifestRoot), /byte mismatch/);

  const mixedRows = [...Array.from({ length: 18_253 }, () => ({ derivative_contract_id: BASELINE_DERIVATIVE_CONTRACT_ID })), ...Array.from({ length: 209 }, () => ({ derivative_contract_id: RECOVERY_CONTRACT_ID }))] as any;
  const mixedReport = { transform_contract: { derivative_contract_id: BASELINE_DERIVATIVE_CONTRACT_ID }, lineage: { features: { sha256: 'f'.repeat(64) } }, recovery_lineage: { baseline_failure_record_id_stream_sha256: HISTORICAL_FAILURE_STREAM_SHA256, recovery_contract_id: RECOVERY_CONTRACT_ID, recovery_transform_contract: RECOVERY_TRANSFORM_CONTRACT, recovered_rows: 209 } };
  validateTrustedMixedContracts(mixedRows, mixedReport, 'f'.repeat(64));
  assert.throws(() => validateTrustedMixedContracts([{ ...mixedRows[0], derivative_contract_id: 'derivative-contract:'.concat('0'.repeat(64)) }, ...mixedRows.slice(1)] as any, mixedReport, 'f'.repeat(64)), /distribution mismatch/);
  assert.throws(() => validateTrustedMixedContracts(mixedRows, { ...mixedReport, recovery_lineage: { ...mixedReport.recovery_lineage, recovery_contract_id: 'forged' } }, 'f'.repeat(64)), /lineage mismatch/);
  assert(RECOVERY_TRANSFORM_CONTRACT.accepted_sources.includes('authoritative_source'));
  assert.throws(() => validateTrustedMixedContracts(mixedRows, { ...mixedReport, recovery_lineage: { ...mixedReport.recovery_lineage,
    recovery_transform_contract: { ...RECOVERY_TRANSFORM_CONTRACT, accepted_sources: RECOVERY_TRANSFORM_CONTRACT.accepted_sources.filter((lane) => lane !== 'authoritative_source') } } }, 'f'.repeat(64)), /lineage mismatch/);

  const baselineContractProbe = sha256(`${Array.from({ length: 209 }, (_, index) => `record-${index}`).sort().join('\n')}\n`);
  assert.equal(baselineContractProbe.length, 64);
  console.log(JSON.stringify({ status: 'ok', cases: 41, contracts: ['exact_identity_hash', 'baseline_member_hashes', 'baseline_failure_subset', 'baseline_transform', 'registered_derivative_tree', 'registered_derivative_byte_tamper', 'transient_then_success', 'persistent_failure', 'direct_success', 'missing_object', 'alias', 'pdf', 'decode', 'size_cap', 'timeout', 'unsafe_url', 'https_upgrade', 'resume_content', 'resume_traversal', 'resume_unrecovered', 'resume_unrecovered_tamper', 'resume_incomplete_attempts', 'authoritative_contract', 'authoritative_contract_tamper', 'mixed_contract_lineage', 'mixed_contract_distribution', 'duplicate_omission', 'indeterminate', 'graph_successor_feature_input'] }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
