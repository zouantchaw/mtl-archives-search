import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvImport from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import {
  BENCHMARK_V1_SCHEMA,
  buildAcquisitionQueue,
  buildCandidateReport,
  auditComponentSplits,
  summarizeRetrieval,
  validateCandidateReport,
  type CandidateReport,
} from './build-benchmark-v1-candidate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const schemaPath = path.join(root, 'docs/dataset-factory/benchmark-v1-candidate.schema.json');
const Ajv = AjvImport as unknown as new (options: Record<string, unknown>) => { compile: (schema: unknown) => (value: unknown) => boolean; errorsText: () => string };

const splitRows = [
  { record_id: 'a', component_id: 'component-1', benchmark_split: 'train' as const },
  { record_id: 'b', component_id: 'component-1', benchmark_split: 'train' as const },
  { record_id: 'c', component_id: 'component-2', benchmark_split: 'test' as const },
];
const firstAudit = auditComponentSplits(splitRows);
assert.equal(firstAudit.crossings, 0);
assert.equal(auditComponentSplits([...splitRows].reverse()).sha256, firstAudit.sha256);
assert.throws(() => auditComponentSplits([...splitRows, splitRows[0]]), /duplicate split record/);
assert.throws(() => auditComponentSplits([...splitRows, { ...splitRows[2], record_id: 'd', component_id: 'component-1', benchmark_split: 'validation' }]), /component crosses benchmark splits/);

const retrieval = summarizeRetrieval([
  { task_id: 'gold-1', slice: 'scene_text', judgment_source: 'reviewed_gold' },
  { task_id: 'silver-1', slice: 'scene_text', judgment_source: 'research_enrichment_silver' },
  { task_id: 'stress-1', slice: 'hard_negative', judgment_source: 'stress_only' },
]);
assert.deepEqual(
  { reviewed_gold: retrieval.reviewed_gold, silver: retrieval.silver, stress: retrieval.stress },
  { reviewed_gold: 1, silver: 1, stress: 1 },
);
assert.throws(() => summarizeRetrieval([{ task_id: 'same' }, { task_id: 'same' }]), /duplicate retrieval task/);
assert.equal(buildAcquisitionQueue(26, {
  entity_place: { total: 57, reviewed_gold: 13, silver: 44, stress: 0 },
  metadata_title: { total: 4, reviewed_gold: 3, silver: 1, stress: 0 },
  reranker_required: { total: 2, reviewed_gold: 2, silver: 0, stress: 0 },
  scene_text: { total: 3, reviewed_gold: 3, silver: 0, stress: 0 },
  text_in_image: { total: 9, reviewed_gold: 5, silver: 4, stress: 0 },
}).length, 74);

const report = buildCandidateReport({
  goldRoot: path.join(root, 'data/does-not-exist/gold'),
  graphMap: path.join(root, 'data/does-not-exist/graph-map.jsonl'),
  retrievalTasks: path.join(root, 'data/does-not-exist/retrieval.jsonl'),
  verifiedIntelligence: path.join(root, 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/published-benchmark-tasks-v1.json'),
  graphEvidence: path.join(root, 'docs/dataset-factory/visual-family-graph-v1-evidence.json'),
  canonicalEvidence: path.join(root, 'docs/dataset-factory/artifact-registry.v0.jsonl'),
  goldDescriptor: path.join(root, 'docs/dataset-factory/fixtures/gold-label-batch-002/final-bundle-v1.json'),
  generatedAt: '2026-08-31T12:00:00.000Z',
});
validateCandidateReport(report);
assert.equal(report.schema_version, BENCHMARK_V1_SCHEMA);
assert.equal(report.state, 'preflight_blocked');
assert.equal(report.lock_authority, false);
assert.equal(report.issue_70_complete, false);
assert.equal(report.retrieval_shortfall.shortfall, 100);
assert.equal(report.acquisition_queue.rows.length, 100);

const tamperedRetrieval = path.join(root, 'docs/dataset-factory/fixtures/benchmark-v1-candidate/tampered-retrieval.self-test.jsonl');
fs.writeFileSync(tamperedRetrieval, `${JSON.stringify({ task_id: 'tampered', slice: 'scene_text', judgment_source: 'reviewed_gold' })}\n`);
try {
  const tampered = buildCandidateReport({
    goldRoot: path.join(root, 'data/does-not-exist/gold'),
    graphMap: path.join(root, 'data/does-not-exist/graph-map.jsonl'),
    retrievalTasks: tamperedRetrieval,
    verifiedIntelligence: path.join(root, 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/published-benchmark-tasks-v1.json'),
    graphEvidence: path.join(root, 'docs/dataset-factory/visual-family-graph-v1-evidence.json'),
    canonicalEvidence: path.join(root, 'docs/dataset-factory/artifact-registry.v0.jsonl'),
    goldDescriptor: path.join(root, 'docs/dataset-factory/fixtures/gold-label-batch-002/final-bundle-v1.json'),
    generatedAt: '2026-08-31T12:00:00.000Z',
  });
  assert.equal(tampered.inputs.retrieval_tasks.status, 'hash_mismatch');
  assert.match(tampered.blockers.join('\n'), /retrieval_tasks hash\/member mismatch/);
} finally {
  fs.unlinkSync(tamperedRetrieval);
}

const ajv = new Ajv({ allErrors: true, strict: false });
const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
assert.equal(validate(report), true, ajv.errorsText());
assert.throws(() => validateCandidateReport({ ...report, lock_authority: true } as unknown as CandidateReport), /cannot assert lock authority/);

console.log(JSON.stringify({ status: 'benchmark_v1_candidate_self_test_passed', cases: 14 }));
