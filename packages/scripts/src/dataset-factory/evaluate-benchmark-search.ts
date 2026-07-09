import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifact } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_TASKS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0/retrieval_tasks.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0',
);
const DEFAULT_API_BASE = 'https://www.mtlarchives.com';

type RetrievalTask = {
  task_id: string;
  split: 'train' | 'validation' | 'test';
  slice: string;
  record_id: string;
  positive_record_ids: string[];
  query: string;
  expected_rank_bucket: string;
  source_expectation_mode: string;
  eval_modes: string[];
};

type SearchItem = {
  metadataFilename?: string;
  metadata_filename?: string;
  id?: string;
  name?: string;
  title?: string;
  score?: number;
  source?: string;
};

type EvalRow = {
  task_id: string;
  split: RetrievalTask['split'];
  slice: string;
  query: string;
  expected_rank_bucket: string;
  source_expectation_mode: string;
  mode: string;
  expected_record_id: string;
  rank: number | null;
  score: number | null;
  found: boolean;
  pass_expected_bucket: boolean;
  result_count: number;
  error: string | null;
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

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.json$/, '');
}

function itemId(item: SearchItem): string {
  return normalizeId(item.metadataFilename ?? item.metadata_filename ?? item.id);
}

function thresholdForBucket(bucket: string, limit: number): number {
  if (bucket === 'top_1') return 1;
  if (bucket === 'top_3') return 3;
  if (bucket === 'top_10') return 10;
  if (bucket === 'discoverable') return limit;
  if (bucket === 'negative') return 0;
  return limit;
}

async function evaluateTaskMode(task: RetrievalTask, mode: string, apiBase: string, limit: number, maxSize: number, cacheBust?: string): Promise<EvalRow> {
  const expected = normalizeId(task.positive_record_ids[0] ?? task.record_id);
  const url = new URL('/api/search', apiBase);
  url.searchParams.set('q', task.query);
  url.searchParams.set('mode', mode);
  url.searchParams.set('limit', String(limit));
  if (maxSize > 0) url.searchParams.set('maxSize', String(maxSize));
  if (cacheBust) url.searchParams.set('__bench', cacheBust);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { items?: SearchItem[]; results?: SearchItem[] };
    const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.results) ? payload.results : [];
    const index = items.findIndex((item) => itemId(item) === expected);
    const item = index >= 0 ? items[index] : null;
    const rank = index >= 0 ? index + 1 : null;
    const threshold = thresholdForBucket(task.expected_rank_bucket, limit);
    return {
      task_id: task.task_id,
      split: task.split,
      slice: task.slice,
      query: task.query,
      expected_rank_bucket: task.expected_rank_bucket,
      source_expectation_mode: task.source_expectation_mode,
      mode,
      expected_record_id: `${expected}.json`,
      rank,
      score: typeof item?.score === 'number' ? item.score : null,
      found: rank !== null,
      pass_expected_bucket: task.expected_rank_bucket === 'negative' ? rank === null : rank !== null && rank <= threshold,
      result_count: items.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      task_id: task.task_id,
      split: task.split,
      slice: task.slice,
      query: task.query,
      expected_rank_bucket: task.expected_rank_bucket,
      source_expectation_mode: task.source_expectation_mode,
      mode,
      expected_record_id: `${expected}.json`,
      rank: null,
      score: null,
      found: false,
      pass_expected_bucket: false,
      result_count: 0,
      error: message,
    };
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function aggregate(rows: EvalRow[]): Record<string, unknown> {
  const byMode: Record<string, EvalRow[]> = {};
  const bySliceMode: Record<string, EvalRow[]> = {};
  for (const row of rows) {
    byMode[row.mode] = byMode[row.mode] ?? [];
    byMode[row.mode].push(row);
    const sliceMode = `${row.slice}:${row.mode}`;
    bySliceMode[sliceMode] = bySliceMode[sliceMode] ?? [];
    bySliceMode[sliceMode].push(row);
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
    overall: summarize(rows),
    by_mode: Object.fromEntries(Object.entries(byMode).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)])),
    by_slice_mode: Object.fromEntries(Object.entries(bySliceMode).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, summarize(value)])),
  };
}

function renderMarkdown(report: Record<string, unknown>, rows: EvalRow[]): string {
  const aggregateReport = report.aggregate as {
    by_mode?: Record<string, { tasks: number; precision_at_1: number; precision_at_3: number; precision_at_10: number; expected_bucket_pass_rate: number; mrr: number; found_rate: number; errors: number }>;
  };
  const lines = [
    '# MTL-CityMemory-Bench v0 Search Baseline',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## By Mode',
    '',
    '| Mode | Tasks | P@1 | P@3 | P@10 | Expected Pass | MRR | Found | Errors |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [mode, row] of Object.entries(aggregateReport.by_mode ?? {})) {
    lines.push(`| ${mode} | ${row.tasks} | ${row.precision_at_1.toFixed(3)} | ${row.precision_at_3.toFixed(3)} | ${row.precision_at_10.toFixed(3)} | ${row.expected_bucket_pass_rate.toFixed(3)} | ${row.mrr.toFixed(3)} | ${row.found_rate.toFixed(3)} | ${row.errors} |`);
  }
  const failures = rows.filter((row) => !row.pass_expected_bucket && !row.error).slice(0, 25);
  lines.push('', '## First Expected-Bucket Failures', '');
  if (!failures.length) {
    lines.push('No expected-bucket failures.');
  } else {
    lines.push('| Task | Mode | Slice | Query | Expected | Rank |', '|---|---|---|---|---|---:|');
    for (const row of failures) {
      lines.push(`| ${row.task_id} | ${row.mode} | ${row.slice} | ${row.query.replace(/\|/g, '\\|')} | ${row.expected_rank_bucket} | ${row.rank ?? 'missing'} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tasks: { type: 'string', default: DEFAULT_TASKS },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'api-base': { type: 'string', default: DEFAULT_API_BASE },
      'report-api-base': { type: 'string' },
      modes: { type: 'string', default: 'semantic,smart,visual' },
      limit: { type: 'string', default: '24' },
      'max-size': { type: 'string', default: '1000000' },
      'limit-tasks': { type: 'string' },
      'cache-bust': { type: 'string' },
    },
  });

  const tasksPath = resolveRepoPath(values.tasks!);
  const outputDir = resolveRepoPath(values.output!);
  const apiBase = values['api-base']!;
  const reportApiBase = values['report-api-base'] ?? apiBase;
  const modes = values.modes!.split(',').map((mode) => mode.trim()).filter(Boolean);
  const limit = Math.max(1, Number(values.limit ?? 24));
  const maxSize = Math.max(0, Number(values['max-size'] ?? 0));
  const taskLimit = values['limit-tasks'] ? Math.max(1, Number(values['limit-tasks'])) : null;
  const cacheBust = values['cache-bust'];
  requireArtifact(tasksPath, 'benchmark retrieval tasks');
  const tasks = readJsonl<RetrievalTask>(tasksPath).slice(0, taskLimit ?? undefined);

  const rows: EvalRow[] = [];
  for (const task of tasks) {
    for (const mode of modes) {
      rows.push(await evaluateTaskMode(task, mode, apiBase, limit, maxSize, cacheBust));
    }
  }

  const report = {
    benchmark_id: 'mtl_citymemory_bench_v0',
    baseline_id: 'current_live_search',
    generated_at: datasetFactoryNowIso(),
    api_base: reportApiBase,
    search_limit: limit,
    max_size: maxSize,
    cache_bust: cacheBust ?? null,
    input_tasks: path.relative(MONOREPO_ROOT, tasksPath),
    modes,
    aggregate: aggregate(rows),
    caveats: [
      'This is a live API baseline and may change with deployments, indexes, or cache state.',
      'Current API has no OCR lexical mode; baseline evaluates semantic, smart, and visual modes for every retrieval task.',
      'Some benchmark expectations intentionally require future OCR/reranking behavior.',
    ],
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'search_baseline_current.jsonl'), rows);
  fs.writeFileSync(path.join(outputDir, 'search_baseline_current.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'search_baseline_current.md'), renderMarkdown(report, rows), 'utf-8');

  console.log(`Wrote search baseline to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  const byMode = (report.aggregate as { by_mode: Record<string, { precision_at_10: number; mrr: number; expected_bucket_pass_rate: number }> }).by_mode;
  for (const [mode, summary] of Object.entries(byMode)) {
    console.log(`- ${mode}: p@10=${summary.precision_at_10.toFixed(3)} mrr=${summary.mrr.toFixed(3)} expectedPass=${summary.expected_bucket_pass_rate.toFixed(3)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
