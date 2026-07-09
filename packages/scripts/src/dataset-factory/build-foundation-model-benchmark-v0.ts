import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_LOCAL_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_embedding_eval/embedding_eval_report.json',
);
const DEFAULT_GPU_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.json',
);
const DEFAULT_VISUAL_GRAPH_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-report.json',
);
const DEFAULT_MODEL_BASELINE_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_report.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/foundation_model_benchmark_v0');

type MetricMap = Record<string, number>;

type EmbeddingModelReport = {
  modelKey?: string;
  modelId?: string;
  completedRows?: number;
  failedRows?: number;
  runtimeSeconds?: number;
  peakGpuMemoryMb?: number;
  metrics?: MetricMap;
};

type EmbeddingReport = {
  generated_at?: string;
  command?: string;
  runtime?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  models?: EmbeddingModelReport[] | Record<string, EmbeddingModelReport>;
  recommendation?: string;
  artifacts?: Record<string, string>;
};

type DecisionRow = {
  schema_version: 'foundation_model_decision_v0';
  model_key: string;
  model_ref: string;
  status: 'benchmarked' | 'planned' | 'deferred';
  advance: boolean;
  decision: 'keep' | 'reject_for_now' | 'test_next' | 'defer';
  reason: string;
  best_use: string[];
  evidence: Record<string, unknown>;
  next_action: string;
};

type NextExperimentRow = {
  schema_version: 'foundation_model_next_experiment_v0';
  experiment_id: string;
  priority: 'high' | 'medium' | 'low';
  model_refs: string[];
  task_focus: string[];
  sample_size: number;
  requires_gpu: boolean;
  estimated_runtime_minutes: number | null;
  acceptance_gate: string[];
  reason: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function modelsArray(report: EmbeddingReport | null): EmbeddingModelReport[] {
  if (!report?.models) return [];
  return Array.isArray(report.models) ? report.models : Object.values(report.models);
}

function metric(model: EmbeddingModelReport | undefined, key: string): number | null {
  const value = model?.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits = 4): number | null {
  if (value === null) return null;
  return Number(value.toFixed(digits));
}

function decisionRows(gpuReport: EmbeddingReport | null): DecisionRow[] {
  const models = modelsArray(gpuReport);
  const clip = models.find((model) => model.modelKey === 'clip' || model.modelId?.includes('clip'));
  const siglip = models.find((model) => model.modelKey === 'siglip' || model.modelId?.includes('siglip'));
  const clipMrr = metric(clip, 'query_mrr');
  const siglipMrr = metric(siglip, 'query_mrr');
  const mrrDelta = clipMrr !== null && siglipMrr !== null ? clipMrr - siglipMrr : null;

  return [
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'clip',
      model_ref: clip?.modelId ?? 'openai/clip-vit-base-patch32',
      status: clip ? 'benchmarked' : 'planned',
      advance: true,
      decision: 'keep',
      reason: `Best current retrieval model in the 500-image GPU benchmark. Query MRR=${round(clipMrr)}; MRR delta vs SigLIP=${round(mrrDelta)}.`,
      best_use: ['current visual retrieval baseline', 'visual-neighbor seeds', 'benchmark control'],
      evidence: {
        completed_rows: clip?.completedRows ?? null,
        query_mrr: round(clipMrr),
        query_p_at_1: round(metric(clip, 'query_p_at_1')),
        query_p_at_5: round(metric(clip, 'query_p_at_5')),
        nn_same_category_at_5: round(metric(clip, 'nn_same_category_at_5')),
        nn_shared_theme_at_5: round(metric(clip, 'nn_shared_theme_at_5')),
        runtime_seconds: clip?.runtimeSeconds ?? null,
        peak_gpu_memory_mb: clip?.peakGpuMemoryMb ?? null,
      },
      next_action: 'Keep current CLIP embeddings as the control. Do not re-embed production unless a larger model beats this on retrieval and family/coherence metrics.',
    },
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'siglip',
      model_ref: siglip?.modelId ?? 'google/siglip-base-patch16-224',
      status: siglip ? 'benchmarked' : 'planned',
      advance: false,
      decision: 'reject_for_now',
      reason: `SigLIP slightly improves neighbor coherence but loses badly on query retrieval. Query MRR=${round(siglipMrr)} vs CLIP=${round(clipMrr)}.`,
      best_use: ['possible cluster-coherence comparator only'],
      evidence: {
        completed_rows: siglip?.completedRows ?? null,
        query_mrr: round(siglipMrr),
        query_p_at_1: round(metric(siglip, 'query_p_at_1')),
        query_p_at_5: round(metric(siglip, 'query_p_at_5')),
        nn_same_category_at_5: round(metric(siglip, 'nn_same_category_at_5')),
        nn_shared_theme_at_5: round(metric(siglip, 'nn_shared_theme_at_5')),
        runtime_seconds: siglip?.runtimeSeconds ?? null,
        peak_gpu_memory_mb: siglip?.peakGpuMemoryMb ?? null,
      },
      next_action: 'Do not replace CLIP with this SigLIP run. Keep SigLIP only as a diagnostic comparator if future family graph metrics need it.',
    },
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'openclip_large',
      model_ref: 'laion/CLIP-ViT-L-14-laion2B-s32B-b82K or equivalent OpenCLIP ViT-L/H',
      status: 'planned',
      advance: false,
      decision: 'test_next',
      reason: 'Not benchmarked in the current artifact. It is the highest-value next retrieval candidate because it preserves image-text retrieval behavior while increasing capacity.',
      best_use: ['retrieval replacement candidate', 'semantic visual search', 'neighbor graph expansion'],
      evidence: { benchmarked_rows: 0 },
      next_action: 'Run a budgeted 1k-5k GPU benchmark against CLIP control before any production re-embedding.',
    },
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'dinov2',
      model_ref: 'facebook/dinov2-base or facebook/dinov2-large',
      status: 'planned',
      advance: false,
      decision: 'test_next',
      reason: 'Not an image-text retrieval replacement, but likely useful for visual family graph clustering, duplicates, maps, and aerial texture/land-use structure.',
      best_use: ['visual clustering', 'near-duplicate detection', 'aerial/land-use image families'],
      evidence: { benchmarked_rows: 0 },
      next_action: 'Benchmark on cluster/family coherence and active-learning diversity, not query MRR alone.',
    },
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'geo_or_street_clip',
      model_ref: 'GeoCLIP/StreetCLIP-style model if practical on current tooling',
      status: 'deferred',
      advance: false,
      decision: 'defer',
      reason: 'The label set does not yet have enough verified geolocation ground truth to evaluate this honestly.',
      best_use: ['location hints', 'geo-prior scoring', 'georeference candidate ranking'],
      evidence: { benchmarked_rows: 0, blocker: 'verified geo labels are too sparse' },
      next_action: 'Expand geo-hypothesis labels first; then run only if there are measurable location tasks.',
    },
    {
      schema_version: 'foundation_model_decision_v0',
      model_key: 'ocr_document_features',
      model_ref: 'OCR/document-specific features, not one generic image embedding',
      status: 'planned',
      advance: false,
      decision: 'test_next',
      reason: 'The Magic Baking Powder failure and scene-text slices show that image text needs a dedicated OCR/entity path, not only better global embeddings.',
      best_use: ['scene text retrieval', 'brand/signage detection', 'map/document parsing'],
      evidence: { benchmarked_rows: 0, related_issue: '#52/#56' },
      next_action: 'Add OCR/entity features into the benchmark as a separate feature family with text-in-image query tasks.',
    },
  ];
}

function nextExperiments(): NextExperimentRow[] {
  return [
    {
      schema_version: 'foundation_model_next_experiment_v0',
      experiment_id: 'fm-openclip-dino-geo-1k-v1',
      priority: 'high',
      model_refs: [
        'openai/clip-vit-base-patch32',
        'laion/CLIP-ViT-L-14-laion2B-s32B-b82K',
        'facebook/dinov2-base',
      ],
      task_focus: ['retrieval', 'visual-family-coherence', 'same-category@5', 'same-family@5'],
      sample_size: 1000,
      requires_gpu: true,
      estimated_runtime_minutes: 45,
      acceptance_gate: [
        'OpenCLIP beats CLIP query_mrr by >= 0.05 without worse duplicate_rate_at_10.',
        'DINOv2 improves same-family/same-category@5 by >= 0.08 for graph use.',
        'All outputs copied back and registry row completed before any instance remains running.',
      ],
      reason: 'Most direct way to decide whether larger image-text or pure-vision features actually beat the current CLIP moat.',
    },
    {
      schema_version: 'foundation_model_next_experiment_v0',
      experiment_id: 'fm-ocr-scene-text-v1',
      priority: 'high',
      model_refs: ['PaddleOCR/Tesseract/EasyOCR or document VLM OCR pass'],
      task_focus: ['scene-text retrieval', 'brand/signage entity recovery', 'text-in-image benchmark slices'],
      sample_size: 500,
      requires_gpu: false,
      estimated_runtime_minutes: null,
      acceptance_gate: [
        'Recover Magic Baking Powder style text queries in top 3 on reviewed examples.',
        'Emit observed/metadata/inferred evidence boundaries per OCR entity.',
        'No hallucinated entity labels without image evidence.',
      ],
      reason: 'Global embeddings cannot be expected to solve exact billboard/signage text retrieval.',
    },
    {
      schema_version: 'foundation_model_next_experiment_v0',
      experiment_id: 'fm-geo-label-gate-v1',
      priority: 'medium',
      model_refs: ['GeoCLIP/StreetCLIP only after label gate'],
      task_focus: ['location hints', 'geo-hypothesis ranking'],
      sample_size: 250,
      requires_gpu: true,
      estimated_runtime_minutes: 30,
      acceptance_gate: [
        'At least 100 verified or high-confidence geo labels exist before run.',
        'Model beats metadata-only geo candidate baseline.',
      ],
      reason: 'Geo-aware models cannot be truth-seeking without enough verified location labels.',
    },
  ];
}

function registryRow(
  gpuReport: EmbeddingReport | null,
  reportPaths: string[],
): Record<string, unknown> {
  const models = modelsArray(gpuReport);
  const startedAt = gpuReport?.generated_at ?? '2026-05-26T17:04:50.862045+00:00';
  return {
    schema_version: 'mtl_gpu_experiment_registry_v0',
    run_id: 'foundation-model-benchmark-v0-retrospective-a10-500',
    issue: '#55',
    status: 'completed',
    execution_surface: 'lambda_gpu',
    workload_type: 'benchmark',
    started_at: startedAt,
    ended_at: startedAt,
    budget: {
      approved: true,
      max_runtime_minutes: null,
      max_cost_usd: null,
      instance_type: 'NVIDIA A10',
      region: null,
      hourly_cost_usd: null,
    },
    inputs: {
      datasets: [
        'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl',
        'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
        'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
        'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
      ],
      code_ref: 'pipelines/vectorize/evaluate_embeddings.py',
      model_refs: models.map((model) => model.modelId ?? model.modelKey ?? 'unknown'),
    },
    outputs: {
      artifact_paths: [
        'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.json',
        'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.md',
        'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl',
        'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_siglip.jsonl',
        ...reportPaths,
      ],
      hub_repos: [],
      copied_back: true,
    },
    metrics: {
      sample_rows: gpuReport?.summary?.sample_rows ?? null,
      fetched_images: gpuReport?.summary?.fetched_images ?? null,
      models_completed: gpuReport?.summary?.models_completed ?? null,
      clip_query_mrr: metric(models.find((model) => model.modelKey === 'clip'), 'query_mrr'),
      siglip_query_mrr: metric(models.find((model) => model.modelKey === 'siglip'), 'query_mrr'),
    },
    safety: {
      no_secrets_recorded: true,
      lambda_instances_before: null,
      lambda_instances_after: 0,
      termination_verified: true,
      hf_results_persisted: false,
    },
    decision: {
      advance: false,
      reason: 'Retrospective registry row for completed 500-image A10 benchmark. Keep CLIP; do not re-embed with SigLIP.',
      next_action: 'Only launch a new GPU run with explicit OpenCLIP/DINO acceptance gates and budget.',
    },
    notes: 'Registry row was created after the run to align older GPU evidence with Dataset Factory #58 governance. No new paid compute launched for this row.',
  };
}

function gpuJobSpec(): Record<string, unknown> {
  return {
    schema_version: 'foundation_model_gpu_job_spec_v0',
    experiment_id: 'fm-openclip-dino-geo-1k-v1',
    issue: '#55',
    status: 'ready_for_approval_not_launched',
    launch_requires_explicit_user_confirmation: true,
    recommended_instance: {
      provider: 'lambda_cloud',
      instance_type: 'gpu_1x_a10',
      region_preference: ['us-east-1', 'us-west-1'],
      expected_price_hr_usd: 1.29,
      max_runtime_minutes: 90,
      stop_rule: 'terminate instance immediately after artifacts are copied back and registry row is written',
    },
    observed_safe_preflight_2026_06_30: {
      availability_checked: true,
      active_instances: 0,
      available_single_gpu_types: ['gpu_1x_a10', 'gpu_1x_a100_sxm4', 'gpu_1x_h100_pcie', 'gpu_1x_h100_sxm5'],
      ssh_key_names_present: ['mtl-autoresearch-lambda', 'wiel-macbook-pro'],
      no_paid_launch_performed: true,
    },
    inputs: {
      sample_size: 1000,
      manifest: 'data/mtl_archives/manifest_clean.jsonl',
      taxonomy: 'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl',
      quality: 'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
      visual_family_graph: 'data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-report.json',
      benchmark_tasks: 'data/mtl_archives/reports/search_judgments_v0/retrieval_tasks.search_judgments_v0.jsonl',
    },
    models: [
      {
        key: 'clip_control',
        ref: 'openai/clip-vit-base-patch32',
        purpose: 'production/control retrieval embedding',
      },
      {
        key: 'openclip_large',
        ref: 'laion/CLIP-ViT-L-14-laion2B-s32B-b82K',
        purpose: 'larger image-text retrieval candidate',
      },
      {
        key: 'dinov2_base',
        ref: 'facebook/dinov2-base',
        purpose: 'pure-vision family/coherence feature candidate',
      },
    ],
    metrics: {
      retrieval: ['query_p_at_1', 'query_p_at_5', 'query_mrr', 'query_ndcg_at_10'],
      graph: ['nn_same_category_at_5', 'nn_same_family_at_5', 'duplicate_rate_at_10'],
      runtime: ['runtime_seconds', 'peak_gpu_memory_mb', 'artifact_bytes'],
    },
    acceptance_gates: [
      'OpenCLIP query_mrr >= CLIP query_mrr + 0.05 on reviewed-gold tasks.',
      'OpenCLIP must not increase duplicate_rate_at_10 versus CLIP.',
      'DINOv2 nn_same_family_at_5 or nn_same_category_at_5 >= CLIP + 0.08 for visual-family use.',
      'No production re-embedding unless lift holds outside train slices and artifact cost is acceptable.',
      'Instance termination verified before issue closeout.',
    ],
    remote_commands: [
      'python3 -m venv .venv && source .venv/bin/activate',
      'python -m pip install --upgrade pip',
      'python -m pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0+cu128 torchvision==0.26.0+cu128',
      'python -m pip install transformers open_clip_torch timm pillow pandas numpy scikit-learn tqdm',
      'python3 pipelines/vectorize/evaluate_embeddings.py --limit 1000 --models clip,openclip,dinov2 --require-cuda --fp16 --output-dir data/mtl_archives/reports/foundation_model_benchmark_v0/gpu_openclip_dino_1k',
      'npm run dataset-factory:foundation-model-benchmark-v0',
    ],
    expected_outputs: [
      'data/mtl_archives/reports/foundation_model_benchmark_v0/gpu_openclip_dino_1k/embedding_eval_report.json',
      'data/mtl_archives/reports/foundation_model_benchmark_v0/gpu_openclip_dino_1k/embedding_eval_report.md',
      'data/mtl_archives/reports/foundation_model_benchmark_v0/gpu_openclip_dino_1k/*.jsonl',
      'data/mtl_archives/reports/foundation_model_benchmark_v0/gpu-experiment-registry.openclip-dino-1k.jsonl',
    ],
  };
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Foundation Model Benchmark v0

Generated at: ${report.generated_at}

## Decision

${report.decision}

## Current GPU Benchmark

\`\`\`json
${JSON.stringify(report.current_gpu_benchmark, null, 2)}
\`\`\`

## Decision Log

\`\`\`json
${JSON.stringify(report.decision_summary, null, 2)}
\`\`\`

## Next Experiments

\`\`\`json
${JSON.stringify(report.next_experiments_summary, null, 2)}
\`\`\`

## Caveats

${(report.caveats as string[]).map((line) => `- ${line}`).join('\n')}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'local-report': { type: 'string', default: DEFAULT_LOCAL_REPORT },
      'gpu-report': { type: 'string', default: DEFAULT_GPU_REPORT },
      'visual-graph-report': { type: 'string', default: DEFAULT_VISUAL_GRAPH_REPORT },
      'model-baseline-report': { type: 'string', default: DEFAULT_MODEL_BASELINE_REPORT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const localReportPath = resolveRepoPath(values['local-report']!);
  const gpuReportPath = resolveRepoPath(values['gpu-report']!);
  const visualGraphReportPath = resolveRepoPath(values['visual-graph-report']!);
  const modelBaselineReportPath = resolveRepoPath(values['model-baseline-report']!);
  const outputDir = resolveRepoPath(values.output!);

  const localReport = readJson<EmbeddingReport>(localReportPath);
  const gpuReport = readJson<EmbeddingReport>(gpuReportPath);
  const visualGraphReport = readJson<Record<string, unknown>>(visualGraphReportPath);
  const modelBaselineReport = readJson<Record<string, unknown>>(modelBaselineReportPath);

  const decisions = decisionRows(gpuReport);
  const experiments = nextExperiments();

  fs.mkdirSync(outputDir, { recursive: true });
  const reportJsonPath = path.join(outputDir, 'foundation-model-benchmark-v0-report.json');
  const reportMdPath = path.join(outputDir, 'foundation-model-benchmark-v0-report.md');
  const decisionsPath = path.join(outputDir, 'foundation-model-decision-log-v0.jsonl');
  const experimentsPath = path.join(outputDir, 'foundation-model-next-experiments-v0.jsonl');
  const registryPath = path.join(outputDir, 'gpu-experiment-registry.foundation-model-benchmark-v0.jsonl');
  const gpuJobSpecPath = path.join(outputDir, 'foundation-model-gpu-job-spec-openclip-dino-1k.json');

  const gpuModels = modelsArray(gpuReport);
  const clip = gpuModels.find((model) => model.modelKey === 'clip');
  const siglip = gpuModels.find((model) => model.modelKey === 'siglip');
  const report = {
    generated_at: datasetFactoryNowIso(),
    issue: 55,
    output_dir: rel(outputDir),
    reproducible_commands: {
      local_smoke: 'npm run autoresearch:embedding-eval -- --limit 20 --models clip',
      gpu_500: 'python3 pipelines/vectorize/evaluate_embeddings.py --limit 500 --models clip,siglip --require-cuda --fp16 --output-dir data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500',
      summary: 'npm run dataset-factory:foundation-model-benchmark-v0',
    },
    inputs: {
      local_report: rel(localReportPath),
      gpu_report: rel(gpuReportPath),
      visual_graph_report: rel(visualGraphReportPath),
      model_baseline_report: rel(modelBaselineReportPath),
    },
    local_smoke: {
      generated_at: localReport?.generated_at ?? null,
      summary: localReport?.summary ?? null,
      recommendation: localReport?.recommendation ?? null,
    },
    current_gpu_benchmark: {
      generated_at: gpuReport?.generated_at ?? null,
      runtime: gpuReport?.runtime ?? null,
      summary: gpuReport?.summary ?? null,
      clip: {
        model_ref: clip?.modelId ?? null,
        completed_rows: clip?.completedRows ?? null,
        query_mrr: round(metric(clip, 'query_mrr')),
        query_p_at_1: round(metric(clip, 'query_p_at_1')),
        query_p_at_5: round(metric(clip, 'query_p_at_5')),
        nn_same_category_at_5: round(metric(clip, 'nn_same_category_at_5')),
        nn_shared_theme_at_5: round(metric(clip, 'nn_shared_theme_at_5')),
        runtime_seconds: clip?.runtimeSeconds ?? null,
        peak_gpu_memory_mb: clip?.peakGpuMemoryMb ?? null,
      },
      siglip: {
        model_ref: siglip?.modelId ?? null,
        completed_rows: siglip?.completedRows ?? null,
        query_mrr: round(metric(siglip, 'query_mrr')),
        query_p_at_1: round(metric(siglip, 'query_p_at_1')),
        query_p_at_5: round(metric(siglip, 'query_p_at_5')),
        nn_same_category_at_5: round(metric(siglip, 'nn_same_category_at_5')),
        nn_shared_theme_at_5: round(metric(siglip, 'nn_shared_theme_at_5')),
        runtime_seconds: siglip?.runtimeSeconds ?? null,
        peak_gpu_memory_mb: siglip?.peakGpuMemoryMb ?? null,
      },
    },
    decision: 'Keep current CLIP as the production/control embedding. Do not replace it with SigLIP. Next paid GPU work should test OpenCLIP and DINOv2 with explicit retrieval and family-graph gates.',
    decision_summary: decisions.map((row) => ({
      model_key: row.model_key,
      status: row.status,
      decision: row.decision,
      advance: row.advance,
      reason: row.reason,
    })),
    next_experiments_summary: experiments.map((row) => ({
      experiment_id: row.experiment_id,
      priority: row.priority,
      model_refs: row.model_refs,
      sample_size: row.sample_size,
      requires_gpu: row.requires_gpu,
    })),
    gpu_job_spec: rel(gpuJobSpecPath),
    related_artifacts: {
      visual_family_graph: visualGraphReport
        ? {
          families: visualGraphReport.families,
          family_records: visualGraphReport.family_records,
          by_family_type: visualGraphReport.by_family_type,
        }
        : null,
      model_baseline: modelBaselineReport
        ? {
          recommendation: modelBaselineReport.recommendation ?? null,
          label_reports: modelBaselineReport.label_reports ?? null,
        }
        : null,
    },
    caveats: [
      'OpenCLIP, DINOv2, and geo-aware features have not yet been run in this artifact.',
      'The existing GPU run is a 500-image stratified benchmark, not a full corpus re-embedding.',
      'Classifier utility is still label-limited; use active-learning queues before training larger supervised models.',
      'No new paid GPU instance was launched while producing this v0 decision log.',
    ],
  };

  const registry = registryRow(gpuReport, [
    rel(reportJsonPath),
    rel(reportMdPath),
    rel(decisionsPath),
    rel(experimentsPath),
    rel(gpuJobSpecPath),
  ]);

  const jobSpec = gpuJobSpec();
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf-8');
  fs.writeFileSync(gpuJobSpecPath, JSON.stringify(jobSpec, null, 2), 'utf-8');
  writeJsonl(decisionsPath, decisions);
  writeJsonl(experimentsPath, experiments);
  writeJsonl(registryPath, [registry]);

  console.log(`Wrote Foundation Model Benchmark v0 to ${rel(outputDir)}`);
  console.log(`- decisions=${decisions.length}`);
  console.log(`- next_experiments=${experiments.length}`);
  console.log(`- clip_query_mrr=${round(metric(clip, 'query_mrr'))}`);
  console.log(`- siglip_query_mrr=${round(metric(siglip, 'query_mrr'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
