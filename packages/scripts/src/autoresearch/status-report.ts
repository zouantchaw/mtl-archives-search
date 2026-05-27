import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONOREPO_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_status');

type ArtifactStatus = {
  key: string;
  path: string;
  required: boolean;
  exists: boolean;
  bytes: number | null;
  rows: number | null;
  modifiedAt: string | null;
  staleBecause?: string;
};

type Lane = {
  key: string;
  title: string;
  issue?: number;
  required: string[];
  optional?: string[];
  dependsOn?: string[];
  summary: Record<string, unknown>;
  decision?: string;
};

type StatusReport = {
  generatedAt: string;
  status: 'pass' | 'fail';
  outputDir: string;
  summary: Record<string, unknown>;
  decisions: string[];
  lanes: Lane[];
  artifacts: ArtifactStatus[];
  missingRequired: ArtifactStatus[];
  staleRequired: ArtifactStatus[];
  actionableMissingPaths: string[];
};

const ARTIFACTS = {
  vlmFullCompletion: 'data/mtl_archives/reports/autoresearch_vlm_full/completion_report.json',
  vlmFullManifest: 'data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl',
  candidatesReport: 'data/mtl_archives/reports/autoresearch_candidates/candidates.json',
  candidatesDownstream: 'data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl',
  collectionsCompletion: 'data/mtl_archives/reports/autoresearch_collections/completion_report.json',
  collectionsDownstream: 'data/mtl_archives/reports/autoresearch_collections/collections_downstream.jsonl',
  collectionRecordsDownstream: 'data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl',
  qualityCompletion: 'data/mtl_archives/reports/autoresearch_image_quality/completion_report.json',
  qualityLabels: 'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
  qualityIssues: 'data/mtl_archives/reports/autoresearch_image_quality/quality_issues_downstream.jsonl',
  taxonomyCompletion: 'data/mtl_archives/reports/autoresearch_taxonomy/completion_report.json',
  taxonomyDownstream: 'data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl',
  cleanupCompletion: 'data/mtl_archives/reports/autoresearch_cleanup_embedding/completion_report.json',
  cleanupRows: 'data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_rows.jsonl',
  embeddingGpuReport: 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.json',
  embeddingGpuCompletion: 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/gpu_500_completion_report.json',
  embeddingClipRows: 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl',
  embeddingSiglipRows: 'data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_siglip.jsonl',
  searchIssue22Completion: 'data/mtl_archives/reports/autoresearch_search_issue22/completion_report.json',
  searchIssue22Baseline: 'data/mtl_archives/reports/autoresearch_search_issue22_baseline.json',
  searchIssue22Policy: 'data/mtl_archives/reports/autoresearch_search_issue22_policy.json',
  socialReport: 'data/social/autoresearch_social_report.json',
  socialShortlistReport: 'data/social/autoresearch_shortlist/shortlist_report.json',
  lambdaState: 'data/mtl_archives/reports/autoresearch_lambda_state.json',
  decisionLog: 'docs/autoresearch.md',
} as const;

function resolveRepo(relativePath: string): string {
  return path.resolve(MONOREPO_ROOT, relativePath);
}

function readJson<T = any>(relativePath: string): T | null {
  const absolutePath = resolveRepo(relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

function countJsonlRows(relativePath: string): number | null {
  const absolutePath = resolveRepo(relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  const text = fs.readFileSync(absolutePath, 'utf8').trim();
  if (!text) return 0;
  return text.split('\n').length;
}

function artifactStatus(key: string, relativePath: string, required: boolean): ArtifactStatus {
  const absolutePath = resolveRepo(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { key, path: relativePath, required, exists: false, bytes: null, rows: null, modifiedAt: null };
  }
  const stat = fs.statSync(absolutePath);
  return {
    key,
    path: relativePath,
    required,
    exists: true,
    bytes: stat.size,
    rows: relativePath.endsWith('.jsonl') ? countJsonlRows(relativePath) : null,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function markStale(artifact: ArtifactStatus, dependencyKeys: string[], artifactsByKey: Map<string, ArtifactStatus>): ArtifactStatus {
  if (!artifact.exists || !artifact.modifiedAt) return artifact;
  const artifactTime = Date.parse(artifact.modifiedAt);
  for (const dependencyKey of dependencyKeys) {
    const dependency = artifactsByKey.get(dependencyKey);
    if (!dependency?.exists || !dependency.modifiedAt) continue;
    if (Date.parse(dependency.modifiedAt) > artifactTime) {
      return { ...artifact, staleBecause: `${dependency.path} is newer` };
    }
  }
  return artifact;
}

function num(value: unknown, digits = 4): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

function modelMetrics(report: any, modelKey: string): Record<string, unknown> {
  const model = (report?.models ?? []).find((entry: any) => entry?.modelKey === modelKey);
  const metrics = model?.metrics ?? {};
  return {
    completedRows: model?.completedRows ?? null,
    failedRows: model?.failedRows ?? null,
    queryMrr: num(metrics.query_mrr),
    queryP1: num(metrics.query_p_at_1),
    queryP5: num(metrics.query_p_at_5),
    promptP1: num(metrics.prompt_p_at_1),
    nnSameCategoryAt5: num(metrics.nn_same_category_at_5),
    nnSharedThemeAt5: num(metrics.nn_shared_theme_at_5),
  };
}

function buildReport(outputDir: string): StatusReport {
  const vlm = readJson<any>(ARTIFACTS.vlmFullCompletion);
  const candidates = readJson<any>(ARTIFACTS.candidatesReport);
  const collections = readJson<any>(ARTIFACTS.collectionsCompletion);
  const quality = readJson<any>(ARTIFACTS.qualityCompletion);
  const taxonomy = readJson<any>(ARTIFACTS.taxonomyCompletion);
  const cleanup = readJson<any>(ARTIFACTS.cleanupCompletion);
  const embedding = readJson<any>(ARTIFACTS.embeddingGpuReport);
  const search = readJson<any>(ARTIFACTS.searchIssue22Completion);
  const social = readJson<any>(ARTIFACTS.socialReport);
  const shortlist = readJson<any>(ARTIFACTS.socialShortlistReport);
  const lambda = readJson<any>(ARTIFACTS.lambdaState);

  const lanes: Lane[] = [
    {
      key: 'vlm_full',
      title: 'Full Archive VLM Enrichment',
      issue: 13,
      required: ['vlmFullCompletion', 'vlmFullManifest'],
      summary: {
        rows: vlm?.metrics?.rows ?? null,
        captioned: vlm?.metrics?.captioned ?? null,
        structuredValid: vlm?.metrics?.structured_valid ?? null,
        structuredInvalid: vlm?.metrics?.structured_invalid ?? null,
        errors: vlm?.metrics?.errors ?? null,
        gpuHours: num((vlm?.metrics?.duration_seconds ?? 0) / 3600, 2),
      },
    },
    {
      key: 'candidates',
      title: 'Rare, Sequence, Social, and Print Candidates',
      issue: 11,
      required: ['candidatesReport', 'candidatesDownstream'],
      dependsOn: ['vlmFullManifest'],
      summary: candidates?.summary ?? {},
    },
    {
      key: 'collections',
      title: 'Visual Collections',
      issue: 19,
      required: ['collectionsCompletion', 'collectionsDownstream', 'collectionRecordsDownstream'],
      dependsOn: ['vlmFullManifest', 'candidatesReport'],
      summary: collections?.summary ?? {},
    },
    {
      key: 'quality',
      title: 'Image Quality Labels',
      issue: 20,
      required: ['qualityCompletion', 'qualityLabels', 'qualityIssues'],
      dependsOn: ['vlmFullManifest', 'candidatesReport', 'collectionsDownstream'],
      summary: quality?.summary ?? {},
    },
    {
      key: 'taxonomy',
      title: 'Visual Taxonomy',
      issue: 16,
      required: ['taxonomyCompletion', 'taxonomyDownstream'],
      dependsOn: ['vlmFullManifest', 'candidatesDownstream', 'collectionRecordsDownstream', 'qualityLabels'],
      summary: taxonomy?.summary ?? {},
    },
    {
      key: 'cleanup',
      title: 'Cleanup Before Embedding',
      issue: 12,
      required: ['cleanupCompletion', 'cleanupRows'],
      dependsOn: ['qualityIssues'],
      summary: cleanup?.summary ?? {},
      decision: cleanup?.decision ?? 'Use targeted review only; do not blindly cleanup all flagged records.',
    },
    {
      key: 'embedding_gpu',
      title: 'CLIP/SigLIP GPU Embedding Evaluation',
      issue: 17,
      required: ['embeddingGpuReport', 'embeddingGpuCompletion', 'embeddingClipRows', 'embeddingSiglipRows'],
      dependsOn: ['taxonomyDownstream', 'qualityLabels', 'candidatesDownstream', 'collectionRecordsDownstream'],
      summary: {
        runtime: embedding?.runtime ?? {},
        sample: embedding?.summary ?? {},
        clip: modelMetrics(embedding, 'clip'),
        siglip: modelMetrics(embedding, 'siglip'),
      },
      decision: embedding?.recommendation ?? 'Keep CLIP unless a larger embedding model family is tested.',
    },
    {
      key: 'search_productization',
      title: 'Search Taxonomy/Quality Productization',
      issue: 22,
      required: ['searchIssue22Completion', 'searchIssue22Baseline', 'searchIssue22Policy'],
      dependsOn: ['taxonomyDownstream', 'qualityLabels'],
      summary: search?.summary ?? {},
      decision: 'Policy metadata is wired in, but current eval is neutral/slightly negative; keep measuring product search gaps.',
    },
    {
      key: 'social',
      title: 'Social Evaluation and Shortlist',
      issue: 23,
      required: ['socialReport', 'socialShortlistReport'],
      summary: {
        socialEvaluation: social?.aggregate ?? {},
        shortlist: shortlist?.summary ?? {},
      },
      decision: 'Use autoresearch shortlist as a review queue, not as publish approval.',
    },
    {
      key: 'lambda_state',
      title: 'Lambda/GPU State',
      issue: 10,
      required: ['lambdaState'],
      summary: {
        activeInstances: Array.isArray(lambda?.lastStatus) ? lambda.lastStatus.length : null,
        updatedAt: lambda?.updatedAt ?? null,
        launchedAt: lambda?.launchedAt ?? null,
        terminatedAt: lambda?.terminatedAt ?? null,
        instanceType: lambda?.launchPlan?.instanceTypeName ?? null,
        region: lambda?.launchPlan?.regionName ?? null,
      },
      decision: Array.isArray(lambda?.lastStatus) && lambda.lastStatus.length === 0 ? 'No active Lambda GPU instances recorded.' : 'Check Lambda manually before starting another GPU job.',
    },
    {
      key: 'decision_log',
      title: 'Durable Decision Log',
      issue: 21,
      required: ['decisionLog'],
      summary: {
        path: ARTIFACTS.decisionLog,
      },
    },
  ];

  const requiredKeys = new Set(lanes.flatMap((lane) => lane.required));
  const optionalKeys = new Set(lanes.flatMap((lane) => lane.optional ?? []));
  const artifactRows = Object.entries(ARTIFACTS).map(([key, relativePath]) =>
    artifactStatus(key, relativePath, requiredKeys.has(key) || !optionalKeys.has(key)),
  );
  const byKey = new Map(artifactRows.map((artifact) => [artifact.key, artifact]));
  const staleKeys = new Map<string, string[]>();
  for (const lane of lanes) {
    for (const required of lane.required) {
      if (lane.dependsOn?.length) staleKeys.set(required, lane.dependsOn);
    }
  }
  const artifacts = artifactRows.map((artifact) => markStale(artifact, staleKeys.get(artifact.key) ?? [], byKey));
  const missingRequired = artifacts.filter((artifact) => artifact.required && !artifact.exists);
  const staleRequired = artifacts.filter((artifact) => artifact.required && artifact.staleBecause);
  const clip = modelMetrics(embedding, 'clip');
  const siglip = modelMetrics(embedding, 'siglip');

  return {
    generatedAt: new Date().toISOString(),
    status: missingRequired.length || staleRequired.length ? 'fail' : 'pass',
    outputDir: path.relative(MONOREPO_ROOT, outputDir),
    summary: {
      lanes: lanes.length,
      artifacts: artifacts.length,
      missingRequired: missingRequired.length,
      staleRequired: staleRequired.length,
      vlmRows: vlm?.metrics?.rows ?? null,
      taxonomyRows: taxonomy?.summary?.classified_rows ?? null,
      qualityLabels: countJsonlRows(ARTIFACTS.qualityLabels),
      candidateRows: countJsonlRows(ARTIFACTS.candidatesDownstream),
      collections: collections?.summary?.collections ?? null,
      socialShortlistSelected: shortlist?.summary?.selectedRecords ?? null,
      gpuDevice: embedding?.runtime?.device ?? null,
      gpuName: embedding?.runtime?.gpu_name ?? null,
      clipQueryMrr: clip.queryMrr,
      siglipQueryMrr: siglip.queryMrr,
      lambdaActiveInstances: Array.isArray(lambda?.lastStatus) ? lambda.lastStatus.length : null,
    },
    decisions: [
      'Keep the current CLIP embedding baseline; the 500-record Lambda A10 CUDA run beat base SigLIP on product-critical query retrieval.',
      'Do not re-embed production indexes with base SigLIP from current evidence.',
      'Use taxonomy and quality labels as product/search inputs, but keep evaluating search ranking changes because issue #22 was neutral/slightly negative.',
      'Use visual collections and candidate reports as reviewable inputs for social/story workflows, not automatic publishing decisions.',
      'Use cleanup for targeted review only; do not blindly crop or normalize all flagged records.',
      'Run another GPU embedding experiment only if product search still has gaps after taxonomy, quality, and ranking integration.',
    ],
    lanes,
    artifacts,
    missingRequired,
    staleRequired,
    actionableMissingPaths: missingRequired.map((artifact) => artifact.path),
  };
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function tableRow(cells: unknown[]): string {
  return `| ${cells.map((cell) => String(cell ?? '').replace(/\n/g, '<br>')).join(' | ')} |`;
}

function writeMarkdown(filePath: string, report: StatusReport): void {
  const lines = [
    '# Autoresearch Status Report',
    '',
    `Generated: \`${report.generatedAt}\``,
    '',
    `Status: **${report.status.toUpperCase()}**`,
    '',
    '## Summary',
    '',
    `- Required missing artifacts: \`${report.missingRequired.length}\``,
    `- Required stale artifacts: \`${report.staleRequired.length}\``,
    `- VLM rows: \`${report.summary.vlmRows}\``,
    `- Taxonomy rows: \`${report.summary.taxonomyRows}\``,
    `- Quality labels: \`${report.summary.qualityLabels}\``,
    `- Candidate rows: \`${report.summary.candidateRows}\``,
    `- Collections: \`${report.summary.collections}\``,
    `- Social shortlist selected: \`${report.summary.socialShortlistSelected}\``,
    `- GPU evidence: \`${report.summary.gpuName ?? report.summary.gpuDevice ?? 'unknown'}\``,
    `- Lambda active instances: \`${report.summary.lambdaActiveInstances}\``,
    '',
    '## Key Decisions',
    '',
    ...report.decisions.map((decision) => `- ${decision}`),
    '',
    '## Embedding Evidence',
    '',
    tableRow(['Model', 'Query MRR', 'Query P@1', 'Query P@5', 'Prompt P@1', 'NN category@5', 'NN theme@5']),
    tableRow(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
  ];
  const embeddingLane = report.lanes.find((lane) => lane.key === 'embedding_gpu');
  const embeddingSummary = embeddingLane?.summary as any;
  for (const key of ['clip', 'siglip']) {
    const metrics = embeddingSummary?.[key] ?? {};
    lines.push(tableRow([key, metrics.queryMrr, metrics.queryP1, metrics.queryP5, metrics.promptP1, metrics.nnSameCategoryAt5, metrics.nnSharedThemeAt5]));
  }
  lines.push(
    '',
    `Decision: ${embeddingLane?.decision ?? 'Keep CLIP from current evidence.'}`,
    '',
    '## Lanes',
    '',
    tableRow(['Lane', 'Issue', 'Required artifacts', 'Summary', 'Decision']),
    tableRow(['---', '---:', '---', '---', '---']),
  );
  for (const lane of report.lanes) {
    const requiredStatuses = lane.required
      .map((key) => {
        const artifact = report.artifacts.find((entry) => entry.key === key);
        if (!artifact?.exists) return `missing:${key}`;
        if (artifact.staleBecause) return `stale:${key}`;
        return `ok:${key}`;
      })
      .join('<br>');
    lines.push(tableRow([lane.title, lane.issue ? `#${lane.issue}` : '', requiredStatuses, JSON.stringify(lane.summary), lane.decision ?? '']));
  }
  lines.push('', '## Missing Or Stale Required Artifacts', '');
  if (!report.missingRequired.length && !report.staleRequired.length) {
    lines.push('- None.');
  } else {
    for (const artifact of report.missingRequired) lines.push(`- Missing: \`${artifact.path}\``);
    for (const artifact of report.staleRequired) lines.push(`- Stale: \`${artifact.path}\` (${artifact.staleBecause})`);
  }
  lines.push('', '## Outputs', '', `- JSON: \`${path.relative(MONOREPO_ROOT, path.join(path.dirname(filePath), 'status_report.json'))}\``, `- Markdown: \`${path.relative(MONOREPO_ROOT, filePath)}\``, '');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'));
}

function parseArgs(): { outputDir: string } {
  const outputIndex = process.argv.indexOf('--output-dir');
  const outputDir = outputIndex >= 0 ? process.argv[outputIndex + 1] : DEFAULT_OUTPUT_DIR;
  if (!outputDir) throw new Error('--output-dir requires a value');
  return { outputDir: path.resolve(MONOREPO_ROOT, outputDir) };
}

function main(): void {
  const { outputDir } = parseArgs();
  const report = buildReport(outputDir);
  const jsonPath = path.join(outputDir, 'status_report.json');
  const markdownPath = path.join(outputDir, 'status_report.md');
  writeJson(jsonPath, report);
  writeMarkdown(markdownPath, report);
  console.log(`[autoresearch:status] status=${report.status}`);
  console.log(`[autoresearch:status] missingRequired=${report.missingRequired.length} staleRequired=${report.staleRequired.length}`);
  console.log(`[autoresearch:status] markdown=${path.relative(MONOREPO_ROOT, markdownPath)}`);
  console.log(`[autoresearch:status] json=${path.relative(MONOREPO_ROOT, jsonPath)}`);
  if (report.status !== 'pass') process.exitCode = 1;
}

main();
