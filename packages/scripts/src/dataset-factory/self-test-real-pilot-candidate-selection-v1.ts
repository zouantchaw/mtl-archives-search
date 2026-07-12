import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import sharp from 'sharp';
import { MONOREPO_ROOT } from './verified-multimodal-batch-001-contract.js';
import { EXCLUSION_SCHEMA_VERSION, SELECTION_SCHEMA_VERSION, SUCCESSOR_GRAPH_CONTRACT_SHA256, assertApprovedHash, assertSuccessorContract, mechanicalReasons, normalizedUrlSet, safeSourceUrl, selectCandidates, sha256, verifyDerivativeBytes, verifyDescriptorMembers, type JoinedCandidate } from './real-pilot-candidate-selection-v1.js';

function row(id: number, patch: Partial<JoinedCandidate> = {}): JoinedCandidate {
  return { record_id: `mtl_archives_metadata_${id}.json`, numeric_id: id, name: id === 0 ? 'Rue Saint-Antoine Magic Baking Powder' : `Rue Test ${id}`,
    description: 'A metadata description with an édifice and an enseigne for acquisition ranking only; it is not a verified claim.', date: '1920', cote: `VM94-${id}`,
    corpus_state: 'canonical', corpus_rights_complete: true, corpus_attribution: 'Archives de la Ville de Montréal', local_rights_complete: true,
    local_attribution: 'Archives de la Ville de Montréal', source_identity: `https://archive.example/${id}.jpg`, source_identity_sha256: `${id}`.padStart(64, '0'), source_urls: [`https://archive.example/${id}.jpg`],
    component_id: `component-${id}`, map_split: 'train', graph_split: 'train', component_size: 1, node_phash_status: 'success', derivative_path: `../../../canonical/derivatives/${id}.jpg`,
    derivative_sha256: `d${id}`.padEnd(64, '0'), derivative_bytes: 100, derivative_width: 256, derivative_height: 256, derivative_decode_ok: true, recovery_recovered: true,
    recovery_disposition: 'recovered_authoritative_source', normalized_pixel_sha256: `a${id}`.padEnd(64, '0'), recovered_payload_sha256: `b${id}`.padEnd(64, '0'), semantic_join_ok: true, ...patch };
}
function excludedReason(rows: JoinedCandidate[], reason: string): void { assert(selectCandidates(rows).exclusions.some((item) => item.reasons.includes(reason)), `missing exclusion ${reason}`); }

const ordered = selectCandidates([row(2), row(0), row(1)], 1); const reversed = selectCandidates([row(1), row(0), row(2)], 1);
assert.deepEqual(ordered, reversed, 'selection must be independent of input order');
assert.equal(ordered.candidates.find((item) => item.numeric_id === 0)?.declared_anchor, true);
assert.equal(ordered.candidates.every((item) => item.verified_claim_count === 0 && item.proxy_boundary === 'ranking_only_not_verified'), true);
assert.equal(ordered.candidates.every((item) => item.schema_version === SELECTION_SCHEMA_VERSION), true);
assert.equal(ordered.exclusions.every((item) => item.schema_version === EXCLUSION_SCHEMA_VERSION), true);
assert.equal(ordered.candidates.filter((item) => item.selection_bucket === 'ranked_pool').length, 1, 'pool is broad policy input, not final selection logic');
assert(ordered.candidates.some((item) => item.selection_bucket === 'reserve'));

excludedReason([row(3, { corpus_state: '' })], 'not_canonical_real_state');
excludedReason([row(3, { corpus_rights_complete: false })], 'incomplete_canonical_rights_or_attribution');
excludedReason([row(3, { derivative_path: '' })], 'derivative_unavailable');
excludedReason([row(3, { derivative_decode_ok: false })], 'decode_or_visual_feature_failure');
excludedReason([row(3, { component_id: '' })], 'missing_authoritative_component');
excludedReason([row(3, { graph_split: 'test' })], 'authoritative_split_mismatch');
excludedReason([row(3, { source_identity: '', source_identity_sha256: '' })], 'missing_source_identity');
excludedReason([row(3, { source_urls: ['https://archive.example/x.jpg?token=secret'] })], 'unsafe_or_missing_source_url');
excludedReason([row(3, { semantic_join_ok: false })], 'semantic_join_mismatch');
excludedReason([row(3), row(4, { component_id: 'component-3' })], 'duplicate_component_identity');
excludedReason([row(3, { source_identity: 'http://depot.ville.montreal.qc.ca/a.jpg', source_urls: ['http://depot.ville.montreal.qc.ca/a.jpg'] }), row(4, { source_identity: 'https://depot.ville.montreal.qc.ca/a.jpg', source_urls: ['https://depot.ville.montreal.qc.ca/a.jpg'] })], 'duplicate_source_identity');
excludedReason([row(3), row(4, { normalized_pixel_sha256: row(3).normalized_pixel_sha256 })], 'duplicate_image_or_payload_identity');
assert.equal(safeSourceUrl('javascript:alert(1)'), false); assert.equal(safeSourceUrl('https://user:pass@example.org/a'), false); assert.equal(safeSourceUrl('https://example.org/a#x'), false);
assert.equal(safeSourceUrl('http://example.org/a'), false); assert.equal(safeSourceUrl('https://127.0.0.1/a'), false); assert.equal(safeSourceUrl('https://169.254.1.1/a'), false); assert.equal(safeSourceUrl('https://localhost/a'), false); assert.equal(safeSourceUrl('https://example.org:8443/a'), false);
assert.equal(safeSourceUrl('https://[fe80::1]/a'), false); assert.equal(safeSourceUrl('https://[fd00::1]/a'), false);
for (const url of ['https://0.0.0.0/a','https://100.64.0.1/a','https://192.0.2.1/a','https://198.18.0.1/a','https://198.51.100.1/a','https://203.0.113.1/a','https://224.0.0.1/a','https://240.0.0.1/a','https://[::]/a','https://[::ffff:192.168.1.1]/a','https://[2001:db8::1]/a','https://[ff00::1]/a']) assert.equal(safeSourceUrl(url), false, url);
for (const url of ['https://[100:0:0:1::]/a','https://[3fff::1]/a','https://[5f00::1]/a','https://8.8.8.8/a']) assert.equal(safeSourceUrl(url), false, url);
assert.equal(safeSourceUrl('http://depot.ville.montreal.qc.ca/a.jpg'), true);
assert.deepEqual(normalizedUrlSet(['http://depot.ville.montreal.qc.ca/a b.jpg','https://depot.ville.montreal.qc.ca/a%20b.jpg']), ['https://depot.ville.montreal.qc.ca/a%20b.jpg']);
assert.notDeepEqual(normalizedUrlSet(['https://example.org/a.jpg']), normalizedUrlSet(['https://example.org/b.jpg']));
assert(mechanicalReasons(row(9)).length === 0);
assertSuccessorContract(SUCCESSOR_GRAPH_CONTRACT_SHA256); assert.throws(() => assertSuccessorContract('a'.repeat(64)), /contract digest mismatch/);
assertApprovedHash(Buffer.from('approved'), sha256('approved'), 'fixture'); assert.throws(() => assertApprovedHash(Buffer.from('tampered'), sha256('approved'), 'fixture'), /approved hash drift/);
const jpeg = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#123456' } }).jpeg().toBuffer();
const derivative = { sha256: sha256(jpeg), bytes: jpeg.length, width: 4, height: 3, format: 'jpeg', magic: 'ffd8' };
await verifyDerivativeBytes(jpeg, derivative);
const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));
await assert.rejects(verifyDerivativeBytes(truncated, { ...derivative, bytes: truncated.length, sha256: sha256(truncated) }));
await assert.rejects(verifyDerivativeBytes(jpeg, { ...derivative, bytes: jpeg.length + 1 }), /byte length/);
await assert.rejects(verifyDerivativeBytes(jpeg, { ...derivative, sha256: 'a'.repeat(64) }), /hash/);
const memberData = Buffer.from('deterministic output\n'); const member = { path: 'out.txt', bytes: memberData.length, sha256: sha256(memberData) };
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue69-selection-')), fixtureOut = path.join(fixtureRoot, 'output'); fs.mkdirSync(fixtureOut); fs.writeFileSync(path.join(fixtureOut, member.path), memberData);
const descriptor = { output_root: 'output', successor_contract_sha256: SUCCESSOR_GRAPH_CONTRACT_SHA256, members: [member], counts: { files: 1, bytes: memberData.length }, tree_sha256: sha256(`out.txt\t${member.bytes}\t${member.sha256}\n`) };
verifyDescriptorMembers(fixtureRoot, descriptor);
fs.writeFileSync(path.join(fixtureOut, member.path), 'tampered\n'); assert.throws(() => verifyDescriptorMembers(fixtureRoot, descriptor), /member drift/); fs.writeFileSync(path.join(fixtureOut, member.path), memberData);
assert.throws(() => verifyDescriptorMembers(fixtureRoot, { ...descriptor, tree_sha256: 'a'.repeat(64) }), /tree digest/);
fs.writeFileSync(path.join(fixtureOut, 'extra.txt'), 'extra'); assert.throws(() => verifyDescriptorMembers(fixtureRoot, descriptor), /exact output membership/); fs.rmSync(path.join(fixtureOut, 'extra.txt'));
assert.throws(() => verifyDescriptorMembers(fixtureRoot, { ...descriptor, members: [member, member], counts: { files: 2, bytes: member.bytes * 2 } }), /duplicate descriptor/);
assert.throws(() => verifyDescriptorMembers(fixtureRoot, { ...descriptor, members: [{ ...member, path: '../escape' }] }), /unsafe descriptor member/); fs.rmSync(fixtureRoot, { recursive: true, force: true });
const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue69-linked-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'issue69-outside-')); fs.writeFileSync(path.join(outside, 'out.txt'), memberData); fs.symlinkSync(outside, path.join(linkedRoot, 'linked'));
assert.throws(() => verifyDescriptorMembers(linkedRoot, { ...descriptor, output_root: 'linked' }), /symlinked descriptor output ancestor/); fs.rmSync(linkedRoot, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => { compile(schema: object): (value: unknown) => boolean };
const schemaDir = path.join(MONOREPO_ROOT, 'docs/dataset-factory/schemas/real-pilot-candidate-selection-v1'); const ajv = new Ajv2020({ allErrors: true, strict: true });
(addFormatsImport as unknown as (instance: object) => void)(ajv);
const candidateSchema = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, 'candidate.schema.v1.json'), 'utf8')) as object);
const reportSchema = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, 'selection-report.schema.v1.json'), 'utf8')) as object);
assert(candidateSchema(ordered.candidates[0]), 'candidate schema rejected valid row');
assert.equal(candidateSchema({ ...ordered.candidates[0], verified_claim_count: 1 }), false, 'schema accepted a verified claim');
assert.equal(candidateSchema({ ...ordered.candidates[0], unexpected: true }), false, 'schema accepted an additional property');
const realReportPath = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/verified_multimodal_batch_001_real_pilot/selection/selection-report-v1.json');
if (fs.existsSync(realReportPath)) { const realReport = JSON.parse(fs.readFileSync(realReportPath, 'utf8')) as object; assert(reportSchema(realReport), 'real report schema rejected'); assert.equal(reportSchema({ ...realReport, unexpected: true }), false, 'report schema accepted additional property'); }

console.log(JSON.stringify({ status: 'ok', adversarial_cases: 54, deterministic_candidates: ordered.candidates.length, full_decode_probes: 4, descriptor_tamper_probes: 6, approved_hash_drift_probes: 1 }));
