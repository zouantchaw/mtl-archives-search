import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const QUALITY_ROOT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0');
const DEFAULT_GATE_REPORT = path.join(QUALITY_ROOT, 'production_apply_gate_v0/production-apply-gate-v0-report.json');
const DEFAULT_MANIFEST_SNAPSHOT = path.join(
  QUALITY_ROOT,
  'production_live_preflight_v0/production-manifest-snapshot.json',
);
const DEFAULT_OUTPUT_DIR = path.join(QUALITY_ROOT, 'production_scoped_apply_v0');

const ROTATION_VALUES = [90, 180, 270] as const;
const RECORD_ID_PATTERN = /^mtl_archives_metadata_\d+\.json$/;

type JsonObject = Record<string, unknown>;

type RotationUpdate = {
  sequence: number;
  record_id: string;
  rotation_degrees: number;
};

type PlanRow = {
  record_id: string;
  image_path?: string;
  recommended_action?: string;
  [key: string]: unknown;
};

type ManifestRow = {
  metadata_filename: string;
  image_filename: string | null;
  rotation_degrees: number | null;
};

type WranglerResult = {
  results?: unknown;
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

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
    'utf-8',
  );
}

function markdownEscape(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function parseSnapshotRows(filePath: string): ManifestRow[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) throw new Error(`Manifest snapshot is empty: ${filePath}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filePath}:${index + 1}: ${message}`);
      }
    });
  }

  const candidateRows = Array.isArray(parsed) && parsed.length === 1
    && isObject(parsed[0])
    && Array.isArray((parsed[0] as WranglerResult).results)
    ? (parsed[0] as WranglerResult).results
    : parsed;

  if (!Array.isArray(candidateRows)) {
    throw new Error('Manifest snapshot must be a JSON array, JSONL rows, or Wrangler --json result array.');
  }

  return candidateRows.map((row, index) => normalizeManifestRow(row, `${filePath}:${index + 1}`));
}

function normalizeManifestRow(row: unknown, label: string): ManifestRow {
  if (!isObject(row)) throw new Error(`${label}: manifest row is not an object.`);
  if (typeof row.metadata_filename !== 'string' || !row.metadata_filename) {
    throw new Error(`${label}: missing metadata_filename string.`);
  }
  const imageFilename = row.image_filename;
  const rotation = row.rotation_degrees;
  return {
    metadata_filename: row.metadata_filename,
    image_filename: typeof imageFilename === 'string' ? imageFilename : null,
    rotation_degrees: typeof rotation === 'number' && Number.isFinite(rotation) ? rotation : null,
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value as T[];
}

function asRotationUpdate(value: unknown, label: string): RotationUpdate {
  if (!isObject(value)) throw new Error(`${label}: rotation update is not an object.`);
  const { sequence, record_id: recordId, rotation_degrees: rotationDegrees } = value;
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`${label}: invalid sequence.`);
  }
  if (typeof recordId !== 'string' || !RECORD_ID_PATTERN.test(recordId)) {
    throw new Error(`${label}: invalid record_id.`);
  }
  if (!ROTATION_VALUES.includes(rotationDegrees as typeof ROTATION_VALUES[number])) {
    throw new Error(`${label}: invalid rotation_degrees.`);
  }
  return {
    sequence,
    record_id: recordId,
    rotation_degrees: rotationDegrees as typeof ROTATION_VALUES[number],
  };
}

function asPlanRow(value: unknown, label: string): PlanRow {
  if (!isObject(value)) throw new Error(`${label}: plan row is not an object.`);
  if (typeof value.record_id !== 'string' || !RECORD_ID_PATTERN.test(value.record_id)) {
    throw new Error(`${label}: invalid record_id.`);
  }
  return value as PlanRow;
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size) throw new Error(`${label} contains duplicate IDs: ${[...duplicates].sort().join(', ')}`);
}

function countByRotation(rows: RotationUpdate[]): Record<string, number> {
  return Object.fromEntries(ROTATION_VALUES.map((rotation) => [
    String(rotation),
    rows.filter((row) => row.rotation_degrees === rotation).length,
  ]));
}

function splitByManifest<T extends { record_id: string }>(
  rows: T[],
  manifestByMetadata: Map<string, ManifestRow>,
): { present: T[]; missing: T[] } {
  const present: T[] = [];
  const missing: T[] = [];
  for (const row of rows) {
    if (manifestByMetadata.has(row.record_id)) present.push(row);
    else missing.push(row);
  }
  return { present, missing };
}

function buildRotationSql(rows: RotationUpdate[], sourcePlan: string): string {
  const lines = [
    '-- Production-scoped Quality Repair v0 rotation transaction.',
    `-- Source plan: ${sourcePlan}`,
    `-- Production-present target count: ${rows.length}`,
    '-- Generated by dataset-factory:production-scoped-apply-v0.',
    '-- Do not apply without explicit approval, rollback capture, and a fresh target-count precondition.',
    '',
    'BEGIN TRANSACTION;',
    '',
  ];
  for (const row of rows) {
    lines.push(`UPDATE manifest SET rotation_degrees=${row.rotation_degrees} WHERE metadata_filename='${row.record_id}';`);
  }
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

function renderMarkdown(report: JsonObject): string {
  const summary = report.summary as JsonObject;
  const outputs = report.outputs as JsonObject;
  const blockers = report.blockers as string[];
  const warnings = report.warnings as string[];

  const lines = [
    '# Production-Scoped Apply v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Boundary',
    '',
    '- This is a non-mutating planner for GitHub issue #60.',
    '- It does not read Cloudflare credentials, call Wrangler, query D1, upload R2 objects, or execute SQL.',
    '- It consumes a local production manifest snapshot that must be produced by a separate read-only control step.',
    '',
    '## Summary',
    '',
    `- Production manifest rows in snapshot: ${summary.production_manifest_rows}`,
    `- Planned rotation updates: ${summary.planned_rotation_updates}`,
    `- Production-present rotation updates: ${summary.production_present_rotation_updates}`,
    `- Production-missing rotation updates: ${summary.production_missing_rotation_updates}`,
    `- Production-present R2 backfills: ${summary.production_present_r2_backfills}`,
    `- Production-missing R2 backfills: ${summary.production_missing_r2_backfills}`,
    `- Production-present PDF remediations: ${summary.production_present_pdf_remediations}`,
    `- Production-missing PDF remediations: ${summary.production_missing_pdf_remediations}`,
    `- Ready for production apply: ${summary.ready_for_production_apply}`,
    '',
    '## Blockers',
    '',
    ...(blockers.length ? blockers.map((blocker) => `- ${blocker}`) : ['- None']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ['- None']),
    '',
    '## Outputs',
    '',
  ];

  for (const [name, filePath] of Object.entries(outputs)) {
    lines.push(`- ${markdownEscape(name)}: \`${markdownEscape(filePath)}\``);
  }

  lines.push(
    '',
    '## Decision',
    '',
    String(report.decision),
    '',
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'gate-report': { type: 'string', default: DEFAULT_GATE_REPORT },
      'manifest-snapshot': { type: 'string', default: DEFAULT_MANIFEST_SNAPSHOT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const gateReportPath = resolveRepoPath(values['gate-report']!);
  const manifestSnapshotPath = resolveRepoPath(values['manifest-snapshot']!);
  const outputDir = resolveRepoPath(values.output!);
  const gateReport = readJson<JsonObject>(gateReportPath);
  const snapshotRows = parseSnapshotRows(manifestSnapshotPath);
  assertUnique(snapshotRows.map((row) => row.metadata_filename), 'Manifest snapshot');
  const manifestByMetadata = new Map(snapshotRows.map((row) => [row.metadata_filename, row]));

  const rotationInput = gateReport.rotation_degrees_transaction_input;
  if (!isObject(rotationInput)) throw new Error('Gate report is missing rotation_degrees_transaction_input.');
  const rotationUpdates = asArray<unknown>(rotationInput.updates, 'rotation_degrees_transaction_input.updates')
    .map((row, index) => asRotationUpdate(row, `rotation update ${index + 1}`));
  const backfillCandidates = asArray<unknown>(gateReport.r2_image_backfill_candidates, 'r2_image_backfill_candidates')
    .map((row, index) => asPlanRow(row, `R2 backfill candidate ${index + 1}`));
  const pdfRemediations = asArray<unknown>(gateReport.pdf_backed_r2_image_objects, 'pdf_backed_r2_image_objects')
    .map((row, index) => asPlanRow(row, `PDF remediation ${index + 1}`));
  assertUnique(rotationUpdates.map((row) => row.record_id), 'Rotation updates');
  assertUnique(backfillCandidates.map((row) => row.record_id), 'R2 backfill candidates');
  assertUnique(pdfRemediations.map((row) => row.record_id), 'PDF remediations');

  const rotationSplit = splitByManifest(rotationUpdates, manifestByMetadata);
  const backfillSplit = splitByManifest(backfillCandidates, manifestByMetadata);
  const pdfSplit = splitByManifest(pdfRemediations, manifestByMetadata);
  const nonNullRotationTargets = rotationSplit.present.filter((row) => {
    const current = manifestByMetadata.get(row.record_id)?.rotation_degrees;
    return current !== null && current !== undefined;
  });
  const conflictingRotationTargets = rotationSplit.present.filter((row) => {
    const current = manifestByMetadata.get(row.record_id)?.rotation_degrees;
    return current !== null && current !== undefined && current !== row.rotation_degrees;
  });

  const blockers = [
    rotationSplit.missing.length
      ? `${rotationSplit.missing.length} planned rotation targets are missing from the production manifest snapshot.`
      : null,
    backfillSplit.missing.length
      ? `${backfillSplit.missing.length} planned R2 backfill records are missing from the production manifest snapshot.`
      : null,
    pdfSplit.missing.length
      ? `${pdfSplit.missing.length} planned PDF remediation record(s) are missing from the production manifest snapshot.`
      : null,
    conflictingRotationTargets.length
      ? `${conflictingRotationTargets.length} production rows already have conflicting rotation_degrees values.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    nonNullRotationTargets.length
      ? `${nonNullRotationTargets.length} production-present rotation targets already have non-null rotation_degrees.`
      : null,
  ].filter((value): value is string => Boolean(value));
  const readyForApply = blockers.length === 0;

  fs.mkdirSync(outputDir, { recursive: true });
  const presentSqlPath = path.join(outputDir, 'production-scoped-rotation-present.sql');
  const presentRotationPath = path.join(outputDir, 'production-scoped-rotation-present.jsonl');
  const presentBackfillPath = path.join(outputDir, 'production-scoped-r2-backfill-present.jsonl');
  const missingBackfillPath = path.join(outputDir, 'production-scoped-r2-backfill-missing-manifest.jsonl');
  const presentPdfPath = path.join(outputDir, 'production-scoped-pdf-remediation-present.jsonl');
  const missingPdfPath = path.join(outputDir, 'production-scoped-pdf-remediation-missing-manifest.jsonl');
  const missingRotationPath = path.join(outputDir, 'production-scoped-rotation-missing-manifest.jsonl');

  const presentRotationRows = rotationSplit.present.map((row) => ({
    record_id: row.record_id,
    current_rotation_degrees: manifestByMetadata.get(row.record_id)?.rotation_degrees ?? null,
    planned_rotation_degrees: row.rotation_degrees,
  }));

  fs.writeFileSync(presentSqlPath, buildRotationSql(rotationSplit.present, rel(gateReportPath)), 'utf-8');
  writeJsonl(presentRotationPath, presentRotationRows);
  writeJsonl(presentBackfillPath, backfillSplit.present);
  writeJsonl(missingBackfillPath, backfillSplit.missing);
  writeJsonl(presentPdfPath, pdfSplit.present);
  writeJsonl(missingPdfPath, pdfSplit.missing);
  writeJsonl(missingRotationPath, rotationSplit.missing);

  const outputFiles = {
    report_json: rel(path.join(outputDir, 'production-scoped-apply-v0-report.json')),
    report_markdown: rel(path.join(outputDir, 'production-scoped-apply-v0-report.md')),
    production_present_rotation_sql: rel(presentSqlPath),
    production_present_rotation_plan: rel(presentRotationPath),
    production_missing_rotation_targets: rel(missingRotationPath),
    production_present_r2_backfills: rel(presentBackfillPath),
    production_missing_r2_backfills: rel(missingBackfillPath),
    production_present_pdf_remediations: rel(presentPdfPath),
    production_missing_pdf_remediations: rel(missingPdfPath),
  };
  const report = {
    generated_at: new Date().toISOString(),
    issue: 60,
    planner_id: 'production_scoped_apply_v0',
    boundary: {
      no_production_writes_executed: true,
      no_cloudflare_credentials_read: true,
      no_network_calls: true,
      approval_required_before_any_r2_or_d1_mutation: true,
    },
    inputs: {
      gate_report: rel(gateReportPath),
      production_manifest_snapshot: rel(manifestSnapshotPath),
    },
    summary: {
      production_manifest_rows: snapshotRows.length,
      planned_rotation_updates: rotationUpdates.length,
      production_present_rotation_updates: rotationSplit.present.length,
      production_missing_rotation_updates: rotationSplit.missing.length,
      planned_rotation_by_value: countByRotation(rotationUpdates),
      production_present_rotation_by_value: countByRotation(rotationSplit.present),
      production_missing_rotation_by_value: countByRotation(rotationSplit.missing),
      existing_non_null_rotation_targets: nonNullRotationTargets.length,
      conflicting_existing_rotation_targets: conflictingRotationTargets.length,
      planned_r2_backfills: backfillCandidates.length,
      production_present_r2_backfills: backfillSplit.present.length,
      production_missing_r2_backfills: backfillSplit.missing.length,
      planned_pdf_remediations: pdfRemediations.length,
      production_present_pdf_remediations: pdfSplit.present.length,
      production_missing_pdf_remediations: pdfSplit.missing.length,
      ready_for_production_apply: readyForApply,
    },
    samples: {
      missing_rotation_targets: rotationSplit.missing.slice(0, 30).map((row) => row.record_id),
      missing_r2_backfills: backfillSplit.missing.map((row) => row.record_id),
      missing_pdf_remediations: pdfSplit.missing.map((row) => row.record_id),
      conflicting_existing_rotation_targets: conflictingRotationTargets.slice(0, 30).map((row) => ({
        record_id: row.record_id,
        current_rotation_degrees: manifestByMetadata.get(row.record_id)?.rotation_degrees,
        planned_rotation_degrees: row.rotation_degrees,
      })),
    },
    blockers,
    warnings,
    outputs: outputFiles,
    decision: readyForApply
      ? 'Production snapshot fully covers the local plan. Production writes still require explicit approval and rollback capture.'
      : 'Production snapshot does not fully cover the local plan. Use the production-present outputs only after explicit approval, and handle missing-manifest rows through a separate reconciliation task.',
  };

  const reportJsonPath = path.join(outputDir, 'production-scoped-apply-v0-report.json');
  const reportMdPath = path.join(outputDir, 'production-scoped-apply-v0-report.md');
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(reportMdPath, `${renderMarkdown(report)}\n`, 'utf-8');

  console.log(`[production-scoped-apply-v0] output=${rel(outputDir)}`);
  console.log(`[production-scoped-apply-v0] report=${rel(reportJsonPath)}`);
  console.log(`[production-scoped-apply-v0] summary=${JSON.stringify(report.summary)}`);
  console.log(`[production-scoped-apply-v0] decision=${report.decision}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
