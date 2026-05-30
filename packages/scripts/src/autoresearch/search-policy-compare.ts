import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_BASELINE = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_issue27_baseline.json');
const DEFAULT_CURRENT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_issue27_current.json');
const DEFAULT_REVISED = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_issue27_revised.json');
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_search_issue27');

type Aggregate = {
  precisionAt1: number;
  precisionAt3: number;
  precisionAt5: number;
  mrr: number;
  duplicateRate: number;
  weightedScore: number;
};

type QueryResult = {
  query: {
    id: string;
    query: string;
    category?: string;
  };
  metrics: {
    precisionAt1: number;
    precisionAt3: number;
    precisionAt5: number;
    mrr: number;
    duplicateRate: number;
  };
  topResults: Array<{
    id?: string;
    relevance?: number;
    fusedScore?: number;
    policyReasons?: string[];
  }>;
};

type SearchReport = {
  generatedAt: string;
  policy: string;
  aggregate: Aggregate;
  policyStats: {
    excluded: number;
    demoted: number;
    reasons: Record<string, number>;
  };
  results: QueryResult[];
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function metricDelta(left: Aggregate, right: Aggregate): Aggregate {
  return {
    precisionAt1: round(right.precisionAt1 - left.precisionAt1),
    precisionAt3: round(right.precisionAt3 - left.precisionAt3),
    precisionAt5: round(right.precisionAt5 - left.precisionAt5),
    mrr: round(right.mrr - left.mrr),
    duplicateRate: round(right.duplicateRate - left.duplicateRate),
    weightedScore: round(right.weightedScore - left.weightedScore),
  };
}

function queryScore(result: QueryResult): number {
  return result.metrics.precisionAt5 * 0.4 + result.metrics.mrr * 0.35 + result.metrics.precisionAt1 * 0.2 - result.metrics.duplicateRate * 0.05;
}

function compareQueries(baseline: SearchReport, candidate: SearchReport): Array<Record<string, unknown>> {
  const byId = new Map(candidate.results.map((result) => [result.query.id, result]));
  return baseline.results.map((base) => {
    const next = byId.get(base.query.id);
    const baseScore = queryScore(base);
    const nextScore = next ? queryScore(next) : 0;
    return {
      id: base.query.id,
      query: base.query.query,
      category: base.query.category ?? '',
      baselineScore: round(baseScore),
      candidateScore: round(nextScore),
      delta: round(nextScore - baseScore),
      baselineFirstRelevantRank: firstRelevantRank(base),
      candidateFirstRelevantRank: next ? firstRelevantRank(next) : null,
      candidateTopPolicyReasons: next ? topPolicyReasons(next) : [],
    };
  });
}

function firstRelevantRank(result: QueryResult): number | null {
  const index = result.topResults.findIndex((item) => Number(item.relevance ?? 0) > 0);
  return index === -1 ? null : index + 1;
}

function topPolicyReasons(result: QueryResult): string[] {
  return [...new Set(result.topResults.flatMap((item) => item.policyReasons ?? []))].slice(0, 8);
}

function regressionSummary(comparisons: Array<Record<string, unknown>>): string[] {
  return comparisons
    .filter((row) => Number(row.delta) < 0)
    .sort((a, b) => Number(a.delta) - Number(b.delta))
    .map((row) => String(row.id));
}

function improvementSummary(comparisons: Array<Record<string, unknown>>): string[] {
  return comparisons
    .filter((row) => Number(row.delta) > 0)
    .sort((a, b) => Number(b.delta) - Number(a.delta))
    .map((row) => String(row.id));
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Autoresearch Search Policy Issue 27',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Decision',
    '',
    report.decision,
    '',
    '## Aggregate Metrics',
    '',
    '| Policy | P@1 | P@3 | P@5 | MRR | Duplicate | Weighted |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of report.policies) {
    lines.push(
      `| ${row.name} | ${row.aggregate.precisionAt1.toFixed(4)} | ${row.aggregate.precisionAt3.toFixed(4)} | ${row.aggregate.precisionAt5.toFixed(4)} | ${row.aggregate.mrr.toFixed(4)} | ${row.aggregate.duplicateRate.toFixed(4)} | ${row.aggregate.weightedScore.toFixed(4)} |`,
    );
  }
  lines.push(
    '',
    '## Deltas',
    '',
    `- Current vs baseline: \`${JSON.stringify(report.deltas.currentVsBaseline)}\``,
    `- Revised vs baseline: \`${JSON.stringify(report.deltas.revisedVsBaseline)}\``,
    `- Revised vs current: \`${JSON.stringify(report.deltas.revisedVsCurrent)}\``,
    '',
    '## Query Movement',
    '',
    `- Current regressions vs baseline: ${report.current.regressedQueries.map((id: string) => `\`${id}\``).join(', ') || 'none'}`,
    `- Current improvements vs baseline: ${report.current.improvedQueries.map((id: string) => `\`${id}\``).join(', ') || 'none'}`,
    `- Revised regressions vs baseline: ${report.revised.regressedQueries.map((id: string) => `\`${id}\``).join(', ') || 'none'}`,
    `- Revised improvements vs current: ${report.revised.improvedAgainstCurrent.map((id: string) => `\`${id}\``).join(', ') || 'none'}`,
    '',
    '## Regression Notes',
    '',
  );
  for (const note of report.regressionNotes) lines.push(`- ${note}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      baseline: { type: 'string', default: DEFAULT_BASELINE },
      current: { type: 'string', default: DEFAULT_CURRENT },
      revised: { type: 'string', default: DEFAULT_REVISED },
      'output-dir': { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const baselinePath = resolveRepoPath(values.baseline!);
  const currentPath = resolveRepoPath(values.current!);
  const revisedPath = resolveRepoPath(values.revised!);
  const outputDir = resolveRepoPath(values['output-dir']!);
  fs.mkdirSync(outputDir, { recursive: true });

  const baseline = readJson<SearchReport>(baselinePath);
  const current = readJson<SearchReport>(currentPath);
  const revised = readJson<SearchReport>(revisedPath);
  const currentComparisons = compareQueries(baseline, current);
  const revisedComparisons = compareQueries(baseline, revised);
  const revisedVsCurrent = compareQueries(current, revised);

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      baseline: path.relative(MONOREPO_ROOT, baselinePath),
      current: path.relative(MONOREPO_ROOT, currentPath),
      revised: path.relative(MONOREPO_ROOT, revisedPath),
    },
    decision: 'Keep taxonomy and quality policy signals as explainability fields only. The current broad demotion/boost policy regressed the existing eval; the revised score-neutral policy restores baseline ranking while preserving policy reasons for review and future experiments.',
    policies: [
      { name: 'baseline', policy: baseline.policy, aggregate: baseline.aggregate, policyStats: baseline.policyStats },
      { name: 'current', policy: current.policy, aggregate: current.aggregate, policyStats: current.policyStats },
      { name: 'revised', policy: revised.policy, aggregate: revised.aggregate, policyStats: revised.policyStats },
    ],
    deltas: {
      currentVsBaseline: metricDelta(baseline.aggregate, current.aggregate),
      revisedVsBaseline: metricDelta(baseline.aggregate, revised.aggregate),
      revisedVsCurrent: metricDelta(current.aggregate, revised.aggregate),
    },
    current: {
      regressedQueries: regressionSummary(currentComparisons),
      improvedQueries: improvementSummary(currentComparisons),
      comparisons: currentComparisons,
    },
    revised: {
      regressedQueries: regressionSummary(revisedComparisons),
      improvedQueries: improvementSummary(revisedComparisons),
      improvedAgainstCurrent: improvementSummary(revisedVsCurrent),
      comparisons: revisedComparisons,
    },
    regressionNotes: [
      '`waterfront-1` regressed under the current policy because broad taxonomy waterfront boosts moved keyword-irrelevant waterfront records above the first keyword-relevant result.',
      '`park-2` regressed under the current policy because park taxonomy boosts promoted visually plausible but keyword-irrelevant records ahead of the first park/people match.',
      '`historical-1` remains underspecified by the taxonomy policy; the query has no matching taxonomy intent and should be covered by stronger place/district labels before ranking boosts are re-enabled.',
    ],
  };

  fs.writeFileSync(path.join(outputDir, 'completion_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, 'completion_report.md'), renderMarkdown(report));
  console.log(`[autoresearch:search-policy-compare] output=${outputDir}`);
  console.log(`[autoresearch:search-policy-compare] decision=${report.decision}`);
  console.log(`[autoresearch:search-policy-compare] revisedWeighted=${revised.aggregate.weightedScore.toFixed(4)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
