import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_GOLD_TASKS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/retrieval_tasks.jsonl',
);
const DEFAULT_RESEARCH_PACKETS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/research_enrichment_v0/research-enrichment-packets-v0.jsonl',
);
const DEFAULT_FAMILY_MAP = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-record-family-map.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/search_judgments_v0');
const DEFAULT_SEED = 'search-judgments-v0-2026-06-30';

type Split = 'train' | 'validation' | 'test';

type RetrievalTask = {
  task_id: string;
  benchmark_id: string;
  task_type: 'retrieval';
  split: Split;
  slice: string;
  record_id: string;
  positive_record_ids: string[];
  query: string;
  expected_rank_bucket: string;
  source_expectation_mode: string;
  eval_modes: string[];
  rationale: string;
  evidence_refs: string[];
  adjudication_status: string;
};

type ResearchPacket = {
  packet_id: string;
  record_id: string;
  research_depth: string;
  provenance_fit_score: number;
  title: string;
  date: string;
  cote: string;
  risk_flags: string[];
  evidence: {
    metadata_claims: Array<{ claim: string; evidence_type: string; source_field: string | null; confidence: number }>;
    inferences: Array<{ claim: string; evidence_type: string; confidence: number; review_flags: string[] }>;
  };
  research_targets: {
    entities: string[];
    search_terms: string[];
    suggested_queries: string[];
  };
};

type FamilyMapRow = {
  record_id?: string;
  leakage_group_id?: string;
};

type SearchJudgment = RetrievalTask & {
  judgment_source: 'reviewed_gold' | 'research_enrichment_silver';
  evidence_boundary: 'reviewed_gold' | 'metadata' | 'inferred';
  confidence: number;
  leakage_group_id: string | null;
};

type EvalRow = {
  task_id: string;
  mode: string;
  rank: number | null;
  found: boolean;
  pass_expected_bucket: boolean;
  error: string | null;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function splitFor(value: string): Split {
  const ratio = hashSeed(`${DEFAULT_SEED}:${value}`) / 4294967296;
  if (ratio < 0.6) return 'train';
  if (ratio < 0.8) return 'validation';
  return 'test';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort();
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

function queryLooksUseful(query: string): boolean {
  const normalized = normalize(query);
  if (normalized.length < 4) return false;
  if (/^mtl archives metadata/.test(normalized)) return false;
  if (/^vm\d/.test(normalized)) return false;
  return normalized.split(' ').length <= 12;
}

function titleSlice(query: string): string {
  if (/(magic baking powder|gazette|joubert|coca cola|molson|company|compagnie|marché|market)/i.test(query)) return 'text_in_image';
  if (/(rue|avenue|boulevard|parc|pont|canal|gare|eglise|église|hotel|hôtel|aqueduc|université|mcgill)/i.test(query)) return 'entity_place';
  return 'metadata_title';
}

function expectationMode(slice: string): string {
  if (slice === 'text_in_image') return 'ocr_lexical';
  if (slice === 'entity_place') return 'reranked';
  return 'semantic';
}

function bucketFor(slice: string): string {
  return slice === 'text_in_image' ? 'top_10' : 'top_10';
}

function bestQuery(packet: ResearchPacket): { query: string; slice: string; boundary: 'metadata' | 'inferred'; confidence: number; evidenceRefs: string[] } | null {
  const entities = packet.research_targets.entities.filter(queryLooksUseful);
  const highValueEntity = entities.find((entity) => /(magic baking powder|gazette|company|compagnie|marché|aqueduc|pont|parc|rue|boulevard|avenue|mcgill)/i.test(entity));
  if (highValueEntity) {
    const slice = titleSlice(highValueEntity);
    return {
      query: highValueEntity,
      slice,
      boundary: 'inferred',
      confidence: slice === 'text_in_image' ? 0.68 : 0.72,
      evidenceRefs: [packet.packet_id, 'research_targets.entities'],
    };
  }
  if (queryLooksUseful(packet.title)) {
    const slice = titleSlice(packet.title);
    return {
      query: packet.title,
      slice,
      boundary: 'metadata',
      confidence: 0.78,
      evidenceRefs: [packet.packet_id, 'metadata.title'],
    };
  }
  const suggested = packet.research_targets.suggested_queries.find(queryLooksUseful);
  if (suggested) {
    const slice = titleSlice(suggested);
    return {
      query: suggested,
      slice,
      boundary: 'inferred',
      confidence: 0.62,
      evidenceRefs: [packet.packet_id, 'research_targets.suggested_queries'],
    };
  }
  return null;
}

function buildSilverTasks(
  packets: ResearchPacket[],
  familyByRecord: Map<string, FamilyMapRow>,
  existingKeys: Set<string>,
  targetCount: number,
): SearchJudgment[] {
  const tasks: SearchJudgment[] = [];
  for (const packet of packets) {
    if (tasks.length >= targetCount) break;
    const query = bestQuery(packet);
    if (!query) continue;
    const key = `${normalize(query.query)}|${packet.record_id}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const family = familyByRecord.get(packet.record_id);
    tasks.push({
      task_id: `ret-silver-${String(tasks.length + 1).padStart(4, '0')}`,
      benchmark_id: 'mtl_citymemory_bench_v0',
      task_type: 'retrieval',
      split: splitFor(clean(family?.leakage_group_id || packet.record_id)),
      slice: query.slice,
      record_id: packet.record_id,
      positive_record_ids: [packet.record_id],
      query: query.query,
      expected_rank_bucket: bucketFor(query.slice),
      source_expectation_mode: expectationMode(query.slice),
      eval_modes: ['semantic', 'smart', 'visual'],
      rationale: `Silver judgment from Research Enrichment v0 packet ${packet.packet_id}. Boundary=${query.boundary}; requires later human review before gold promotion.`,
      evidence_refs: query.evidenceRefs,
      adjudication_status: 'silver_needs_review',
      judgment_source: 'research_enrichment_silver',
      evidence_boundary: query.boundary,
      confidence: query.confidence,
      leakage_group_id: family?.leakage_group_id ?? null,
    });
  }
  return tasks;
}

function liveBaselineSummary(outputDir: string, judgments: SearchJudgment[]): Record<string, unknown> | null {
  const baselineRowsPath = path.join(outputDir, 'live_baseline_current/search_baseline_current.jsonl');
  const baselineReportPath = path.join(outputDir, 'live_baseline_current/search_baseline_current.json');
  if (!fs.existsSync(baselineRowsPath)) return null;
  const rows = readJsonl<EvalRow>(baselineRowsPath);
  const byTask = new Map(judgments.map((row) => [row.task_id, row]));
  const groups = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const judgment = byTask.get(row.task_id);
    const key = `${judgment?.judgment_source ?? 'unknown'}:${row.mode}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const summarize = (items: EvalRow[]) => ({
    tasks: items.length,
    precision_at_1: mean(items.map((row) => row.rank !== null && row.rank <= 1 ? 1 : 0)),
    precision_at_3: mean(items.map((row) => row.rank !== null && row.rank <= 3 ? 1 : 0)),
    precision_at_10: mean(items.map((row) => row.rank !== null && row.rank <= 10 ? 1 : 0)),
    expected_bucket_pass_rate: mean(items.map((row) => row.pass_expected_bucket ? 1 : 0)),
    mrr: mean(items.map((row) => row.rank ? 1 / row.rank : 0)),
    found_rate: mean(items.map((row) => row.found ? 1 : 0)),
    errors: items.filter((row) => row.error).length,
  });
  return {
    report_path: path.relative(MONOREPO_ROOT, baselineReportPath),
    rows_path: path.relative(MONOREPO_ROOT, baselineRowsPath),
    aggregate_by_judgment_source_mode: Object.fromEntries(
      Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => [key, summarize(items)]),
    ),
  };
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Search Judgments v0

Generated at: ${report.generated_at}

## Summary

- Total judgments: ${report.total_judgments}
- Reviewed gold: ${report.reviewed_gold}
- Silver needs review: ${report.silver_needs_review}
- Output directory: \`${report.output_dir}\`

## Breakdown

\`\`\`json
${JSON.stringify(report.breakdown, null, 2)}
\`\`\`

## Decision

${report.decision}

## Live Baseline

\`\`\`json
${JSON.stringify(report.live_baseline_current, null, 2)}
\`\`\`

## Caveats

${(report.caveats as string[]).map((line) => `- ${line}`).join('\n')}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      gold: { type: 'string', default: DEFAULT_GOLD_TASKS },
      packets: { type: 'string', default: DEFAULT_RESEARCH_PACKETS },
      'family-map': { type: 'string', default: DEFAULT_FAMILY_MAP },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      total: { type: 'string', default: '75' },
    },
  });

  const goldPath = resolveRepoPath(values.gold!);
  const packetsPath = resolveRepoPath(values.packets!);
  const familyMapPath = resolveRepoPath(values['family-map']!);
  const outputDir = resolveRepoPath(values.output!);
  const targetTotal = Number.parseInt(values.total!, 10);
  if (!Number.isFinite(targetTotal) || targetTotal < 50 || targetTotal > 100) {
    throw new Error('--total must be between 50 and 100');
  }
  requireArtifacts([
    { path: goldPath, label: 'gold benchmark retrieval tasks' },
    { path: packetsPath, label: 'research enrichment packets' },
    { path: familyMapPath, label: 'visual family graph record map' },
  ]);

  const gold = readJsonl<RetrievalTask>(goldPath);
  const packets = readJsonl<ResearchPacket>(packetsPath);
  const familyByRecord = new Map(readJsonl<FamilyMapRow>(familyMapPath).map((row) => [clean(row.record_id), row]));
  const existingKeys = new Set(gold.map((task) => `${normalize(task.query)}|${task.record_id}`));

  const goldJudgments: SearchJudgment[] = gold.map((task) => ({
    ...task,
    judgment_source: 'reviewed_gold',
    evidence_boundary: 'reviewed_gold',
    confidence: 0.92,
    leakage_group_id: familyByRecord.get(task.record_id)?.leakage_group_id ?? null,
  }));
  const silver = buildSilverTasks(packets, familyByRecord, existingKeys, Math.max(0, targetTotal - goldJudgments.length));
  const judgments = [...goldJudgments, ...silver].slice(0, targetTotal);

  fs.mkdirSync(outputDir, { recursive: true });
  const judgmentPath = path.join(outputDir, 'search-judgments-v0.jsonl');
  const tasksPath = path.join(outputDir, 'retrieval_tasks.search_judgments_v0.jsonl');
  const reportJsonPath = path.join(outputDir, 'search-judgments-v0-report.json');
  const reportMdPath = path.join(outputDir, 'search-judgments-v0-report.md');

  const retrievalTasks: SearchJudgment[] = judgments.map((row) => ({
    task_id: row.task_id,
    benchmark_id: row.benchmark_id,
    task_type: row.task_type,
    split: row.split,
    slice: row.slice,
    record_id: row.record_id,
    positive_record_ids: row.positive_record_ids,
    query: row.query,
    expected_rank_bucket: row.expected_rank_bucket,
    source_expectation_mode: row.source_expectation_mode,
    eval_modes: row.eval_modes,
    rationale: row.rationale,
    evidence_refs: row.evidence_refs,
    adjudication_status: row.adjudication_status,
    judgment_source: row.judgment_source,
    evidence_boundary: row.evidence_boundary,
    confidence: row.confidence,
    leakage_group_id: row.leakage_group_id,
  }));

  const report = {
    generated_at: datasetFactoryNowIso(),
    issue: 52,
    output_dir: rel(outputDir),
    inputs: {
      gold: rel(goldPath),
      packets: rel(packetsPath),
      family_map: rel(familyMapPath),
    },
    total_judgments: judgments.length,
    reviewed_gold: judgments.filter((row) => row.judgment_source === 'reviewed_gold').length,
    silver_needs_review: judgments.filter((row) => row.judgment_source === 'research_enrichment_silver').length,
    breakdown: {
      by_source: countBy(judgments, (row) => row.judgment_source),
      by_slice: countBy(judgments, (row) => row.slice),
      by_split: countBy(judgments, (row) => row.split),
      by_evidence_boundary: countBy(judgments, (row) => row.evidence_boundary),
    },
    top_silver: silver.slice(0, 12).map((row) => ({
      task_id: row.task_id,
      record_id: row.record_id,
      query: row.query,
      slice: row.slice,
      evidence_boundary: row.evidence_boundary,
      confidence: row.confidence,
    })),
    live_baseline_current: liveBaselineSummary(outputDir, judgments),
    decision: 'The v0 query set now meets the 50-100 judgment target for reranker stress testing, but only 26 are reviewed gold. Silver rows must not be treated as final benchmark truth until human/Codex review promotes them.',
    caveats: [
      'Silver judgments are expected-positive retrieval tasks derived from research packets; they are not human-reviewed gold.',
      'Text-in-image expectations intentionally expose OCR/signage gaps such as Magic Baking Powder.',
      'Family leakage groups are carried forward where available so future splits can keep visual relatives together.',
    ],
  };

  writeJsonl(judgmentPath, judgments);
  writeJsonl(tasksPath, retrievalTasks);
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf-8');

  console.log(`Wrote Search Judgments v0 to ${rel(outputDir)}`);
  console.log(`- total_judgments=${judgments.length}`);
  console.log(`- reviewed_gold=${report.reviewed_gold}`);
  console.log(`- silver_needs_review=${report.silver_needs_review}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
