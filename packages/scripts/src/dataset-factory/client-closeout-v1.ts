import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

type J = any;
type Source = {
  phaseStatus: J;
  phaseSelection: J;
  gateGStatus: J;
  gateGReview: J;
  gateGDossiers: J;
  gateHMetrics: J;
  gateHFalsePrecision: J;
  gateHMatrix: J;
  gateHStatus: J;
  gateHTaskReview: J;
  gateHPublishedTasks: J;
  gateH2Status: J;
  gateH2Matrix: J;
  h2Builder: J;
  h2Linux: J;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURE = path.join(ROOT, 'docs/dataset-factory/fixtures/client-closeout-v1');
const MANIFEST = path.join(FIXTURE, 'manifest-v1.json');
const SCHEMA = path.join(ROOT, 'docs/dataset-factory/schemas/client-closeout-v1.schema.json');

const REL = {
  phaseStatus: 'docs/dataset-factory/fixtures/phase-d-scale-v1/status-report-v1.json',
  phaseSelection: 'docs/dataset-factory/fixtures/phase-d-scale-v1/candidate-selection-evidence-v1.json',
  gateGStatus: 'docs/dataset-factory/fixtures/verified-dossiers-publication-v1/publication-status-v1.json',
  gateGReview: 'docs/dataset-factory/fixtures/verified-dossiers-publication-v1/independent-dossier-review-v1.json',
  gateGDossiers: 'docs/dataset-factory/fixtures/verified-dossiers-publication-v1/published-dossiers-v1.json',
  gateHMetrics: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/reviewed-metrics-v1.json',
  gateHFalsePrecision: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/false-precision-cases-v1.json',
  gateHMatrix: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/final-criterion-matrix-v1.json',
  gateHStatus: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/publication-status-v1.json',
  gateHTaskReview: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/independent-task-review-v1.json',
  gateHPublishedTasks: 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/published-benchmark-tasks-v1.json',
  gateH2Status: 'docs/dataset-factory/fixtures/reviewed-metrics-v2/candidate-status-v2.json',
  gateH2Matrix: 'docs/dataset-factory/fixtures/reviewed-metrics-v2/candidate-criterion-matrix-v2.json',
  h2Builder: 'docs/dataset-factory/fixtures/gate-h2-builder-receipts-v1/synthetic-comparison.json',
  h2Linux: 'docs/dataset-factory/fixtures/gate-h2-linux-conformance-v1/run-evidence.json',
} as const;

const REGISTRY_ID = 'dfv0_client_closeout_v1_20260831';
const EXPECTED_EVIDENCE: Record<string, { path: string; sha256: string; bytes: number; role: string }> = {
  phase_d_status: { path: REL.phaseStatus, sha256: '5778afc0e2033055a0d74a362ac98d726e8c2917783c2618b1ee4102f059fc47', bytes: 937, role: 'client_ready' },
  phase_d_selection: { path: REL.phaseSelection, sha256: 'd6aec52d39d83a3fda645d56f101890ad176b3e1851851b2787db98d2645f78d', bytes: 4243798, role: 'client_ready' },
  gate_g_status: { path: REL.gateGStatus, sha256: '84370bb42e7f99700b3dcf5a600ba38a9fa461bea987472cbd08cd39d994c527', bytes: 824, role: 'client_ready' },
  gate_g_review: { path: REL.gateGReview, sha256: '22f476ec148e45283f66e3dbf838934929f6f56aaf34248241e2630b7a91e2cc', bytes: 50658, role: 'client_ready' },
  gate_g_dossiers: { path: REL.gateGDossiers, sha256: '92cc7feff1704918883afc578c6393ca1eb708a6971bcf195f09e317044c8425', bytes: 434863, role: 'client_ready' },
  gate_h_metrics: { path: REL.gateHMetrics, sha256: '88c73267a73264d8aaf629f43a7927dfd801ebf6f63dda4645cf8656b3d140ef', bytes: 225454, role: 'research_pending' },
  gate_h_false_precision: { path: REL.gateHFalsePrecision, sha256: '244a04b6974f7724d19c07c02ce56cd356c6eca0d2bea6b01eae7eb20adaf967', bytes: 4208, role: 'client_ready' },
  gate_h_matrix: { path: REL.gateHMatrix, sha256: 'c54fcb468e143c8870ce2a705baaeb9f18afc07e9919a5c38c6ba5c41b3699ad', bytes: 2965, role: 'research_pending' },
  gate_h_status: { path: REL.gateHStatus, sha256: 'e061c09444f1c80f85b63f0b42164bf0602e6172b2895a469182ea6a50e5c0c1', bytes: 397, role: 'research_pending' },
  gate_h_task_review: { path: REL.gateHTaskReview, sha256: '422cd4d3faab3e233af0241ca11dd82cc9a26e75c0af08961698bc342b97552a', bytes: 27037, role: 'client_ready' },
  gate_h_published_tasks: { path: REL.gateHPublishedTasks, sha256: '9381129f41fbd21f238f7a7a4eed53b0a3147f815f82a810ec1e020c63ecef99', bytes: 370235, role: 'client_ready' },
  gate_h2_status: { path: REL.gateH2Status, sha256: '9b79c6c820169f73805fe0a2a1a43661311d1185dc8f1351cedf90ea179348df', bytes: 2149, role: 'research_pending' },
  gate_h2_matrix: { path: REL.gateH2Matrix, sha256: '6087baa6aa2f79f181149925e50394984b0d0a0779150ba74bc956e48ea6ae25', bytes: 3707, role: 'research_pending' },
  h2_builder_synthetic: { path: REL.h2Builder, sha256: '085ad5cc051ea9315cebe53f4f71f424f5c8a114c61d3f58c32bc35a5cfa94cf', bytes: 507, role: 'research_pending' },
  h2_linux_synthetic: { path: REL.h2Linux, sha256: '77bf0bb8348c5a18f2135cdb098d044f343228e1624d39acbebaf583e02a1232', bytes: 28122, role: 'research_pending' },
};

const Ajv2020 = Ajv2020Import as unknown as new (options: J) => J;
const addFormats = addFormatsImport as unknown as (ajv: J) => void;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function load(file: string): J {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourcePath(relativePath: string): string {
  const absolute = path.resolve(ROOT, relativePath);
  assert(absolute === ROOT || absolute.startsWith(`${ROOT}${path.sep}`), `source escapes repository: ${relativePath}`);
  return absolute;
}

function sourceFiles(): Source {
  return Object.fromEntries(
    Object.entries(REL).map(([key, relativePath]) => [key, load(sourcePath(relativePath))]),
  ) as Source;
}

function verifySchema(manifest: J): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(load(SCHEMA));
  assert(validate(manifest), `manifest schema failed: ${JSON.stringify(validate.errors)}`);
}

function verifyPins(manifest: J): void {
  const ids = new Set<string>();
  assert(manifest.evidence.length === Object.keys(EXPECTED_EVIDENCE).length, 'evidence role count drift');
  for (const evidence of manifest.evidence) {
    assert(!ids.has(evidence.id), `duplicate evidence id: ${evidence.id}`);
    ids.add(evidence.id);
    const expected = EXPECTED_EVIDENCE[evidence.id];
    assert(expected, `unexpected evidence role: ${evidence.id}`);
    assert(evidence.path === expected.path, `${evidence.id}: path is not the bound authority path`);
    assert(evidence.sha256 === expected.sha256, `${evidence.id}: manifest hash is not the bound authority hash`);
    assert(evidence.bytes === expected.bytes, `${evidence.id}: manifest byte count is not the bound authority count`);
    assert(evidence.role === expected.role, `${evidence.id}: evidence role drift`);
    const file = sourcePath(evidence.path);
    const bytes = fs.readFileSync(file);
    assert(bytes.length === evidence.bytes, `${evidence.id}: byte count drift`);
    assert(sha256(bytes) === evidence.sha256, `${evidence.id}: SHA-256 drift`);
  }
  assert(ids.size === Object.keys(EXPECTED_EVIDENCE).length, 'evidence IDs are incomplete');
  const criteriaEvidence = new Set(manifest.evidence.map((entry: J) => entry.id));
  for (const criterion of manifest.criteria) {
    for (const evidenceId of criterion.evidence_ids) {
      assert(criteriaEvidence.has(evidenceId), `${criterion.criterion_id}: unknown evidence ${evidenceId}`);
    }
  }
}

function verifyRegistry(): void {
  const registry = sourcePath('docs/dataset-factory/artifact-registry.v0.jsonl');
  const rows = fs.readFileSync(registry, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const row = rows.find((entry: J) => entry.stable_id === REGISTRY_ID);
  assert(row, 'client closeout is missing from the artifact registry');
  assert(row.storage?.locator === 'docs/dataset-factory/fixtures/client-closeout-v1', 'client closeout registry locator drift');
  assert(row.content_digest?.scope === 'sorted_tree_manifest', 'client closeout registry digest scope drift');
  const members = fs.readdirSync(FIXTURE).filter((member) => fs.statSync(path.join(FIXTURE, member)).isFile()).sort();
  const treeRows = members.map((member) => {
    const bytes = fs.readFileSync(path.join(FIXTURE, member));
    return `${member}\t${sha256(bytes)}\t${bytes.length}`;
  });
  const treeDigest = sha256(Buffer.from(`${treeRows.join('\n')}\n`));
  const byteCount = members.reduce((sum, member) => sum + fs.statSync(path.join(FIXTURE, member)).size, 0);
  assert(row.counts?.file_count === members.length && row.counts?.byte_count === byteCount, 'client closeout registry counts drift');
  assert(row.content_digest.value === treeDigest, 'client closeout registry tree digest drift');
}

function countBy(values: J[], key: string): Record<string, number> {
  return values.reduce((counts, value) => {
    const name = String(value[key]);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
}

function verifyClientLane(manifest: J, source: Source): void {
  const records = source.phaseSelection.records;
  assert(source.phaseStatus.counts.visually_and_provenance_processed === 60, 'Phase D processed count is not 60');
  assert(records.length === 60, 'Phase D selection does not contain 60 records');
  const laneCounts = countBy(records, 'primary_stratum');
  assert(laneCounts.aerial === 20 && laneCounts.control === 10 && laneCounts.ground === 30, 'Phase D lane counts drift');

  const gateG = source.gateGStatus;
  assert(gateG.state === 'published' && gateG.issue_complete === true, 'Gate G is not published');
  assert(JSON.stringify(gateG.counts) === JSON.stringify({ candidates: 36, accepted: 32, held: 4, rejected: 0, fully_verified: 32, benchmark_tasks: 0, search_tasks: 0 }), 'Gate G counts drift');
  assert(gateG.production_mutation === false && gateG.paid_gpu === false, 'Gate G safety flags drift');

  const review = source.gateGReview;
  assert(JSON.stringify(review.counts) === JSON.stringify({ candidates: 36, accepted: 32, held: 4, rejected: 0, fully_verified: 32 }), 'Gate G review counts drift');
  const dossiers = source.gateGDossiers.dossiers;
  assert(dossiers.length === 36, 'Gate G dossier count drift');
  const accepted = dossiers.filter((dossier: J) => dossier.fully_verified === true && dossier.independent_review?.disposition === 'accepted');
  assert(accepted.length === 32, 'Gate G accepted dossier count drift');
  assert(manifest.client_specimen.record_count === records.length, 'manifest record count does not equal derived Phase D count');
  assert(manifest.client_specimen.fully_verified_dossier_count === accepted.length, 'manifest dossier count does not equal derived Gate G count');
  assert(accepted.every((dossier: J) => dossier.rights?.complete === true), 'Gate G accepted dossier rights are incomplete');
  assert(accepted.every((dossier: J) => dossier.independent_review?.completed === true), 'Gate G accepted dossier review is incomplete');
  assert(accepted.every((dossier: J) => dossier.visual_claims?.length === 1 && dossier.visual_claims[0].evidence?.declaration === 'whole_image'), 'Gate G visual claim boundary drift');
  assert(accepted.every((dossier: J) => Array.isArray(dossier.external_claims) && dossier.external_claims.length === 0), 'Gate G unexpectedly contains external claims');
  assert(accepted.every((dossier: J) => {
    const unresolved = dossier.uncertainty?.unresolved ?? [];
    return unresolved.includes('historical identity') && unresolved.includes('exact location');
  }), 'Gate G accepted dossier uncertainty boundary drift');

  const falseCases = source.gateHFalsePrecision.cases;
  assert(falseCases.length >= 4, 'false-precision controls are incomplete');
  assert(falseCases.some((entry: J) => entry.case_id === 'castrol-catelli' && entry.record_id === 105 && entry.disposition === 'rejected_false_precision_hypothesis'), 'CASTROL false-precision control missing');

  const acceptedTasks = source.gateHStatus.counts;
  assert(source.gateHStatus.state === 'published_external_task_review' && source.gateHStatus.issue_complete === true, 'Gate H v1 is not a historical publication');
  assert(acceptedTasks.accepted === 32 && acceptedTasks.published_tasks === 32 && acceptedTasks.search_tasks === 0, 'Gate H v1 task counts drift');
  assert(manifest.client_specimen.task_count === acceptedTasks.published_tasks, 'manifest task count does not equal published task count');
}

function verifyTaskPublication(manifest: J, source: Source): void {
  const review = source.gateHTaskReview;
  const published = source.gateHPublishedTasks;
  assert(review.schema_version === 'reviewed_metrics_task_review_receipt_v1.0.0', 'Gate H task review schema identity drift');
  assert(JSON.stringify(review.counts) === JSON.stringify({ candidates: 32, accepted: 32, held: 0, rejected: 0 }), 'Gate H task review counts drift');
  assert(review.reviewer?.identity === 'sol-high-gate-h-task-reviewer:019f63c9-b9ff-7460-b541-b8b331c31021', 'Gate H task reviewer identity drift');
  assert(review.reviewer?.session_id === '019f63c9-b9ff-7460-b541-b8b331c31021', 'Gate H task reviewer session drift');
  assert(review.reviewer?.model === 'gpt-5.6-sol' && review.reviewer?.reasoning_effort === 'high', 'Gate H task reviewer route drift');
  assert(Object.values(review.reviewer?.attestations ?? {}).length === 5 && Object.values(review.reviewer.attestations).every(Boolean), 'Gate H task reviewer attestations are incomplete');
  assert(Array.isArray(review.dispositions) && review.dispositions.length === 32, 'Gate H independent task rows are incomplete');
  assert(Array.isArray(published.accepted_tasks) && published.accepted_tasks.length === 32, 'published task bytes are incomplete');
  assert(manifest.client_specimen.task_count === published.accepted_tasks.length, 'manifest task count does not equal independently derived published task bytes');
  assert(published.review_receipt_sha256 === '422cd4d3faab3e233af0241ca11dd82cc9a26e75c0af08961698bc342b97552a', 'published task review receipt binding drift');

  const reviewed = new Map<string, J>(review.dispositions.map((row: J) => [row.task_id, row] as [string, J]));
  const tasks = new Map<string, J>(published.accepted_tasks.map((task: J) => [task.task_id, task] as [string, J]));
  assert(reviewed.size === 32 && tasks.size === 32, 'Gate H task IDs are not unique');
  for (const [taskId, row] of reviewed) {
    const task = tasks.get(taskId);
    assert(task, `published task missing reviewed task: ${taskId}`);
    assert(row.disposition === 'accepted' && typeof row.task_sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.task_sha256), `task review hash/disposition invalid: ${taskId}`);
    assert(Object.values(row.approvals ?? {}).length === 5 && Object.values(row.approvals).every(Boolean), `task review approvals incomplete: ${taskId}`);
    assert(task.task_review?.status === 'accepted_external_review' && task.task_review?.disposition === 'accepted', `embedded task review invalid: ${taskId}`);
    assert(task.task_review.reviewer?.identity === review.reviewer.identity && task.task_review.reviewer?.session_id === review.reviewer.session_id, `task reviewer join drift: ${taskId}`);
    assert(JSON.stringify(task.task_review.reviewer.attestations) === JSON.stringify(review.reviewer.attestations), `task reviewer attestation join drift: ${taskId}`);
    assert(task.task_review.reviewer?.attestations && Object.values(task.task_review.reviewer.attestations).every(Boolean), `task reviewer attestations drift: ${taskId}`);
    assert(task.record?.component_id === task.component_id && task.record?.split === task.split, `task component/split join drift: ${taskId}`);
    assert(typeof task.claim_sha256 === 'string' && /^[a-f0-9]{64}$/.test(task.claim_sha256), `task claim hash missing: ${taskId}`);
    assert(task.dossier?.fully_verified === true && task.dossier?.disposition === 'accepted', `task dossier authority drift: ${taskId}`);
    assert(task.rights?.complete === true && task.rights?.commercial_use_allowed === true, `task rights authority drift: ${taskId}`);
    assert(typeof task.input?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(task.input.sha256) && Number.isInteger(task.input.bytes) && task.input.bytes > 0, `task input bytes/hash missing: ${taskId}`);
  }
  assert(manifest.evidence.find((entry: J) => entry.id === 'gate_h_task_review')?.role === 'client_ready', 'task review is not in client-ready evidence lane');
  assert(manifest.evidence.find((entry: J) => entry.id === 'gate_h_published_tasks')?.role === 'client_ready', 'published tasks are not in client-ready evidence lane');
}

function verifyMetricContract(source: Source): void {
  const required = new Set([
    'ocr_normalized_exact_match', 'ocr_cer', 'ocr_wer', 'entity_precision', 'entity_recall',
    'false_identity_rate', 'place_link_precision', 'image_mode_macro_f1',
    'aerial_region_label_agreement', 'aerial_mask_iou', 'geolocation_median_distance',
    'geolocation_p90_distance', 'stage_wall_time_median', 'stage_wall_time_p90',
    'actual_cost_per_stage', 'actual_cost_per_record',
  ]);
  const metrics = source.gateHMetrics.metrics;
  assert(Array.isArray(metrics) && metrics.length >= required.size, 'Gate H metric report is incomplete');
  const ids = new Set(metrics.map((metric: J) => metric.metric_id));
  for (const id of required) assert(ids.has(id), `Gate H metric missing: ${id}`);
  for (const metric of metrics) {
    const subset = metric.source_subset;
    assert(Array.isArray(subset?.universe_member_ids) && Array.isArray(subset?.included_member_ids), `${metric.metric_id}: subset membership missing`);
    assert(Array.isArray(subset?.denominator_member_ids) && Array.isArray(subset?.numerator_member_ids), `${metric.metric_id}: numerator/denominator membership missing`);
    assert(Array.isArray(subset?.excluded_members) && typeof subset?.subset_sha256 === 'string', `${metric.metric_id}: exclusions or subset digest missing`);
    if (metric.status === 'unavailable') {
      assert(metric.numerator === null && metric.denominator === 0 && metric.value === null, `${metric.metric_id}: unavailable metric must stay null with zero denominator`);
      assert(typeof metric.reason === 'string' && metric.reason.length > 0, `${metric.metric_id}: unavailable reason missing`);
    }
  }
  const matrixRows = new Map(source.gateHMatrix.rows.map((row: J) => [row.criterion_id, row.status]));
  assert(matrixRows.get('92.metrics_denominators') === 'satisfied', 'Gate H metric denominator criterion drift');
  assert(matrixRows.get('92.component_leakage') === 'satisfied', 'Gate H component leakage criterion drift');
  assert(matrixRows.get('69.reviewed_metrics') === 'satisfied_with_unavailable_denominators', 'Gate H parent metric status drift');
}

function verifyResearchBoundary(manifest: J, source: Source): void {
  assert(manifest.client_specimen.status === 'client_specimen_ready', 'client specimen status is not ready');
  assert(manifest.research_evaluation.status === 'research_evaluation_pending', 'research status is not pending');
  assert(JSON.stringify(manifest.research_evaluation.issues) === JSON.stringify([69, 92, 96, 97, 101]), 'research issue identity join drift');
  const h2 = source.gateH2Status;
  for (const key of ['issue_92_complete', 'issue_69_complete', 'candidate_complete', 'publication_exists', 'prediction_exists', 'gold_exists'] as const) {
    assert(h2[key] === false, `H2 candidate flag ${key} unexpectedly true`);
  }
  assert(h2.mutations?.production === false && h2.mutations?.search_index === false && h2.mutations?.paid_gpu === false, 'H2 mutation flags drift');
  assert(source.h2Builder.status === 'synthetic_contract_fixture', 'H2 builder evidence is not marked synthetic');
  assert(source.h2Linux.status === 'synthetic_local_fixture' && source.h2Linux.synthetic === true, 'Linux evidence is not marked synthetic');
  assert(source.gateH2Matrix.issue_92_complete === false && source.gateH2Matrix.issue_69_complete === false, 'H2 criterion matrix unexpectedly complete');
}

function verifyCriteria(manifest: J): void {
  const keys = manifest.criteria.map((criterion: J) => `${criterion.issue}.${criterion.criterion_id.split('.').slice(1).join('.')}`);
  assert(new Set(keys).size === keys.length, 'criterion IDs are not unique');
  const expected = new Map<string, string>([
    ['69.processed_records', 'proven'], ['69.deeply_verified_dossiers', 'proven'], ['69.visual_claim_boundaries', 'proven'],
    ['69.external_claim_citations', 'proven_in_scope'], ['69.unsupported_claim_controls', 'proven'], ['69.reviewed_metrics', 'pending'],
    ['69.false_precision', 'proven'], ['69.rights_attribution', 'proven'], ['69.accepted_tasks', 'proven_in_scope'],
    ['69.schema_registry', 'proven'], ['69.separate_dossier_review', 'proven'], ['69.issue_close', 'pending'],
    ['92.metrics_denominators', 'proven_in_scope'], ['92.false_precision', 'proven'], ['92.cost_time', 'proven'],
    ['92.accepted_tasks', 'partial'], ['92.component_leakage', 'proven_in_scope'], ['92.run_report_parent_matrix', 'pending'],
    ['92.schemas_registry_replay', 'proven_in_scope'], ['92.issue_close', 'pending'],
  ]);
  assert(manifest.criteria.length === expected.size, 'criterion count drift');
  const expectedEvidence: Record<string, string[]> = {
    '69.processed_records': ['phase_d_status', 'phase_d_selection'],
    '69.deeply_verified_dossiers': ['gate_g_status', 'gate_g_review', 'gate_g_dossiers'],
    '69.visual_claim_boundaries': ['gate_g_dossiers', 'gate_g_review'],
    '69.external_claim_citations': ['gate_g_dossiers', 'gate_g_review'],
    '69.unsupported_claim_controls': ['gate_g_dossiers', 'gate_g_review', 'gate_h_false_precision'],
    '69.reviewed_metrics': ['gate_h_metrics', 'gate_h2_status'],
    '69.false_precision': ['gate_h_false_precision'],
    '69.rights_attribution': ['gate_g_status', 'gate_g_dossiers', 'gate_g_review'],
    '69.accepted_tasks': ['gate_h_status', 'gate_h_task_review', 'gate_h_published_tasks'],
    '69.schema_registry': ['gate_g_status', 'gate_h_status'],
    '69.separate_dossier_review': ['gate_g_review', 'gate_g_status'],
    '69.issue_close': ['gate_h2_status', 'gate_h2_matrix'],
    '92.metrics_denominators': ['gate_h_metrics', 'gate_h_matrix'],
    '92.false_precision': ['gate_h_false_precision'],
    '92.cost_time': ['gate_h_metrics'],
    '92.accepted_tasks': ['gate_h_status', 'gate_h_task_review', 'gate_h_published_tasks', 'gate_h2_status'],
    '92.component_leakage': ['gate_h_matrix', 'gate_h_task_review', 'gate_h_published_tasks'],
    '92.run_report_parent_matrix': ['gate_h_matrix', 'gate_h2_matrix'],
    '92.schemas_registry_replay': ['gate_h_status', 'gate_h2_status'],
    '92.issue_close': ['gate_h2_status', 'gate_h2_matrix'],
  };
  for (const criterion of manifest.criteria) {
    const key = criterion.criterion_id;
    assert(key.startsWith(`${criterion.issue}.`), `${key}: criterion.issue does not match criterion_id`);
    assert(expected.get(key) === criterion.status, `${key}: status drift (${criterion.status})`);
    assert(JSON.stringify([...criterion.evidence_ids].sort()) === JSON.stringify([...expectedEvidence[key]].sort()), `${key}: evidence binding drift`);
    assert(criterion.limitation.length > 0, `${key}: limitation is required`);
    if (key === '92.schemas_registry_replay') {
      assert(!/v2[^.]*\b(?:pass|passes|passed)\b/i.test(criterion.result), 'H2 v2 result must not claim a pass');
      assert(/pending|unavailable/i.test(criterion.result), 'H2 v2 pending blocker is not stated');
    }
  }
}

export function verify(manifest: J = load(MANIFEST), source: Source = sourceFiles()): void {
  verifySchema(manifest);
  assert(manifest.artifact_id === REGISTRY_ID, 'manifest artifact_id does not match registry ID');
  verifyPins(manifest);
  verifyRegistry();
  verifyClientLane(manifest, source);
  verifyTaskPublication(manifest, source);
  verifyMetricContract(source);
  verifyResearchBoundary(manifest, source);
  verifyCriteria(manifest);
  console.log('client closeout v1: verified (client specimen ready; research evaluation pending)');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectsFailure(action: () => void, label: string): void {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`self-test expected failure: ${label}`);
}

export function selfTest(): void {
  const manifest = load(MANIFEST);
  const source = sourceFiles();
  verify(manifest, source);

  const badManifest = clone(manifest);
  badManifest.client_specimen.record_count = 59;
  expectsFailure(() => verify(badManifest, source), 'client record count');

  const badDossierCount = clone(manifest);
  badDossierCount.client_specimen.fully_verified_dossier_count = 31;
  expectsFailure(() => verify(badDossierCount, source), 'client dossier count');

  const badTaskCount = clone(manifest);
  badTaskCount.client_specimen.task_count = 31;
  expectsFailure(() => verify(badTaskCount, source), 'client task count');

  const badEvidencePath = clone(manifest);
  const gateGStatusPin = badEvidencePath.evidence.find((entry: J) => entry.id === 'gate_g_status');
  gateGStatusPin.path = REL.phaseStatus;
  gateGStatusPin.sha256 = '5778afc0e2033055a0d74a362ac98d726e8c2917783c2618b1ee4102f059fc47';
  gateGStatusPin.bytes = 937;
  expectsFailure(() => verify(badEvidencePath, source), 'evidence role path substitution');

  const badTemplateAuthority = clone(manifest);
  const taskReviewPin = badTemplateAuthority.evidence.find((entry: J) => entry.id === 'gate_h_task_review');
  const templatePath = sourcePath('docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/independent-task-review.template-v1.json');
  const templateBytes = fs.readFileSync(templatePath);
  taskReviewPin.path = 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/independent-task-review.template-v1.json';
  taskReviewPin.sha256 = sha256(templateBytes);
  taskReviewPin.bytes = templateBytes.length;
  expectsFailure(() => verify(badTemplateAuthority, source), 'blank task-review template substitution');

  const badSource = clone(source);
  badSource.gateGStatus.counts.accepted = 31;
  expectsFailure(() => verify(manifest, badSource), 'Gate G accepted dossier count');

  const badReviewIdentity = clone(source);
  badReviewIdentity.gateHTaskReview.reviewer.attestations.no_gate_g_reviewer_overlap = false;
  expectsFailure(() => verify(manifest, badReviewIdentity), 'task reviewer attestation bypass');

  const badPublishedTask = clone(source);
  badPublishedTask.gateHPublishedTasks.accepted_tasks[0].task_id = 'gate-h:image-mode:tampered';
  expectsFailure(() => verify(manifest, badPublishedTask), 'published task identity substitution');

  const badResearch = clone(source);
  badResearch.gateH2Status.prediction_exists = true;
  expectsFailure(() => verify(manifest, badResearch), 'H2 prediction boundary');
  const badMatrix = clone(source);
  badMatrix.gateH2Matrix.issue_69_complete = true;
  expectsFailure(() => verify(manifest, badMatrix), 'H2 criterion matrix completion boundary');

  const badIdentity = clone(manifest);
  badIdentity.artifact_id = 'dfv0_client_closeout_v1_20260830';
  expectsFailure(() => verify(badIdentity, source), 'registry artifact identity join');

  const badCriterionIssue = clone(manifest);
  badCriterionIssue.criteria[0].issue = 92;
  expectsFailure(() => verify(badCriterionIssue, source), 'criterion issue mapping');

  const badCriterionEvidence = clone(manifest);
  badCriterionEvidence.criteria.find((criterion: J) => criterion.criterion_id === '69.deeply_verified_dossiers').evidence_ids = ['gate_h2_status'];
  expectsFailure(() => verify(badCriterionEvidence, source), 'criterion evidence binding');
  console.log('client closeout v1: self-test passed (positive and tamper cases)');
}

const command = process.argv[2] ?? 'verify';
if (command === 'self-test') selfTest();
else if (command === 'verify') verify();
else throw new Error(`Unknown command: ${command}`);
