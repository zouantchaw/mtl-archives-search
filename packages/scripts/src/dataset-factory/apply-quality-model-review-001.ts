import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_INPUT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/ocr_entity_review_001/ocr-entity-review-001-applied-labels.jsonl',
);
const DEFAULT_DECISIONS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/quality-model-review-decisions.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001',
);
const DEFAULT_PASS_ID = 'quality_model_review_001';

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

type EvidenceBucket = 'observed' | 'metadata' | 'inferred' | 'verified';

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
  source: Record<string, unknown>;
  review: {
    labeler_type: string;
    labeler_id: string;
    labeled_at: string;
    review_stage: 'example' | 'batch' | 'gold' | 'adjudicated';
  };
  labels: {
    quality_action?: string[];
    search_expectations?: unknown[];
    [key: string]: unknown;
  };
  evidence: Record<EvidenceBucket, EvidenceItem[]>;
  confidence: {
    overall: number;
    field_confidence: Record<string, number>;
    needs_human_review: boolean;
    review_flags: ReviewFlag[];
  };
  pairwise_preferences: unknown[];
};

type ReviewDecision = {
  record_id: string;
  decision: 'promote_gold' | 'apply_updates_hold' | 'hold_batch';
  reviewer: 'codex_quality_model_review';
  reviewed_at?: string;
  clear_top_flags?: ReviewFlag[];
  set_quality_action?: string[];
  field_confidence?: Record<string, number>;
  overall_confidence?: number;
  add_evidence?: Array<EvidenceItem & { bucket?: EvidenceBucket }>;
  update_evidence_flags?: Array<{
    bucket: EvidenceBucket;
    id: string;
    clear_flags: ReviewFlag[];
  }>;
  notes: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
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

function cloneLabel(label: LabelRow): LabelRow {
  return JSON.parse(JSON.stringify(label)) as LabelRow;
}

function slugify(value: string): string {
  return value.replace(/_/g, '-').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function evidencePrefix(passId: string): string {
  return passId.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function removeFlags(flags: ReviewFlag[] = [], clear: ReviewFlag[] = []): ReviewFlag[] {
  const clearSet = new Set(clear);
  return uniqueSorted(flags.filter((flag) => flag !== 'none' && !clearSet.has(flag)));
}

function nestedReviewFlags(value: unknown, flags: ReviewFlag[] = []): ReviewFlag[] {
  if (Array.isArray(value)) {
    for (const item of value) nestedReviewFlags(item, flags);
    return flags;
  }
  if (!value || typeof value !== 'object') return flags;
  const objectValue = value as Record<string, unknown>;
  if (Array.isArray(objectValue.review_flags)) {
    for (const flag of objectValue.review_flags) flags.push(String(flag) as ReviewFlag);
  }
  for (const [key, nested] of Object.entries(objectValue)) {
    if (key !== 'review_flags') nestedReviewFlags(nested, flags);
  }
  return flags;
}

function activeNestedFlags(label: LabelRow): ReviewFlag[] {
  return nestedReviewFlags(label.labels).filter((flag) => flag !== 'none');
}

function canPromote(label: LabelRow): boolean {
  return !label.confidence.needs_human_review
    && label.confidence.review_flags.length === 0
    && activeNestedFlags(label).length === 0
    && label.confidence.overall >= 0.72
    && label.evidence.observed.length > 0
    && label.evidence.metadata.length > 0
    && Array.isArray(label.labels.search_expectations)
    && label.labels.search_expectations.length > 0;
}

function applyDecision(label: LabelRow, decision: ReviewDecision, appliedAt: string, passId: string, slug: string): LabelRow {
  const next = cloneLabel(label);
  const prefix = evidencePrefix(passId);

  for (const item of decision.add_evidence ?? []) {
    const bucket = item.bucket ?? 'observed';
    const id = item.id.startsWith(prefix) ? item.id : `${prefix}_${item.id}`;
    if (!next.evidence[bucket].some((evidence) => evidence.id === id)) {
      next.evidence[bucket].push({
        id,
        claim: item.claim,
        evidence_type: item.evidence_type,
        source_field: item.source_field ?? passId,
        source_url: item.source_url,
        confidence: item.confidence,
        review_flags: item.review_flags,
      });
    }
  }

  for (const update of decision.update_evidence_flags ?? []) {
    next.evidence[update.bucket] = next.evidence[update.bucket].map((item) => (
      item.id === update.id
        ? { ...item, review_flags: removeFlags(item.review_flags, update.clear_flags) }
        : item
    ));
  }

  if (decision.set_quality_action) {
    next.labels.quality_action = decision.set_quality_action;
  }

  next.confidence.review_flags = removeFlags(next.confidence.review_flags, decision.clear_top_flags ?? []);
  for (const [field, confidence] of Object.entries(decision.field_confidence ?? {})) {
    next.confidence.field_confidence[field] = Math.max(next.confidence.field_confidence[field] ?? 0, confidence);
  }
  if (typeof decision.overall_confidence === 'number') {
    next.confidence.overall = Math.max(next.confidence.overall, decision.overall_confidence);
  }

  const activeTop = next.confidence.review_flags.filter((flag) => flag !== 'none');
  const activeNested = activeNestedFlags(next);
  next.confidence.needs_human_review = activeTop.length > 0 || activeNested.length > 0;
  if (decision.decision === 'promote_gold') {
    next.review.review_stage = canPromote(next) ? 'gold' : 'batch';
  }

  if (decision.decision !== 'hold_batch') {
    next.review.labeler_id = `${next.review.labeler_id}+${slug}`;
    next.review.labeled_at = appliedAt;
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

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Quality Model Review 001

Generated at: ${report.generated_at}

## Counts

\`\`\`json
${JSON.stringify(report.counts, null, 2)}
\`\`\`

## Policy

- Clears quality/model flags only after image-level review confirms the label is usable.
- Does not clear external entity/georeference blockers.
- Promotes a row to gold only if the strict gold policy passes after the review.

## Caveats

- This pass is about label reliability and benchmark eligibility, not derivative image restoration.
- Georeference and external entity resolution remain separate queues.
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      decisions: { type: 'string', default: DEFAULT_DECISIONS },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'pass-id': { type: 'string', default: DEFAULT_PASS_ID },
    },
  });

  const inputPath = resolveRepoPath(values.input!);
  const decisionsPath = resolveRepoPath(values.decisions!);
  const outputDir = resolveRepoPath(values.output!);
  const passId = values['pass-id']!;
  const slug = slugify(passId);
  requireArtifacts([
    { path: inputPath, label: 'input labels from prior review pass' },
    { path: decisionsPath, label: 'quality/model review decisions' },
  ]);
  const labels = readJsonl<LabelRow>(inputPath);
  const decisions = readJsonl<ReviewDecision>(decisionsPath);
  const decisionMap = new Map(decisions.map((decision) => [decision.record_id, decision]));
  const appliedAt = datasetFactoryNowIso();
  const beforeGoldIds = new Set(labels.filter((label) => label.review.review_stage === 'gold').map((label) => label.record_id));
  const changedDecisionIds = new Set(decisions.filter((decision) => decision.decision !== 'hold_batch').map((decision) => decision.record_id));
  const reviewed = labels.map((label) => {
    const decision = decisionMap.get(label.record_id);
    return decision ? applyDecision(label, decision, appliedAt, passId, slug) : label;
  });
  const gold = reviewed.filter((label) => label.review.review_stage === 'gold');
  const held = reviewed.filter((label) => label.review.review_stage !== 'gold');
  const newlyPromoted = gold.filter((label) => decisionMap.has(label.record_id) && !beforeGoldIds.has(label.record_id));
  const notPromoted = decisions.filter((decision) => decision.decision === 'promote_gold' && !newlyPromoted.some((label) => label.record_id === decision.record_id));
  const updatedHeld = reviewed.filter((label) => changedDecisionIds.has(label.record_id) && label.review.review_stage !== 'gold');
  const holdOnly = decisions.filter((decision) => decision.decision === 'hold_batch');

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, `${slug}-applied-labels.jsonl`), reviewed);
  writeJsonl(path.join(outputDir, `gold-labels-batch-001.${slug}.jsonl`), gold);
  writeJsonl(path.join(outputDir, `batch-001-held-after-${slug}.jsonl`), held);
  writeJsonl(path.join(outputDir, `${slug}-not-promoted.jsonl`), notPromoted);
  writeJsonl(path.join(outputDir, `${slug}-updated-held.jsonl`), updatedHeld);

  const report = {
    generated_at: appliedAt,
    pass_id: passId,
    pass_slug: slug,
    inputs: {
      labels: path.relative(MONOREPO_ROOT, inputPath),
      decisions: path.relative(MONOREPO_ROOT, decisionsPath),
    },
    outputs: {
      applied_labels: `${slug}-applied-labels.jsonl`,
      gold_labels: `gold-labels-batch-001.${slug}.jsonl`,
      held_labels: `batch-001-held-after-${slug}.jsonl`,
      updated_held: `${slug}-updated-held.jsonl`,
      not_promoted: `${slug}-not-promoted.jsonl`,
      report_json: `${slug}-report.json`,
      report_md: `${slug}-report.md`,
    },
    counts: {
      input_labels: labels.length,
      review_decisions: decisions.length,
      apply_updates_hold_decisions: decisions.filter((decision) => decision.decision === 'apply_updates_hold').length,
      hold_only_decisions: holdOnly.length,
      requested_gold_promotions: decisions.filter((decision) => decision.decision === 'promote_gold').length,
      newly_promoted_gold: newlyPromoted.length,
      not_promoted_after_decision: notPromoted.length,
      total_gold_after_review: gold.length,
      held_after_review: held.length,
      gold_by_image_mode: countBy(gold, (label) => String(label.labels.image_mode ?? 'unknown')),
      newly_promoted_ids: newlyPromoted.map((label) => label.record_id),
      not_promoted_ids: notPromoted.map((decision) => decision.record_id),
      updated_held_ids: updatedHeld.map((label) => label.record_id),
      hold_only_ids: holdOnly.map((decision) => decision.record_id),
    },
  };
  fs.writeFileSync(path.join(outputDir, `${slug}-report.json`), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, `${slug}-report.md`), renderMarkdown(report), 'utf-8');

  console.log(`Wrote ${slug} to ${path.relative(MONOREPO_ROOT, outputDir)}`);
  console.log(`- decisions: ${decisions.length}`);
  console.log(`- newly_promoted_gold: ${newlyPromoted.length}`);
  console.log(`- total_gold_after_review: ${gold.length}`);
  console.log(`- held_after_review: ${held.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
