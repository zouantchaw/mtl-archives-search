import fs from 'node:fs';
import path from 'node:path';
import type { ValidateFunction } from 'ajv';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { deterministicSplit } from '../visual-family-graph-v1/model.js';
import {
  MONOREPO_ROOT, VMI_FIXTURE_DIR, canonicalJson, deriveBenchmarkTasks, deriveRunReport, fileSha256,
  readJsonl, rejectedClaims, syntheticPackets, unresolvedClaims, validateBenchmarkTasks, validatePacket,
  type BenchmarkTask, type RunReport, type VerifiedMultimodalPacket,
} from './verified-multimodal-batch-001-contract.js';

const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => { compile(schema: object): ValidateFunction };
const addFormats = addFormatsImport as unknown as (ajv: object) => void;
const schemaDir = path.join(MONOREPO_ROOT, 'docs/dataset-factory/schemas/verified-multimodal-batch-001');

function loadValidator(name: string): ValidateFunction {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf-8')) as object);
}

function assertSchema(validator: ValidateFunction, value: unknown, label: string): void {
  if (!validator(value)) throw new Error(`${label}: ${JSON.stringify(validator.errors)}`);
}

function expectFailure(label: string, mutate: (packet: VerifiedMultimodalPacket) => void): void {
  const packet = structuredClone(syntheticPackets()[0]);
  mutate(packet);
  try { validatePacket(packet); } catch { return; }
  throw new Error(`Expected fail-closed validation for ${label}`);
}

function expectSchemaFailure(label: string, mutate: (packet: VerifiedMultimodalPacket) => void): void {
  const packet = structuredClone(syntheticPackets()[0]);
  mutate(packet);
  if (packetSchema(packet)) throw new Error(`Expected packet schema failure for ${label}`);
}

function expectDerivationFailure(label: string, mutate: (packet: VerifiedMultimodalPacket) => void): void {
  const packet = structuredClone(syntheticPackets()[0]);
  mutate(packet);
  try { deriveBenchmarkTasks([packet]); } catch { return; }
  throw new Error(`Expected benchmark derivation failure for ${label}`);
}

function expectBenchmarkFailure(label: string, tasks: BenchmarkTask[]): void {
  try { validateBenchmarkTasks(tasks); } catch { return; }
  throw new Error(`Expected benchmark validation failure for ${label}`);
}

const runReportDigestControl = {
  packet_sha256: 'a'.repeat(64), benchmark_sha256: 'b'.repeat(64),
  unresolved_sha256: 'c'.repeat(64), rejected_sha256: 'd'.repeat(64),
};

function expectRunReportFailure(
  label: string,
  packets: VerifiedMultimodalPacket[],
  tasks: BenchmarkTask[],
  digests = runReportDigestControl,
): void {
  try { deriveRunReport(packets, tasks, digests); } catch { return; }
  throw new Error(`Expected run-report derivation failure for ${label}`);
}

const packetSchema = loadValidator('packet.schema.v1.json');
const benchmarkSchema = loadValidator('benchmark-task.schema.v1.json');
const reportSchema = loadValidator('run-report.schema.v1.json');
for (const packet of syntheticPackets()) { validatePacket(packet); assertSchema(packetSchema, packet, packet.record_id); }

expectFailure('visual claim without region', (packet) => { packet.evidence[0].region_id = null; });
expectFailure('synthetic external evidence', (packet) => { packet.evidence[0].boundary = 'externally_verified'; });
expectFailure('incomplete rights', (packet) => { packet.rights_attribution.attribution = ' '; });
expectFailure('non-external verified status', (packet) => { packet.visual_observations[0].verified_status = 'externally_verified'; });
expectFailure('exact location without accepted external georeference', (packet) => { packet.visual_observations[0].exact_location = true; });
expectFailure('area without accepted external scale', (packet) => { packet.visual_observations[0].asserts_area_or_distance = true; });
expectFailure('blank reviewer ID', (packet) => { packet.review_state.reviewer_ids[1] = ' '; });
expectFailure('reviewer overlap', (packet) => { packet.review_state.reviewer_ids[1] = packet.review_state.reviewer_ids[0]; });
expectFailure('benchmark from unresolved inference', (packet) => { packet.inferred_hypotheses[0].benchmark_eligible = true; });
expectFailure('claim in wrong boundary collection', (packet) => { packet.visual_observations[0].boundary = 'source_metadata'; });
expectFailure('metadata evidence without field', (packet) => { packet.evidence.find((item) => item.boundary === 'source_metadata')!.source_metadata_field = ' '; });
expectFailure('non-metadata evidence with metadata field', (packet) => { packet.evidence[0].source_metadata_field = 'title'; });
expectFailure('invalid confidence enum', (packet) => { packet.visual_observations[0].confidence = 'certain' as never; });
expectFailure('blank primary reviewer ID', (packet) => { packet.review_state.reviewer_ids[0] = ' '; });
expectFailure('blank adjudicator ID', (packet) => { packet.review_state.reviewer_ids[2] = ' '; });
expectFailure('adjudicator-primary overlap', (packet) => { packet.review_state.reviewer_ids[2] = packet.review_state.reviewer_ids[0]; });
expectFailure('adjudicator-independent overlap', (packet) => { packet.review_state.reviewer_ids[2] = packet.review_state.reviewer_ids[1]; });
expectFailure('invalid review state status', (packet) => { packet.review_state.status = 'approved' as never; });
expectFailure('invalid region kind', (packet) => { packet.regions[0].kind = 'circle' as never; });
expectFailure('metadata field does not exist', (packet) => { packet.evidence.find((item) => item.boundary === 'source_metadata')!.source_metadata_field = 'missing_field'; });
expectFailure('metadata field is null', (packet) => { packet.evidence.find((item) => item.boundary === 'source_metadata')!.source_metadata_field = 'archive_record_url'; });
expectFailure('unused synthetic external evidence', (packet) => { packet.evidence.push({ evidence_id: 'unused-external', boundary: 'externally_verified', region_id: null, external_source_url: 'https://example.org/source', external_source_note: 'Independent source note.', source_metadata_field: null, georeference_or_scale_basis: null }); });
expectFailure('blank record ID', (packet) => { packet.record_id = ' '; });
expectFailure('invalid packet lane', (packet) => { packet.lane = 'other' as never; });
expectFailure('empty regions', (packet) => { packet.regions = []; });
expectFailure('empty evidence', (packet) => { packet.evidence = []; });
expectFailure('empty claims', (packet) => { packet.visual_observations = []; packet.source_metadata_claims = []; packet.inferred_hypotheses = []; packet.externally_verified_claims = []; packet.rejected_hypotheses = []; });
expectFailure('blank claim ID', (packet) => { packet.visual_observations[0].claim_id = ' '; });
expectFailure('blank claim text', (packet) => { packet.visual_observations[0].text = ' '; });
expectFailure('blank abstention target', (packet) => { packet.abstentions[0].target = ' '; });
expectFailure('blank abstention reason', (packet) => { packet.abstentions[0].reason = ' '; });
expectFailure('blank abstention boundary', (packet) => { packet.abstentions[0].evidence_boundary = ' '; });
expectFailure('whole image with bbox', (packet) => { packet.regions[0].bbox_xyxy_pct = [0, 0, 10, 10]; });
expectFailure('reversed bbox endpoints', (packet) => { packet.regions[1].bbox_xyxy_pct = [90, 10, 20, 10]; });
expectSchemaFailure('bbox endpoint outside percentage range', (packet) => { packet.regions[1].bbox_xyxy_pct = [90, 10, 110, 20]; });
expectDerivationFailure('promoted inference claim bypass', (packet) => {
  const promoted = packet.inferred_hypotheses[0];
  promoted.boundary = 'externally_verified'; promoted.verified_status = 'externally_verified'; promoted.review_status = 'accepted'; promoted.benchmark_eligible = true;
});

expectSchemaFailure('inference in visual_observations', (packet) => { packet.visual_observations[0].boundary = 'inference'; });
expectSchemaFailure('metadata evidence without real field', (packet) => { packet.evidence.find((item) => item.boundary === 'source_metadata')!.source_metadata_field = 'missing_field'; });
expectSchemaFailure('visual evidence carrying georef basis', (packet) => { packet.evidence[0].georeference_or_scale_basis = { basis_type: 'georeference', description: 'Three accepted control points.', control_point_ids: ['cp-1', 'cp-2', 'cp-3'] }; });
expectSchemaFailure('unused external evidence', (packet) => { packet.evidence.push({ evidence_id: 'unused-external', boundary: 'externally_verified', region_id: null, external_source_url: 'https://example.org/source', external_source_note: 'Independent source note.', source_metadata_field: null, georeference_or_scale_basis: null }); });

const invalidPacket = { ...syntheticPackets()[0], unexpected: true };
if (packetSchema(invalidPacket)) throw new Error('packet schema must reject additional properties');
const invalidReport = { schema_version: 'verified_multimodal_run_report_v1.0.0', unexpected: true };
if (reportSchema(invalidReport)) throw new Error('run-report schema must enforce required fields/additionalProperties');
const invalidBenchmark = { schema_version: 'verified_multimodal_benchmark_task_v1.0.0', split: 'holdout' };
if (benchmarkSchema(invalidBenchmark)) throw new Error('benchmark schema must enforce required fields/enums');
const benchmarkControl: BenchmarkTask = {
  schema_version: 'verified_multimodal_benchmark_task_v1.0.0', task_id: 'control-1', record_id: 'real-1', lane: 'ground_ocr_entity_place', query: 'control query',
  positive_claim_ids: ['claim-1'], positive_record_ids: ['real-1'], evidence_boundary: 'externally_verified', source_urls: ['https://example.org/source'],
  family_id: 'family-1', component_id: 'component-1', split: deterministicSplit('component-1'), source_snapshot_digest: 'a'.repeat(64),
};
expectBenchmarkFailure('blank task ID', [{ ...benchmarkControl, task_id: ' ' }]);
expectBenchmarkFailure('blank record ID', [{ ...benchmarkControl, record_id: ' ' }]);
expectBenchmarkFailure('blank query', [{ ...benchmarkControl, query: ' ' }]);
expectBenchmarkFailure('empty positive claim IDs', [{ ...benchmarkControl, positive_claim_ids: [] }]);
expectBenchmarkFailure('empty positive record IDs', [{ ...benchmarkControl, positive_record_ids: [] }]);
expectBenchmarkFailure('invalid benchmark lane', [{ ...benchmarkControl, lane: 'other' as never }]);
expectBenchmarkFailure('duplicate source URLs', [{ ...benchmarkControl, source_urls: ['https://example.org/source', 'https://example.org/source'] }]);
expectBenchmarkFailure('duplicate task IDs', [benchmarkControl, { ...benchmarkControl, record_id: 'real-2' }]);
expectBenchmarkFailure('duplicate record claim identities', [benchmarkControl, { ...benchmarkControl, task_id: 'control-2' }]);
const sameComponentDifferentFamily = { ...benchmarkControl, task_id: 'control-2', family_id: 'family-2', positive_claim_ids: ['claim-2'] };
validateBenchmarkTasks([benchmarkControl, sameComponentDifferentFamily]);
if (benchmarkControl.split !== sameComponentDifferentFamily.split || benchmarkControl.split !== deterministicSplit(benchmarkControl.component_id)) {
  throw new Error('families in one component did not share the authoritative split');
}
validateBenchmarkTasks([benchmarkControl]);
try { validateBenchmarkTasks([benchmarkControl, { ...benchmarkControl, task_id: 'control-2', positive_claim_ids: ['claim-2'], split: benchmarkControl.split === 'test' ? 'train' : 'test' }]); throw new Error('component split mismatch accepted'); } catch (error) {
  if (error instanceof Error && error.message === 'component split mismatch accepted') throw error;
}
try { validateBenchmarkTasks([{ ...benchmarkControl, source_snapshot_digest: ' ' }]); throw new Error('blank snapshot digest accepted'); } catch (error) {
  if (error instanceof Error && error.message === 'blank snapshot digest accepted') throw error;
}
for (const suffix of ['?token=secret', '#fragment']) {
  const unstable = { ...benchmarkControl, source_urls: [`https://example.org/source${suffix}`] };
  try { validateBenchmarkTasks([unstable]); throw new Error(`runtime accepted URL suffix ${suffix}`); } catch (error) {
    if (error instanceof Error && error.message === `runtime accepted URL suffix ${suffix}`) throw error;
  }
  if (benchmarkSchema(unstable)) throw new Error(`benchmark schema accepted URL suffix ${suffix}`);
}

const realPacket = structuredClone(syntheticPackets()[0]);
realPacket.record_id = 'hermetic-real-contract-control';
realPacket.pilot_scope = 'canonical_real_slice';
realPacket.synthetic_fixture = false;
realPacket.source_metadata.source_kind = 'canonical_real';
realPacket.source_metadata.archive_record_url = 'https://example.org/archive/record-1';
realPacket.rights_attribution.rights_url = 'https://example.org/rights/license';
realPacket.evidence.push({ evidence_id: 'external-control', boundary: 'externally_verified', region_id: null, external_source_url: 'https://example.org/evidence/source-1', external_source_note: 'Hermetic contract-only external evidence control.', source_metadata_field: null, georeference_or_scale_basis: null });
realPacket.externally_verified_claims.push({ claim_id: 'external-claim-control', lane: realPacket.lane, text: 'Hermetic real-packet contract control claim.', boundary: 'externally_verified', evidence_ids: ['external-control'], confidence: 'high', alternatives: [], verified_status: 'externally_verified', review_status: 'accepted', review_flags: [], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: true });
realPacket.evidence.push({ evidence_id: 'external-control-2', boundary: 'externally_verified', region_id: null, external_source_url: 'https://example.org/evidence/source-2', external_source_note: 'Second hermetic contract-only external evidence control.', source_metadata_field: null, georeference_or_scale_basis: null });
realPacket.externally_verified_claims.push({ claim_id: 'external-claim-control-2', lane: realPacket.lane, text: 'Second hermetic real-packet contract control claim.', boundary: 'externally_verified', evidence_ids: ['external-control-2'], confidence: 'high', alternatives: [], verified_status: 'externally_verified', review_status: 'accepted', review_flags: [], exact_location: false, asserts_area_or_distance: false, benchmark_eligible: true });
validatePacket(realPacket);
const realTasks = deriveBenchmarkTasks([realPacket]);
if (realTasks.length !== 2 || realTasks.map((task) => task.positive_claim_ids[0]).join(',') !== 'external-claim-control,external-claim-control-2') throw new Error('valid two-claim canonical real packet did not derive exactly two benchmark tasks');
if (realTasks.some((task) => task.split !== deterministicSplit(realPacket.source_metadata.component_id))) throw new Error('single-component real tasks disagree with authoritative split');
const needsReviewPacket = structuredClone(realPacket);
needsReviewPacket.review_state.status = 'needs_review';
try { deriveBenchmarkTasks([needsReviewPacket]); throw new Error('needs_review real packet derived a benchmark task'); } catch (error) {
  if (error instanceof Error && error.message === 'needs_review real packet derived a benchmark task') throw error;
}
try { deriveBenchmarkTasks([realPacket, structuredClone(realPacket)]); throw new Error('duplicate real packet record ID accepted'); } catch (error) {
  if (error instanceof Error && error.message === 'duplicate real packet record ID accepted') throw error;
}
const exactLocationPacket = structuredClone(realPacket);
exactLocationPacket.externally_verified_claims[0].exact_location = true;
exactLocationPacket.evidence.find((item) => item.evidence_id === 'external-control')!.georeference_or_scale_basis = { basis_type: 'georeference', description: 'Three independently identified map control points.', control_point_ids: ['cp-1', 'cp-2', 'cp-3'] };
validatePacket(exactLocationPacket);
const insufficientControlPoints = structuredClone(exactLocationPacket);
insufficientControlPoints.evidence.find((item) => item.evidence_id === 'external-control')!.georeference_or_scale_basis!.control_point_ids = ['cp-1', 'cp-2'];
try { validatePacket(insufficientControlPoints); throw new Error('exact location accepted fewer than three control points'); } catch (error) {
  if (error instanceof Error && error.message === 'exact location accepted fewer than three control points') throw error;
}
expectDerivationFailure('invalid canonical real rights provenance', (packet) => { packet.synthetic_fixture = false; packet.pilot_scope = 'canonical_real_slice'; packet.source_metadata.source_kind = 'canonical_real'; packet.source_metadata.archive_record_url = 'https://example.org/archive/record'; packet.rights_attribution.rights_url = null; });
const malformedReportPacket = structuredClone(syntheticPackets()[0]);
malformedReportPacket.record_id = ' ';
expectRunReportFailure('malformed packet input', [malformedReportPacket], []);
expectRunReportFailure('malformed benchmark task input', syntheticPackets(), [{ ...benchmarkControl, query: ' ' }]);
expectRunReportFailure('canonical real packet input', [realPacket], []);
expectRunReportFailure('empty packet set', [], []);
const duplicateReportPacket = structuredClone(syntheticPackets()[0]);
expectRunReportFailure('duplicate packet record IDs', [duplicateReportPacket, structuredClone(duplicateReportPacket)], []);
expectRunReportFailure('short digest', syntheticPackets(), [], { ...runReportDigestControl, packet_sha256: 'a'.repeat(63) });
expectRunReportFailure('uppercase digest', syntheticPackets(), [], { ...runReportDigestControl, benchmark_sha256: 'A'.repeat(64) });
expectRunReportFailure('non-hex digest', syntheticPackets(), [], { ...runReportDigestControl, rejected_sha256: 'z'.repeat(64) });

const fixtureDir = path.join(MONOREPO_ROOT, VMI_FIXTURE_DIR);
const packetsPath = path.join(fixtureDir, 'packets.v1.jsonl');
const benchmarkPath = path.join(fixtureDir, 'benchmark-tasks.v1.jsonl');
const unresolvedPath = path.join(fixtureDir, 'unresolved-queue.v1.jsonl');
const rejectedPath = path.join(fixtureDir, 'rejected-hypotheses.v1.jsonl');
const reportPath = path.join(fixtureDir, 'run-report.v1.json');
const packets = readJsonl<VerifiedMultimodalPacket>(packetsPath);
const benchmark = readJsonl<BenchmarkTask>(benchmarkPath);
const unresolved = readJsonl(unresolvedPath);
const rejected = readJsonl(rejectedPath);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as RunReport;
for (const packet of packets) { validatePacket(packet); assertSchema(packetSchema, packet, packet.record_id); }
for (const task of benchmark) assertSchema(benchmarkSchema, task, task.task_id);
validateBenchmarkTasks(benchmark);
assertSchema(reportSchema, report, 'run report');

const derivedBenchmark = deriveBenchmarkTasks(packets);
if (canonicalJson(derivedBenchmark) !== canonicalJson(benchmark)) throw new Error('stale benchmark queue');
if (canonicalJson(unresolvedClaims(packets)) !== canonicalJson(unresolved)) throw new Error('stale unresolved queue');
if (canonicalJson(rejectedClaims(packets)) !== canonicalJson(rejected)) throw new Error('stale rejected queue');
const digests = {
  packet_sha256: fileSha256(packetsPath), benchmark_sha256: fileSha256(benchmarkPath),
  unresolved_sha256: fileSha256(unresolvedPath), rejected_sha256: fileSha256(rejectedPath),
};
for (const [field, digest] of Object.entries(digests)) {
  if (report[field as keyof RunReport] !== digest) throw new Error(`run report ${field} drift`);
}
const recomputedReport = deriveRunReport(packets, benchmark, digests);
if (canonicalJson(recomputedReport) !== canonicalJson(report)) throw new Error('run report counts or gates are stale');
if (benchmark.length !== 0 || packets.some((packet) => packet.externally_verified_claims.length !== 0)) {
  throw new Error('synthetic foundation must have zero verified and benchmark outputs');
}

console.log(JSON.stringify({ status: 'ok', adversarial_cases: 76, schemas_checked: 3, digests_checked: 4, canonical_real_tasks: realTasks.length, fixture_checked: true, verified_claims: 0, benchmark_tasks: 0 }));
