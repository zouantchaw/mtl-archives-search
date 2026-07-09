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
    env: { ...process.env, FORCE_COLOR: '0' },
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
      env: { ...process.env, FORCE_COLOR: '0' },
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

function assertRows(filePath: string, minRows = 1): number {
  assertFile(filePath);
  const rows = readJsonl<unknown>(filePath);
  if (rows.length < minRows) throw new Error(`${filePath} emitted ${rows.length} rows, expected at least ${minRows}`);
  return rows.length;
}

function assertJson(filePath: string): void {
  assertFile(filePath);
  readJson(filePath);
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
      'dfv0_batch_001',
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
    await runScriptAsync('evaluate-benchmark-search.ts', [
      '--tasks', path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl'),
      '--output', out('benchmark_v0'),
      '--api-base', apiBase,
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
      '--modes', 'semantic,smart,visual',
      '--limit', '8',
      '--limit-tasks', '6',
      '--max-size', '0',
      '--epochs', '8',
      '--max-negatives-per-task', '4',
    ], commands);
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
    '--captured-at', '2026-07-09T00:00:00.000Z',
  ], commands);

  const checks = {
    review_packet_rows: assertRows(path.join(out('review_packets'), 'review_packet.jsonl')),
    batch_packet_rows: assertRows(path.join(out('batch_001'), 'batch_001_review_packet.jsonl')),
    calibration_label_rows: assertRows(path.join(out('calibration_50'), 'calibration_labels.jsonl')),
    adjudicated_label_rows: assertRows(path.join(out('adjudication_v0'), 'batch-001-adjudicated-labels.jsonl')),
    benchmark_retrieval_tasks: assertRows(path.join(out('benchmark_v0'), 'retrieval_tasks.jsonl')),
    search_baseline_rows: assertRows(path.join(out('benchmark_v0'), 'search_baseline_current.jsonl')),
    reranker_candidates: assertRows(path.join(out('search_reranker_v0'), 'search_candidates.jsonl')),
    reranker_preferences: assertRows(path.join(out('search_reranker_v0'), 'search_pairwise_preferences.jsonl')),
    active_learning_rows: assertRows(path.join(out('active_learning_v0'), 'active-learning-batch-001.jsonl')),
    active_learning_label_rows: assertRows(path.join(out('active_learning_labels'), 'active-learning-top-100-labels.jsonl')),
    quality_repair_rows: assertRows(path.join(out('quality_repair_v0'), 'quality-repair-v0-review-queue.jsonl')),
    visual_family_rows: assertRows(path.join(out('visual_family_graph_v0'), 'visual-family-graph-v0-families.jsonl')),
    research_packet_rows: assertRows(path.join(out('research_enrichment_v0'), 'research-enrichment-packets-v0.jsonl')),
    search_judgment_rows: assertRows(path.join(out('search_judgments_v0'), 'search-judgments-v0.jsonl')),
    reward_signal_rows: assertRows(path.join(out('reward_data_v0'), 'reward-signals-v0.jsonl')),
  };

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
  const report = {
    schema_version: 'dataset_factory_smoke_v0_report',
    generated_at: new Date().toISOString(),
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
    checks,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
