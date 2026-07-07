import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const QUALITY_ROOT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0');
const DEFAULT_SCOPED_REPORT = path.join(
  QUALITY_ROOT,
  'production_scoped_apply_v0/production-scoped-apply-v0-report.json',
);
const DEFAULT_R2_SNAPSHOT = path.join(
  QUALITY_ROOT,
  'production_live_preflight_v0/production-r2-target-snapshot.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.join(QUALITY_ROOT, 'production_rollback_pack_v0');

const RECORD_ID_PATTERN = /^mtl_archives_metadata_\d+\.json$/;
const OBJECT_KEY_PATTERN = /^mtl_archives_image_\d+\.(jpg|jpeg)$/;
const ROTATION_VALUES = [90, 180, 270] as const;
const PRECONDITION_CHUNK_SIZE = 250;

type JsonObject = Record<string, unknown>;

type RotationPlanRow = {
  record_id: string;
  current_rotation_degrees: number | null;
  planned_rotation_degrees: number;
};

type R2PlanRow = {
  record_id: string;
  image_path?: string;
  [key: string]: unknown;
};

type R2SnapshotRow = {
  object_key: string;
  url?: string | null;
  http_status: number;
  content_type?: string | null;
  content_length?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  magic_hex?: string | null;
  preserved_copy_path?: string | null;
};

type R2RollbackRow = {
  record_id: string;
  object_key: string;
  category: 'image_backfill' | 'pdf_remediation';
  preapply_http_status: number | null;
  preapply_content_type: string | null;
  preapply_content_length: number | null;
  preapply_etag: string | null;
  preapply_magic_hex: string | null;
  rollback_action: 'delete_new_object' | 'restore_preserved_object' | 'manual_review_required';
  preserved_copy_path: string | null;
  ready: boolean;
};

type PreconditionQuery = {
  chunk: number;
  expected_targets: number;
  sql: string;
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

function writeJsonl(filePath: string, rows: unknown[]): void {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
    'utf-8',
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function asArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value as T[];
}

function assertRecordId(value: string, label: string): void {
  if (!RECORD_ID_PATTERN.test(value)) throw new Error(`${label}: invalid record_id.`);
}

function assertObjectKey(value: string, label: string): void {
  if (!OBJECT_KEY_PATTERN.test(value)) throw new Error(`${label}: invalid object key.`);
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

function isPathInside(candidate: string, root: string): boolean {
  const relativePath = path.relative(root, candidate);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function statRegularFile(filePath: string): fs.Stats | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function normalizeRotationPlanRow(row: unknown, label: string): RotationPlanRow {
  if (!isObject(row)) throw new Error(`${label}: row is not an object.`);
  const recordId = asString(row.record_id, `${label}.record_id`);
  assertRecordId(recordId, label);
  const current = row.current_rotation_degrees;
  const planned = row.planned_rotation_degrees;
  if (current !== null && !(typeof current === 'number' && ROTATION_VALUES.includes(current as typeof ROTATION_VALUES[number]))) {
    throw new Error(`${label}.current_rotation_degrees must be null, 90, 180, or 270.`);
  }
  if (!(typeof planned === 'number' && ROTATION_VALUES.includes(planned as typeof ROTATION_VALUES[number]))) {
    throw new Error(`${label}.planned_rotation_degrees must be 90, 180, or 270.`);
  }
  return {
    record_id: recordId,
    current_rotation_degrees: current as number | null,
    planned_rotation_degrees: planned,
  };
}

function normalizeR2PlanRow(row: unknown, label: string): R2PlanRow {
  if (!isObject(row)) throw new Error(`${label}: row is not an object.`);
  const recordId = asString(row.record_id, `${label}.record_id`);
  assertRecordId(recordId, label);
  const imagePath = asString(row.image_path, `${label}.image_path`);
  assertObjectKey(imagePath, label);
  return { ...row, record_id: recordId, image_path: imagePath };
}

function normalizeR2SnapshotRow(row: unknown, label: string): R2SnapshotRow {
  if (!isObject(row)) throw new Error(`${label}: row is not an object.`);
  const objectKey = asString(row.object_key, `${label}.object_key`);
  assertObjectKey(objectKey, label);
  if (typeof row.http_status !== 'number' || !Number.isInteger(row.http_status)) {
    throw new Error(`${label}.http_status must be an integer.`);
  }
  const contentLength = row.content_length;
  return {
    object_key: objectKey,
    url: typeof row.url === 'string' ? row.url : null,
    http_status: row.http_status,
    content_type: typeof row.content_type === 'string' ? row.content_type : null,
    content_length: typeof contentLength === 'number' && Number.isFinite(contentLength) ? contentLength : null,
    etag: typeof row.etag === 'string' ? row.etag : null,
    last_modified: typeof row.last_modified === 'string' ? row.last_modified : null,
    magic_hex: typeof row.magic_hex === 'string' ? row.magic_hex : null,
    preserved_copy_path: typeof row.preserved_copy_path === 'string' && row.preserved_copy_path
      ? row.preserved_copy_path
      : null,
  };
}

function scopedOutputPath(report: JsonObject, key: string): string {
  const outputs = report.outputs;
  if (!isObject(outputs)) throw new Error('Scoped report is missing outputs.');
  return resolveRepoPath(asString(outputs[key], `outputs.${key}`));
}

function sqlValue(value: number | null): string {
  return value === null ? 'NULL' : String(value);
}

function buildRollbackSql(rows: RotationPlanRow[], scopedReport: string): string {
  const lines = [
    '-- Production Quality Repair v0 rotation rollback transaction.',
    `-- Source scoped plan: ${scopedReport}`,
    `-- Target count: ${rows.length}`,
    '-- Generated by dataset-factory:production-rollback-pack-v0.',
    '-- Apply only if the matching production apply transaction must be reverted.',
    '',
    'BEGIN TRANSACTION;',
    '',
  ];
  for (const row of rows) {
    lines.push(`UPDATE manifest SET rotation_degrees=${sqlValue(row.current_rotation_degrees)} WHERE metadata_filename='${row.record_id}';`);
  }
  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

function buildPreconditionQueries(rows: RotationPlanRow[], scopedReport: string): PreconditionQuery[] {
  const queries: PreconditionQuery[] = [];
  for (let offset = 0; offset < rows.length; offset += PRECONDITION_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + PRECONDITION_CHUNK_SIZE);
    const chunkIndex = Math.floor(offset / PRECONDITION_CHUNK_SIZE) + 1;
    const values = chunk.map((row) =>
      `('${row.record_id}', ${sqlValue(row.current_rotation_degrees)}, ${row.planned_rotation_degrees})`
    );
    const sql = [
      'WITH expected(metadata_filename, current_rotation_degrees, planned_rotation_degrees) AS (',
      `  VALUES\n  ${values.join(',\n  ')}`,
      ')',
      'SELECT',
      `  ${chunkIndex} AS chunk,`,
      `  ${chunk.length} AS expected_targets,`,
      '  (SELECT COUNT(*) FROM expected e LEFT JOIN manifest m ON m.metadata_filename = e.metadata_filename WHERE m.metadata_filename IS NULL) AS missing_targets,',
      '  (SELECT COUNT(*) FROM expected e JOIN manifest m ON m.metadata_filename = e.metadata_filename WHERE m.rotation_degrees IS NOT e.current_rotation_degrees) AS current_value_mismatches;',
      '',
    ].join('\n');
    queries.push({ chunk: chunkIndex, expected_targets: chunk.length, sql });
  }
  return queries;
}

function renderPreconditionIndex(queries: PreconditionQuery[]): string {
  const lines = [
    '-- Read-only precondition checks for the production-present rotation transaction.',
    `-- Chunks: ${queries.length}`,
    `-- Chunk size: ${PRECONDITION_CHUNK_SIZE}`,
    '-- Run chunk files individually with Wrangler and require missing_targets=0 and current_value_mismatches=0 for every chunk.',
    '',
  ];
  for (const query of queries) {
    lines.push(`-- Chunk ${query.chunk}: expected_targets=${query.expected_targets}`);
  }
  return lines.join('\n');
}

function buildR2RollbackRows(
  rows: R2PlanRow[],
  category: R2RollbackRow['category'],
  snapshots: Map<string, R2SnapshotRow>,
  preservedRoot: string,
): R2RollbackRow[] {
  return rows.map((row) => {
    const objectKey = row.image_path!;
    const snapshot = snapshots.get(objectKey);
    if (!snapshot) {
      return {
        record_id: row.record_id,
        object_key: objectKey,
        category,
        preapply_http_status: null,
        preapply_content_type: null,
        preapply_content_length: null,
        preapply_etag: null,
        preapply_magic_hex: null,
        rollback_action: 'manual_review_required',
        preserved_copy_path: null,
        ready: false,
      };
    }

    const wasMissing = snapshot.http_status === 404;
    const preservedCopy = snapshot.preserved_copy_path ? resolveRepoPath(snapshot.preserved_copy_path) : null;
    const preservedCopyStats = preservedCopy ? statRegularFile(preservedCopy) : null;
    const preservedCopyMatchesSnapshot = Boolean(
      preservedCopy
        && preservedCopyStats
        && isPathInside(preservedCopy, preservedRoot)
        && path.basename(preservedCopy) === objectKey
        && (snapshot.content_length === null || preservedCopyStats.size === snapshot.content_length),
    );
    const restoreReady = snapshot.http_status >= 200 && snapshot.http_status < 300 && preservedCopyMatchesSnapshot;
    return {
      record_id: row.record_id,
      object_key: objectKey,
      category,
      preapply_http_status: snapshot.http_status,
      preapply_content_type: snapshot.content_type ?? null,
      preapply_content_length: snapshot.content_length ?? null,
      preapply_etag: snapshot.etag ?? null,
      preapply_magic_hex: snapshot.magic_hex ?? null,
      rollback_action: wasMissing ? 'delete_new_object' : restoreReady ? 'restore_preserved_object' : 'manual_review_required',
      preserved_copy_path: snapshot.preserved_copy_path ?? null,
      ready: wasMissing || restoreReady,
    };
  });
}

function renderMarkdown(report: JsonObject): string {
  const summary = report.summary as JsonObject;
  const outputs = report.outputs as JsonObject;
  const blockers = report.blockers as string[];
  const warnings = report.warnings as string[];
  const lines = [
    '# Production Rollback Pack v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Boundary',
    '',
    '- This is a non-mutating rollback/evidence pack for GitHub issue #60.',
    '- It does not read credentials, call Wrangler, perform network I/O, execute SQL, or mutate R2/D1.',
    '- It consumes local snapshots produced by separate read-only control steps.',
    '',
    '## Summary',
    '',
    `- D1 rotation rollback rows: ${summary.d1_rotation_rollback_rows}`,
    `- D1 rotation rows currently NULL: ${summary.d1_rotation_current_null_rows}`,
    `- R2 rollback targets: ${summary.r2_rollback_targets}`,
    `- R2 delete-new-object rollback targets: ${summary.r2_delete_new_object_targets}`,
    `- R2 restore-preserved-object targets: ${summary.r2_restore_preserved_object_targets}`,
    `- R2 manual-review targets: ${summary.r2_manual_review_targets}`,
    `- Ready for production-present apply after explicit approval: ${summary.ready_for_production_present_apply}`,
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
    lines.push(`- ${name}: \`${filePath}\``);
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
      'scoped-report': { type: 'string', default: DEFAULT_SCOPED_REPORT },
      'r2-snapshot': { type: 'string', default: DEFAULT_R2_SNAPSHOT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const scopedReportPath = resolveRepoPath(values['scoped-report']!);
  const r2SnapshotPath = resolveRepoPath(values['r2-snapshot']!);
  const outputDir = resolveRepoPath(values.output!);
  const scopedReport = readJson<JsonObject>(scopedReportPath);
  const rotationPlan = readJsonl<unknown>(scopedOutputPath(scopedReport, 'production_present_rotation_plan'))
    .map((row, index) => normalizeRotationPlanRow(row, `rotation plan ${index + 1}`));
  const r2Backfills = readJsonl<unknown>(scopedOutputPath(scopedReport, 'production_present_r2_backfills'))
    .map((row, index) => normalizeR2PlanRow(row, `R2 backfill ${index + 1}`));
  const pdfRemediations = readJsonl<unknown>(scopedOutputPath(scopedReport, 'production_present_pdf_remediations'))
    .map((row, index) => normalizeR2PlanRow(row, `PDF remediation ${index + 1}`));
  const r2Snapshots = fs.existsSync(r2SnapshotPath)
    ? readJsonl<unknown>(r2SnapshotPath).map((row, index) => normalizeR2SnapshotRow(row, `R2 snapshot ${index + 1}`))
    : [];

  assertUnique(rotationPlan.map((row) => row.record_id), 'D1 rotation rollback plan');
  assertUnique([...r2Backfills, ...pdfRemediations].map((row) => row.image_path!), 'R2 rollback targets');
  assertUnique(r2Snapshots.map((row) => row.object_key), 'R2 snapshot');

  const snapshotByKey = new Map(r2Snapshots.map((row) => [row.object_key, row]));
  const r2PreservedRoot = path.join(path.dirname(r2SnapshotPath), 'r2-preserved');
  const r2RollbackRows = [
    ...buildR2RollbackRows(r2Backfills, 'image_backfill', snapshotByKey, r2PreservedRoot),
    ...buildR2RollbackRows(pdfRemediations, 'pdf_remediation', snapshotByKey, r2PreservedRoot),
  ];
  const manualR2Rows = r2RollbackRows.filter((row) => !row.ready);
  const scopedSummary = isObject(scopedReport.summary) ? scopedReport.summary : {};
  const expectedRotationRows = typeof scopedSummary.production_present_rotation_updates === 'number'
    ? scopedSummary.production_present_rotation_updates
    : null;
  const expectedR2Backfills = typeof scopedSummary.production_present_r2_backfills === 'number'
    ? scopedSummary.production_present_r2_backfills
    : null;
  const expectedPdfRemediations = typeof scopedSummary.production_present_pdf_remediations === 'number'
    ? scopedSummary.production_present_pdf_remediations
    : null;

  const blockers = [
    expectedRotationRows !== null && expectedRotationRows !== rotationPlan.length
      ? `Scoped report expected ${expectedRotationRows} rotation rows but found ${rotationPlan.length}.`
      : null,
    expectedR2Backfills !== null && expectedR2Backfills !== r2Backfills.length
      ? `Scoped report expected ${expectedR2Backfills} R2 backfills but found ${r2Backfills.length}.`
      : null,
    expectedPdfRemediations !== null && expectedPdfRemediations !== pdfRemediations.length
      ? `Scoped report expected ${expectedPdfRemediations} PDF remediations but found ${pdfRemediations.length}.`
      : null,
    r2Snapshots.length !== r2RollbackRows.length
      ? `R2 snapshot coverage is incomplete: expected ${r2RollbackRows.length}, found ${r2Snapshots.length}.`
      : null,
    manualR2Rows.length ? `${manualR2Rows.length} R2 rollback target(s) require manual review.` : null,
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    scopedSummary.ready_for_production_apply === false
      ? 'The full local/Kami plan is not production-covered; this rollback pack is only for production-present targets.'
      : null,
  ].filter((value): value is string => Boolean(value));
  const ready = blockers.length === 0;

  fs.mkdirSync(outputDir, { recursive: true });
  const d1SnapshotPath = path.join(outputDir, 'd1-rotation-preapply-snapshot.jsonl');
  const d1RollbackSqlPath = path.join(outputDir, 'd1-rotation-rollback.sql');
  const d1PreconditionIndexPath = path.join(outputDir, 'd1-rotation-precondition-index.sql');
  const d1PreconditionQueriesPath = path.join(outputDir, 'd1-rotation-precondition-queries.jsonl');
  const d1PreconditionChunksDir = path.join(outputDir, 'd1-rotation-precondition-chunks');
  const r2RollbackPath = path.join(outputDir, 'r2-rollback-plan.jsonl');
  const r2ManualPath = path.join(outputDir, 'r2-manual-review.jsonl');
  const preconditionQueries = buildPreconditionQueries(rotationPlan, rel(scopedReportPath));

  writeJsonl(d1SnapshotPath, rotationPlan);
  fs.writeFileSync(d1RollbackSqlPath, buildRollbackSql(rotationPlan, rel(scopedReportPath)), 'utf-8');
  fs.writeFileSync(d1PreconditionIndexPath, `${renderPreconditionIndex(preconditionQueries)}\n`, 'utf-8');
  fs.mkdirSync(d1PreconditionChunksDir, { recursive: true });
  const preconditionIndexRows = preconditionQueries.map((query) => {
    const sqlPath = path.join(d1PreconditionChunksDir, `chunk-${String(query.chunk).padStart(3, '0')}.sql`);
    fs.writeFileSync(sqlPath, query.sql, 'utf-8');
    return {
      chunk: query.chunk,
      expected_targets: query.expected_targets,
      sql_file: rel(sqlPath),
    };
  });
  writeJsonl(d1PreconditionQueriesPath, preconditionIndexRows);
  writeJsonl(r2RollbackPath, r2RollbackRows);
  writeJsonl(r2ManualPath, manualR2Rows);

  const outputs = {
    report_json: rel(path.join(outputDir, 'production-rollback-pack-v0-report.json')),
    report_markdown: rel(path.join(outputDir, 'production-rollback-pack-v0-report.md')),
    d1_rotation_preapply_snapshot: rel(d1SnapshotPath),
    d1_rotation_precondition_index: rel(d1PreconditionIndexPath),
    d1_rotation_precondition_queries: rel(d1PreconditionQueriesPath),
    d1_rotation_precondition_chunks_dir: rel(d1PreconditionChunksDir),
    d1_rotation_rollback_sql: rel(d1RollbackSqlPath),
    r2_rollback_plan: rel(r2RollbackPath),
    r2_manual_review: rel(r2ManualPath),
  };
  const report = {
    generated_at: new Date().toISOString(),
    issue: 60,
    pack_id: 'production_rollback_pack_v0',
    boundary: {
      no_production_writes_executed: true,
      no_cloudflare_credentials_read: true,
      no_network_calls: true,
      approval_required_before_any_r2_or_d1_mutation: true,
    },
    inputs: {
      scoped_report: rel(scopedReportPath),
      r2_snapshot: fs.existsSync(r2SnapshotPath) ? rel(r2SnapshotPath) : null,
    },
    summary: {
      d1_rotation_rollback_rows: rotationPlan.length,
      d1_rotation_current_null_rows: rotationPlan.filter((row) => row.current_rotation_degrees === null).length,
      d1_rotation_current_non_null_rows: rotationPlan.filter((row) => row.current_rotation_degrees !== null).length,
      d1_rotation_precondition_chunks: Math.ceil(rotationPlan.length / PRECONDITION_CHUNK_SIZE),
      d1_rotation_precondition_chunk_size: PRECONDITION_CHUNK_SIZE,
      r2_rollback_targets: r2RollbackRows.length,
      r2_snapshot_rows: r2Snapshots.length,
      r2_delete_new_object_targets: r2RollbackRows.filter((row) => row.rollback_action === 'delete_new_object').length,
      r2_restore_preserved_object_targets: r2RollbackRows.filter((row) => row.rollback_action === 'restore_preserved_object').length,
      r2_manual_review_targets: manualR2Rows.length,
      ready_for_production_present_apply: ready,
    },
    blockers,
    warnings,
    samples: {
      manual_r2_targets: manualR2Rows.slice(0, 20),
    },
    outputs,
    decision: ready
      ? 'Rollback evidence is complete for the production-present subset. Production writes still require explicit approval and a fresh read-only precondition check.'
      : 'Rollback evidence is incomplete. Do not apply production-present writes until blockers are resolved.',
  };

  const reportJsonPath = path.join(outputDir, 'production-rollback-pack-v0-report.json');
  const reportMdPath = path.join(outputDir, 'production-rollback-pack-v0-report.md');
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(reportMdPath, `${renderMarkdown(report)}\n`, 'utf-8');

  console.log(`[production-rollback-pack-v0] output=${rel(outputDir)}`);
  console.log(`[production-rollback-pack-v0] report=${rel(reportJsonPath)}`);
  console.log(`[production-rollback-pack-v0] summary=${JSON.stringify(report.summary)}`);
  console.log(`[production-rollback-pack-v0] decision=${report.decision}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
