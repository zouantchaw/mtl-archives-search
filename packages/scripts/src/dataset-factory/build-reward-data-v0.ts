import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_PAIRWISE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_reranker_v0_prod/search_pairwise_preferences.jsonl',
);
const DEFAULT_ACTIVE_LEARNING = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/reward_data_v0');
const DEFAULT_CAPTURED_AT = '2026-06-30T05:09:10.000Z';

type Split = 'train' | 'validation' | 'test';
type RewardSignalType = 'pairwise_preference' | 'pointwise_rating' | 'product_behavior' | 'social_performance' | 'stakeholder_decision' | 'codex_review';
type SourceType = 'codex' | 'human' | 'product_analytics' | 'social_platform' | 'stakeholder' | 'model';
type RewardSurface = 'search' | 'dataset_factory' | 'social' | 'print' | 'partner' | 'newsletter' | 'game' | 'unknown';
type RewardTarget = 'search_relevance' | 'story_value' | 'print_value' | 'social_engagement' | 'partner_fit' | 'trust_provenance' | 'quality_repair';
type GroundTruthBoundary = 'reward_not_fact' | 'factual_label' | 'mixed' | 'unknown';

type PairwisePreference = {
  preference_id: string;
  task_id: string;
  split: Split;
  query: string;
  preferred_record_id: string;
  other_record_id: string;
  source: string;
  label: string;
  rationale: string;
};

type ActiveLearningRow = {
  queue_id: string;
  selected_at: string;
  rank: number;
  record: {
    id: string;
  };
  acquisition: {
    score: number;
    primary_stratum: string;
    reasons: string[];
    strata: string[];
  };
  current_signals: {
    model_baseline_gap_matches?: string[];
  };
  label_task: {
    priority: 'critical' | 'high' | 'medium';
    ml_tasks: string[];
  };
};

type RewardSignal = {
  schema_version: 'mtl_reward_signal_v0';
  signal_id: string;
  signal_type: RewardSignalType;
  source_type: SourceType;
  source_event_id: string;
  source_url: string | null;
  captured_at: string;
  surface: RewardSurface;
  reward_target: RewardTarget;
  reward_value: number;
  confidence: number;
  ground_truth_boundary: GroundTruthBoundary;
  record_ids: string[];
  preferred_record_id: string | null;
  other_record_id: string | null;
  query: string | null;
  task_id: string | null;
  split: Split | null;
  label: string | null;
  evidence_refs: string[];
  context: {
    benchmark_id: string | null;
    label_version: string | null;
    ranking_version: string | null;
    image_family: string | null;
    audience: string | null;
    platform: string | null;
    notes: string;
    source_preference_type?: string;
    source_signal_type?: string;
    queue_rank?: number;
    queue_priority?: string;
    primary_stratum?: string;
  };
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file does not exist: ${filePath}`);
  }
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function confidenceForPreference(pref: PairwisePreference): number {
  if (pref.split === 'train') return 0.86;
  if (pref.split === 'validation') return 0.82;
  return 0.8;
}

function rewardSignalFromPreference(pref: PairwisePreference, capturedAt: string): RewardSignal {
  return {
    schema_version: 'mtl_reward_signal_v0',
    signal_id: `reward-search-${pref.preference_id}`,
    signal_type: 'pairwise_preference',
    source_type: 'codex',
    source_event_id: pref.preference_id,
    source_url: null,
    captured_at: capturedAt,
    surface: 'search',
    reward_target: 'search_relevance',
    reward_value: 1,
    confidence: confidenceForPreference(pref),
    ground_truth_boundary: 'reward_not_fact',
    record_ids: unique([pref.preferred_record_id, pref.other_record_id]),
    preferred_record_id: pref.preferred_record_id,
    other_record_id: pref.other_record_id,
    query: pref.query,
    task_id: pref.task_id,
    split: pref.split,
    label: 'preferred',
    evidence_refs: [pref.task_id, pref.preference_id],
    context: {
      benchmark_id: 'mtl_citymemory_bench_v0',
      label_version: 'dataset_factory_label_v0.quality_model_review_001_gold',
      ranking_version: 'search_reranker_v0_prod',
      image_family: null,
      audience: 'dataset_factory',
      platform: 'mtl_archives_search',
      notes: pref.rationale,
      source_preference_type: pref.source,
    },
  };
}

function rewardTargetForModelGap(target: string): RewardTarget {
  if (target === 'search_value') return 'search_relevance';
  if (target === 'story_value') return 'story_value';
  if (target === 'print_value') return 'print_value';
  if (target === 'partner_fit_tourism_local') return 'partner_fit';
  if (target === 'needs_human_review') return 'trust_provenance';
  return 'quality_repair';
}

function confidenceForActiveLearning(row: ActiveLearningRow): number {
  if (row.label_task.priority === 'critical') return 0.74;
  if (row.label_task.priority === 'high') return 0.68;
  return 0.62;
}

function rewardValueForActiveLearning(row: ActiveLearningRow): number {
  return Math.max(0.1, Math.min(1, row.acquisition.score / 100));
}

function rewardSignalsFromActiveLearning(row: ActiveLearningRow, capturedAt: string): RewardSignal[] {
  const targets = unique(row.current_signals.model_baseline_gap_matches ?? []).sort();
  return targets.map((target) => ({
    schema_version: 'mtl_reward_signal_v0',
    signal_id: `reward-active-learning-${row.queue_id}-${target}`,
    signal_type: 'codex_review',
    source_type: 'model',
    source_event_id: `${row.queue_id}:${target}`,
    source_url: null,
    captured_at: row.selected_at || capturedAt,
    surface: 'dataset_factory',
    reward_target: rewardTargetForModelGap(target),
    reward_value: rewardValueForActiveLearning(row),
    confidence: confidenceForActiveLearning(row),
    ground_truth_boundary: 'reward_not_fact',
    record_ids: [row.record.id],
    preferred_record_id: null,
    other_record_id: null,
    query: null,
    task_id: row.queue_id,
    split: null,
    label: 'selected_for_model_gap_review',
    evidence_refs: [row.queue_id, `model_gap:${target}`],
    context: {
      benchmark_id: 'mtl_citymemory_bench_v0',
      label_version: 'dataset_factory_label_v0.quality_model_review_001_gold',
      ranking_version: 'active_learning_v0_model_baseline_gap',
      image_family: null,
      audience: 'dataset_factory',
      platform: 'mtl_archives_search',
      notes: `Selected by Active Learning v0 to repair model-baseline target ${target}. Reasons: ${row.acquisition.reasons.slice(0, 4).join('; ')}`,
      source_signal_type: 'active_learning_model_gap',
      queue_rank: row.rank,
      queue_priority: row.label_task.priority,
      primary_stratum: row.acquisition.primary_stratum,
    },
  }));
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Reward Data v0 Report

Generated at: ${report.generated_at}

## Summary

- Input pairwise preferences: ${report.input_pairwise_preferences}
- Input active-learning rows: ${report.input_active_learning_rows}
- Reward signals written: ${report.reward_signals}
- Output: \`${report.output_jsonl}\`

## By Split

\`\`\`json
${JSON.stringify(report.by_split, null, 2)}
\`\`\`

## By Target

\`\`\`json
${JSON.stringify(report.by_reward_target, null, 2)}
\`\`\`

## Notes

- These rows are reward/preference data, not factual ground truth.
- They are derived from reviewed-gold retrieval positives, retrieved hard negatives, and dataset-factory model-gap acquisition signals.
- Future product, social, print, partner, and stakeholder events should use the same schema but must preserve their source context.
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      pairwise: { type: 'string', default: DEFAULT_PAIRWISE },
      'active-learning': { type: 'string', default: DEFAULT_ACTIVE_LEARNING },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'captured-at': { type: 'string', default: DEFAULT_CAPTURED_AT },
    },
  });

  const pairwisePath = resolveRepoPath(values.pairwise!);
  const activeLearningPath = resolveRepoPath(values['active-learning']!);
  const outputDir = resolveRepoPath(values.output!);
  const capturedAt = values['captured-at']!;
  requireArtifacts([
    { path: pairwisePath, label: 'search pairwise preferences' },
    { path: activeLearningPath, label: 'active-learning queue' },
  ]);
  const preferences = readJsonl<PairwisePreference>(pairwisePath);
  const activeLearningRows = readJsonl<ActiveLearningRow>(activeLearningPath);
  const searchSignals = preferences.map((pref) => rewardSignalFromPreference(pref, capturedAt));
  const activeLearningSignals = activeLearningRows.flatMap((row) => rewardSignalsFromActiveLearning(row, capturedAt));
  const signals = [...searchSignals, ...activeLearningSignals];

  fs.mkdirSync(outputDir, { recursive: true });
  const outputJsonl = path.join(outputDir, 'reward-signals-v0.jsonl');
  writeJsonl(outputJsonl, signals);

  const report = {
    generated_at: datasetFactoryNowIso(),
    schema_version: 'mtl_reward_signal_v0',
    input_pairwise_preferences: preferences.length,
    input_active_learning_rows: activeLearningRows.length,
    search_reward_signals: searchSignals.length,
    dataset_factory_reward_signals: activeLearningSignals.length,
    reward_signals: signals.length,
    inputs: {
      pairwise_preferences: path.relative(MONOREPO_ROOT, pairwisePath),
      active_learning_queue: path.relative(MONOREPO_ROOT, activeLearningPath),
    },
    output_jsonl: path.relative(MONOREPO_ROOT, outputJsonl),
    by_split: countBy(signals, (row) => row.split ?? 'unknown'),
    by_reward_target: countBy(signals, (row) => row.reward_target),
    by_surface: countBy(signals, (row) => row.surface),
    by_source_type: countBy(signals, (row) => row.source_type),
    by_signal_type: countBy(signals, (row) => row.signal_type),
    caveats: [
      'Reward data is intentionally separate from factual labels.',
      'Search rows are query-level preferences; dataset-factory rows are acquisition/model-gap usefulness signals.',
      'Product and social event backfills should preserve source-specific context before use in optimization.',
    ],
  };

  fs.writeFileSync(path.join(outputDir, 'reward-data-v0-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'reward-data-v0-report.md'), renderMarkdown(report), 'utf-8');

  console.log(`Wrote Reward Data v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- reward_signals=${signals.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
