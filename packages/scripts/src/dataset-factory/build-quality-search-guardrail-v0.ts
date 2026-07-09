import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_TASKS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/search_judgments_v0/retrieval_tasks.search_judgments_v0.jsonl',
);
const DEFAULT_CANDIDATES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl',
);
const DEFAULT_QUALITY_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_audit_14822/quality_labels.jsonl',
);
const DEFAULT_REPAIR_QUEUE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_repair_plan_14822/quality-repair-v0-review-queue.jsonl',
);
const DEFAULT_REPAIR_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_repair_plan_14822/quality-repair-v0-report.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_search_guardrail_v0',
);

type Split = 'train' | 'validation' | 'test';

type RetrievalTask = {
  task_id: string;
  split: Split;
  slice: string;
  record_id: string;
  positive_record_ids: string[];
  query: string;
  expected_rank_bucket: string;
  judgment_source?: string;
  evidence_boundary?: string;
  adjudication_status?: string;
};

type CandidateRow = {
  task_id: string;
  split: Split;
  slice: string;
  judgment_source: string;
  evidence_boundary: string;
  adjudication_status: string;
  query: string;
  expected_record_id: string;
  candidate_record_id: string;
  is_positive: boolean;
  ranks: Partial<Record<'semantic' | 'smart' | 'visual', number>>;
  scores: Partial<Record<'semantic' | 'smart' | 'visual', number>>;
  sources: string[];
};

type QualityLabel = {
  id: string;
  audited?: boolean;
  labels?: string[];
  severity?: 'none' | 'low' | 'medium' | 'high';
  recommendedAction?: string;
  confidence?: number;
};

type RepairQueueRow = {
  record_id: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  recommended_action?: string;
  safe_backfill?: string;
  labels?: string[];
};

type RepairStatus = {
  record_id: string;
  labels: string[];
  severity: string;
  queue_priority: string | null;
  queue_action: string | null;
  safe_backfill: string | null;
  audited: boolean;
  confidence: number | null;
  flagged: boolean;
  pure_rotation: boolean;
  derivative_missing: boolean;
  human_review: boolean;
  non_rotation_review: boolean;
};

type PolicyId =
  | 'smart_current'
  | 'smart_rotation_metadata_only'
  | 'smart_filter_derivative_failures'
  | 'smart_demote_nonrotation_review'
  | 'smart_filter_nonrotation_review'
  | 'smart_demote_all_flagged'
  | 'smart_filter_all_flagged'
  | 'union_best_current'
  | 'union_demote_nonrotation_review';

type TaskMetricRow = {
  task_id: string;
  split: Split;
  slice: string;
  judgment_source: string;
  query: string;
  expected_record_id: string;
  policy: PolicyId;
  rank: number | null;
  pass_expected_bucket: boolean;
  found: boolean;
  candidate_count: number;
  expected_repair_status: RepairStatus | null;
};

type Aggregate = {
  tasks: number;
  precision_at_1: number;
  precision_at_3: number;
  precision_at_10: number;
  expected_bucket_pass_rate: number;
  mrr: number;
  found_rate: number;
  candidate_count_mean: number;
};

type PolicySummary = {
  policy: PolicyId;
  baseline_policy: PolicyId | null;
  aggregate: Aggregate;
  delta_vs_baseline: Record<string, number> | null;
  lost_expected_bucket_passes: number;
  gained_expected_bucket_passes: number;
  lost_reviewed_gold_passes: number;
  by_judgment_source: Record<string, Aggregate>;
  by_slice: Record<string, Aggregate>;
  by_split: Record<string, Aggregate>;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filePath}:${index + 1}: ${message}`);
      }
    });
}

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function normalizeId(value: unknown): string {
  const text = String(value ?? '').trim();
  return text.endsWith('.json') ? text : `${text}.json`;
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function thresholdForBucket(bucket: string, limit: number): number {
  if (bucket === 'top_1') return 1;
  if (bucket === 'top_3') return 3;
  if (bucket === 'top_10') return 10;
  if (bucket === 'discoverable') return limit;
  if (bucket === 'negative') return 0;
  return limit;
}

function aggregate(rows: TaskMetricRow[]): Aggregate {
  return {
    tasks: rows.length,
    precision_at_1: mean(rows.map((row) => row.rank !== null && row.rank <= 1 ? 1 : 0)),
    precision_at_3: mean(rows.map((row) => row.rank !== null && row.rank <= 3 ? 1 : 0)),
    precision_at_10: mean(rows.map((row) => row.rank !== null && row.rank <= 10 ? 1 : 0)),
    expected_bucket_pass_rate: mean(rows.map((row) => row.pass_expected_bucket ? 1 : 0)),
    mrr: mean(rows.map((row) => row.rank ? 1 / row.rank : 0)),
    found_rate: mean(rows.map((row) => row.found ? 1 : 0)),
    candidate_count_mean: mean(rows.map((row) => row.candidate_count)),
  };
}

function aggregateBy(rows: TaskMetricRow[], keyFn: (row: TaskMetricRow) => string): Record<string, Aggregate> {
  const grouped: Record<string, TaskMetricRow[]> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    grouped[key] = grouped[key] ?? [];
    grouped[key].push(row);
  }
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, aggregate(value)]));
}

function summarizeDelta(current: Aggregate, baseline: Aggregate): Record<string, number> {
  return {
    precision_at_1: current.precision_at_1 - baseline.precision_at_1,
    precision_at_3: current.precision_at_3 - baseline.precision_at_3,
    precision_at_10: current.precision_at_10 - baseline.precision_at_10,
    expected_bucket_pass_rate: current.expected_bucket_pass_rate - baseline.expected_bucket_pass_rate,
    mrr: current.mrr - baseline.mrr,
    found_rate: current.found_rate - baseline.found_rate,
    candidate_count_mean: current.candidate_count_mean - baseline.candidate_count_mean,
  };
}

function labelsFrom(label: QualityLabel | undefined, queue: RepairQueueRow | undefined): string[] {
  return Array.from(new Set([...(label?.labels ?? []), ...(queue?.labels ?? [])])).sort();
}

function isPureRotation(labels: string[], queueAction: string | null): boolean {
  if (queueAction !== 'rotate_metadata_backfill') return false;
  const nonRotationLabels = labels.filter((label) => ![
    'orientation_exif_rotation',
  ].includes(label));
  return nonRotationLabels.length === 0;
}

function buildRepairStatus(
  label: QualityLabel | undefined,
  queue: RepairQueueRow | undefined,
  recordId: string,
): RepairStatus | null {
  if (!label && !queue) return null;
  const labels = labelsFrom(label, queue);
  const queueAction = queue?.recommended_action ?? null;
  const severity = label?.severity ?? 'unknown';
  const derivativeMissing = labels.includes('image_derivative_missing')
    || labels.includes('image_fetch_or_decode_failure')
    || labels.includes('image_fetch_network_failure')
    || queueAction === 'fetch_decode_retry';
  const pureRotation = isPureRotation(labels, queueAction);
  const humanReview = Boolean(queue && !['rotate_metadata_backfill', 'no_action'].includes(queueAction ?? ''));
  return {
    record_id: recordId,
    labels,
    severity,
    queue_priority: queue?.priority ?? null,
    queue_action: queueAction,
    safe_backfill: queue?.safe_backfill ?? null,
    audited: Boolean(label?.audited),
    confidence: typeof label?.confidence === 'number' ? label.confidence : null,
    flagged: severity !== 'none' || Boolean(queue),
    pure_rotation: pureRotation,
    derivative_missing: derivativeMissing,
    human_review: humanReview,
    non_rotation_review: humanReview || derivativeMissing || (Boolean(queue) && !pureRotation && queueAction !== 'rotate_metadata_backfill'),
  };
}

function bestModeRank(candidate: CandidateRow): number | null {
  const ranks = Object.values(candidate.ranks).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return ranks.length ? Math.min(...ranks) : null;
}

function bestScore(candidate: CandidateRow): number {
  return Math.max(...Object.values(candidate.scores).map((value) => typeof value === 'number' ? value : 0), 0);
}

function baseScore(candidate: CandidateRow, scope: 'smart' | 'union_best'): number | null {
  const rank = scope === 'smart' ? candidate.ranks.smart : bestModeRank(candidate);
  if (typeof rank !== 'number') return null;
  return 1000 - rank + bestScore(candidate) / 100;
}

function policyScore(
  candidate: CandidateRow,
  policy: PolicyId,
  status: RepairStatus | null,
): number | null {
  const scope = policy.startsWith('union_') ? 'union_best' : 'smart';
  const base = baseScore(candidate, scope);
  if (base === null) return null;
  if (policy.endsWith('_current') || policy === 'smart_rotation_metadata_only') return base;
  if (policy === 'smart_filter_derivative_failures' && status?.derivative_missing) return null;
  if (policy === 'smart_filter_nonrotation_review' && status?.non_rotation_review) return null;
  if (policy === 'smart_filter_all_flagged' && status?.flagged) return null;
  if (policy === 'smart_demote_nonrotation_review' && status?.non_rotation_review) return base - 1000;
  if (policy === 'union_demote_nonrotation_review' && status?.non_rotation_review) return base - 1000;
  if (policy === 'smart_demote_all_flagged' && status?.flagged) return base - 1000;
  return base;
}

function evaluatePolicy(params: {
  tasks: RetrievalTask[];
  candidatesByTask: Map<string, CandidateRow[]>;
  statusByRecord: Map<string, RepairStatus>;
  policy: PolicyId;
  limit: number;
}): TaskMetricRow[] {
  return params.tasks.map((task) => {
    const expected = normalizeId(task.positive_record_ids[0] ?? task.record_id);
    const candidates = (params.candidatesByTask.get(task.task_id) ?? [])
      .map((candidate) => ({
        candidate,
        status: params.statusByRecord.get(normalizeId(candidate.candidate_record_id)) ?? null,
        score: policyScore(candidate, params.policy, params.statusByRecord.get(normalizeId(candidate.candidate_record_id)) ?? null),
      }))
      .filter((row): row is { candidate: CandidateRow; status: RepairStatus | null; score: number } => row.score !== null)
      .sort((a, b) => b.score - a.score || a.candidate.candidate_record_id.localeCompare(b.candidate.candidate_record_id));
    const index = candidates.findIndex((row) => normalizeId(row.candidate.candidate_record_id) === expected);
    const rank = index >= 0 ? index + 1 : null;
    const threshold = thresholdForBucket(task.expected_rank_bucket, params.limit);
    return {
      task_id: task.task_id,
      split: task.split,
      slice: task.slice,
      judgment_source: task.judgment_source ?? candidates[0]?.candidate.judgment_source ?? 'unknown',
      query: task.query,
      expected_record_id: expected,
      policy: params.policy,
      rank,
      pass_expected_bucket: task.expected_rank_bucket === 'negative' ? rank === null : rank !== null && rank <= threshold,
      found: rank !== null,
      candidate_count: candidates.length,
      expected_repair_status: params.statusByRecord.get(expected) ?? null,
    };
  });
}

function summarizePolicy(policy: PolicyId, rows: TaskMetricRow[], baselineRows: TaskMetricRow[] | null): PolicySummary {
  const byTaskBaseline = new Map((baselineRows ?? []).map((row) => [row.task_id, row]));
  const agg = aggregate(rows);
  const baselineAgg = baselineRows ? aggregate(baselineRows) : null;
  const lost = rows.filter((row) => byTaskBaseline.get(row.task_id)?.pass_expected_bucket && !row.pass_expected_bucket);
  const gained = rows.filter((row) => !byTaskBaseline.get(row.task_id)?.pass_expected_bucket && row.pass_expected_bucket);
  return {
    policy,
    baseline_policy: baselineRows?.[0]?.policy ?? null,
    aggregate: agg,
    delta_vs_baseline: baselineAgg ? summarizeDelta(agg, baselineAgg) : null,
    lost_expected_bucket_passes: lost.length,
    gained_expected_bucket_passes: gained.length,
    lost_reviewed_gold_passes: lost.filter((row) => row.judgment_source === 'reviewed_gold').length,
    by_judgment_source: aggregateBy(rows, (row) => row.judgment_source),
    by_slice: aggregateBy(rows, (row) => row.slice),
    by_split: aggregateBy(rows, (row) => row.split),
  };
}

function impactRows(policyRows: TaskMetricRow[], baselineRows: TaskMetricRow[]): Record<string, unknown>[] {
  const baselineByTask = new Map(baselineRows.map((row) => [row.task_id, row]));
  return policyRows.map((row) => {
    const baseline = baselineByTask.get(row.task_id);
    return {
      task_id: row.task_id,
      policy: row.policy,
      split: row.split,
      slice: row.slice,
      judgment_source: row.judgment_source,
      query: row.query,
      expected_record_id: row.expected_record_id,
      baseline_rank: baseline?.rank ?? null,
      policy_rank: row.rank,
      baseline_pass: baseline?.pass_expected_bucket ?? false,
      policy_pass: row.pass_expected_bucket,
      pass_delta: Number(row.pass_expected_bucket) - Number(baseline?.pass_expected_bucket ?? false),
      rank_delta: baseline?.rank && row.rank ? row.rank - baseline.rank : null,
      expected_repair_status: row.expected_repair_status,
    };
  });
}

function metric(value: number): string {
  return value.toFixed(3);
}

function renderAggregateTable(title: string, summaries: PolicySummary[]): string[] {
  const lines = [
    `## ${title}`,
    '',
    '| Policy | Baseline | P@1 | P@3 | P@10 | Expected Pass | MRR | Found | Lost Passes | Lost Gold |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const summary of summaries) {
    const delta = summary.delta_vs_baseline;
    const deltaText = delta ? ` (${delta.expected_bucket_pass_rate >= 0 ? '+' : ''}${metric(delta.expected_bucket_pass_rate)})` : '';
    lines.push(`| ${summary.policy} | ${summary.baseline_policy ?? '-'} | ${metric(summary.aggregate.precision_at_1)} | ${metric(summary.aggregate.precision_at_3)} | ${metric(summary.aggregate.precision_at_10)} | ${metric(summary.aggregate.expected_bucket_pass_rate)}${deltaText} | ${metric(summary.aggregate.mrr)} | ${metric(summary.aggregate.found_rate)} | ${summary.lost_expected_bucket_passes} | ${summary.lost_reviewed_gold_passes} |`);
  }
  lines.push('');
  return lines;
}

function renderMarkdown(report: Record<string, unknown>, summaries: PolicySummary[], impacts: Record<string, unknown>[]): string {
  const overlap = report.expected_positive_repair_overlap as Record<string, unknown>;
  const badImpacts = impacts
    .filter((row) => row.pass_delta === -1)
    .slice(0, 20);
  const lines = [
    '# Quality Repair Search Guardrail v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Decision',
    '',
    String(report.decision),
    '',
    '## Coverage',
    '',
    `- Retrieval tasks: ${report.task_count}`,
    `- Candidate rows: ${report.candidate_count}`,
    `- Quality labels: ${report.quality_label_count}`,
    `- Repair queue rows: ${report.repair_queue_count}`,
    `- Expected positives in repair queue: ${overlap.expected_positives_in_repair_queue}`,
    `- Expected positives with non-rotation review risk: ${overlap.expected_positives_nonrotation_review}`,
    `- Expected positives with derivative-missing risk: ${overlap.expected_positives_derivative_missing}`,
    '',
    ...renderAggregateTable('Policy Metrics', summaries),
    '## First Lost-Pass Impacts',
    '',
  ];
  if (!badImpacts.length) {
    lines.push('No policy lost an expected-bucket pass against its baseline.');
  } else {
    lines.push('| Policy | Task | Source | Slice | Query | Expected | Baseline Rank | Policy Rank | Labels | Action |', '|---|---|---|---|---|---|---:|---:|---|---|');
    for (const row of badImpacts) {
      const status = row.expected_repair_status as RepairStatus | null;
      lines.push(`| ${row.policy} | ${row.task_id} | ${row.judgment_source} | ${row.slice} | ${String(row.query).replace(/\|/g, '\\|')} | ${row.expected_record_id} | ${row.baseline_rank ?? 'missing'} | ${row.policy_rank ?? 'missing'} | ${(status?.labels ?? []).join(', ')} | ${status?.queue_action ?? '-'} |`);
    }
  }
  lines.push(
    '',
    '## Notes',
    '',
    '- This is an offline guardrail over existing search candidate artifacts; it does not mutate D1, Vectorize, R2, or production ranking.',
    '- `smart_rotation_metadata_only` intentionally has no ranking effect; it exists to verify that metadata-only orientation backfill is not being conflated with quality demotion.',
    '- Broad filtering/demotion policies are stress tests, not recommendations.',
    '- The current repair queue uses `review_only` for rotation rows while still emitting SQL for human review; SQL must not be applied blindly.',
    '',
  );
  return `${lines.join('\n')}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tasks: { type: 'string', default: DEFAULT_TASKS },
      candidates: { type: 'string', default: DEFAULT_CANDIDATES },
      'quality-labels': { type: 'string', default: DEFAULT_QUALITY_LABELS },
      'repair-queue': { type: 'string', default: DEFAULT_REPAIR_QUEUE },
      'repair-report': { type: 'string', default: DEFAULT_REPAIR_REPORT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      limit: { type: 'string', default: '10' },
    },
  });

  const tasksPath = resolveRepoPath(values.tasks!);
  const candidatesPath = resolveRepoPath(values.candidates!);
  const qualityLabelsPath = resolveRepoPath(values['quality-labels']!);
  const repairQueuePath = resolveRepoPath(values['repair-queue']!);
  const repairReportPath = resolveRepoPath(values['repair-report']!);
  const outputDir = resolveRepoPath(values.output!);
  const limit = Math.max(1, Number(values.limit ?? 10));

  const tasks = readJsonl<RetrievalTask>(tasksPath);
  const candidates = readJsonl<CandidateRow>(candidatesPath);
  const qualityLabels = readJsonl<QualityLabel>(qualityLabelsPath);
  const repairQueue = readJsonl<RepairQueueRow>(repairQueuePath);
  const repairReport = fs.existsSync(repairReportPath)
    ? JSON.parse(fs.readFileSync(repairReportPath, 'utf-8')) as Record<string, unknown>
    : null;

  const labelsByRecord = new Map(qualityLabels.map((row) => [normalizeId(row.id), row]));
  const queueByRecord = new Map(repairQueue.map((row) => [normalizeId(row.record_id), row]));
  const statusByRecord = new Map<string, RepairStatus>();
  for (const recordId of new Set([...labelsByRecord.keys(), ...queueByRecord.keys()])) {
    const status = buildRepairStatus(labelsByRecord.get(recordId), queueByRecord.get(recordId), recordId);
    if (status) statusByRecord.set(recordId, status);
  }

  const candidatesByTask = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) {
    candidatesByTask.set(candidate.task_id, candidatesByTask.get(candidate.task_id) ?? []);
    candidatesByTask.get(candidate.task_id)!.push(candidate);
  }

  const policies: PolicyId[] = [
    'smart_current',
    'smart_rotation_metadata_only',
    'smart_filter_derivative_failures',
    'smart_demote_nonrotation_review',
    'smart_filter_nonrotation_review',
    'smart_demote_all_flagged',
    'smart_filter_all_flagged',
    'union_best_current',
    'union_demote_nonrotation_review',
  ];
  const rowsByPolicy = new Map<PolicyId, TaskMetricRow[]>();
  for (const policy of policies) {
    rowsByPolicy.set(policy, evaluatePolicy({ tasks, candidatesByTask, statusByRecord, policy, limit }));
  }

  const smartBaseline = rowsByPolicy.get('smart_current')!;
  const unionBaseline = rowsByPolicy.get('union_best_current')!;
  const summaries = policies.map((policy) => summarizePolicy(
    policy,
    rowsByPolicy.get(policy)!,
    policy.startsWith('union_')
      ? (policy === 'union_best_current' ? null : unionBaseline)
      : (policy === 'smart_current' ? null : smartBaseline),
  ));
  const impacts = policies
    .filter((policy) => policy !== 'smart_current' && policy !== 'union_best_current')
    .flatMap((policy) => impactRows(rowsByPolicy.get(policy)!, policy.startsWith('union_') ? unionBaseline : smartBaseline));

  const expectedStatuses = tasks.map((task) => statusByRecord.get(normalizeId(task.positive_record_ids[0] ?? task.record_id)) ?? null);
  const report = {
    issue: 53,
    guardrail_id: 'quality_repair_search_guardrail_v0',
    generated_at: datasetFactoryNowIso(),
    inputs: {
      tasks: rel(tasksPath),
      candidates: rel(candidatesPath),
      quality_labels: rel(qualityLabelsPath),
      repair_queue: rel(repairQueuePath),
      repair_report: fs.existsSync(repairReportPath) ? rel(repairReportPath) : null,
    },
    task_count: tasks.length,
    candidate_count: candidates.length,
    quality_label_count: qualityLabels.length,
    repair_queue_count: repairQueue.length,
    repair_report_decision: repairReport?.decision ?? null,
    repair_report_full_audit_ready: repairReport?.full_audit_ready ?? null,
    status_counts: {
      by_severity: countBy(Array.from(statusByRecord.values()), (row) => row.severity),
      by_queue_action: countBy(Array.from(statusByRecord.values()).filter((row) => row.queue_action), (row) => row.queue_action ?? 'none'),
      by_priority: countBy(Array.from(statusByRecord.values()).filter((row) => row.queue_priority), (row) => row.queue_priority ?? 'none'),
    },
    expected_positive_repair_overlap: {
      expected_positives_with_any_quality_status: expectedStatuses.filter(Boolean).length,
      expected_positives_in_repair_queue: expectedStatuses.filter((row) => row?.queue_action).length,
      expected_positives_pure_rotation: expectedStatuses.filter((row) => row?.pure_rotation).length,
      expected_positives_nonrotation_review: expectedStatuses.filter((row) => row?.non_rotation_review).length,
      expected_positives_derivative_missing: expectedStatuses.filter((row) => row?.derivative_missing).length,
      by_queue_action: countBy(expectedStatuses.filter((row): row is RepairStatus => Boolean(row?.queue_action)), (row) => row.queue_action ?? 'none'),
      by_label: countBy(expectedStatuses.flatMap((row) => row?.labels ?? []), (label) => label),
    },
    summaries,
    decision: 'Safe to treat rotation metadata as reviewable metadata-only repair. Do not use Quality Repair v0 as a broad search demotion/filter until non-rotation review rows are adjudicated and a post-apply benchmark preserves reviewed-gold retrieval.',
    caveats: [
      'This guardrail uses existing search candidate artifacts rather than refetching live API candidates.',
      'Policy simulations are ranking stress tests; they do not measure regenerated embeddings from physically rotated/cropped images.',
      'Silver research-enrichment tasks are useful stress tests but should not override reviewed-gold regressions.',
    ],
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'quality-search-guardrail-v0-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'quality-search-guardrail-v0-report.md'), renderMarkdown(report, summaries, impacts), 'utf-8');
  writeJsonl(path.join(outputDir, 'quality-search-guardrail-v0-task-impacts.jsonl'), impacts);

  console.log(`[quality-search-guardrail-v0] output=${rel(outputDir)}`);
  for (const summary of summaries) {
    const delta = summary.delta_vs_baseline?.expected_bucket_pass_rate;
    console.log(`- ${summary.policy}: expectedPass=${summary.aggregate.expected_bucket_pass_rate.toFixed(3)} lost=${summary.lost_expected_bucket_passes}${typeof delta === 'number' ? ` delta=${delta.toFixed(3)}` : ''}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
