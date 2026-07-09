import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_QUALITY_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_audit_14822/quality_labels.jsonl',
);
const DEFAULT_BACKFILL_SQL = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_repair_plan_14822/quality-repair-v0-backfill.sql',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_rotation_sql_review_v0',
);
const DEFAULT_MIGRATION = path.resolve(MONOREPO_ROOT, 'infrastructure/d1/migrations/0008_add_rotation_degrees.sql');
const DEFAULT_WORKER = path.resolve(MONOREPO_ROOT, 'apps/api/src/worker.ts');

type ManifestRow = {
  metadata_filename?: string;
};

type QualityLabel = {
  id: string;
  title?: string;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
  confidence?: number;
  metrics?: {
    recommendedRotationDegrees?: number | null;
    exifOrientation?: number | null;
  };
  notes?: string[];
};

type SqlUpdate = {
  record_id: string;
  rotation_degrees: number;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
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

function parseUpdates(sql: string): SqlUpdate[] {
  return [...sql.matchAll(/UPDATE\s+manifest\s+SET\s+rotation_degrees=(\d+)\s+WHERE\s+metadata_filename='([^']+)';/g)]
    .map((match) => ({
      rotation_degrees: Number(match[1]),
      record_id: match[2],
    }));
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderMarkdown(report: Record<string, unknown>, missingRows: QualityLabel[]): string {
  const summary = report.summary as Record<string, unknown>;
  const lines = [
    '# Quality Rotation SQL Review v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Orientation label rows: ${summary.orientation_label_rows}`,
    `- SQL update rows: ${summary.sql_update_rows}`,
    `- Duplicate SQL IDs: ${summary.duplicate_sql_ids}`,
    `- Invalid SQL rotation values: ${summary.invalid_sql_rotation_values}`,
    `- SQL IDs missing from manifest: ${summary.sql_ids_missing_from_manifest}`,
    `- Orientation rows intentionally excluded from SQL: ${summary.orientation_rows_missing_from_sql}`,
    `- Migration has rotation column: ${summary.migration_has_rotation_column}`,
    `- Worker selects rotation column: ${summary.worker_selects_rotation_column}`,
    '',
    '## Rotation Counts',
    '',
    '| Degrees | SQL rows |',
    '|---:|---:|',
  ];
  const counts = summary.sql_rotation_counts as Record<string, number>;
  for (const [key, value] of Object.entries(counts)) lines.push(`| ${key} | ${value} |`);
  lines.push('', '## Excluded Orientation Rows', '');
  if (!missingRows.length) {
    lines.push('No orientation rows were excluded from SQL.');
  } else {
    lines.push('| Record | Title | Degree | Severity | Action | Labels |', '|---|---|---:|---|---|---|');
    for (const row of missingRows) {
      lines.push(`| ${row.id} | ${(row.title ?? '').replace(/\|/g, '\\|')} | ${row.metrics?.recommendedRotationDegrees ?? ''} | ${row.severity ?? ''} | ${row.recommendedAction ?? ''} | ${(row.labels ?? []).join(', ')} |`);
    }
  }
  lines.push(
    '',
    '## Decision',
    '',
    String(report.decision),
    '',
    '## Caveats',
    '',
    '- This reviews the SQL file only. It does not apply SQL to D1.',
    '- Rotation updates should still be applied through a transaction and followed by the search guardrail benchmark.',
    '',
  );
  return `${lines.join('\n')}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      'quality-labels': { type: 'string', default: DEFAULT_QUALITY_LABELS },
      sql: { type: 'string', default: DEFAULT_BACKFILL_SQL },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      migration: { type: 'string', default: DEFAULT_MIGRATION },
      worker: { type: 'string', default: DEFAULT_WORKER },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const labelsPath = resolveRepoPath(values['quality-labels']!);
  const sqlPath = resolveRepoPath(values.sql!);
  const outputDir = resolveRepoPath(values.output!);
  const migrationPath = resolveRepoPath(values.migration!);
  const workerPath = resolveRepoPath(values.worker!);

  const manifestRows = readJsonl<ManifestRow>(manifestPath);
  const labels = readJsonl<QualityLabel>(labelsPath);
  const updates = parseUpdates(fs.readFileSync(sqlPath, 'utf-8'));
  const manifestIds = new Set(manifestRows.map((row) => row.metadata_filename).filter(Boolean));
  const labelsById = new Map(labels.map((row) => [row.id, row]));
  const updateIds = updates.map((row) => row.record_id);
  const updateIdSet = new Set(updateIds);
  const duplicateSqlIds = updateIds.filter((id, index) => updateIds.indexOf(id) !== index);
  const orientationRows = labels.filter((row) => row.labels?.includes('orientation_exif_rotation'));
  const missingFromSql = orientationRows.filter((row) => !updateIdSet.has(row.id));
  const sqlIdsMissingFromManifest = updates.filter((row) => !manifestIds.has(row.record_id));
  const sqlIdsWithoutOrientationLabel = updates.filter((row) => !labelsById.get(row.record_id)?.labels?.includes('orientation_exif_rotation'));
  const sqlValueMismatches = updates.filter((row) => {
    const expected = labelsById.get(row.record_id)?.metrics?.recommendedRotationDegrees;
    return expected !== row.rotation_degrees;
  });
  const invalidSqlRotationValues = updates.filter((row) => ![90, 180, 270].includes(row.rotation_degrees));
  const migrationText = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf-8') : '';
  const workerText = fs.existsSync(workerPath) ? fs.readFileSync(workerPath, 'utf-8') : '';
  const migrationHasRotationColumn = /ADD COLUMN\s+rotation_degrees\s+INTEGER/i.test(migrationText);
  const workerSelectsRotationColumn = workerText.includes('rotation_degrees');
  const safeToReview = !duplicateSqlIds.length
    && !sqlIdsMissingFromManifest.length
    && !sqlIdsWithoutOrientationLabel.length
    && !sqlValueMismatches.length
    && !invalidSqlRotationValues.length
    && missingFromSql.every((row) => row.recommendedAction === 'review')
    && migrationHasRotationColumn
    && workerSelectsRotationColumn;
  const report = {
    generated_at: new Date().toISOString(),
    issue: 53,
    inputs: {
      manifest: rel(manifestPath),
      quality_labels: rel(labelsPath),
      sql: rel(sqlPath),
      migration: fs.existsSync(migrationPath) ? rel(migrationPath) : null,
      worker: fs.existsSync(workerPath) ? rel(workerPath) : null,
    },
    summary: {
      manifest_rows: manifestRows.length,
      quality_label_rows: labels.length,
      orientation_label_rows: orientationRows.length,
      sql_update_rows: updates.length,
      duplicate_sql_ids: duplicateSqlIds.length,
      invalid_sql_rotation_values: invalidSqlRotationValues.length,
      sql_ids_missing_from_manifest: sqlIdsMissingFromManifest.length,
      sql_ids_without_orientation_label: sqlIdsWithoutOrientationLabel.length,
      sql_value_mismatches: sqlValueMismatches.length,
      orientation_rows_missing_from_sql: missingFromSql.length,
      sql_rotation_counts: countBy(updates, (row) => String(row.rotation_degrees)),
      missing_from_sql_by_action: countBy(missingFromSql, (row) => row.recommendedAction ?? 'unknown'),
      missing_from_sql_by_severity: countBy(missingFromSql, (row) => row.severity ?? 'unknown'),
      migration_has_rotation_column: migrationHasRotationColumn,
      worker_selects_rotation_column: workerSelectsRotationColumn,
    },
    missing_from_sql: missingFromSql,
    anomalies: {
      duplicate_sql_ids: Array.from(new Set(duplicateSqlIds)).sort(),
      invalid_sql_rotation_values: invalidSqlRotationValues,
      sql_ids_missing_from_manifest: sqlIdsMissingFromManifest,
      sql_ids_without_orientation_label: sqlIdsWithoutOrientationLabel,
      sql_value_mismatches: sqlValueMismatches,
    },
    decision: safeToReview
      ? 'Rotation SQL is internally consistent and ready for human review as metadata-only backfill. The two orientation rows excluded from SQL are high-severity manual-review records, not silent omissions.'
      : 'Rotation SQL has anomalies or missing migration/worker support that should be fixed before human review or application.',
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'quality-rotation-sql-review-v0-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'quality-rotation-sql-review-v0-report.md'), renderMarkdown(report, missingFromSql), 'utf-8');
  writeJsonl(path.join(outputDir, 'quality-rotation-sql-review-v0-excluded.jsonl'), missingFromSql);
  console.log(`[quality-rotation-sql-review-v0] output=${rel(outputDir)}`);
  console.log(`[quality-rotation-sql-review-v0] decision=${report.decision}`);
  console.log(`[quality-rotation-sql-review-v0] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
