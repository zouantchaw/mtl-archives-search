import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const QUALITY_ROOT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0');
const DEFAULT_FAILURE_DIR = path.join(QUALITY_ROOT, 'kami_failure_reconciliation_v0');
const DEFAULT_ROTATION_DIR = path.join(QUALITY_ROOT, 'kami_rotation_sql_review_v0');
const DEFAULT_GUARDRAIL_DIR = path.join(QUALITY_ROOT, 'kami_full_search_guardrail_v0/current_live_guardrail');
const DEFAULT_REPAIR_DIR = path.join(QUALITY_ROOT, 'kami_full_repair_plan_14822');
const DEFAULT_OUTPUT_DIR = path.join(QUALITY_ROOT, 'production_apply_gate_v0');

const EXPECTED_BACKFILL_CANDIDATES = 36;
const EXPECTED_PDF_OBJECT_REMEDIATIONS = 2;
const EXPECTED_ROTATION_UPDATES = 11432;

type JsonObject = Record<string, unknown>;

type ProbeResult = {
  url?: string;
  httpStatus?: number | null;
  contentType?: string | null;
  bytes?: number;
  decoded?: boolean;
  format?: string | null;
  magicKind?: string | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
};

type ReconciliationRow = {
  record_id: string;
  title?: string;
  image_path?: string;
  manifest_external_url?: string | null;
  original_failure_error?: string | null;
  expected_size_bytes?: number | null;
  r2_probe?: ProbeResult | null;
  fallback_probe?: ProbeResult | null;
  fallback_candidates?: string[];
  derivative_path?: string | null;
  derivative_bytes?: number | null;
  derivative_width?: number | null;
  derivative_height?: number | null;
  classification?: string;
  recommended_action?: string;
  notes?: string[];
};

type RotationUpdate = {
  sequence: number;
  record_id: string;
  rotation_degrees: number;
};

type GuardrailImpact = {
  task_id?: string;
  policy?: string;
  split?: string;
  slice?: string;
  judgment_source?: string;
  query?: string;
  expected_record_id?: string;
  baseline_rank?: number | null;
  policy_rank?: number | null;
  baseline_pass?: boolean;
  policy_pass?: boolean;
  pass_delta?: number;
  rank_delta?: number | null;
  expected_repair_status?: JsonObject;
};

type TransactionEnvelope = {
  wrapped: boolean;
  beginCount: number;
  commitCount: number;
  updateOutsideTransactionCount: number;
  statementsBeforeBeginCount: number;
  statementsAfterCommitCount: number;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
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

function naturalRecordCompare(a: { record_id: string }, b: { record_id: string }): number {
  return a.record_id.localeCompare(b.record_id, 'en', { numeric: true });
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function parseRotationUpdates(sql: string): RotationUpdate[] {
  return [...sql.matchAll(/UPDATE\s+manifest\s+SET\s+rotation_degrees=(\d+)\s+WHERE\s+metadata_filename='([^']+)';/g)]
    .map((match, index) => ({
      sequence: index + 1,
      rotation_degrees: Number(match[1]),
      record_id: match[2],
    }));
}

function assertUnique(ids: string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size) throw new Error(`${label} contains duplicate IDs: ${Array.from(duplicates).sort().join(', ')}`);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function analyzeTransactionEnvelope(sql: string): TransactionEnvelope {
  let inTransaction = false;
  let afterCommit = false;
  let beginCount = 0;
  let commitCount = 0;
  let updateOutsideTransactionCount = 0;
  let statementsBeforeBeginCount = 0;
  let statementsAfterCommitCount = 0;

  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    if (/^BEGIN\s+TRANSACTION;$/i.test(line)) {
      beginCount += 1;
      if (afterCommit) statementsAfterCommitCount += 1;
      inTransaction = true;
      continue;
    }

    if (/^COMMIT;$/i.test(line)) {
      commitCount += 1;
      inTransaction = false;
      afterCommit = true;
      continue;
    }

    if (!beginCount) statementsBeforeBeginCount += 1;
    if (afterCommit) statementsAfterCommitCount += 1;
    if (/^UPDATE\s+manifest\s+SET\s+rotation_degrees=/i.test(line) && !inTransaction) {
      updateOutsideTransactionCount += 1;
    }
  }

  return {
    wrapped: beginCount === 1
      && commitCount === 1
      && !inTransaction
      && updateOutsideTransactionCount === 0
      && statementsBeforeBeginCount === 0
      && statementsAfterCommitCount === 0,
    beginCount,
    commitCount,
    updateOutsideTransactionCount,
    statementsBeforeBeginCount,
    statementsAfterCommitCount,
  };
}

function rotationReportPasses(report: JsonObject, expectedUpdateCount: number): boolean {
  const summary = report.summary as JsonObject | undefined;
  const anomalies = report.anomalies as JsonObject | undefined;
  if (!summary || !anomalies) return false;

  return asNumber(summary.sql_update_rows) === expectedUpdateCount
    && asNumber(summary.duplicate_sql_ids) === 0
    && asNumber(summary.invalid_sql_rotation_values) === 0
    && asNumber(summary.sql_ids_missing_from_manifest) === 0
    && asNumber(summary.sql_ids_without_orientation_label) === 0
    && asNumber(summary.sql_value_mismatches) === 0
    && asBoolean(summary.migration_has_rotation_column) === true
    && asBoolean(summary.worker_selects_rotation_column) === true
    && arrayLength(anomalies.duplicate_sql_ids) === 0
    && arrayLength(anomalies.invalid_sql_rotation_values) === 0
    && arrayLength(anomalies.sql_ids_missing_from_manifest) === 0
    && arrayLength(anomalies.sql_ids_without_orientation_label) === 0
    && arrayLength(anomalies.sql_value_mismatches) === 0;
}

function guardrailPasses(summaries: JsonObject[], magicImpact: GuardrailImpact): boolean {
  const rotationPolicy = summaries.find((summary) => summary.policy === 'smart_rotation_metadata_only');
  return Boolean(rotationPolicy)
    && asNumber(rotationPolicy?.lost_reviewed_gold_passes) === 0
    && asNumber(rotationPolicy?.lost_expected_bucket_passes) === 0
    && magicImpact.baseline_pass === true
    && magicImpact.policy_pass === true
    && magicImpact.baseline_rank === magicImpact.policy_rank;
}

function generatedAtFromInputs(reports: JsonObject[]): string {
  const dates = reports
    .map((report) => typeof report.generated_at === 'string' ? report.generated_at : null)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates[dates.length - 1] ?? 'unknown';
}

function markdownEscape(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function tableRows(rows: ReconciliationRow[]): string[] {
  return rows.map((row) => [
    markdownEscape(row.record_id),
    markdownEscape(row.image_path),
    markdownEscape(row.recommended_action),
    markdownEscape(row.fallback_probe?.format ?? row.fallback_probe?.magicKind ?? ''),
    markdownEscape(row.derivative_path ?? ''),
  ].join(' | ')).map((line) => `| ${line} |`);
}

function renderMarkdown(plan: JsonObject): string {
  const summary = plan.summary as JsonObject;
  const writeCategories = plan.proposed_production_write_categories as JsonObject[];
  const backfillRows = plan.r2_image_backfill_candidates as ReconciliationRow[];
  const pdfRows = plan.pdf_backed_r2_image_objects as ReconciliationRow[];
  const guardrail = plan.post_apply_guardrails as JsonObject;
  const magic = guardrail.magic_baking_powder as JsonObject;
  const sql = plan.rotation_degrees_transaction_input as JsonObject;
  const sqlCounts = sql.rotation_counts as Record<string, number>;

  const lines = [
    '# Production Apply Gate v0',
    '',
    `Generated from local evidence: ${plan.generated_at}`,
    '',
    '## Boundary',
    '',
    '- This is a no-secrets, non-mutating preparation artifact for GitHub issue #60.',
    '- It does not execute R2, D1, Vectorize, Worker, route, secret, deployment, or queue writes.',
    '- Production writes remain approval-bound for the local control thread.',
    '',
    '## Summary',
    '',
    `- R2/object-key image backfill candidates: ${summary.r2_image_backfill_candidates}`,
    `- PDF-backed R2 image objects requiring remediation: ${summary.pdf_backed_r2_image_objects}`,
    `- D1 rotation_degrees SQL updates: ${summary.rotation_sql_updates}`,
    `- Rotation SQL is transaction-wrapped: ${summary.rotation_sql_transaction_wrapped}`,
    `- Broad quality filtering/demotion approved: ${summary.broad_quality_filtering_or_demotion_approved}`,
    `- Vectorize rebuild proposed: ${summary.vectorize_rebuild_proposed}`,
    '',
    '## Proposed Production Write Categories',
    '',
    '| Category | Count | Approval state | Execution state |',
    '|---|---:|---|---|',
  ];

  for (const category of writeCategories) {
    lines.push(`| ${markdownEscape(category.category)} | ${category.count} | ${markdownEscape(category.approval_state)} | ${markdownEscape(category.execution_state)} |`);
  }

  lines.push(
    '',
    '## 36 R2/Object-Key Image Backfill Candidates',
    '',
    '| Record | Target object key | Action | Source format | Local derivative evidence |',
    '|---|---|---|---|---|',
    ...tableRows(backfillRows),
    '',
    '## 2 PDF-Backed R2 Image Objects',
    '',
    '| Record | Current object key | Action | Source format | Local derivative evidence |',
    '|---|---|---|---|---|',
    ...tableRows(pdfRows),
    '',
    '## Rotation SQL Transaction Input',
    '',
    `- SQL input: \`${sql.sql_input}\``,
    `- Update count: ${sql.update_count}`,
    `- Transaction-wrapped: ${sql.transaction_wrapped}`,
    `- Rotation counts: 90=${sqlCounts['90'] ?? 0}, 180=${sqlCounts['180'] ?? 0}, 270=${sqlCounts['270'] ?? 0}`,
    '- Full ordered update enumeration is in `production-apply-gate-v0-report.json` under `rotation_degrees_transaction_input.updates`.',
    '',
    '## Preflight Checks',
    '',
    '| Check | Status | Evidence |',
    '|---|---|---|',
  );

  for (const check of plan.preflight_checks as JsonObject[]) {
    lines.push(`| ${markdownEscape(check.check)} | ${markdownEscape(check.status)} | ${markdownEscape(check.evidence)} |`);
  }

  lines.push(
    '',
    '## Rollback Evidence Requirements',
    '',
  );
  for (const requirement of plan.rollback_evidence_requirements as string[]) {
    lines.push(`- ${requirement}`);
  }

  lines.push(
    '',
    '## Post-Apply Guardrails',
    '',
    `- Re-run current live search guardrail: ${guardrail.rerun_current_live_search_guardrail}`,
    `- Magic baking powder expected record: ${magic.expected_record_id}`,
    `- Current baseline rank: ${magic.current_baseline_rank}`,
    `- Required post-apply result: ${magic.required_post_apply_result}`,
    '- Do not apply broad quality filtering/demotion unless a new guardrail run preserves reviewed-gold passes.',
    '',
    '## Decision',
    '',
    String(plan.decision),
    '',
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'failure-dir': { type: 'string', default: DEFAULT_FAILURE_DIR },
      'rotation-dir': { type: 'string', default: DEFAULT_ROTATION_DIR },
      'guardrail-dir': { type: 'string', default: DEFAULT_GUARDRAIL_DIR },
      'repair-dir': { type: 'string', default: DEFAULT_REPAIR_DIR },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const failureDir = resolveRepoPath(values['failure-dir']!);
  const rotationDir = resolveRepoPath(values['rotation-dir']!);
  const guardrailDir = resolveRepoPath(values['guardrail-dir']!);
  const repairDir = resolveRepoPath(values['repair-dir']!);
  const outputDir = resolveRepoPath(values.output!);

  const backfillPath = path.join(failureDir, 'quality-failure-reconciliation-v0-backfill-candidates.jsonl');
  const pdfPath = path.join(failureDir, 'quality-failure-reconciliation-v0-r2-pdf-object-remediation.jsonl');
  const failureReportPath = path.join(failureDir, 'quality-failure-reconciliation-v0-report.json');
  const rotationReportPath = path.join(rotationDir, 'quality-rotation-sql-review-v0-report.json');
  const guardrailReportPath = path.join(guardrailDir, 'quality-search-guardrail-v0-report.json');
  const guardrailImpactsPath = path.join(guardrailDir, 'quality-search-guardrail-v0-task-impacts.jsonl');
  const repairReportPath = path.join(repairDir, 'quality-repair-v0-report.json');
  const sqlPath = path.join(repairDir, 'quality-repair-v0-backfill.sql');

  const backfillCandidates = readJsonl<ReconciliationRow>(backfillPath).sort(naturalRecordCompare);
  const pdfObjects = readJsonl<ReconciliationRow>(pdfPath).sort(naturalRecordCompare);
  const failureReport = readJson<JsonObject>(failureReportPath);
  const rotationReport = readJson<JsonObject>(rotationReportPath);
  const guardrailReport = readJson<JsonObject>(guardrailReportPath);
  const repairReport = readJson<JsonObject>(repairReportPath);
  const sqlText = fs.readFileSync(sqlPath, 'utf-8');
  const rotationUpdates = parseRotationUpdates(sqlText);
  const guardrailImpacts = readJsonl<GuardrailImpact>(guardrailImpactsPath);

  if (backfillCandidates.length !== EXPECTED_BACKFILL_CANDIDATES) {
    throw new Error(`Expected ${EXPECTED_BACKFILL_CANDIDATES} backfill candidates, found ${backfillCandidates.length}`);
  }
  if (pdfObjects.length !== EXPECTED_PDF_OBJECT_REMEDIATIONS) {
    throw new Error(`Expected ${EXPECTED_PDF_OBJECT_REMEDIATIONS} PDF object remediations, found ${pdfObjects.length}`);
  }
  if (rotationUpdates.length !== EXPECTED_ROTATION_UPDATES) {
    throw new Error(`Expected ${EXPECTED_ROTATION_UPDATES} rotation updates, found ${rotationUpdates.length}`);
  }
  assertUnique(backfillCandidates.map((row) => row.record_id), 'Backfill candidates');
  assertUnique(pdfObjects.map((row) => row.record_id), 'PDF object remediations');
  assertUnique(rotationUpdates.map((row) => row.record_id), 'Rotation updates');

  const transactionEnvelope = analyzeTransactionEnvelope(sqlText);
  const transactionWrapped = transactionEnvelope.wrapped;
  const invalidRotationValues = rotationUpdates.filter((row) => ![90, 180, 270].includes(row.rotation_degrees));
  const magicImpact = guardrailImpacts.find((row) =>
    row.policy === 'smart_rotation_metadata_only'
    && row.query === 'Magic baking powder'
    && row.expected_record_id === 'mtl_archives_metadata_0.json'
  );
  if (!magicImpact) throw new Error('Missing Magic baking powder smart_rotation_metadata_only guardrail impact');

  const guardrailSummaries = (guardrailReport.summaries as JsonObject[]).map((summary) => ({
    policy: summary.policy,
    baseline_policy: summary.baseline_policy ?? null,
    lost_expected_bucket_passes: summary.lost_expected_bucket_passes,
    lost_reviewed_gold_passes: summary.lost_reviewed_gold_passes,
    aggregate: summary.aggregate,
  }));
  const rotationReportClean = rotationReportPasses(rotationReport, rotationUpdates.length);
  const guardrailClean = guardrailPasses(guardrailSummaries, magicImpact);
  const hardGateErrors = [
    transactionWrapped ? null : `Rotation SQL is not fully transaction-wrapped: ${JSON.stringify(transactionEnvelope)}`,
    invalidRotationValues.length === 0 ? null : `Rotation SQL has ${invalidRotationValues.length} invalid rotation values.`,
    rotationReportClean ? null : 'Rotation SQL review report contains anomalies or missing migration/worker support.',
    guardrailClean ? null : 'Search guardrail does not prove rotation metadata preserves reviewed-gold passes and Magic baking powder rank.',
  ].filter((value): value is string => Boolean(value));
  if (hardGateErrors.length) throw new Error(`Production apply gate failed closed:\n- ${hardGateErrors.join('\n- ')}`);

  const plan = {
    generated_at: generatedAtFromInputs([failureReport, rotationReport, guardrailReport, repairReport]),
    issue: 60,
    source_issue: 53,
    gate_id: 'production_apply_gate_v0',
    boundary: {
      no_production_writes_executed: true,
      no_secrets_required_or_read: true,
      no_vectorize_rebuild_proposed: true,
      approval_required_before_any_r2_or_d1_mutation: true,
    },
    inputs: {
      failure_reconciliation_report: rel(failureReportPath),
      r2_backfill_candidates: rel(backfillPath),
      pdf_object_remediation_candidates: rel(pdfPath),
      rotation_sql_review_report: rel(rotationReportPath),
      rotation_transaction_sql: rel(sqlPath),
      repair_report: rel(repairReportPath),
      current_live_search_guardrail_report: rel(guardrailReportPath),
      current_live_search_guardrail_task_impacts: rel(guardrailImpactsPath),
    },
    summary: {
      r2_image_backfill_candidates: backfillCandidates.length,
      pdf_backed_r2_image_objects: pdfObjects.length,
      rotation_sql_updates: rotationUpdates.length,
      rotation_sql_transaction_wrapped: transactionWrapped,
      rotation_sql_transaction_envelope: transactionEnvelope,
      invalid_rotation_values: invalidRotationValues.length,
      rotation_sql_review_passed: rotationReportClean,
      search_guardrail_passed: guardrailClean,
      broad_quality_filtering_or_demotion_approved: false,
      vectorize_rebuild_proposed: false,
    },
    proposed_production_write_categories: [
      {
        category: 'R2 image object backfill from reviewed source-reachable image derivatives',
        count: backfillCandidates.length,
        approval_state: 'pending explicit human/local-control approval',
        execution_state: 'not executed by this script',
      },
      {
        category: 'R2/document handling remediation for PDF bytes currently served from image object keys',
        count: pdfObjects.length,
        approval_state: 'pending decision: replace with real image derivative, add document handling, or exclude from image surfaces',
        execution_state: 'not executed by this script',
      },
      {
        category: 'D1 manifest.rotation_degrees transaction',
        count: rotationUpdates.length,
        approval_state: 'pending explicit human/local-control approval',
        execution_state: 'not executed by this script',
      },
    ],
    r2_image_backfill_candidates: backfillCandidates,
    pdf_backed_r2_image_objects: pdfObjects,
    rotation_degrees_transaction_input: {
      sql_input: rel(sqlPath),
      update_count: rotationUpdates.length,
      transaction_wrapped: transactionWrapped,
      transaction_envelope: transactionEnvelope,
      rotation_counts: countBy(rotationUpdates, (row) => String(row.rotation_degrees)),
      updates: rotationUpdates,
    },
    preflight_checks: [
      {
        check: 'Human-review all 36 image backfill candidates against source URL, manifest ID, object key, and local derivative evidence.',
        status: 'pending_human_review',
        evidence: rel(backfillPath),
      },
      {
        check: 'Choose remediation path for both PDF-backed R2 image objects before treating them as image-surface records.',
        status: 'pending_human_review',
        evidence: rel(pdfPath),
      },
      {
        check: 'Confirm rotation SQL stays transaction-wrapped and contains exactly 11,432 updates.',
        status: transactionWrapped && rotationUpdates.length === EXPECTED_ROTATION_UPDATES ? 'pass' : 'fail',
        evidence: rel(sqlPath),
      },
      {
        check: 'Confirm rotation SQL review has no duplicate IDs, missing manifest IDs, invalid values, or value mismatches.',
        status: rotationReportClean ? 'pass' : 'fail',
        evidence: rel(rotationReportPath),
      },
      {
        check: 'Confirm current guardrail rejects broad filtering/demotion and preserves reviewed-gold passes for rotation metadata only.',
        status: guardrailClean ? 'pass' : 'fail',
        evidence: rel(guardrailReportPath),
      },
      {
        check: 'Confirm no Vectorize rebuild is part of the initial approved production write set.',
        status: 'pass',
        evidence: 'Issue #60 non-goal and current guardrail decision.',
      },
    ],
    rollback_evidence_requirements: [
      'Before any R2 mutation, capture each target object key, current existence status, byte count, content type, checksum or ETag if available, and a restorable copy for objects that already exist.',
      'Before any PDF-object remediation, preserve the existing PDF bytes or object metadata and document whether the approved path is replacement, explicit document handling, or image-surface exclusion.',
      'Before any D1 transaction, export the pre-apply rotation_degrees values for all 11,432 target metadata_filename rows and keep the exact transaction SQL used.',
      'After any failed or rolled-back apply, produce evidence that R2 object keys and D1 rotation_degrees values match the captured pre-apply state.',
      'Keep post-apply guardrail output and Magic baking powder verification beside the apply log.',
    ],
    post_apply_guardrails: {
      rerun_current_live_search_guardrail: 'required after approved D1/R2 changes',
      guardrail_command_reference: 'npm run dataset-factory:quality-search-guardrail-v0',
      broad_quality_filtering_or_demotion: 'not approved unless a new guardrail run preserves reviewed-gold retrieval',
      magic_baking_powder: {
        query: 'Magic baking powder',
        expected_record_id: 'mtl_archives_metadata_0.json',
        current_policy: magicImpact.policy,
        current_baseline_rank: magicImpact.baseline_rank,
        current_rotation_metadata_only_rank: magicImpact.policy_rank,
        required_post_apply_result: 'mtl_archives_metadata_0.json must still return for Magic baking powder, ideally at rank 1 as in the current guardrail.',
      },
      current_guardrail_policy_summaries: guardrailSummaries,
    },
    decision: 'Ready for local human/Codex review as a non-mutating #60 preparation layer. Actual production R2/D1 writes remain pending explicit approval and must be followed by rollback evidence capture plus live search guardrails.',
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, 'production-apply-gate-v0-report.json');
  const mdPath = path.join(outputDir, 'production-apply-gate-v0-report.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(mdPath, `${renderMarkdown(plan)}\n`, 'utf-8');

  console.log(`[production-apply-gate-v0] output=${rel(outputDir)}`);
  console.log(`[production-apply-gate-v0] report=${rel(jsonPath)}`);
  console.log(`[production-apply-gate-v0] markdown=${rel(mdPath)}`);
  console.log(`[production-apply-gate-v0] summary=${JSON.stringify(plan.summary)}`);
  console.log(`[production-apply-gate-v0] decision=${plan.decision}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
