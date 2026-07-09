import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { requireArtifact } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0',
);
const DEFAULT_SEED = 'mtl-citymemory-bench-v0-2026-06-29';

type EvidenceItem = {
  id: string;
  claim: string;
  evidence_type: string;
  source_field: string | null;
  source_url: string | null;
  confidence: number;
  review_flags: string[];
};

type BenchmarkAdjudicationStatus = 'calibration' | 'reviewed_gold' | 'mixed_review';

type LabelRow = {
  record_id: string;
  image_filename: string;
  source: {
    source_system: string;
    package_slug: string | null;
    source_url: string | null;
    credit_line: string;
    commercial_use_allowed: boolean;
  };
  review: {
    review_stage: string;
  };
  labels: {
    human_legible: string;
    story_value: string;
    print_value: string;
    partner_fit: string[];
    search_value: string;
    quality_action: string[];
    geo_time_extractable: {
      geo: string;
      time: string;
      public_safe_exact_location: boolean;
      notes: string;
    };
    provenance_depth: string;
    commercial_surface: string[];
    image_mode?: string;
    scene_text?: Array<Record<string, unknown>>;
    entities?: Array<Record<string, unknown>>;
    aerial_land_use?: {
      dominant_land_use?: string;
      land_use_mix?: Array<Record<string, unknown>>;
      urbanization_stage?: string;
      segmentation_candidate?: boolean;
      georeference_candidate?: boolean;
      notes?: string;
    };
    geo_hypotheses?: Array<Record<string, unknown>>;
    search_expectations?: Array<{
      query: string;
      expected_rank_bucket: string;
      mode: string;
      rationale: string;
      evidence_refs: string[];
    }>;
    ml_tasks?: string[];
  };
  evidence: {
    observed: EvidenceItem[];
    metadata: EvidenceItem[];
    inferred: EvidenceItem[];
    verified: EvidenceItem[];
  };
  confidence: {
    overall: number;
    field_confidence: Record<string, number>;
    needs_human_review: boolean;
    review_flags: string[];
  };
  pairwise_preferences: Array<Record<string, unknown>>;
};

type SplitRecord = {
  record_id: string;
  split: 'train' | 'validation' | 'test';
  family_key: string;
  image_mode: string;
  lane: 'ground_text_entity' | 'aerial_land_use_geo';
  review_stage: string;
  needs_human_review: boolean;
};

type RetrievalTask = {
  task_id: string;
  benchmark_id: 'mtl_citymemory_bench_v0';
  task_type: 'retrieval';
  split: SplitRecord['split'];
  slice: string;
  record_id: string;
  positive_record_ids: string[];
  query: string;
  expected_rank_bucket: string;
  source_expectation_mode: string;
  eval_modes: string[];
  rationale: string;
  evidence_refs: string[];
  adjudication_status: BenchmarkAdjudicationStatus;
};

type ClassificationTask = {
  task_id: string;
  benchmark_id: 'mtl_citymemory_bench_v0';
  task_type: 'classification';
  split: SplitRecord['split'];
  record_id: string;
  label_name: string;
  target: string | string[] | boolean;
  confidence: number;
  slice: string;
  adjudication_status: BenchmarkAdjudicationStatus;
};

type ProvenanceTask = {
  task_id: string;
  benchmark_id: 'mtl_citymemory_bench_v0';
  task_type: 'provenance';
  split: SplitRecord['split'];
  record_id: string;
  claim_id: string;
  claim: string;
  expected_evidence_bucket: 'observed' | 'metadata' | 'inferred' | 'verified';
  evidence_type: string;
  confidence: number;
  review_flags: string[];
  adjudication_status: BenchmarkAdjudicationStatus;
};

type RankingTask = {
  task_id: string;
  benchmark_id: 'mtl_citymemory_bench_v0';
  task_type: 'pairwise_ranking';
  split: SplitRecord['split'];
  criterion: 'story_value' | 'print_value' | 'search_value';
  preferred_record_id: string;
  other_record_id: string;
  source: 'derived_from_label_delta';
  adjudication_required: true;
  rationale: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
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

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function splitForFamily(familyKey: string, seed: string): SplitRecord['split'] {
  const value = hashSeed(`${seed}:${familyKey}`) / 4294967296;
  if (value < 0.6) return 'train';
  if (value < 0.8) return 'validation';
  return 'test';
}

function familyKey(label: LabelRow): string {
  const sourceUrl = label.source.source_url ?? '';
  const filename = label.image_filename;
  const aerialMatch = /VM97-3_7P(\d+)/i.exec(sourceUrl) ?? /VM97-3_7P(\d+)/i.exec(filename);
  if (aerialMatch) return `aerial_7p_${aerialMatch[1]}`;
  const obliqueMatch = /(VM94-B\d+)/i.exec(sourceUrl);
  if (obliqueMatch) return `oblique_${obliqueMatch[1].toLowerCase()}`;
  return label.record_id;
}

function lane(label: LabelRow): SplitRecord['lane'] {
  const mode = String(label.labels.image_mode ?? '');
  return mode.startsWith('aerial') || mode === 'low_information' ? 'aerial_land_use_geo' : 'ground_text_entity';
}

function taskSliceForRetrieval(label: LabelRow, expectationMode: string, query: string): string {
  if (expectationMode === 'ocr_lexical') return 'text_in_image';
  if (expectationMode === 'reranked') return 'reranker_required';
  const mode = String(label.labels.image_mode ?? '');
  if (mode.startsWith('aerial') || mode === 'low_information') return 'aerial_land_use';
  if ((label.labels.scene_text ?? []).length) return 'scene_text';
  if ((label.labels.entities ?? []).length) return 'entity_place';
  if (/farmland|waterfront|residential|industrial|aerial/i.test(query)) return 'aerial_land_use';
  return 'metadata_title';
}

function splitRecords(labels: LabelRow[], seed: string): Map<string, SplitRecord> {
  const map = new Map<string, SplitRecord>();
  for (const label of labels) {
    const family = familyKey(label);
    map.set(label.record_id, {
      record_id: label.record_id,
      split: splitForFamily(family, seed),
      family_key: family,
      image_mode: String(label.labels.image_mode ?? 'unknown'),
      lane: lane(label),
      review_stage: label.review.review_stage,
      needs_human_review: label.confidence.needs_human_review,
    });
  }
  return map;
}

function reviewStatus(labels: LabelRow[]): BenchmarkAdjudicationStatus {
  if (labels.length === 0) return 'calibration';
  const allGold = labels.every((label) => label.review.review_stage === 'gold' && !label.confidence.needs_human_review);
  if (allGold) return 'reviewed_gold';
  const allDraft = labels.every((label) => label.review.review_stage !== 'gold' || label.confidence.needs_human_review);
  return allDraft ? 'calibration' : 'mixed_review';
}

function buildRetrievalTasks(
  labels: LabelRow[],
  splits: Map<string, SplitRecord>,
  adjudicationStatus: BenchmarkAdjudicationStatus,
): RetrievalTask[] {
  const tasks: RetrievalTask[] = [];
  for (const label of labels) {
    const split = splits.get(label.record_id);
    if (!split) continue;
    const expectations = label.labels.search_expectations ?? [];
    for (const expectation of expectations) {
      tasks.push({
        task_id: `ret-${String(tasks.length + 1).padStart(4, '0')}`,
        benchmark_id: 'mtl_citymemory_bench_v0',
        task_type: 'retrieval',
        split: split.split,
        slice: taskSliceForRetrieval(label, expectation.mode, expectation.query),
        record_id: label.record_id,
        positive_record_ids: [label.record_id],
        query: expectation.query,
        expected_rank_bucket: expectation.expected_rank_bucket,
        source_expectation_mode: expectation.mode,
        eval_modes: ['semantic', 'smart', 'visual'],
        rationale: expectation.rationale,
        evidence_refs: expectation.evidence_refs,
        adjudication_status: adjudicationStatus,
      });
    }
  }
  return tasks;
}

function buildClassificationTasks(
  labels: LabelRow[],
  splits: Map<string, SplitRecord>,
  adjudicationStatus: BenchmarkAdjudicationStatus,
): ClassificationTask[] {
  const tasks: ClassificationTask[] = [];
  const push = (label: LabelRow, labelName: string, target: string | string[] | boolean, confidence: number, slice: string) => {
    const split = splits.get(label.record_id);
    if (!split) return;
    tasks.push({
      task_id: `cls-${String(tasks.length + 1).padStart(4, '0')}`,
      benchmark_id: 'mtl_citymemory_bench_v0',
      task_type: 'classification',
      split: split.split,
      record_id: label.record_id,
      label_name: labelName,
      target,
      confidence,
      slice,
      adjudication_status: adjudicationStatus,
    });
  };

  for (const label of labels) {
    push(label, 'image_mode', String(label.labels.image_mode ?? 'unknown'), label.confidence.field_confidence.image_mode ?? 0.5, 'image_mode');
    push(label, 'human_legible', label.labels.human_legible, label.confidence.field_confidence.human_legible ?? 0.5, 'product_quality');
    push(label, 'story_value', label.labels.story_value, label.confidence.field_confidence.story_value ?? 0.5, 'product_quality');
    push(label, 'print_value', label.labels.print_value, label.confidence.field_confidence.print_value ?? 0.5, 'commercial_value');
    push(label, 'search_value', label.labels.search_value, label.confidence.field_confidence.search_value ?? 0.5, 'search_value');
    push(label, 'needs_human_review', label.confidence.needs_human_review, 0.8, 'active_learning');
    if (label.labels.aerial_land_use?.dominant_land_use) {
      push(label, 'aerial_land_use', label.labels.aerial_land_use.dominant_land_use, label.confidence.field_confidence.aerial_land_use ?? 0.5, 'aerial_land_use');
      push(label, 'aerial_segmentation_candidate', Boolean(label.labels.aerial_land_use.segmentation_candidate), 0.7, 'aerial_segmentation');
      push(label, 'aerial_georeference_candidate', Boolean(label.labels.aerial_land_use.georeference_candidate), 0.7, 'geo_estimation');
    }
  }
  return tasks;
}

function buildProvenanceTasks(
  labels: LabelRow[],
  splits: Map<string, SplitRecord>,
  adjudicationStatus: BenchmarkAdjudicationStatus,
): ProvenanceTask[] {
  const tasks: ProvenanceTask[] = [];
  const buckets: Array<keyof LabelRow['evidence']> = ['observed', 'metadata', 'inferred', 'verified'];
  for (const label of labels) {
    const split = splits.get(label.record_id);
    if (!split) continue;
    for (const bucket of buckets) {
      for (const item of label.evidence[bucket] ?? []) {
        tasks.push({
          task_id: `prov-${String(tasks.length + 1).padStart(4, '0')}`,
          benchmark_id: 'mtl_citymemory_bench_v0',
          task_type: 'provenance',
          split: split.split,
          record_id: label.record_id,
          claim_id: item.id,
          claim: item.claim,
          expected_evidence_bucket: bucket,
          evidence_type: item.evidence_type,
          confidence: item.confidence,
          review_flags: item.review_flags,
          adjudication_status: adjudicationStatus,
        });
      }
    }
  }
  return tasks;
}

const SCORE_MAPS = {
  story_value: { high: 3, medium: 2, low: 1, none: 0 },
  print_value: { high: 3, medium: 2, low: 1, none: 0 },
  search_value: { priority: 4, high: 3, medium: 2, low: 1, exclude: 0 },
} as const;

function scoreLabel(label: LabelRow, criterion: keyof typeof SCORE_MAPS): number {
  const value = String(label.labels[criterion] ?? '');
  return Number((SCORE_MAPS[criterion] as Record<string, number>)[value] ?? 0);
}

function buildRankingTasks(labels: LabelRow[], splits: Map<string, SplitRecord>): RankingTask[] {
  const tasks: RankingTask[] = [];
  const criteria: Array<keyof typeof SCORE_MAPS> = ['story_value', 'print_value', 'search_value'];
  for (const criterion of criteria) {
    const sorted = [...labels].sort((a, b) => scoreLabel(b, criterion) - scoreLabel(a, criterion));
    const high = sorted.filter((label) => scoreLabel(label, criterion) >= (criterion === 'search_value' ? 3 : 2));
    const low = sorted.filter((label) => scoreLabel(label, criterion) <= 1);
    const limit = Math.min(12, high.length, low.length);
    for (let i = 0; i < limit; i += 1) {
      const preferred = high[i];
      const other = low[low.length - 1 - i];
      const split = splits.get(preferred.record_id);
      if (!split || preferred.record_id === other.record_id) continue;
      tasks.push({
        task_id: `rank-${String(tasks.length + 1).padStart(4, '0')}`,
        benchmark_id: 'mtl_citymemory_bench_v0',
        task_type: 'pairwise_ranking',
        split: split.split,
        criterion,
        preferred_record_id: preferred.record_id,
        other_record_id: other.record_id,
        source: 'derived_from_label_delta',
        adjudication_required: true,
        rationale: `Label ${criterion} score is higher for ${preferred.record_id} than ${other.record_id}.`,
      });
    }
  }
  return tasks;
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderReadme(manifest: Record<string, unknown>): string {
  const status = String(manifest.status ?? 'unknown');
  const caveats = Array.isArray(manifest.caveats)
    ? (manifest.caveats as string[]).map((caveat) => `- ${caveat}`).join('\n')
    : '';

  return `# MTL-CityMemory-Bench v0

This generated artifact turns Dataset Factory labels into benchmark tasks for archive intelligence.

Status: ${status}.

## Files

- \`manifest.json\`: benchmark metadata and counts
- \`record_splits.jsonl\`: train/validation/test split by record and family key
- \`retrieval_tasks.jsonl\`: query-to-image search tasks
- \`classification_tasks.jsonl\`: image mode, land-use, product, and review-routing tasks
- \`provenance_tasks.jsonl\`: evidence-bucket classification tasks
- \`ranking_tasks.jsonl\`: derived pairwise ranking tasks that require adjudication

## Counts

\`\`\`json
${JSON.stringify((manifest as { counts?: unknown }).counts, null, 2)}
\`\`\`

## Caveats

${caveats}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      labels: { type: 'string', default: DEFAULT_LABELS },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      seed: { type: 'string', default: DEFAULT_SEED },
    },
  });

  const labelsPath = resolveRepoPath(values.labels!);
  const outputDir = resolveRepoPath(values.output!);
  const seed = values.seed!;
  requireArtifact(labelsPath, 'Dataset Factory label rows');
  const labels = readJsonl<LabelRow>(labelsPath);
  const adjudicationStatus = reviewStatus(labels);
  const splits = splitRecords(labels, seed);
  const splitRows = Array.from(splits.values()).sort((a, b) => a.record_id.localeCompare(b.record_id));
  const retrievalTasks = buildRetrievalTasks(labels, splits, adjudicationStatus);
  const classificationTasks = buildClassificationTasks(labels, splits, adjudicationStatus);
  const provenanceTasks = buildProvenanceTasks(labels, splits, adjudicationStatus);
  const rankingTasks = buildRankingTasks(labels, splits);

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'record_splits.jsonl'), splitRows);
  writeJsonl(path.join(outputDir, 'retrieval_tasks.jsonl'), retrievalTasks);
  writeJsonl(path.join(outputDir, 'classification_tasks.jsonl'), classificationTasks);
  writeJsonl(path.join(outputDir, 'provenance_tasks.jsonl'), provenanceTasks);
  writeJsonl(path.join(outputDir, 'ranking_tasks.jsonl'), rankingTasks);

  const manifest = {
    benchmark_id: 'mtl_citymemory_bench_v0',
    generated_at: new Date().toISOString(),
    seed,
    status: adjudicationStatus,
    inputs: {
      labels: path.relative(MONOREPO_ROOT, labelsPath),
    },
    outputs: {
      record_splits: 'record_splits.jsonl',
      retrieval_tasks: 'retrieval_tasks.jsonl',
      classification_tasks: 'classification_tasks.jsonl',
      provenance_tasks: 'provenance_tasks.jsonl',
      ranking_tasks: 'ranking_tasks.jsonl',
      readme: 'README.md',
    },
    counts: {
      labels: labels.length,
      splits: countBy(splitRows, (row) => row.split),
      retrieval_tasks: retrievalTasks.length,
      retrieval_by_slice: countBy(retrievalTasks, (row) => row.slice),
      classification_tasks: classificationTasks.length,
      classification_by_label: countBy(classificationTasks, (row) => row.label_name),
      provenance_tasks: provenanceTasks.length,
      provenance_by_bucket: countBy(provenanceTasks, (row) => row.expected_evidence_bucket),
      ranking_tasks: rankingTasks.length,
      ranking_by_criterion: countBy(rankingTasks, (row) => row.criterion),
    },
    leakage_controls: {
      split_unit: 'family_key',
      family_key_rule: 'aerial VM97-3_7P flight strip when available; oblique VM94-B reportage when available; otherwise record_id',
      limitation: 'duplicate/near-neighbor family graph is not yet available; replace split keys when #54 exists.',
    },
    caveats: [
      adjudicationStatus === 'reviewed_gold'
        ? 'Labels are reviewed gold under the current Dataset Factory v0 policy, but still need larger-scale human QA before model training is trusted.'
        : 'Labels are calibration or mixed-review labels, not final large-scale training gold.',
      'Pairwise ranking tasks are derived from label deltas and require adjudication.',
      'Search baseline scores should be regenerated when the live API or index changes.',
      'Aerial exact coordinates and acreage are not benchmark targets until georeferencing labels exist.',
    ],
  };

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'README.md'), renderReadme(manifest), 'utf-8');

  console.log(`Wrote MTL-CityMemory-Bench v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- retrieval_tasks: ${retrievalTasks.length}`);
  console.log(`- classification_tasks: ${classificationTasks.length}`);
  console.log(`- provenance_tasks: ${provenanceTasks.length}`);
  console.log(`- ranking_tasks: ${rankingTasks.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
