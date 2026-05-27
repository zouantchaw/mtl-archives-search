import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const BASE_CONFIG = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/search/config.json');
const QUERIES = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/search/queries.json');
const SWEEP_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_sweep');
const SUMMARY_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_sweep.json');

type SearchConfig = {
  endpoint: string;
  topK: number;
  resultLimit: number;
  rrfK: number;
  visualWeight: number;
  semanticWeight: number;
  bothBonus: number;
  metadataKeywordWeight: number;
  descriptionKeywordWeight: number;
  duplicatePenalty: number;
};

type Report = {
  aggregate?: {
    precisionAt1?: number;
    precisionAt5?: number;
    mrr?: number;
    duplicateRate?: number;
    avgLatencyMs?: number;
    weightedScore?: number;
  };
};

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function variantName(config: Partial<SearchConfig>, index: number): string {
  const parts = [
    `v${String(index).padStart(2, '0')}`,
    `k${config.rrfK}`,
    `vw${config.visualWeight}`,
    `sw${config.semanticWeight}`,
    `b${config.bothBonus}`,
  ];
  return parts.join('_').replace(/[^a-zA-Z0-9_.-]/g, '-');
}

function runEvaluate(configPath: string, outputPath: string) {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(MONOREPO_ROOT, 'node_modules/tsx/dist/cli.mjs'),
      path.resolve(MONOREPO_ROOT, 'packages/scripts/src/autoresearch/search-evaluate.ts'),
      '--config',
      configPath,
      '--queries',
      QUERIES,
      '--output',
      outputPath,
    ],
    {
      cwd: MONOREPO_ROOT,
      encoding: 'utf-8',
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `search-evaluate exited ${result.status}`);
  }
}

async function main() {
  const base = readJson<SearchConfig>(BASE_CONFIG);
  fs.mkdirSync(SWEEP_DIR, { recursive: true });

  const variants: Partial<SearchConfig>[] = [
    {},
    { rrfK: 20 },
    { rrfK: 40 },
    { rrfK: 80 },
    { visualWeight: 1.3, semanticWeight: 0.9 },
    { visualWeight: 0.9, semanticWeight: 1.3 },
    { visualWeight: 1.6, semanticWeight: 0.8, bothBonus: 0.02 },
    { visualWeight: 0.8, semanticWeight: 1.6, bothBonus: 0.02 },
    { bothBonus: 0 },
    { bothBonus: 0.03 },
    { duplicatePenalty: 0.5 },
    { metadataKeywordWeight: 1.5, descriptionKeywordWeight: 0.25 },
  ];

  const rows = variants.map((patch, index) => {
    const config = { ...base, ...patch };
    const name = variantName(config, index);
    const configPath = path.join(SWEEP_DIR, `${name}.config.json`);
    const reportPath = path.join(SWEEP_DIR, `${name}.report.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    runEvaluate(configPath, reportPath);
    const report = readJson<Report>(reportPath);
    return {
      name,
      config,
      reportPath,
      aggregate: report.aggregate ?? {},
    };
  }).sort((a, b) => Number(b.aggregate.weightedScore ?? 0) - Number(a.aggregate.weightedScore ?? 0));

  const summary = {
    generatedAt: new Date().toISOString(),
    baseConfigPath: BASE_CONFIG,
    queriesPath: QUERIES,
    variantCount: rows.length,
    best: rows[0] ?? null,
    rows,
  };
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  console.log(`[autoresearch:search:sweep] variants=${rows.length}`);
  if (rows[0]) {
    console.log(`[autoresearch:search:sweep] best=${rows[0].name} weighted=${Number(rows[0].aggregate.weightedScore ?? 0).toFixed(3)} p5=${Number(rows[0].aggregate.precisionAt5 ?? 0).toFixed(3)} mrr=${Number(rows[0].aggregate.mrr ?? 0).toFixed(3)}`);
    console.log(`[autoresearch:search:sweep] bestReport=${rows[0].reportPath}`);
  }
  console.log(`[autoresearch:search:sweep] summary=${SUMMARY_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
