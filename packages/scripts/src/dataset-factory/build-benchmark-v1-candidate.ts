import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

export const BENCHMARK_V1_SCHEMA = 'mtl_citymemory_bench_v1_candidate_v1.0.0';
export const BENCHMARK_V1_ID = 'mtl_citymemory_bench_v1';
export const REVIEWED_RETRIEVAL_MINIMUM = 100;
export const CLASSIFICATION_RECORD_MINIMUM = 200;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_GRAPH_EVIDENCE = path.join(ROOT, 'docs/dataset-factory/visual-family-graph-v1-evidence.json');
const DEFAULT_CANONICAL_EVIDENCE = path.join(ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');
const DEFAULT_GOLD_DESCRIPTOR = path.join(ROOT, 'docs/dataset-factory/fixtures/gold-label-batch-002/final-bundle-v1.json');
const DEFAULT_GOLD_ROOT = path.join(ROOT, 'data/mtl_archives/reports/gold_label_batch_002');
const DEFAULT_GRAPH_MAP = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/graph/record-leakage-map-v1.jsonl');
const DEFAULT_RETRIEVAL = path.join(ROOT, 'data/mtl_archives/reports/search_judgments_v0/retrieval_tasks.search_judgments_v0.jsonl');
const DEFAULT_VERIFIED_INTELLIGENCE = path.join(ROOT, 'docs/dataset-factory/fixtures/reviewed-metrics-publication-v1/published-benchmark-tasks-v1.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs/dataset-factory/fixtures/benchmark-v1-candidate/preflight-report-v1.json');

type InputStatus = 'available' | 'descriptor_only' | 'missing_local_evidence' | 'hash_mismatch';
type CandidateSplit = 'train' | 'validation' | 'test';

export type CandidateInput = {
  artifact_id: string | null;
  locator: string;
  status: InputStatus;
  expected_sha256: string | null;
  observed_sha256: string | null;
  bytes: number | null;
  rows: number | null;
};

export type RetrievalRow = {
  task_id?: string;
  record_id?: string;
  positive_record_ids?: string[];
  slice?: string;
  judgment_source?: string;
  adjudication_status?: string;
  [key: string]: unknown;
};

export type ComponentRow = {
  record_id: string;
  component_id: string;
  benchmark_split: CandidateSplit;
};

export type CandidateReport = {
  schema_version: typeof BENCHMARK_V1_SCHEMA;
  benchmark_id: typeof BENCHMARK_V1_ID;
  generated_at: string;
  state: 'candidate_ready' | 'preflight_blocked';
  candidate_ready: boolean;
  lock_authority: false;
  issue_70_complete: false;
  inputs: {
    canonical_corpus: CandidateInput;
    visual_family_graph: CandidateInput;
    gold_batch_002: CandidateInput;
    verified_intelligence: CandidateInput;
    retrieval_tasks: CandidateInput;
  };
  splits: {
    status: 'not_emitted_missing_graph' | 'candidate_emitted';
    method: 'visual_family_graph_v1_connected_component';
    component_crossings: number | null;
    rows: number | null;
    sha256: string | null;
    output_locator: string | null;
  };
  retrieval_shortfall: {
    reviewed_gold: number;
    minimum_reviewed_gold: 100;
    shortfall: number;
    silver: number;
    stress: number;
    by_slice: Record<string, { total: number; reviewed_gold: number; silver: number; stress: number }>;
  };
  classification_support: {
    reviewed_gold_records: number;
    minimum_reviewed_gold_records: 200;
    by_target: Record<string, number>;
  };
  promotion_thresholds: {
    status: 'proposed_not_authorized';
    frozen_before_candidate_results: true;
    values: {
      classification_macro_f1: number;
      retrieval_mrr: number;
      retrieval_recall_at_10: number;
      ranking_pairwise_accuracy: number;
      duplicate_rate_at_10: number;
      calibration_ece: number;
    };
  };
  acquisition_queue: {
    status: 'human_review_required';
    required_additional_reviewed_queries: number;
    rows: Array<{
      queue_id: string;
      slice: string;
      target_reviewed_gold: 1;
      status: 'unreviewed_acquisition';
      reason: 'needs_independent_human_review_before_gold';
    }>;
  };
  gates: {
    independent_review: false;
    canonical_corpus_frozen: boolean;
    family_graph_frozen: boolean;
    classification_support: boolean;
    retrieval_support: boolean;
    silver_separated: boolean;
    leakage_audit: boolean;
    baseline_recorded: false;
  };
  blockers: string[];
};

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function locator(value: string): string {
  const normalized = value.replaceAll(path.sep, '/');
  const relative = path.relative(ROOT, value).replaceAll(path.sep, '/');
  if (relative && !relative.startsWith('../') && relative !== '..') return relative;
  const marker = normalized.lastIndexOf('/data/');
  return marker >= 0 ? normalized.slice(marker + 1) : normalized.startsWith('data/') ? normalized : `<external-input>/${path.basename(normalized)}`;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function readJsonl<T extends Record<string, unknown>>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function fileInput(filePath: string, artifactId: string | null, expectedSha: string | null, statusWhenMissing: InputStatus = 'missing_local_evidence'): CandidateInput {
  const exists = fs.existsSync(filePath);
  if (!exists) return { artifact_id: artifactId, locator: locator(filePath), status: statusWhenMissing, expected_sha256: expectedSha, observed_sha256: null, bytes: null, rows: null };
  const bytes = fs.readFileSync(filePath);
  const rows = filePath.endsWith('.jsonl') ? bytes.toString('utf8').split(/\r?\n/).filter(Boolean).length : null;
  const observedSha = sha256(bytes);
  return { artifact_id: artifactId, locator: locator(filePath), status: expectedSha && observedSha !== expectedSha ? 'hash_mismatch' : 'available', expected_sha256: expectedSha, observed_sha256: observedSha, bytes: bytes.byteLength, rows };
}

function directoryInput(directory: string, artifactId: string, descriptor: Record<string, unknown>): CandidateInput {
  const expectedSha = String(descriptor.tree_sha256 ?? '');
  if (!fs.existsSync(directory)) return { artifact_id: artifactId, locator: locator(directory), status: 'missing_local_evidence', expected_sha256: expectedSha, observed_sha256: null, bytes: null, rows: null };
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk(directory);
  files.sort();
  const members = files.map((file) => ({ path: path.relative(directory, file).replaceAll(path.sep, '/'), sha256: sha256(fs.readFileSync(file)), bytes: fs.statSync(file).size }));
  const rootLocator = `${locator(directory).replace(/\/$/, '')}/`;
  const expectedMembers = Array.isArray(descriptor.members)
    ? descriptor.members.map((member) => {
        const value = member as Record<string, unknown>;
        const declaredPath = String(value.path ?? '');
        return { path: declaredPath.startsWith(rootLocator) ? declaredPath.slice(rootLocator.length) : declaredPath, sha256: String(value.sha256 ?? ''), bytes: Number(value.bytes) };
      }).sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const exactMembers = expectedMembers.length === members.length && expectedMembers.every((expected, index) => {
    const observed = members[index];
    return observed?.path === expected.path && observed.sha256 === expected.sha256 && observed.bytes === expected.bytes;
  });
  const rowsPath = path.join(directory, 'adjudication/adjudications-v1.jsonl');
  const rows = fs.existsSync(rowsPath) ? readJsonl(rowsPath).length : null;
  return { artifact_id: artifactId, locator: locator(directory), status: exactMembers && expectedSha ? 'available' : 'hash_mismatch', expected_sha256: expectedSha || null, observed_sha256: exactMembers ? expectedSha : sha256(stableJson(members)), bytes: members.reduce((sum, member) => sum + member.bytes, 0), rows };
}

function graphInput(mapPath: string): CandidateInput {
  return fileInput(mapPath, 'ccv1_visual_family_graph_20260710', 'a4f66eee3b39573977ab3694cfde5fbe4db62be4f09c77120316d2d7b56aa8cc');
}

export function auditComponentSplits(rows: ComponentRow[]): { crossings: number; sha256: string } {
  const byRecord = new Set<string>();
  const byComponent = new Map<string, CandidateSplit>();
  for (const row of rows) {
    if (byRecord.has(row.record_id)) throw new Error(`duplicate split record ${row.record_id}`);
    byRecord.add(row.record_id);
    const existing = byComponent.get(row.component_id);
    if (existing && existing !== row.benchmark_split) throw new Error(`component crosses benchmark splits: ${row.component_id}`);
    byComponent.set(row.component_id, row.benchmark_split);
  }
  const canonical = [...rows].sort((a, b) => a.record_id.localeCompare(b.record_id));
  return { crossings: 0, sha256: sha256(serializeComponentSplits(canonical)) };
}

export function serializeComponentSplits(rows: ComponentRow[]): string {
  return [...rows]
    .sort((a, b) => a.record_id.localeCompare(b.record_id))
    .map((row) => JSON.stringify(row))
    .join('\n') + (rows.length ? '\n' : '');
}

function readComponents(mapPath: string): ComponentRow[] {
  const rows = readJsonl<Record<string, unknown>>(mapPath).map((row) => ({ record_id: String(row.record_id), component_id: String(row.component_id), benchmark_split: String(row.benchmark_split) as CandidateSplit }));
  for (const row of rows) {
    if (!row.record_id || !row.component_id || !['train', 'validation', 'test'].includes(row.benchmark_split)) throw new Error(`invalid family graph split row for ${row.record_id}`);
  }
  return rows;
}

function countGoldRecords(goldRoot: string): { records: number; byTarget: Record<string, number> } {
  const filePath = path.join(goldRoot, 'adjudication/adjudications-v1.jsonl');
  if (!fs.existsSync(filePath)) return { records: 0, byTarget: {} };
  const rows = readJsonl<Record<string, unknown>>(filePath);
  const records = new Set(rows.map((row) => String(row.record_id ?? row.neutral_id ?? ''))).size;
  const byTarget: Record<string, number> = {};
  for (const row of rows) {
    const labels = row.final_labels && typeof row.final_labels === 'object' ? row.final_labels as Record<string, unknown> : {};
    for (const [target, value] of Object.entries(labels)) {
      const status = value && typeof value === 'object' ? (value as Record<string, unknown>).status : null;
      if (status === 'observed' || status === 'accepted' || status === true) byTarget[target] = (byTarget[target] ?? 0) + 1;
    }
  }
  return { records, byTarget };
}

export function summarizeRetrieval(rows: RetrievalRow[]) {
  const ids = new Set<string>();
  let reviewed_gold = 0;
  let silver = 0;
  let stress = 0;
  const by_slice: Record<string, { total: number; reviewed_gold: number; silver: number; stress: number }> = {};
  for (const row of rows) {
    const taskId = String(row.task_id ?? '');
    if (!taskId) throw new Error('retrieval task is missing task_id');
    if (ids.has(taskId)) throw new Error(`duplicate retrieval task ${taskId}`);
    ids.add(taskId);
    const source = String(row.judgment_source ?? row.adjudication_status ?? '');
    const kind = source === 'reviewed_gold' ? 'reviewed_gold' : source.includes('stress') ? 'stress' : 'silver';
    if (kind === 'reviewed_gold') reviewed_gold += 1;
    else if (kind === 'stress') stress += 1;
    else silver += 1;
    const slice = String(row.slice ?? 'unclassified');
    const count = by_slice[slice] ?? { total: 0, reviewed_gold: 0, silver: 0, stress: 0 };
    count.total += 1;
    count[kind] += 1;
    by_slice[slice] = count;
  }
  return { reviewed_gold, silver, stress, by_slice };
}

const ACQUISITION_SLICES = ['entity_place', 'metadata_title', 'reranker_required', 'scene_text', 'text_in_image'];

export function buildAcquisitionQueue(reviewedGold: number, bySlice: Record<string, { total: number; reviewed_gold: number; silver: number; stress: number }>) {
  const shortfall = Math.max(0, REVIEWED_RETRIEVAL_MINIMUM - reviewedGold);
  const targetPerSlice = Math.floor(REVIEWED_RETRIEVAL_MINIMUM / ACQUISITION_SLICES.length);
  const queue: CandidateReport['acquisition_queue']['rows'] = [];
  for (const slice of ACQUISITION_SLICES) {
    const current = bySlice[slice]?.reviewed_gold ?? 0;
    const need = Math.max(0, targetPerSlice - current);
    for (let index = 0; index < need; index += 1) queue.push({ queue_id: `retrieval-review-${String(queue.length + 1).padStart(3, '0')}`, slice, target_reviewed_gold: 1, status: 'unreviewed_acquisition', reason: 'needs_independent_human_review_before_gold' });
  }
  while (queue.length < shortfall) {
    queue.push({ queue_id: `retrieval-review-${String(queue.length + 1).padStart(3, '0')}`, slice: 'coverage_balance_pending', target_reviewed_gold: 1, status: 'unreviewed_acquisition', reason: 'needs_independent_human_review_before_gold' });
  }
  return queue.slice(0, shortfall);
}

export function buildCandidateReport(options: { goldRoot: string; graphMap: string; retrievalTasks: string; verifiedIntelligence: string; graphEvidence: string; canonicalEvidence: string; goldDescriptor: string; generatedAt?: string }): CandidateReport {
  const goldDescriptor = fs.existsSync(options.goldDescriptor) ? readJson(options.goldDescriptor) : {};
  const graphEvidence = fs.existsSync(options.graphEvidence) ? readJson(options.graphEvidence) : {};
  const canonicalRegistry = fs.existsSync(options.canonicalEvidence) ? fs.readFileSync(options.canonicalEvidence, 'utf8') : '';
  const retrievalExists = fs.existsSync(options.retrievalTasks);
  const retrievalRows = retrievalExists ? readJsonl<RetrievalRow>(options.retrievalTasks) : [];
  const retrieval = summarizeRetrieval(retrievalRows);
  const gold = countGoldRecords(options.goldRoot);
  const components = fs.existsSync(options.graphMap) ? readComponents(options.graphMap) : [];
  const splitAudit = components.length ? auditComponentSplits(components) : null;
  const canonicalArtifactPresent = /"stable_id":"ccv1_reconciliation_20260710"/.test(canonicalRegistry);
  const graphMaterialized = Boolean((graphEvidence.graph as Record<string, unknown> | undefined)?.splits) && Boolean(splitAudit);
  const blockers: string[] = [];
  if (!fs.existsSync(options.goldRoot)) blockers.push(`missing local Gold Batch 002 evidence: ${locator(options.goldRoot)}`);
  if (!graphMaterialized) blockers.push(`missing materialized Visual Family Graph v1 record map: ${locator(options.graphMap)}`);
  if (!retrievalExists) blockers.push(`missing retrieval tasks: ${locator(options.retrievalTasks)}`);
  if (gold.records < CLASSIFICATION_RECORD_MINIMUM) blockers.push(`classification reviewed-gold support ${gold.records}/${CLASSIFICATION_RECORD_MINIMUM}`);
  if (retrieval.reviewed_gold < REVIEWED_RETRIEVAL_MINIMUM) blockers.push(`retrieval reviewed-gold support ${retrieval.reviewed_gold}/${REVIEWED_RETRIEVAL_MINIMUM}; shortfall ${REVIEWED_RETRIEVAL_MINIMUM - retrieval.reviewed_gold}`);
  blockers.push('independent benchmark reviewer has not audited candidate validity, arithmetic, source boundaries, and splits');
  blockers.push('production baselines are not recorded by this foundation slice');
  const graphInputEvidence = graphInput(options.graphMap);
  if (!fs.existsSync(options.graphMap) && Object.keys(graphEvidence).length)
    graphInputEvidence.status = 'descriptor_only';
  const canonicalInput: CandidateInput = canonicalArtifactPresent
    ? { artifact_id: 'ccv1_reconciliation_20260710', locator: 'data/mtl_archives/reports/canonical_corpus_v1/live', status: 'descriptor_only', expected_sha256: '3175aff85c36ca6f4c5d9b9947930bfac31820f408422e7a4f28291434d51be6', observed_sha256: null, bytes: null, rows: null }
    : { artifact_id: null, locator: 'data/mtl_archives/reports/canonical_corpus_v1/live', status: 'missing_local_evidence', expected_sha256: null, observed_sha256: null, bytes: null, rows: null };
  const goldInput = directoryInput(options.goldRoot, 'dfv0_gold_label_batch_002_phase_1', goldDescriptor);
  const verifiedIntelligenceInput = fileInput(options.verifiedIntelligence, 'dfv0_reviewed_metrics_v1_publication', '9381129f41fbd21f238f7a7a4eed53b0a3147f815f82a810ec1e020c63ecef99');
  const retrievalInput = fileInput(options.retrievalTasks, 'dfv0_search_judgments_v0', 'fc2e12e27918b73d5ed5b466e84a3a40381d36ec60ed59ea2c913f8d84ddbf7e');
  for (const [name, input] of Object.entries({ visual_family_graph: graphInputEvidence, gold_batch_002: goldInput, verified_intelligence: verifiedIntelligenceInput, retrieval_tasks: retrievalInput })) {
    if (input.status === 'hash_mismatch') blockers.push(`${name} hash/member mismatch: expected ${input.expected_sha256}, observed ${input.observed_sha256}`);
  }
  const candidateReady = blockers.length === 0;
  return {
    schema_version: BENCHMARK_V1_SCHEMA,
    benchmark_id: BENCHMARK_V1_ID,
    generated_at: options.generatedAt ?? datasetFactoryNowIso(),
    state: candidateReady ? 'candidate_ready' : 'preflight_blocked',
    candidate_ready: candidateReady,
    lock_authority: false,
    issue_70_complete: false,
    inputs: { canonical_corpus: canonicalInput, visual_family_graph: graphInputEvidence, gold_batch_002: goldInput, verified_intelligence: verifiedIntelligenceInput, retrieval_tasks: retrievalInput },
    splits: { status: splitAudit ? 'candidate_emitted' : 'not_emitted_missing_graph', method: 'visual_family_graph_v1_connected_component', component_crossings: splitAudit?.crossings ?? null, rows: splitAudit ? components.length : null, sha256: splitAudit?.sha256 ?? null, output_locator: null },
    retrieval_shortfall: { reviewed_gold: retrieval.reviewed_gold, minimum_reviewed_gold: REVIEWED_RETRIEVAL_MINIMUM, shortfall: Math.max(0, REVIEWED_RETRIEVAL_MINIMUM - retrieval.reviewed_gold), silver: retrieval.silver, stress: retrieval.stress, by_slice: retrieval.by_slice },
    classification_support: { reviewed_gold_records: gold.records, minimum_reviewed_gold_records: CLASSIFICATION_RECORD_MINIMUM, by_target: gold.byTarget },
    promotion_thresholds: { status: 'proposed_not_authorized', frozen_before_candidate_results: true, values: { classification_macro_f1: 0.7, retrieval_mrr: 0.55, retrieval_recall_at_10: 0.8, ranking_pairwise_accuracy: 0.6, duplicate_rate_at_10: 0.05, calibration_ece: 0.1 } },
    acquisition_queue: { status: 'human_review_required', required_additional_reviewed_queries: Math.max(0, REVIEWED_RETRIEVAL_MINIMUM - retrieval.reviewed_gold), rows: buildAcquisitionQueue(retrieval.reviewed_gold, retrieval.by_slice) },
    gates: { independent_review: false, canonical_corpus_frozen: false, family_graph_frozen: graphMaterialized, classification_support: gold.records >= CLASSIFICATION_RECORD_MINIMUM, retrieval_support: retrieval.reviewed_gold >= REVIEWED_RETRIEVAL_MINIMUM, silver_separated: retrieval.silver === retrievalRows.filter((row) => String(row.judgment_source ?? row.adjudication_status ?? '').includes('silver')).length, leakage_audit: splitAudit?.crossings === 0, baseline_recorded: false },
    blockers,
  };
}

export function validateCandidateReport(report: CandidateReport): void {
  if (report.lock_authority || report.issue_70_complete) throw new Error('candidate report cannot assert lock authority or issue completion');
  if (report.retrieval_shortfall.reviewed_gold + report.retrieval_shortfall.shortfall < REVIEWED_RETRIEVAL_MINIMUM) throw new Error('retrieval shortfall arithmetic is inconsistent');
  if (report.retrieval_shortfall.silver < 0 || report.retrieval_shortfall.stress < 0) throw new Error('negative retrieval class count');
  if (report.splits.component_crossings !== null && report.splits.component_crossings !== 0) throw new Error('candidate split leakage crossing detected');
  const queueIds = new Set(report.acquisition_queue.rows.map((row) => row.queue_id));
  if (queueIds.size !== report.acquisition_queue.rows.length) throw new Error('duplicate acquisition queue ID');
  if (report.acquisition_queue.rows.length !== report.acquisition_queue.required_additional_reviewed_queries) throw new Error('acquisition queue shortfall mismatch');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { 'gold-root': { type: 'string', default: DEFAULT_GOLD_ROOT }, 'graph-map': { type: 'string', default: DEFAULT_GRAPH_MAP }, 'retrieval-tasks': { type: 'string', default: DEFAULT_RETRIEVAL }, 'verified-intelligence': { type: 'string', default: DEFAULT_VERIFIED_INTELLIGENCE }, 'graph-evidence': { type: 'string', default: DEFAULT_GRAPH_EVIDENCE }, 'canonical-evidence': { type: 'string', default: DEFAULT_CANONICAL_EVIDENCE }, 'gold-descriptor': { type: 'string', default: DEFAULT_GOLD_DESCRIPTOR }, output: { type: 'string', default: DEFAULT_OUTPUT }, 'splits-output': { type: 'string' }, 'generated-at': { type: 'string' } } });
  const report = buildCandidateReport({ goldRoot: resolvePath(values['gold-root']!), graphMap: resolvePath(values['graph-map']!), retrievalTasks: resolvePath(values['retrieval-tasks']!), verifiedIntelligence: resolvePath(values['verified-intelligence']!), graphEvidence: resolvePath(values['graph-evidence']!), canonicalEvidence: resolvePath(values['canonical-evidence']!), goldDescriptor: resolvePath(values['gold-descriptor']!), generatedAt: values['generated-at'] });
  validateCandidateReport(report);
  const output = resolvePath(values.output!);
  if (fs.existsSync(resolvePath(values['graph-map']!))) {
    const splitRows = readComponents(resolvePath(values['graph-map']!));
    const splitsOutput = resolvePath(values['splits-output'] ?? path.join(path.dirname(output), 'candidate-splits-v1.jsonl'));
    const splitBytes = serializeComponentSplits(splitRows);
    fs.mkdirSync(path.dirname(splitsOutput), { recursive: true });
    fs.writeFileSync(splitsOutput, splitBytes, 'utf8');
    report.splits.output_locator = locator(splitsOutput);
    report.splits.sha256 = sha256(splitBytes);
  }
  validateCandidateReport(report);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: report.state, candidate_ready: report.candidate_ready, reviewed_gold_retrieval: report.retrieval_shortfall.reviewed_gold, retrieval_shortfall: report.retrieval_shortfall.shortfall, output: locator(output) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
