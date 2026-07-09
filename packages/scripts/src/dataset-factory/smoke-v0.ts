import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FIXTURE_DIR = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/v0-smoke');
const DEFAULT_OUTPUT_DIR = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/dataset_factory_smoke_v0');
const FIXED_NOW = '2026-07-09T00:00:00.000Z';
const REPORTED_FIXTURE_API_BASE = 'http://fixture-search.invalid';
const EXPECTED_OUTPUT_TREE_SHA256 = 'd42c31f149637098a058637e3073a4a827674c0d1278df66ea870012a537145d';
const EXPECTED_COUNTS = {
  review_packet_rows: 6,
  batch_packet_rows: 5,
  calibration_label_rows: 5,
  adjudicated_label_rows: 5,
  benchmark_retrieval_tasks: 6,
  search_baseline_rows: 18,
  reranker_candidates: 48,
  reranker_preferences: 24,
  active_learning_rows: 5,
  active_learning_label_rows: 4,
  quality_repair_rows: 7,
  visual_family_rows: 3,
  research_packet_rows: 8,
  search_judgment_rows: 10,
  reward_signal_rows: 33,
} as const;

type CommandResult = {
  script: string;
  args: string[];
  status: number;
  stdout_tail: string;
};

type ArchiveRecord = {
  metadata_filename: string;
  name?: string;
  description?: string;
  vlm_caption?: string;
  image_filename?: string;
};

type SearchItem = {
  metadataFilename: string;
  name: string;
  description: string;
  score: number;
  source: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath).split(path.sep).join('/');
}

function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJsonl<T>(filePath: string): T[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function lineCount(filePath: string): number | null {
  if (!/\.(jsonl|ndjson)$/i.test(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function walkFiles(root: string, current = root): string[] {
  const rows: string[] = [];
  if (!fs.existsSync(current)) return rows;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) rows.push(...walkFiles(root, absolute));
    if (entry.isFile()) rows.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return rows.sort();
}

function treeDigest(root: string): string {
  const rows = walkFiles(root).map((relativePath) => {
    const absolute = path.join(root, relativePath);
    const bytes = fs.readFileSync(absolute);
    return `${relativePath}\t${sha256(bytes)}\t${bytes.byteLength}`;
  });
  return sha256(`${rows.join('\n')}\n`);
}

function fileSummary(filePath: string): Record<string, unknown> {
  const bytes = fs.readFileSync(filePath);
  return {
    path: rel(filePath),
    sha256: sha256(bytes),
    byte_count: bytes.byteLength,
    row_count: lineCount(filePath),
  };
}

function tail(value: string, max = 1400): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function scriptPath(scriptName: string): string {
  return path.join('packages/scripts/src/dataset-factory', scriptName);
}

function runScript(scriptName: string, args: string[], commands: CommandResult[]): void {
  const tsxCli = path.join(MONOREPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`Missing local tsx CLI: ${tsxCli}. Run npm install before Dataset Factory smoke.`);
  }
  const result = spawnSync(process.execPath, [tsxCli, scriptPath(scriptName), ...args], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', DATASET_FACTORY_FIXED_NOW: FIXED_NOW },
  });
  commands.push({
    script: scriptName,
    args,
    status: result.status ?? 1,
    stdout_tail: tail(result.stdout ?? ''),
  });
  if (result.status !== 0) {
    throw new Error([
      `Dataset Factory smoke command failed: ${scriptName}`,
      `args: ${args.join(' ')}`,
      `exit: ${result.status}`,
      `stdout:\n${tail(result.stdout ?? '', 4000)}`,
      `stderr:\n${tail(result.stderr ?? '', 4000)}`,
    ].join('\n'));
  }
}

async function runScriptAsync(scriptName: string, args: string[], commands: CommandResult[], timeoutMs = 90_000): Promise<void> {
  const tsxCli = path.join(MONOREPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`Missing local tsx CLI: ${tsxCli}. Run npm install before Dataset Factory smoke.`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, scriptPath(scriptName), ...args], {
      cwd: MONOREPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0', DATASET_FACTORY_FIXED_NOW: FIXED_NOW },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout = tail(stdout + chunk, 100_000);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = tail(stderr + chunk, 100_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      commands.push({
        script: scriptName,
        args,
        status: code ?? 1,
        stdout_tail: tail(stdout),
      });
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error([
        `Dataset Factory smoke command failed: ${scriptName}`,
        `args: ${args.join(' ')}`,
        `exit: ${code ?? signal ?? 'unknown'}`,
        `stdout:\n${tail(stdout, 4000)}`,
        `stderr:\n${tail(stderr, 4000)}`,
      ].join('\n')));
    });
  });
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenScore(query: string, record: ArchiveRecord): number {
  const tokens = normalize(query).split(' ').filter((token) => token.length > 2);
  const haystack = normalize([record.name, record.description, record.vlm_caption, record.metadata_filename].join(' '));
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / Math.max(1, tokens.length);
}

function searchItems(query: string, records: ArchiveRecord[]): SearchItem[] {
  return records
    .map((record, index) => ({
      metadataFilename: record.metadata_filename.replace(/\.json$/i, ''),
      name: record.name ?? record.metadata_filename,
      description: record.description ?? '',
      score: Number((1 - index * 0.01 + tokenScore(query, record)).toFixed(4)),
      source: 'fixture_mock_search',
    }))
    .sort((a, b) => b.score - a.score || a.metadataFilename.localeCompare(b.metadataFilename));
}

async function withMockSearchServer<T>(records: ArchiveRecord[], run: (apiBase: string) => Promise<T>): Promise<T> {
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/api/search') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const query = url.searchParams.get('q') ?? '';
      const limit = Math.max(1, Number(url.searchParams.get('limit') ?? '24'));
      const items = searchItems(query, records).slice(0, limit);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ items, results: items }));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock search server did not expose a TCP address.');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function assertFile(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`Expected smoke output is missing: ${filePath}`);
}

function assertRows<T>(filePath: string, expectedRows: number): T[] {
  assertFile(filePath);
  const rows = readJsonl<T>(filePath);
  if (rows.length !== expectedRows) throw new Error(`${filePath} emitted ${rows.length} rows, expected exactly ${expectedRows}`);
  return rows;
}

function assertJson(filePath: string): void {
  assertFile(filePath);
  readJson(filePath);
}

function assertRepresentative<T>(rows: T[], predicate: (row: T) => boolean, description: string): void {
  if (!rows.some(predicate)) throw new Error(`Smoke representative assertion failed: ${description}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'keep-output': { type: 'boolean', default: false },
    },
  });

  const outputRoot = resolveRepoPath(values.output!);
  if (!values['keep-output']) fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const fixture = (name: string) => path.join(FIXTURE_DIR, name);
  const out = (name: string) => path.join(outputRoot, name);
  const commands: CommandResult[] = [];
  const records = readJsonl<ArchiveRecord>(fixture('manifest.jsonl'));

  runScript('check-artifact-registry.ts', [
    '--registry', 'docs/dataset-factory/artifact-registry.v0.jsonl',
    '--require', [
      'dfv0_manifest_vlm_full',
      'dfv0_batch_001_quality_model_review_001',
      'dfv0_benchmark_quality_gold',
      'dfv0_active_learning_v0',
      'dfv0_quality_repair_v0',
      'dfv0_visual_family_graph_v0',
      'dfv0_research_enrichment_v0',
      'dfv0_reward_data_v0',
    ].join(','),
  ], commands);

  runScript('build-review-packets.ts', [
    '--manifest', fixture('manifest.jsonl'),
    '--taxonomy', fixture('taxonomy.jsonl'),
    '--quality', fixture('quality-labels.jsonl'),
    '--candidates', fixture('candidates.jsonl'),
    '--collections', fixture('collection-records.jsonl'),
    '--output', out('review_packets'),
    '--limit-per-stratum', '2',
    '--candidate-per-type', '2',
    '--taxonomy-spread-limit', '3',
    '--public-r2-domain', 'fixtures.example.test',
  ], commands);

  runScript('build-batch-001.ts', [
    '--manifest', fixture('manifest.jsonl'),
    '--taxonomy', fixture('taxonomy.jsonl'),
    '--output', out('batch_001'),
    '--aerial-limit', '3',
    '--public-r2-domain', 'fixtures.example.test',
  ], commands);

  runScript('build-calibration-001.ts', [
    '--input', path.join(out('batch_001'), 'batch_001_review_packet.jsonl'),
    '--output', out('calibration_50'),
  ], commands);

  runScript('label-calibration-001.ts', [
    '--input', path.join(out('calibration_50'), 'calibration_packet.jsonl'),
    '--output', out('calibration_50'),
  ], commands);

  runScript('adjudicate-batch-001.ts', [
    '--input', path.join(out('calibration_50'), 'calibration_labels.jsonl'),
    '--output', out('adjudication_v0'),
  ], commands);

  runScript('build-benchmark-v0.ts', [
    '--labels', path.join(out('calibration_50'), 'calibration_labels.jsonl'),
    '--output', out('benchmark_v0'),
  ], commands);

  await withMockSearchServer(records, async (apiBase) => {
    const commandStart = commands.length;
    await runScriptAsync('evaluate-benchmark-search.ts', [
      '--tasks', path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl'),
      '--output', out('benchmark_v0'),
      '--api-base', apiBase,
      '--report-api-base', REPORTED_FIXTURE_API_BASE,
      '--modes', 'semantic,smart,visual',
      '--limit', '8',
      '--limit-tasks', '6',
      '--max-size', '0',
    ], commands);

    await runScriptAsync('evaluate-search-reranker.ts', [
      '--tasks', path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl'),
      '--manifest', fixture('manifest.jsonl'),
      '--labels', path.join(out('calibration_50'), 'calibration_labels.jsonl'),
      '--output', out('search_reranker_v0'),
      '--api-base', apiBase,
      '--report-api-base', REPORTED_FIXTURE_API_BASE,
      '--modes', 'semantic,smart,visual',
      '--limit', '8',
      '--limit-tasks', '6',
      '--max-size', '0',
      '--epochs', '8',
      '--max-negatives-per-task', '4',
    ], commands);
    for (const command of commands.slice(commandStart)) {
      command.args = command.args.map((arg) => arg === apiBase ? REPORTED_FIXTURE_API_BASE : arg);
    }
  });

  runScript('build-active-learning-v0.ts', [
    '--manifest', fixture('manifest.jsonl'),
    '--taxonomy', fixture('taxonomy.jsonl'),
    '--quality', fixture('quality-labels.jsonl'),
    '--candidates', fixture('candidates.jsonl'),
    '--collections', fixture('collection-records.jsonl'),
    '--labels', fixture('existing-labels.jsonl'),
    '--search-baseline', path.join(out('benchmark_v0'), 'search_baseline_current.jsonl'),
    '--artifact-decisions', fixture('image-artifact-decisions.ndjson'),
    '--cleanup-rows', fixture('cleanup-embedding-rows.jsonl'),
    '--model-baseline', fixture('model-baseline-report.json'),
    '--output', out('active_learning_v0'),
    '--queue-size', '5',
    '--max-per-family', '3',
    '--public-r2-domain', 'fixtures.example.test',
  ], commands);

  runScript('label-active-learning-001.ts', [
    '--queue', path.join(out('active_learning_v0'), 'active-learning-batch-001.jsonl'),
    '--existing', path.join(out('calibration_50'), 'calibration_labels.jsonl'),
    '--output', out('active_learning_labels'),
    '--limit', '4',
  ], commands);

  runScript('build-quality-repair-v0.ts', [
    '--quality-labels', fixture('quality-labels.jsonl'),
    '--quality-report', fixture('quality-report.json'),
    '--cleanup-rows', fixture('cleanup-embedding-rows.jsonl'),
    '--cleanup-report', fixture('cleanup-embedding-report.json'),
    '--missing-rows', fixture('missing-images.jsonl'),
    '--missing-report', fixture('missing-images-report.json'),
    '--orientation-report', fixture('image-orientation-report.json'),
    '--orientation-sql', fixture('image-orientation-updates.sql'),
    '--artifact-report', fixture('image-artifact-report.json'),
    '--artifact-decisions', fixture('image-artifact-decisions.ndjson'),
    '--search-baseline', path.join(out('benchmark_v0'), 'search_baseline_current.json'),
    '--output', out('quality_repair_v0'),
    '--max-queue', '8',
  ], commands);

  runScript('build-visual-family-graph-v0.ts', [
    '--manifest', fixture('manifest.jsonl'),
    '--collection-records', fixture('collection-records.jsonl'),
    '--collections', fixture('collections.jsonl'),
    '--embeddings', fixture('embedding-neighbors.jsonl'),
    '--quality', fixture('quality-labels.jsonl'),
    '--reranker-report', path.join(out('search_reranker_v0'), 'search_reranker_report.json'),
    '--output', out('visual_family_graph_v0'),
    '--neighbor-threshold', '0.84',
    '--max-embedding-families', '4',
  ], commands);

  runScript('build-research-enrichment-v0.ts', [
    '--manifest', fixture('manifest.jsonl'),
    '--taxonomy', fixture('taxonomy.jsonl'),
    '--candidates', fixture('candidates.jsonl'),
    '--collections', fixture('collection-records.jsonl'),
    '--quality', fixture('quality-labels.jsonl'),
    '--family-map', path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-record-family-map.jsonl'),
    '--active-queue', path.join(out('active_learning_v0'), 'active-learning-batch-001.jsonl'),
    '--output', out('research_enrichment_v0'),
    '--limit', '25',
  ], commands);

  runScript('build-search-judgments-v0.ts', [
    '--gold', path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl'),
    '--packets', path.join(out('research_enrichment_v0'), 'research-enrichment-packets-v0.jsonl'),
    '--family-map', path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-record-family-map.jsonl'),
    '--output', out('search_judgments_v0'),
    '--total', '50',
  ], commands);

  runScript('build-reward-data-v0.ts', [
    '--pairwise', path.join(out('search_reranker_v0'), 'search_pairwise_preferences.jsonl'),
    '--active-learning', path.join(out('active_learning_v0'), 'active-learning-batch-001.jsonl'),
    '--output', out('reward_data_v0'),
    '--captured-at', FIXED_NOW,
  ], commands);

  const reviewPackets = assertRows<Record<string, unknown>>(path.join(out('review_packets'), 'review_packet.jsonl'), EXPECTED_COUNTS.review_packet_rows);
  const batchPackets = assertRows<{ record?: { id?: string }; lane?: string }>(path.join(out('batch_001'), 'batch_001_review_packet.jsonl'), EXPECTED_COUNTS.batch_packet_rows);
  const calibrationLabels = assertRows<{ record_id?: string; labels?: { image_mode?: string } }>(path.join(out('calibration_50'), 'calibration_labels.jsonl'), EXPECTED_COUNTS.calibration_label_rows);
  const adjudicatedLabels = assertRows<{ record_id?: string }>(path.join(out('adjudication_v0'), 'batch-001-adjudicated-labels.jsonl'), EXPECTED_COUNTS.adjudicated_label_rows);
  const retrievalTasks = assertRows<{ task_id?: string; query?: string }>(path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl'), EXPECTED_COUNTS.benchmark_retrieval_tasks);
  const searchBaseline = assertRows<{ task_id?: string; mode?: string; rank?: number }>(path.join(out('benchmark_v0'), 'search_baseline_current.jsonl'), EXPECTED_COUNTS.search_baseline_rows);
  const rerankerCandidates = assertRows<{ task_id?: string; candidate_record_id?: string; is_positive?: boolean }>(path.join(out('search_reranker_v0'), 'search_candidates.jsonl'), EXPECTED_COUNTS.reranker_candidates);
  const rerankerPreferences = assertRows<{ preference_id?: string; preferred_record_id?: string }>(path.join(out('search_reranker_v0'), 'search_pairwise_preferences.jsonl'), EXPECTED_COUNTS.reranker_preferences);
  const activeLearning = assertRows<{ rank?: number; record?: { id?: string } }>(path.join(out('active_learning_v0'), 'active-learning-batch-001.jsonl'), EXPECTED_COUNTS.active_learning_rows);
  const activeLabels = assertRows<{ record_id?: string; review?: { review_stage?: string } }>(path.join(out('active_learning_labels'), 'active-learning-top-100-labels.jsonl'), EXPECTED_COUNTS.active_learning_label_rows);
  const qualityRepair = assertRows<{ record_id?: string; recommended_action?: string }>(path.join(out('quality_repair_v0'), 'quality-repair-v0-review-queue.jsonl'), EXPECTED_COUNTS.quality_repair_rows);
  const visualFamilies = assertRows<{ family_id?: string; member_count?: number }>(path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-families.jsonl'), EXPECTED_COUNTS.visual_family_rows);
  const researchPackets = assertRows<{ record_id?: string; research_depth?: string }>(path.join(out('research_enrichment_v0'), 'research-enrichment-packets-v0.jsonl'), EXPECTED_COUNTS.research_packet_rows);
  const searchJudgments = assertRows<{ task_id?: string; judgment_source?: string }>(path.join(out('search_judgments_v0'), 'search-judgments-v0.jsonl'), EXPECTED_COUNTS.search_judgment_rows);
  const rewardSignals = assertRows<{ signal_id?: string; signal_type?: string }>(path.join(out('reward_data_v0'), 'reward-signals-v0.jsonl'), EXPECTED_COUNTS.reward_signal_rows);

  assertRepresentative(reviewPackets, (row) => (row as { packet_id?: string }).packet_id === 'dfv0-0001', 'review packet dfv0-0001');
  assertRepresentative(batchPackets, (row) => row.record?.id === 'mtl_archives_metadata_120.json' && row.lane === 'ground_text_entity', 'ground market Batch 001 row');
  assertRepresentative(calibrationLabels, (row) => row.record_id === 'mtl_archives_metadata_120.json' && row.labels?.image_mode === 'ground_street', 'calibration market label');
  assertRepresentative(adjudicatedLabels, (row) => row.record_id === 'mtl_archives_metadata_120.json', 'adjudicated market label');
  assertRepresentative(retrievalTasks, (row) => row.task_id === 'ret-0001' && row.query === 'Market stalls on a winter street', 'benchmark ret-0001 query');
  assertRepresentative(searchBaseline, (row) => row.task_id === 'ret-0001' && row.mode === 'semantic' && row.rank === 1, 'semantic baseline rank for ret-0001');
  assertRepresentative(rerankerCandidates, (row) => row.task_id === 'ret-0001' && row.candidate_record_id === 'mtl_archives_metadata_120.json' && row.is_positive === true, 'positive reranker candidate');
  assertRepresentative(rerankerPreferences, (row) => row.preference_id === 'pref-00001' && row.preferred_record_id === 'mtl_archives_metadata_120.json', 'pairwise preference pref-00001');
  assertRepresentative(activeLearning, (row) => row.rank === 1 && row.record?.id === 'mtl_archives_metadata_13000.json', 'rank-one active-learning hard negative');
  assertRepresentative(activeLabels, (row) => row.record_id === 'mtl_archives_metadata_13000.json' && row.review?.review_stage === 'batch', 'active-learning draft label boundary');
  assertRepresentative(qualityRepair, (row) => row.record_id === 'missing-fixture-1' && row.recommended_action === 'fetch_decode_retry', 'missing-image repair action');
  assertRepresentative(visualFamilies, (row) => row.family_id === 'vf-sequence_run-seq-7p14-fixture-6aebb744' && row.member_count === 2, 'sequence visual family');
  assertRepresentative(researchPackets, (row) => row.record_id === 'mtl_archives_metadata_0.json' && row.research_depth === 'deep_candidate', 'Magic Baking Powder research packet');
  assertRepresentative(searchJudgments, (row) => row.task_id === 'ret-0001' && row.judgment_source === 'reviewed_gold', 'reviewed-gold search judgment');
  assertRepresentative(rewardSignals, (row) => row.signal_id === 'reward-search-pref-00001' && row.signal_type === 'pairwise_preference', 'reward pairwise signal');

  const checks = {
    review_packet_rows: reviewPackets.length,
    batch_packet_rows: batchPackets.length,
    calibration_label_rows: calibrationLabels.length,
    adjudicated_label_rows: adjudicatedLabels.length,
    benchmark_retrieval_tasks: retrievalTasks.length,
    search_baseline_rows: searchBaseline.length,
    reranker_candidates: rerankerCandidates.length,
    reranker_preferences: rerankerPreferences.length,
    active_learning_rows: activeLearning.length,
    active_learning_label_rows: activeLabels.length,
    quality_repair_rows: qualityRepair.length,
    visual_family_rows: visualFamilies.length,
    research_packet_rows: researchPackets.length,
    search_judgment_rows: searchJudgments.length,
    reward_signal_rows: rewardSignals.length,
  };
  if (JSON.stringify(checks) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error(`Smoke count contract drifted: ${JSON.stringify(checks)}`);
  }

  for (const filePath of [
    path.join(out('review_packets'), 'packet_manifest.json'),
    path.join(out('benchmark_v0'), 'manifest.json'),
    path.join(out('search_reranker_v0'), 'search_reranker_report.json'),
    path.join(out('active_learning_v0'), 'active-learning-report.json'),
    path.join(out('quality_repair_v0'), 'quality-repair-v0-report.json'),
    path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-report.json'),
    path.join(out('research_enrichment_v0'), 'research-enrichment-v0-report.json'),
    path.join(out('search_judgments_v0'), 'search-judgments-v0-report.json'),
    path.join(out('reward_data_v0'), 'reward-data-v0-report.json'),
  ]) {
    assertJson(filePath);
  }

  const reportPath = path.join(outputRoot, 'dataset-factory-smoke-v0-report.json');
  const outputTreeHashBeforeReport = treeDigest(outputRoot);
  if (outputTreeHashBeforeReport !== EXPECTED_OUTPUT_TREE_SHA256) {
    throw new Error(`Smoke output hash drifted: expected ${EXPECTED_OUTPUT_TREE_SHA256}, got ${outputTreeHashBeforeReport}`);
  }
  const report = {
    schema_version: 'dataset_factory_smoke_v0_report',
    generated_at: FIXED_NOW,
    status: 'ok',
    fixture_dir: rel(FIXTURE_DIR),
    fixture_tree_sha256: treeDigest(FIXTURE_DIR),
    output_dir: rel(outputRoot),
    output_tree_sha256_before_report: outputTreeHashBeforeReport,
    commands,
    checks,
    key_outputs: {
      artifact_registry: fileSummary(path.join(MONOREPO_ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl')),
      smoke_report: rel(reportPath),
      reward_signals: fileSummary(path.join(out('reward_data_v0'), 'reward-signals-v0.jsonl')),
      visual_family_map: fileSummary(path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-record-family-map.jsonl')),
      search_judgments: fileSummary(path.join(out('search_judgments_v0'), 'search-judgments-v0.jsonl')),
    },
    limitations: [
      'Fixture smoke uses a local mock /api/search server; it does not prove live API quality.',
      'Fixtures are small contract rows, not a benchmark or reviewed-gold evidence.',
      'No D1, R2, Vectorize, Cloudflare, social, DNS, deployment, paid compute, credentials, or signed URLs are used.',
      'Full ignored artifacts are verified separately by the artifact registry checker with --verify-files against a populated artifact root.',
    ],
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  console.log(JSON.stringify({
    status: 'ok',
    output_dir: rel(outputRoot),
    report: rel(reportPath),
    output_tree_sha256_before_report: outputTreeHashBeforeReport,
    checks,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
