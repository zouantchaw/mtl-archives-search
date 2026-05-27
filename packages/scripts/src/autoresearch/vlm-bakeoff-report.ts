import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_vlm_bakeoff');

type RunConfig = {
  label: string;
  output: string;
  attempts?: string;
  model?: string;
  promptVariant?: string;
};

type RunSummary = RunConfig & {
  rows: number;
  captioned: number;
  structuredValid: number;
  structuredInvalid: number;
  errors: number;
  cudaFailedAttempts: number;
  avgCaptionChars: number;
  avgSubjects: number;
  avgSearchTerms: number;
  unknownFields: number;
  score: number;
};

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

function countUnknown(metadata: any): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const fields = [
    metadata.scene_type,
    metadata.setting,
    metadata.season,
    metadata.aerial_ground_document,
    metadata.social_hook,
    metadata.print_quality,
    metadata.quality_notes,
  ];
  return fields.filter((value) => String(value || '').toLowerCase() === 'unknown').length;
}

function parseRun(value: string): RunConfig {
  const [labelPart, rest] = value.includes('=') ? value.split(/=(.*)/s) : ['', value];
  const label = labelPart || path.basename(rest).replace(/\.jsonl$/i, '');
  const output = resolveRepoPath(rest);
  const attempts = output.replace(/\.jsonl$/i, '_attempts.json');
  return {
    label,
    output,
    attempts: fs.existsSync(attempts) ? attempts : undefined,
  };
}

function summarize(run: RunConfig): RunSummary {
  const rows = readJsonl(run.output);
  const attempts = run.attempts && fs.existsSync(run.attempts)
    ? JSON.parse(fs.readFileSync(run.attempts, 'utf-8'))
    : null;
  const captionedRows = rows.filter((row) => row.vlm_caption);
  const validRows = rows.filter((row) => row.vlm_metadata_valid);
  const structuredInvalid = rows.filter((row) => row.vlm_metadata_error).length;
  const errors = rows.filter((row) => row.vlm_error).length;
  const avgCaptionChars = mean(captionedRows.map((row) => String(row.vlm_caption || '').length));
  const avgSubjects = mean(validRows.map((row) => row.vlm_metadata?.visual_subjects?.length || 0));
  const avgSearchTerms = mean(validRows.map((row) => row.vlm_metadata?.search_terms?.length || 0));
  const unknownFields = validRows.reduce((sum, row) => sum + countUnknown(row.vlm_metadata), 0);
  const cudaFailedAttempts = (attempts?.attempts || []).filter((attempt: any) => attempt.cuda_failed).length;
  const promptVariant = attempts?.prompt_variant;
  const score =
    validRows.length * 100 -
    structuredInvalid * 25 -
    errors * 10 -
    cudaFailedAttempts * 50 -
    unknownFields;

  return {
    ...run,
    promptVariant,
    rows: rows.length,
    captioned: captionedRows.length,
    structuredValid: validRows.length,
    structuredInvalid,
    errors,
    cudaFailedAttempts,
    avgCaptionChars,
    avgSubjects,
    avgSearchTerms,
    unknownFields,
    score,
  };
}

function renderMarkdown(summaries: RunSummary[], recommendation: RunSummary): string {
  const lines = [
    '# VLM Model and Prompt Bakeoff',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    '| Run | Prompt | Rows | Captioned | Structured valid | Structured invalid | Errors | CUDA failed | Avg caption chars | Avg subjects | Avg search terms | Unknown fields | Score |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const summary of summaries) {
    lines.push(
      `| ${summary.label} | ${summary.promptVariant || ''} | ${summary.rows} | ${summary.captioned} | ${summary.structuredValid} | ${summary.structuredInvalid} | ${summary.errors} | ${summary.cudaFailedAttempts} | ${summary.avgCaptionChars.toFixed(1)} | ${summary.avgSubjects.toFixed(1)} | ${summary.avgSearchTerms.toFixed(1)} | ${summary.unknownFields} | ${summary.score.toFixed(1)} |`,
    );
  }

  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  lines.push(`Use **${recommendation.label}** for the next benchmark/full-run path.`);
  lines.push('');
  lines.push('Rationale: the selected run had the best score using structured-valid count as the primary signal, then structured-invalid responses, runtime stability, image errors, and metadata richness as penalties/tiebreakers.');
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  for (const summary of summaries) {
    lines.push(`- ${summary.label}: \`${path.relative(MONOREPO_ROOT, summary.output)}\``);
    if (summary.attempts) lines.push(`- ${summary.label} attempts: \`${path.relative(MONOREPO_ROOT, summary.attempts)}\``);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: 'string', multiple: true },
      output: { type: 'string', default: path.join(DEFAULT_DIR, 'report.json') },
      markdown: { type: 'string', default: path.join(DEFAULT_DIR, 'report.md') },
    },
  });

  const runs = (values.run || []).map(parseRun);
  if (!runs.length) throw new Error('Pass at least one --run label=path.jsonl');

  const summaries = runs.map(summarize).sort((a, b) => b.score - a.score);
  const recommendation = summaries[0];
  const outputPath = resolveRepoPath(values.output!);
  const markdownPath = resolveRepoPath(values.markdown!);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    recommendation: recommendation.label,
    summaries,
  }, null, 2));
  fs.writeFileSync(markdownPath, renderMarkdown(summaries, recommendation));

  console.log(`[vlm:bakeoff:report] recommendation=${recommendation.label}`);
  console.log(`[vlm:bakeoff:report] json=${outputPath}`);
  console.log(`[vlm:bakeoff:report] markdown=${markdownPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
