import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_vlm_benchmark');
const DEFAULT_OUTPUT = path.join(DEFAULT_DIR, 'report.json');
const DEFAULT_MARKDOWN = path.join(DEFAULT_DIR, 'report.md');

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

function readJsonl(filePath: string): any[] {
  if (!fs.existsSync(filePath)) throw new Error(`Missing JSONL: ${filePath}`);
  return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(part: number, total: number): number {
  return total ? part / total : 0;
}

function countValue(rows: any[], getter: (row: any) => unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(getter(row) || 'unknown');
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function renderMarkdown(report: any): string {
  const lines = [
    '# 200-Record VLM Benchmark',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Decision',
    '',
    report.ready_for_next_step
      ? 'Structured VLM is ready for the next benchmark/full-run step.'
      : 'Structured VLM needs another iteration before the next benchmark/full-run step.',
    '',
    '## Metrics',
    '',
    `- Rows: ${report.metrics.rows}`,
    `- Captioned: ${report.metrics.captioned} (${(report.metrics.caption_rate * 100).toFixed(1)}%)`,
    `- Structured valid: ${report.metrics.structured_valid} (${(report.metrics.structured_valid_rate * 100).toFixed(1)}%)`,
    `- Structured invalid: ${report.metrics.structured_invalid}`,
    `- Image/model errors: ${report.metrics.errors}`,
    `- CUDA failed attempts: ${report.metrics.cuda_failed_attempts}`,
    `- Duration: ${report.metrics.duration_seconds.toFixed(1)} seconds`,
    `- Throughput: ${report.metrics.rows_per_minute.toFixed(1)} rows/minute`,
    `- Estimated A10 GPU cost: $${report.metrics.estimated_cost_usd.toFixed(2)} at $${report.metrics.hourly_cost_usd.toFixed(2)}/hour`,
    '',
    '## Field Coverage',
    '',
    '| Field | Coverage |',
    '| --- | ---: |',
  ];

  for (const [field, coverage] of Object.entries(report.field_coverage)) {
    lines.push(`| ${field} | ${((coverage as number) * 100).toFixed(1)}% |`);
  }

  lines.push('');
  lines.push('## Distributions');
  lines.push('');
  lines.push(`- Scene types: \`${JSON.stringify(report.distributions.scene_type)}\``);
  lines.push(`- Aerial/ground/document: \`${JSON.stringify(report.distributions.aerial_ground_document)}\``);
  lines.push(`- Seasons: \`${JSON.stringify(report.distributions.season)}\``);
  lines.push(`- Print quality: \`${JSON.stringify(report.distributions.print_quality)}\``);
  lines.push('');
  lines.push('## Qualitative Notes');
  lines.push('');
  for (const note of report.qualitative_notes) {
    lines.push(`- ${note}`);
  }
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Input: \`${report.artifacts.input}\``);
  lines.push(`- Output: \`${report.artifacts.output}\``);
  lines.push(`- Attempts: \`${report.artifacts.attempts}\``);
  if (report.artifacts.sample_summary) lines.push(`- Sample summary: \`${report.artifacts.sample_summary}\``);

  return `${lines.join('\n')}\n`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', required: true },
      output: { type: 'string', required: true },
      attempts: { type: 'string' },
      'sample-summary': { type: 'string' },
      report: { type: 'string', default: DEFAULT_OUTPUT },
      markdown: { type: 'string', default: DEFAULT_MARKDOWN },
      'hourly-cost': { type: 'string', default: '0.75' },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputPath = resolveRepoPath(values.output!);
  const attemptsPath = values.attempts
    ? resolveRepoPath(values.attempts)
    : outputPath.replace(/\.jsonl$/i, '_attempts.json');
  const sampleSummaryPath = values['sample-summary'] ? resolveRepoPath(values['sample-summary']) : null;
  const reportPath = resolveRepoPath(values.report!);
  const markdownPath = resolveRepoPath(values.markdown!);
  const hourlyCost = parseFloat(values['hourly-cost']!);

  const rows = readJsonl(outputPath);
  const validRows = rows.filter((row) => row.vlm_metadata_valid);
  const attempts = fs.existsSync(attemptsPath) ? JSON.parse(fs.readFileSync(attemptsPath, 'utf-8')) : null;
  const durationSeconds = Number(attempts?.duration_seconds || 0);
  const cudaFailedAttempts = (attempts?.attempts || []).filter((attempt: any) => attempt.cuda_failed).length;
  const fields = [
    'caption',
    'scene_type',
    'visual_subjects',
    'setting',
    'season',
    'aerial_ground_document',
    'search_terms',
    'social_hook',
    'print_quality',
    'quality_notes',
  ];
  const fieldCoverage = Object.fromEntries(fields.map((field) => {
    const covered = validRows.filter((row) => {
      const value = row.vlm_metadata?.[field];
      if (Array.isArray(value)) return value.length > 0 && !value.every((entry) => String(entry).toLowerCase() === 'unknown');
      return value && String(value).toLowerCase() !== 'unknown';
    }).length;
    return [field, pct(covered, rows.length)];
  }));

  const metrics = {
    rows: rows.length,
    captioned: rows.filter((row) => row.vlm_caption).length,
    caption_rate: pct(rows.filter((row) => row.vlm_caption).length, rows.length),
    structured_valid: validRows.length,
    structured_valid_rate: pct(validRows.length, rows.length),
    structured_invalid: rows.filter((row) => row.vlm_metadata_error).length,
    errors: rows.filter((row) => row.vlm_error).length,
    cuda_failed_attempts: cudaFailedAttempts,
    duration_seconds: durationSeconds,
    rows_per_minute: durationSeconds > 0 ? rows.length / (durationSeconds / 60) : 0,
    avg_caption_chars: mean(rows.filter((row) => row.vlm_caption).map((row) => String(row.vlm_caption).length)),
    avg_subjects: mean(validRows.map((row) => row.vlm_metadata?.visual_subjects?.length || 0)),
    avg_search_terms: mean(validRows.map((row) => row.vlm_metadata?.search_terms?.length || 0)),
    hourly_cost_usd: hourlyCost,
    estimated_cost_usd: durationSeconds > 0 ? (durationSeconds / 3600) * hourlyCost : 0,
  };

  const qualitativeNotes = [
    metrics.structured_valid_rate >= 0.95
      ? 'Structured JSON validity is high enough for the next scale step.'
      : 'Structured JSON validity is below the 95% threshold and should be improved before scaling.',
    metrics.errors === 0
      ? 'No image/model errors were observed in the benchmark output.'
      : `${metrics.errors} image/model errors were observed; inspect failed rows before scaling.`,
    cudaFailedAttempts === 0
      ? 'No CUDA-failed attempts were observed.'
      : `${cudaFailedAttempts} CUDA-failed attempts were observed; keep resilient chunking enabled.`,
    'Search/social impact still needs downstream evaluation after merging this metadata into text/search inputs.',
  ];

  const report = {
    generated_at: new Date().toISOString(),
    ready_for_next_step: metrics.structured_valid_rate >= 0.95 && metrics.errors === 0 && cudaFailedAttempts === 0,
    metrics,
    field_coverage: fieldCoverage,
    distributions: {
      scene_type: countValue(validRows, (row) => row.vlm_metadata?.scene_type),
      aerial_ground_document: countValue(validRows, (row) => row.vlm_metadata?.aerial_ground_document),
      season: countValue(validRows, (row) => row.vlm_metadata?.season),
      print_quality: countValue(validRows, (row) => row.vlm_metadata?.print_quality),
    },
    qualitative_notes: qualitativeNotes,
    artifacts: {
      input: path.relative(MONOREPO_ROOT, inputPath),
      output: path.relative(MONOREPO_ROOT, outputPath),
      attempts: path.relative(MONOREPO_ROOT, attemptsPath),
      sample_summary: sampleSummaryPath ? path.relative(MONOREPO_ROOT, sampleSummaryPath) : null,
    },
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`[vlm:benchmark:report] ready=${report.ready_for_next_step}`);
  console.log(`[vlm:benchmark:report] json=${reportPath}`);
  console.log(`[vlm:benchmark:report] markdown=${markdownPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
