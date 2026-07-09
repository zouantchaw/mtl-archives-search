import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { requireArtifact } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/gold-labels-batch-001.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0',
);

type ReviewStage = 'example' | 'batch' | 'gold' | 'adjudicated';

type ReviewFlag =
  | 'needs_human_review'
  | 'thin_metadata'
  | 'synthetic_description'
  | 'attribution_detail_missing'
  | 'exact_location_unsafe'
  | 'date_uncertain'
  | 'orientation_uncertain'
  | 'quality_repair_needed'
  | 'rights_review_needed'
  | 'model_disagreement'
  | 'external_verification_needed'
  | 'ocr_uncertain'
  | 'entity_resolution_needed'
  | 'geo_reference_needed'
  | 'aerial_land_use_uncertain'
  | 'low_information_image'
  | 'none';

type EvidenceItem = {
  id: string;
  claim: string;
  evidence_type: string;
  source_field: string | null;
  source_url: string | null;
  confidence: number;
  review_flags: ReviewFlag[];
};

type LabelRow = {
  schema_version: 'dataset_factory_label_v0';
  record_id: string;
  image_filename: string;
  source: {
    source_system: string;
    package_slug: string | null;
    resource_id: string | null;
    source_url: string | null;
    license_id: string;
    license_url: string | null;
    credit_line: string;
    commercial_use_allowed: boolean;
    rights_checked_at: string;
    rights_notes: string;
  };
  review: {
    labeler_type: string;
    labeler_id: string;
    labeled_at: string;
    review_stage: ReviewStage;
  };
  labels: Record<string, unknown>;
  evidence: {
    observed: EvidenceItem[];
    metadata: EvidenceItem[];
    inferred: EvidenceItem[];
    verified: EvidenceItem[];
  };
  confidence: {
    overall: number;
    field_confidence: Record<string, number>;
    needs_human_review: boolean;
    review_flags: ReviewFlag[];
  };
  pairwise_preferences: unknown[];
};

type Decision = {
  record_id: string;
  decision: 'promote_gold' | 'hold_batch' | 'reject_from_gold';
  target_review_stage: ReviewStage;
  priority: 'none' | 'low' | 'medium' | 'high';
  reasons: string[];
  blockers: string[];
  review_queues: string[];
  evidence_counts: {
    observed: number;
    metadata: number;
    inferred: number;
    verified: number;
  };
  confidence: {
    overall: number;
    needs_human_review: boolean;
    top_level_flags: ReviewFlag[];
    nested_flags: ReviewFlag[];
  };
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

function cloneLabel(label: LabelRow): LabelRow {
  return JSON.parse(JSON.stringify(label)) as LabelRow;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function collectNestedReviewFlags(value: unknown, flags: ReviewFlag[] = []): ReviewFlag[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedReviewFlags(item, flags);
    return flags;
  }
  if (!value || typeof value !== 'object') return flags;
  const objectValue = value as Record<string, unknown>;
  if (Array.isArray(objectValue.review_flags)) {
    for (const flag of objectValue.review_flags) flags.push(String(flag) as ReviewFlag);
  }
  for (const [key, nested] of Object.entries(objectValue)) {
    if (key === 'review_flags') continue;
    collectNestedReviewFlags(nested, flags);
  }
  return flags;
}

function activeFlags(flags: ReviewFlag[]): ReviewFlag[] {
  return uniqueSorted(flags.filter((flag) => flag !== 'none'));
}

function labelReviewQueues(label: LabelRow, flags: ReviewFlag[]): string[] {
  const queues = new Set<string>();
  if (flags.includes('geo_reference_needed') || flags.includes('aerial_land_use_uncertain')) queues.add('geo_aerial_review');
  if (flags.includes('quality_repair_needed') || flags.includes('orientation_uncertain')) queues.add('quality_repair_review');
  if (flags.includes('ocr_uncertain') || flags.includes('entity_resolution_needed')) queues.add('ocr_entity_review');
  if (flags.includes('synthetic_description') || flags.includes('model_disagreement')) queues.add('metadata_model_review');
  if (flags.includes('rights_review_needed') || !label.source.commercial_use_allowed) queues.add('rights_review');
  if (!label.evidence.observed.length) queues.add('direct_visual_review');
  return Array.from(queues).sort();
}

function decisionForLabel(label: LabelRow): Decision {
  const topLevelFlags = activeFlags(label.confidence.review_flags);
  const nestedFlags = activeFlags(collectNestedReviewFlags(label.labels));
  const allFlags = activeFlags([...topLevelFlags, ...nestedFlags]);
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (label.confidence.needs_human_review) blockers.push('top-level confidence says needs_human_review');
  if (topLevelFlags.length) blockers.push(`top-level review flags: ${topLevelFlags.join(', ')}`);
  if (nestedFlags.length) blockers.push(`nested label review flags: ${nestedFlags.join(', ')}`);
  if (label.confidence.overall < 0.72) blockers.push(`overall confidence below gold threshold: ${label.confidence.overall.toFixed(2)}`);
  if (!label.evidence.observed.length) blockers.push('no observed visual evidence recorded');
  if (!label.evidence.metadata.length) blockers.push('no source metadata evidence recorded');
  if (!Array.isArray(label.labels.search_expectations) || !label.labels.search_expectations.length) blockers.push('no search expectations');
  if (!label.source.commercial_use_allowed) blockers.push('source rights not mapped to commercial-use-allowed package');

  const promotable = blockers.length === 0;
  if (promotable) {
    reasons.push('no review flags or nested label flags');
    reasons.push('observed and metadata evidence both present');
    reasons.push('overall confidence meets gold threshold');
    reasons.push('source rights are mapped');
  } else {
    reasons.push('held for adjudication before gold promotion');
  }

  const reviewQueues = labelReviewQueues(label, allFlags);
  const priority: Decision['priority'] = promotable
    ? 'none'
    : reviewQueues.includes('direct_visual_review') || reviewQueues.includes('geo_aerial_review') || reviewQueues.includes('quality_repair_review')
      ? 'high'
      : reviewQueues.length
        ? 'medium'
        : 'low';

  return {
    record_id: label.record_id,
    decision: promotable ? 'promote_gold' : 'hold_batch',
    target_review_stage: promotable ? 'gold' : 'batch',
    priority,
    reasons,
    blockers,
    review_queues: reviewQueues,
    evidence_counts: {
      observed: label.evidence.observed.length,
      metadata: label.evidence.metadata.length,
      inferred: label.evidence.inferred.length,
      verified: label.evidence.verified.length,
    },
    confidence: {
      overall: label.confidence.overall,
      needs_human_review: label.confidence.needs_human_review,
      top_level_flags: topLevelFlags,
      nested_flags: nestedFlags,
    },
  };
}

function applyDecision(label: LabelRow, decision: Decision): LabelRow {
  const next = cloneLabel(label);
  next.review.review_stage = decision.target_review_stage;
  if (decision.decision === 'promote_gold') {
    next.confidence.needs_human_review = false;
    next.confidence.review_flags = [];
  }
  return next;
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderMarkdown(report: Record<string, unknown>, decisions: Decision[]): string {
  const topBlockers = decisions
    .filter((decision) => decision.blockers.length)
    .flatMap((decision) => decision.blockers.map((blocker) => ({ blocker, record_id: decision.record_id })))
    .slice(0, 40);
  const lines = [
    '# Batch 001 Gold Adjudication v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Counts',
    '',
    '```json',
    JSON.stringify(report.counts, null, 2),
    '```',
    '',
    '## Review Queues',
    '',
    '```json',
    JSON.stringify(report.review_queues, null, 2),
    '```',
    '',
    '## First Blockers',
    '',
    '| Record | Blocker |',
    '|---|---|',
  ];
  for (const row of topBlockers) {
    lines.push(`| ${row.record_id} | ${row.blocker.replace(/\|/g, '\\|')} |`);
  }
  lines.push(
    '',
    '## Policy',
    '',
    '- Promote only labels with no top-level or nested review flags.',
    '- Require observed visual evidence and metadata evidence.',
    '- Require overall confidence >= 0.72.',
    '- Hold every active-learning draft row that lacks direct observed evidence.',
    '- Do not treat held rows as final gold for model training.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReviewQueue(labels: LabelRow[], decisions: Decision[]): string {
  const decisionById = new Map(decisions.map((decision) => [decision.record_id, decision]));
  const cards = labels
    .filter((label) => decisionById.get(label.record_id)?.decision !== 'promote_gold')
    .slice(0, 100)
    .map((label) => {
      const decision = decisionById.get(label.record_id);
      return `
        <article class="card">
          <div class="body">
            <div class="meta">${escapeHtml(label.record_id)} · ${escapeHtml(String(label.labels.image_mode ?? 'unknown'))}</div>
            <h2>${escapeHtml(String((label.evidence.metadata[0]?.claim ?? label.record_id)).slice(0, 120))}</h2>
            <p><strong>Queues:</strong> ${escapeHtml(decision?.review_queues.join(', ') ?? '')}</p>
            <p><strong>Blockers:</strong> ${escapeHtml(decision?.blockers.slice(0, 3).join('; ') ?? '')}</p>
          </div>
        </article>`;
    }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Batch 001 Adjudication Review Queue</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f2ec; color: #1f2421; }
    header { padding: 18px 24px; background: #fffdf8; border-bottom: 1px solid #ded8ce; position: sticky; top: 0; }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding: 18px; }
    .card { background: #fffdf8; border: 1px solid #ded8ce; border-radius: 8px; }
    .body { padding: 12px; }
    .meta { font-size: 12px; color: #687068; }
    h2 { margin: 6px 0 8px; font-size: 15px; line-height: 1.25; }
    p { font-size: 13px; line-height: 1.35; margin: 6px 0; }
  </style>
</head>
<body>
  <header><h1>Batch 001 Adjudication Review Queue</h1></header>
  <main class="grid">${cards}</main>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const outputDir = resolveRepoPath(values.output!);
  requireArtifact(inputPath, 'candidate label rows for adjudication');
  const labels = readJsonl<LabelRow>(inputPath);
  const decisions = labels.map(decisionForLabel);
  const adjudicatedLabels = labels.map((label, index) => applyDecision(label, decisions[index]));
  const goldLabels = adjudicatedLabels.filter((label) => label.review.review_stage === 'gold');
  const heldLabels = adjudicatedLabels.filter((label) => label.review.review_stage !== 'gold');
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'adjudication-decisions.jsonl'), decisions);
  writeJsonl(path.join(outputDir, 'batch-001-adjudicated-labels.jsonl'), adjudicatedLabels);
  writeJsonl(path.join(outputDir, 'gold-labels-batch-001.adjudicated.jsonl'), goldLabels);
  writeJsonl(path.join(outputDir, 'batch-001-held-for-review.jsonl'), heldLabels);

  const report = {
    generated_at: generatedAt,
    status: 'conservative_adjudication_v0',
    inputs: {
      candidate_labels: path.relative(MONOREPO_ROOT, inputPath),
    },
    outputs: {
      decisions: 'adjudication-decisions.jsonl',
      all_adjudicated_labels: 'batch-001-adjudicated-labels.jsonl',
      gold_only_labels: 'gold-labels-batch-001.adjudicated.jsonl',
      held_labels: 'batch-001-held-for-review.jsonl',
      report_json: 'adjudication-report.json',
      report_md: 'adjudication-report.md',
      review_queue_html: 'adjudication-review-queue.html',
    },
    counts: {
      input_labels: labels.length,
      promoted_gold: goldLabels.length,
      held_batch: heldLabels.length,
      rejected: decisions.filter((decision) => decision.decision === 'reject_from_gold').length,
      by_decision: countBy(decisions, (decision) => decision.decision),
      by_review_stage: countBy(adjudicatedLabels, (label) => label.review.review_stage),
      gold_by_image_mode: countBy(goldLabels, (label) => String(label.labels.image_mode ?? 'unknown')),
      held_by_image_mode: countBy(heldLabels, (label) => String(label.labels.image_mode ?? 'unknown')),
      held_by_first_blocker: countBy(decisions.filter((decision) => decision.decision !== 'promote_gold'), (decision) => decision.blockers[0] ?? 'unknown'),
    },
    review_queues: countBy(decisions.flatMap((decision) => decision.review_queues), (queue) => queue),
    caveats: [
      'This is a conservative automated adjudication pass.',
      'Rows without direct observed evidence stay in batch review.',
      'Gold rows are safe as a seed set; held rows are still useful for review queues and candidate benchmarks.',
    ],
  };

  fs.writeFileSync(path.join(outputDir, 'adjudication-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'adjudication-report.md'), renderMarkdown(report, decisions), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'adjudication-review-queue.html'), renderReviewQueue(labels, decisions), 'utf-8');

  console.log(`Wrote Batch 001 adjudication v0 to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- input_labels: ${labels.length}`);
  console.log(`- promoted_gold: ${goldLabels.length}`);
  console.log(`- held_batch: ${heldLabels.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
