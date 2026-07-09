import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl',
);
const DEFAULT_BENCHMARK = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold',
);
const DEFAULT_MANIFEST = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/model_baseline_v0_cpu_text',
);
const GENERATED_AT = datasetFactoryNowIso();

type EvidenceItem = {
  id: string;
  claim: string;
  evidence_type: string;
  source_field: string | null;
  source_url: string | null;
  confidence: number;
  review_flags: string[];
};

type LabelRow = {
  record_id: string;
  image_filename: string;
  source: {
    source_url: string | null;
    package_slug: string | null;
  };
  labels: {
    human_legible: string;
    story_value: string;
    print_value: string;
    partner_fit: string[];
    search_value: string;
    image_mode?: string;
    scene_text?: Array<Record<string, unknown>>;
    entities?: Array<Record<string, unknown>>;
    aerial_land_use?: Record<string, unknown>;
    geo_hypotheses?: Array<Record<string, unknown>>;
    search_expectations?: Array<{
      query: string;
      rationale: string;
    }>;
  };
  evidence: {
    observed: EvidenceItem[];
    metadata: EvidenceItem[];
    inferred: EvidenceItem[];
    verified: EvidenceItem[];
  };
  confidence: {
    needs_human_review: boolean;
  };
};

type ManifestRow = {
  metadata_filename?: string;
  image_filename?: string;
  name?: string;
  description?: string;
  raw_description?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  vlm_caption?: string | null;
  vlm_metadata?: Record<string, unknown> | null;
};

type ClassificationTask = {
  split: 'train' | 'validation' | 'test';
  record_id: string;
  label_name: string;
  target: string | boolean | string[];
};

type SplitRow = {
  record_id: string;
  split: 'train' | 'validation' | 'test';
  family_key: string;
};

type Example = {
  record_id: string;
  split: 'train' | 'validation' | 'test';
  family_key: string;
  label_name: string;
  target: string;
  text: string;
  tokens: string[];
  feature_excerpt: string;
};

type PredictionRow = {
  evaluation: 'holdout' | 'leave_one_out';
  label_name: string;
  record_id: string;
  split: 'train' | 'validation' | 'test';
  family_key: string;
  actual: string;
  predicted: string;
  confidence: number;
  majority_predicted: string;
  majority_correct: boolean;
  correct: boolean;
  score_gap: number;
  feature_excerpt: string;
};

type LabelReport = {
  label_name: string;
  status: 'evaluated' | 'single_class' | 'insufficient_train_classes' | 'no_holdout_examples';
  class_support: Record<string, number>;
  train_class_support: Record<string, number>;
  holdout?: MetricsReport;
  leave_one_out?: MetricsReport;
  positive_error_review?: PositiveErrorReview;
  decision: {
    advance: boolean;
    reason: string;
    next_action: string;
  };
};

type MetricsReport = {
  examples: number;
  accuracy: number;
  majority_accuracy: number;
  lift_vs_majority: number;
  balanced_accuracy: number;
  macro_f1: number;
  confusion: Record<string, Record<string, number>>;
};

type PositiveErrorReview = {
  positive_definition: string;
  false_positives: number;
  false_negatives: number;
  reviewed_examples: Array<Pick<
    PredictionRow,
    'record_id' | 'split' | 'actual' | 'predicted' | 'confidence' | 'score_gap' | 'feature_excerpt'
  > & { error_type: 'false_positive' | 'false_negative' }>;
};

type Model = {
  classes: string[];
  classDocCounts: Map<string, number>;
  classTokenCounts: Map<string, Map<string, number>>;
  classTotalTokens: Map<string, number>;
  vocabulary: Set<string>;
  majorityClass: string;
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'avec', 'au', 'aux', 'be', 'by', 'captured', 'cote', 'd',
  'dans', 'de', 'des', 'du', 'en', 'et', 'for', 'from', 'in', 'is', 'la', 'le', 'les', 'of', 'on',
  'or', 'ou', 'par', 'pour', 'source', 'sur', 'the', 'to', 'un', 'une', 'with',
]);

const POSITIVE_LABELS: Record<string, { description: string; isPositive: (value: string) => boolean }> = {
  human_legible: {
    description: 'human_legible == high',
    isPositive: (value) => value === 'high',
  },
  story_value: {
    description: 'story_value == high',
    isPositive: (value) => value === 'high',
  },
  print_value: {
    description: 'print_value in {medium, high}',
    isPositive: (value) => value === 'medium' || value === 'high',
  },
  search_value: {
    description: 'search_value in {high, priority}',
    isPositive: (value) => value === 'high' || value === 'priority',
  },
  partner_fit_tourism_local: {
    description: 'partner_fit includes tourism_local',
    isPositive: (value) => value === 'true',
  },
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
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

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(' ');
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).map(stringifyValue).filter(Boolean).join(' ');
  return String(value);
}

function targetKey(target: string | boolean | string[]): string {
  if (Array.isArray(target)) return target.map(String).sort().join('|');
  return String(target);
}

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && token.length <= 32 && !STOPWORDS.has(token))
    ?? [];
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function manifestIndex(rows: ManifestRow[]): Map<string, ManifestRow> {
  const map = new Map<string, ManifestRow>();
  for (const row of rows) {
    if (row.metadata_filename) map.set(row.metadata_filename, row);
    if (row.image_filename) map.set(row.image_filename, row);
  }
  return map;
}

function isLeakProneObservedClaim(item: EvidenceItem): boolean {
  return item.id === 'obs_visual'
    || /^Contact-sheet review shows a /i.test(item.claim)
    || /assigns image mode/i.test(item.claim);
}

function featureText(label: LabelRow, manifest: ManifestRow | undefined): string {
  const parts: string[] = [
    label.source.package_slug ?? '',
    manifest?.name ?? '',
    manifest?.description ?? '',
    manifest?.raw_description ?? '',
    stringifyValue(manifest?.attributes_map ?? {}),
    manifest?.vlm_caption ?? '',
    stringifyValue(manifest?.vlm_metadata ?? {}),
    ...(label.evidence.metadata ?? []).map((item) => item.claim),
    ...(label.evidence.observed ?? []).filter((item) => !isLeakProneObservedClaim(item)).map((item) => item.claim),
    ...(label.evidence.verified ?? []).map((item) => item.claim),
    ...((label.labels.scene_text ?? []).map(stringifyValue)),
    ...((label.labels.entities ?? []).map(stringifyValue)),
    ...((label.labels.search_expectations ?? []).flatMap((expectation) => [expectation.query, expectation.rationale])),
    stringifyValue(label.labels.aerial_land_use ?? {}),
    ...((label.labels.geo_hypotheses ?? []).map(stringifyValue)),
  ];

  return parts.filter(Boolean).join(' ');
}

function buildExamples(
  labels: LabelRow[],
  tasks: ClassificationTask[],
  splits: Map<string, SplitRow>,
  manifests: Map<string, ManifestRow>,
): Example[] {
  const byRecord = new Map(labels.map((label) => [label.record_id, label]));
  const examples: Example[] = [];

  for (const task of tasks) {
    const label = byRecord.get(task.record_id);
    const split = splits.get(task.record_id);
    if (!label || !split) continue;
    const text = featureText(label, manifests.get(label.record_id) ?? manifests.get(label.image_filename));
    examples.push({
      record_id: task.record_id,
      split: task.split,
      family_key: split.family_key,
      label_name: task.label_name,
      target: targetKey(task.target),
      text,
      tokens: tokenize(text),
      feature_excerpt: text.replace(/\s+/g, ' ').slice(0, 260),
    });
  }

  for (const label of labels) {
    const split = splits.get(label.record_id);
    if (!split) continue;
    const text = featureText(label, manifests.get(label.record_id) ?? manifests.get(label.image_filename));
    examples.push({
      record_id: label.record_id,
      split: split.split,
      family_key: split.family_key,
      label_name: 'partner_fit_tourism_local',
      target: String((label.labels.partner_fit ?? []).includes('tourism_local')),
      text,
      tokens: tokenize(text),
      feature_excerpt: text.replace(/\s+/g, ' ').slice(0, 260),
    });
  }

  return examples;
}

function trainNaiveBayes(examples: Example[]): Model {
  const classDocCounts = new Map<string, number>();
  const classTokenCounts = new Map<string, Map<string, number>>();
  const classTotalTokens = new Map<string, number>();
  const vocabulary = new Set<string>();

  for (const example of examples) {
    classDocCounts.set(example.target, (classDocCounts.get(example.target) ?? 0) + 1);
    const tokenCounts = classTokenCounts.get(example.target) ?? new Map<string, number>();
    for (const token of example.tokens) {
      vocabulary.add(token);
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      classTotalTokens.set(example.target, (classTotalTokens.get(example.target) ?? 0) + 1);
    }
    classTokenCounts.set(example.target, tokenCounts);
  }

  const classes = [...classDocCounts.keys()].sort();
  const majorityClass = [...classDocCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'unknown';

  return { classes, classDocCounts, classTokenCounts, classTotalTokens, vocabulary, majorityClass };
}

function predict(model: Model, example: Example): { predicted: string; confidence: number; gap: number; scores: Record<string, number> } {
  if (model.classes.length < 2) {
    return { predicted: model.majorityClass, confidence: 1, gap: 0, scores: { [model.majorityClass]: 0 } };
  }

  const alpha = 1;
  const docs = [...model.classDocCounts.values()].reduce((sum, value) => sum + value, 0);
  const vocabSize = Math.max(1, model.vocabulary.size);
  const docTokenCounts = new Map<string, number>();
  for (const token of example.tokens) {
    docTokenCounts.set(token, (docTokenCounts.get(token) ?? 0) + 1);
  }

  const scores: Record<string, number> = {};
  for (const klass of model.classes) {
    const classDocs = model.classDocCounts.get(klass) ?? 0;
    const classPrior = Math.log((classDocs + alpha) / (docs + alpha * model.classes.length));
    const tokenCounts = model.classTokenCounts.get(klass) ?? new Map<string, number>();
    const totalTokens = model.classTotalTokens.get(klass) ?? 0;
    let score = classPrior;
    for (const [token, count] of docTokenCounts.entries()) {
      const probability = ((tokenCounts.get(token) ?? 0) + alpha) / (totalTokens + alpha * vocabSize);
      score += count * Math.log(probability);
    }
    scores[klass] = score;
  }

  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const predicted = ordered[0]?.[0] ?? model.majorityClass;
  const max = ordered[0]?.[1] ?? 0;
  const second = ordered[1]?.[1] ?? max;
  const denominator = ordered.reduce((sum, [, score]) => sum + Math.exp(score - max), 0);
  const confidence = denominator > 0 ? Math.min(0.9999, 1 / denominator) : 0.9999;
  return { predicted, confidence, gap: max - second, scores };
}

function confusion(rows: PredictionRow[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    matrix[row.actual] ??= {};
    matrix[row.actual][row.predicted] = (matrix[row.actual][row.predicted] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(matrix)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([actual, predictions]) => [
        actual,
        Object.fromEntries(Object.entries(predictions).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
}

function metrics(rows: PredictionRow[]): MetricsReport {
  const classes = [...new Set(rows.flatMap((row) => [row.actual, row.predicted]))].sort();
  const correct = rows.filter((row) => row.correct).length;
  const majorityCorrect = rows.filter((row) => row.majority_correct).length;
  const f1s: number[] = [];
  const recalls: number[] = [];

  for (const klass of classes) {
    const tp = rows.filter((row) => row.actual === klass && row.predicted === klass).length;
    const fp = rows.filter((row) => row.actual !== klass && row.predicted === klass).length;
    const fn = rows.filter((row) => row.actual === klass && row.predicted !== klass).length;
    const support = rows.filter((row) => row.actual === klass).length;
    if (support === 0) continue;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    recalls.push(recall);
    f1s.push(f1);
  }

  const accuracy = rows.length ? correct / rows.length : 0;
  const majorityAccuracy = rows.length ? majorityCorrect / rows.length : 0;
  return {
    examples: rows.length,
    accuracy,
    majority_accuracy: majorityAccuracy,
    lift_vs_majority: accuracy - majorityAccuracy,
    balanced_accuracy: recalls.length ? recalls.reduce((sum, value) => sum + value, 0) / recalls.length : 0,
    macro_f1: f1s.length ? f1s.reduce((sum, value) => sum + value, 0) / f1s.length : 0,
    confusion: confusion(rows),
  };
}

function evaluateHoldout(examples: Example[]): PredictionRow[] {
  const trainRows = examples.filter((example) => example.split === 'train');
  const evalRows = examples.filter((example) => example.split !== 'train');
  const model = trainNaiveBayes(trainRows);

  return evalRows.map((example) => {
    const prediction = predict(model, example);
    return {
      evaluation: 'holdout',
      label_name: example.label_name,
      record_id: example.record_id,
      split: example.split,
      family_key: example.family_key,
      actual: example.target,
      predicted: prediction.predicted,
      confidence: prediction.confidence,
      majority_predicted: model.majorityClass,
      majority_correct: model.majorityClass === example.target,
      correct: prediction.predicted === example.target,
      score_gap: prediction.gap,
      feature_excerpt: example.feature_excerpt,
    };
  });
}

function evaluateLeaveOneOut(examples: Example[]): PredictionRow[] {
  return examples.map((example) => {
    const trainRows = examples.filter((candidate) => candidate.record_id !== example.record_id);
    const model = trainNaiveBayes(trainRows);
    const prediction = predict(model, example);
    return {
      evaluation: 'leave_one_out',
      label_name: example.label_name,
      record_id: example.record_id,
      split: example.split,
      family_key: example.family_key,
      actual: example.target,
      predicted: prediction.predicted,
      confidence: prediction.confidence,
      majority_predicted: model.majorityClass,
      majority_correct: model.majorityClass === example.target,
      correct: prediction.predicted === example.target,
      score_gap: prediction.gap,
      feature_excerpt: example.feature_excerpt,
    };
  });
}

function positiveErrorReview(labelName: string, predictions: PredictionRow[]): PositiveErrorReview | undefined {
  const definition = POSITIVE_LABELS[labelName];
  if (!definition) return undefined;
  const reviewed = predictions
    .map((row) => {
      const actualPositive = definition.isPositive(row.actual);
      const predictedPositive = definition.isPositive(row.predicted);
      if (!actualPositive && predictedPositive) return { ...row, error_type: 'false_positive' as const };
      if (actualPositive && !predictedPositive) return { ...row, error_type: 'false_negative' as const };
      return null;
    })
    .filter((row): row is PredictionRow & { error_type: 'false_positive' | 'false_negative' } => Boolean(row))
    .sort((a, b) => b.confidence - a.confidence || b.score_gap - a.score_gap)
    .slice(0, 12)
    .map((row) => ({
      error_type: row.error_type,
      record_id: row.record_id,
      split: row.split,
      actual: row.actual,
      predicted: row.predicted,
      confidence: Number(row.confidence.toFixed(4)),
      score_gap: Number(row.score_gap.toFixed(4)),
      feature_excerpt: row.feature_excerpt,
    }));

  return {
    positive_definition: definition.description,
    false_positives: reviewed.filter((row) => row.error_type === 'false_positive').length,
    false_negatives: reviewed.filter((row) => row.error_type === 'false_negative').length,
    reviewed_examples: reviewed,
  };
}

function topTokensForLabel(examples: Example[]): Record<string, Array<{ token: string; weight: number }>> {
  const model = trainNaiveBayes(examples);
  if (model.classes.length < 2) return {};
  const output: Record<string, Array<{ token: string; weight: number }>> = {};
  const vocab = [...model.vocabulary];
  const alpha = 1;
  const vocabSize = Math.max(1, model.vocabulary.size);

  for (const klass of model.classes) {
    const classCounts = model.classTokenCounts.get(klass) ?? new Map<string, number>();
    const classTotal = model.classTotalTokens.get(klass) ?? 0;
    const otherClasses = model.classes.filter((candidate) => candidate !== klass);
    const scored = vocab.map((token) => {
      const classProbability = (classCounts.get(token) ?? 0) + alpha;
      const classDenominator = classTotal + alpha * vocabSize;
      const otherScore = otherClasses
        .map((other) => {
          const counts = model.classTokenCounts.get(other) ?? new Map<string, number>();
          const total = model.classTotalTokens.get(other) ?? 0;
          return Math.log(((counts.get(token) ?? 0) + alpha) / (total + alpha * vocabSize));
        })
        .reduce((sum, value) => sum + value, 0) / Math.max(1, otherClasses.length);
      return {
        token,
        weight: Math.log(classProbability / classDenominator) - otherScore,
      };
    });
    output[klass] = scored
      .sort((a, b) => b.weight - a.weight || a.token.localeCompare(b.token))
      .slice(0, 16)
      .map((row) => ({ token: row.token, weight: Number(row.weight.toFixed(4)) }));
  }

  return output;
}

function decisionFor(report: LabelReport): LabelReport['decision'] {
  const loo = report.leave_one_out;
  const holdout = report.holdout;
  if (report.status !== 'evaluated') {
    return {
      advance: false,
      reason: `${report.label_name} is ${report.status}; current labels cannot support a model decision.`,
      next_action: 'Add balanced labels through Dataset Factory active learning before training this target.',
    };
  }
  if (!loo || loo.examples < 20) {
    return {
      advance: false,
      reason: 'Evaluation set is too small for a shipping decision.',
      next_action: 'Collect more labels and rerun the CPU baseline.',
    };
  }
  if (loo.lift_vs_majority > 0.1 && loo.macro_f1 >= 0.55 && (holdout?.examples ?? 0) >= 5) {
    return {
      advance: false,
      reason: 'The signal beats majority in leave-one-out, but the reviewed-gold set is only 20 records.',
      next_action: 'Use as an active-learning ranking hint only; require 100+ balanced labels before shipping.',
    };
  }
  return {
    advance: false,
    reason: 'The model does not reliably beat majority on the current small benchmark.',
    next_action: 'Collect more balanced labels, especially negative/weak examples and aerial cases.',
  };
}

function renderMarkdown(report: {
  input_summary: Record<string, unknown>;
  labels: LabelReport[];
  caveats: string[];
  overall_decision: Record<string, string | boolean>;
}): string {
  const rows = report.labels.map((label) => {
    const holdout = label.holdout;
    const loo = label.leave_one_out;
    return `| ${label.label_name} | ${label.status} | ${holdout ? `${holdout.accuracy.toFixed(3)} / ${holdout.majority_accuracy.toFixed(3)}` : 'n/a'} | ${loo ? `${loo.accuracy.toFixed(3)} / ${loo.majority_accuracy.toFixed(3)}` : 'n/a'} | ${loo ? loo.macro_f1.toFixed(3) : 'n/a'} | ${label.decision.next_action} |`;
  }).join('\n');

  return `# Model Baseline v0 CPU Text

Issue: GitHub #51

Generated: ${GENERATED_AT}

This is a cheap, deterministic CPU baseline over source metadata, VLM/visual-review text, scene text, entities, and search expectations. It is intentionally not a paid GPU run.

## Input Summary

\`\`\`json
${JSON.stringify(report.input_summary, null, 2)}
\`\`\`

## Metrics

| Label | Status | Holdout acc / majority | LOO acc / majority | LOO macro F1 | Decision |
|---|---|---:|---:|---:|---|
${rows}

## Overall Decision

- Advance to product ranking now: ${report.overall_decision.advance}
- Reason: ${report.overall_decision.reason}
- Next action: ${report.overall_decision.next_action}

## Caveats

${report.caveats.map((caveat) => `- ${caveat}`).join('\n')}
`;
}

function registryEntry(outputDir: string, report: { labels: LabelReport[] }): Record<string, unknown> {
  const evaluated = report.labels.filter((label) => label.status === 'evaluated');
  return {
    schema_version: 'mtl_gpu_experiment_registry_v0',
    run_id: 'model-baseline-v0-cpu-text-2026-06-30',
    issue: '#51',
    status: 'completed',
    execution_surface: 'local_cpu',
    workload_type: 'training',
    started_at: GENERATED_AT,
    ended_at: datasetFactoryNowIso(),
    budget: {
      approved: false,
      max_runtime_minutes: 10,
      max_cost_usd: 0,
      instance_type: null,
      region: null,
      hourly_cost_usd: 0,
    },
    inputs: {
      datasets: [
        'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl',
        'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/classification_tasks.jsonl',
        'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
      ],
      code_ref: 'packages/scripts/src/dataset-factory/train-model-baseline-v0.ts',
      model_refs: ['local multinomial naive bayes text baseline'],
    },
    outputs: {
      artifact_paths: [
        path.relative(MONOREPO_ROOT, path.join(outputDir, 'model_baseline_report.json')),
        path.relative(MONOREPO_ROOT, path.join(outputDir, 'model_baseline_report.md')),
        path.relative(MONOREPO_ROOT, path.join(outputDir, 'model_baseline_predictions.jsonl')),
        path.relative(MONOREPO_ROOT, path.join(outputDir, 'model_baseline_weights.json')),
      ],
      hub_repos: [],
      copied_back: true,
    },
    metrics: {
      evaluated_targets: evaluated.length,
      best_leave_one_out_lift: Math.max(0, ...evaluated.map((label) => label.leave_one_out?.lift_vs_majority ?? 0)),
      paid_compute_launched: false,
    },
    safety: {
      no_secrets_recorded: true,
      lambda_instances_before: 0,
      lambda_instances_after: 0,
      termination_verified: true,
      hf_results_persisted: false,
    },
    decision: {
      advance: false,
      reason: 'CPU baseline only. Current reviewed-gold set is too small and imbalanced for product ranking or GPU training.',
      next_action: 'Use active learning to expand balanced labels, then rerun #51 before #55 GPU/model benchmarks.',
    },
    notes: 'No paid compute was launched. This registry entry applies the #58 experiment format to the first #51 CPU baseline.',
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      labels: { type: 'string', default: DEFAULT_LABELS },
      benchmark: { type: 'string', default: DEFAULT_BENCHMARK },
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const labelsPath = resolveRepoPath(values.labels!);
  const benchmarkDir = resolveRepoPath(values.benchmark!);
  const manifestPath = resolveRepoPath(values.manifest!);
  const outputDir = resolveRepoPath(values.output!);

  const labels = readJsonl<LabelRow>(labelsPath);
  const tasks = readJsonl<ClassificationTask>(path.join(benchmarkDir, 'classification_tasks.jsonl'));
  const splitRows = readJsonl<SplitRow>(path.join(benchmarkDir, 'record_splits.jsonl'));
  const manifests = manifestIndex(readJsonl<ManifestRow>(manifestPath));
  const splits = new Map(splitRows.map((row) => [row.record_id, row]));
  const examples = buildExamples(labels, tasks, splits, manifests);
  const labelNames = [...new Set(examples.map((example) => example.label_name))].sort();
  const allPredictions: PredictionRow[] = [];
  const weights: Record<string, Record<string, Array<{ token: string; weight: number }>>> = {};

  const labelReports: LabelReport[] = labelNames.map((labelName) => {
    const labelExamples = examples.filter((example) => example.label_name === labelName);
    const classSupport = countBy(labelExamples, (example) => example.target);
    const trainRows = labelExamples.filter((example) => example.split === 'train');
    const trainClassSupport = countBy(trainRows, (example) => example.target);
    const classes = Object.keys(classSupport);
    const trainClasses = Object.keys(trainClassSupport);
    const holdoutExamples = labelExamples.filter((example) => example.split !== 'train');

    const baseReport: LabelReport = {
      label_name: labelName,
      status: 'evaluated',
      class_support: classSupport,
      train_class_support: trainClassSupport,
      decision: {
        advance: false,
        reason: '',
        next_action: '',
      },
    };

    if (classes.length < 2) {
      baseReport.status = 'single_class';
      baseReport.decision = decisionFor(baseReport);
      return baseReport;
    }
    if (trainClasses.length < 2) {
      baseReport.status = 'insufficient_train_classes';
      baseReport.leave_one_out = metrics(evaluateLeaveOneOut(labelExamples));
      baseReport.positive_error_review = positiveErrorReview(labelName, evaluateLeaveOneOut(labelExamples));
      baseReport.decision = decisionFor(baseReport);
      return baseReport;
    }
    if (holdoutExamples.length === 0) {
      baseReport.status = 'no_holdout_examples';
      baseReport.leave_one_out = metrics(evaluateLeaveOneOut(labelExamples));
      baseReport.positive_error_review = positiveErrorReview(labelName, evaluateLeaveOneOut(labelExamples));
      baseReport.decision = decisionFor(baseReport);
      return baseReport;
    }

    const holdoutPredictions = evaluateHoldout(labelExamples);
    const looPredictions = evaluateLeaveOneOut(labelExamples);
    allPredictions.push(...holdoutPredictions, ...looPredictions);
    weights[labelName] = topTokensForLabel(labelExamples);

    baseReport.holdout = metrics(holdoutPredictions);
    baseReport.leave_one_out = metrics(looPredictions);
    baseReport.positive_error_review = positiveErrorReview(labelName, looPredictions);
    baseReport.decision = decisionFor(baseReport);
    return baseReport;
  });

  const report = {
    generated_at: GENERATED_AT,
    issue: '#51',
    method: {
      name: 'model_baseline_v0_cpu_text',
      model: 'multinomial_naive_bayes',
      feature_sources: [
        'source metadata title/description/date/cote',
        'VLM caption/metadata when present',
        'visual-review observed claims after removing generic image-mode leakage claims',
        'scene_text/entities/search_expectations from Dataset Factory labels',
      ],
      leakage_controls: [
        'Target labels are not included as direct features.',
        'Record ids and image filenames are excluded from feature text.',
        'Generic observed claims like \"ground_object archive image\" are removed before tokenization.',
        'Family split from MTL-CityMemory-Bench v0 is reused.',
      ],
    },
    input_summary: {
      labels: labels.length,
      classification_tasks: tasks.length,
      split_counts: countBy(splitRows, (row) => row.split),
      feature_records: new Set(examples.map((example) => example.record_id)).size,
      targets: countBy(examples, (example) => example.label_name),
    },
    labels: labelReports,
    overall_decision: {
      advance: false,
      reason: 'No classifier should ship yet. The current reviewed-gold set is small and imbalanced; the CPU baseline is useful for measuring what data to collect next.',
      next_action: 'Prioritize balanced active-learning labels for print/search/partner positives and negatives, then rerun CPU baselines before paid GPU experiments.',
    },
    caveats: [
      'Only 20 reviewed-gold records are available in this benchmark artifact.',
      'Human-legible and needs-human-review targets are single-class in this batch, so they are not learnable yet.',
      'This is a text/VLM-metadata baseline, not a CLIP/OpenCLIP/DINO image-embedding baseline.',
      'Holdout splits are tiny: validation has 2 records and test has 3 records.',
      'Use metrics directionally; do not ship model outputs into product ranking without larger balanced labels.',
    ],
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'model_baseline_predictions.jsonl'), allPredictions);
  writeJsonl(
    path.join(outputDir, 'model_baseline_error_review.jsonl'),
    allPredictions
      .filter((row) => !row.correct)
      .sort((a, b) => b.confidence - a.confidence || b.score_gap - a.score_gap),
  );
  fs.writeFileSync(path.join(outputDir, 'model_baseline_weights.json'), JSON.stringify(weights, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'model_baseline_report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'model_baseline_report.md'), renderMarkdown(report), 'utf-8');
  writeJsonl(path.join(outputDir, 'gpu-experiment-registry.model-baseline-v0.jsonl'), [registryEntry(outputDir, report)]);

  console.log(`Wrote Model Baseline v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  for (const label of labelReports) {
    const loo = label.leave_one_out;
    const metric = loo ? `loo_acc=${loo.accuracy.toFixed(3)} majority=${loo.majority_accuracy.toFixed(3)} macro_f1=${loo.macro_f1.toFixed(3)}` : 'no_eval';
    console.log(`- ${label.label_name}: ${label.status} ${metric}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
