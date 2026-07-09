import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_PIXEL_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/bounded_pixel_audit_500/quality_report.json',
);
const DEFAULT_PIXEL_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/bounded_pixel_audit_500/quality_labels.jsonl',
);
const DEFAULT_MISSING_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/missing_images_report.json');
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0/full_manifest_coverage_v0');

type ManifestRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  image_exists?: boolean;
  image_size_bytes?: number;
  name?: string;
  external_url?: string;
  attributes_map?: Record<string, unknown>;
  portal_match?: boolean | number | string | null;
  aerial_matches?: unknown[];
};

type PixelQualityRow = {
  id: string;
  audited?: boolean;
  labels?: string[];
  severity?: string;
  recommendedAction?: string;
  confidence?: number;
  metrics?: {
    recommendedRotationDegrees?: number | null;
    cropKeepRatio?: number;
    meanBrightness?: number;
    contrastStd?: number;
  };
  error?: string;
};

type CoverageCandidate = {
  record_id: string;
  image_key: string | null;
  title: string;
  date: string;
  issue_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: Record<string, unknown>;
  recommended_next_step: string;
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
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

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function title(record: ManifestRecord): string {
  return clean(record.name || record.metadata_filename);
}

function dateValue(record: ManifestRecord): string {
  return clean(record.attributes_map?.Date);
}

function metadataId(record: ManifestRecord): string {
  return clean(record.metadata_filename);
}

function imageKey(record: ManifestRecord): string {
  return clean(record.resolved_image_filename || record.image_filename);
}

function sourceFamily(record: ManifestRecord): string {
  const url = clean(record.external_url).toLowerCase();
  const name = clean(record.name).toLowerCase();
  if (url.includes('vues-aeriennes') || url.includes('greffe') || /^vm97/.test(name)) return 'aerial_or_greffe';
  if (url.includes('phototheque')) return 'phototheque';
  if (url) return 'external_other';
  return 'unknown';
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function candidate(
  record: ManifestRecord,
  issueType: string,
  severity: CoverageCandidate['severity'],
  evidence: Record<string, unknown>,
  recommendedNextStep: string,
): CoverageCandidate {
  return {
    record_id: metadataId(record),
    image_key: imageKey(record) || null,
    title: title(record),
    date: dateValue(record),
    issue_type: issueType,
    severity,
    evidence,
    recommended_next_step: recommendedNextStep,
  };
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Quality Coverage v0

Generated at: ${report.generated_at}

## Summary

- Manifest rows: ${report.manifest_rows}
- Records with image key: ${(report.coverage as Record<string, unknown>).records_with_image_key}
- Records with image size: ${(report.coverage as Record<string, unknown>).records_with_image_size}
- Unique image keys: ${(report.coverage as Record<string, unknown>).unique_image_keys}
- Repair candidates: ${report.repair_candidate_rows}
- Output directory: \`${report.output_dir}\`

## Coverage

\`\`\`json
${JSON.stringify(report.coverage, null, 2)}
\`\`\`

## Pixel Audit Evidence

\`\`\`json
${JSON.stringify(report.pixel_audit, null, 2)}
\`\`\`

## Legacy Missing-Image Reconciliation

\`\`\`json
${JSON.stringify(report.legacy_missing_image_report, null, 2)}
\`\`\`

## Decision

${report.decision}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      'pixel-report': { type: 'string', default: DEFAULT_PIXEL_REPORT },
      'pixel-labels': { type: 'string', default: DEFAULT_PIXEL_LABELS },
      'missing-report': { type: 'string', default: DEFAULT_MISSING_REPORT },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const pixelReportPath = resolveRepoPath(values['pixel-report']!);
  const pixelLabelsPath = resolveRepoPath(values['pixel-labels']!);
  const missingReportPath = resolveRepoPath(values['missing-report']!);
  const outputDir = resolveRepoPath(values.output!);

  const records = readJsonl<ManifestRecord>(manifestPath);
  const pixelReport = readJson<Record<string, unknown>>(pixelReportPath);
  const pixelLabels = readJsonl<PixelQualityRow>(pixelLabelsPath);
  const missingReport = readJson<Record<string, unknown>>(missingReportPath);

  const keys = records.map(imageKey).filter(Boolean);
  const keyCounts = countBy(keys, (key) => key);
  const duplicateKeys = Object.entries(keyCounts).filter(([, count]) => count > 1);
  const sizes = records.map((record) => Number(record.image_size_bytes ?? 0)).filter((size) => size > 0);
  const candidates: CoverageCandidate[] = [];

  for (const record of records) {
    const id = metadataId(record);
    if (!id) continue;
    const key = imageKey(record);
    const size = Number(record.image_size_bytes ?? 0);
    if (!key) {
      candidates.push(candidate(record, 'missing_image_key', 'critical', { image_exists: record.image_exists ?? null }, 'recover image key from source metadata before indexing or publishing'));
    }
    if (record.image_exists === false) {
      candidates.push(candidate(record, 'manifest_image_exists_false', 'critical', { image_key: key || null }, 'retry source fetch and R2 upload'));
    }
    if (!size) {
      candidates.push(candidate(record, 'missing_image_size_bytes', 'high', { image_key: key || null }, 'HEAD/GET source image and backfill size after successful decode'));
    } else if (size < 75_000) {
      candidates.push(candidate(record, 'very_small_image_bytes', 'medium', { image_key: key, image_size_bytes: size }, 'review for thumbnail-only, failed derivative, or low-resolution source'));
    }
    if (key && keyCounts[key] > 1) {
      candidates.push(candidate(record, 'duplicate_image_key', 'medium', { image_key: key, duplicate_count: keyCounts[key] }, 'verify whether duplicate key is an intentional record family or leakage risk'));
    }
  }

  for (const row of pixelLabels) {
    if (!row.labels?.length) continue;
    const record = records.find((item) => metadataId(item) === row.id);
    if (!record) continue;
    if (row.labels.includes('orientation_exif_rotation')) {
      candidates.push(candidate(record, 'pixel_audit_orientation_exif_rotation', 'medium', {
        confidence: row.confidence ?? null,
        recommended_rotation_degrees: row.metrics?.recommendedRotationDegrees ?? null,
      }, 'review generated rotation SQL before D1 backfill'));
    }
    if (row.labels.some((label) => /border|crop|washed|contrast|blurry|soft/.test(label))) {
      candidates.push(candidate(record, 'pixel_audit_crop_tone_review', row.severity === 'high' ? 'high' : 'medium', {
        labels: row.labels,
        recommended_action: row.recommendedAction ?? null,
        crop_keep_ratio: row.metrics?.cropKeepRatio ?? null,
        mean_brightness: row.metrics?.meanBrightness ?? null,
        contrast_std: row.metrics?.contrastStd ?? null,
      }, 'keep as review-only; do not apply crop/tone derivative without before-after and benchmark rerun'));
    }
    if (!row.audited) {
      candidates.push(candidate(record, 'pixel_audit_fetch_decode_failure', 'high', {
        labels: row.labels,
        error: row.error ?? null,
      }, 'retry R2/source fetch with lower concurrency and verify object availability'));
    }
  }

  const report = {
    generated_at: datasetFactoryNowIso(),
    issue: 53,
    output_dir: rel(outputDir),
    inputs: {
      manifest: rel(manifestPath),
      pixel_report: fs.existsSync(pixelReportPath) ? rel(pixelReportPath) : null,
      pixel_labels: fs.existsSync(pixelLabelsPath) ? rel(pixelLabelsPath) : null,
      missing_report: fs.existsSync(missingReportPath) ? rel(missingReportPath) : null,
    },
    manifest_rows: records.length,
    repair_candidate_rows: candidates.length,
    coverage: {
      records_with_metadata_id: records.filter((record) => metadataId(record)).length,
      records_with_image_key: keys.length,
      records_with_image_size: sizes.length,
      records_image_exists_true: records.filter((record) => record.image_exists === true).length,
      records_image_exists_false: records.filter((record) => record.image_exists === false).length,
      records_with_external_url: records.filter((record) => clean(record.external_url)).length,
      records_with_portal_match: records.filter((record) => record.portal_match === true || record.portal_match === 1 || record.portal_match === 'true').length,
      unique_image_keys: Object.keys(keyCounts).length,
      duplicate_image_key_groups: duplicateKeys.length,
      duplicate_image_key_records: duplicateKeys.reduce((sum, [, count]) => sum + count, 0),
      image_size_bytes: {
        min: sizes.length ? Math.min(...sizes) : null,
        p10: percentile(sizes, 0.1),
        p50: percentile(sizes, 0.5),
        p90: percentile(sizes, 0.9),
        max: sizes.length ? Math.max(...sizes) : null,
      },
      by_source_family: countBy(records, sourceFamily),
    },
    pixel_audit: pixelReport
      ? {
        summary: pixelReport.summary ?? null,
        params: pixelReport.params ?? null,
        label_counts: pixelReport.label_counts ?? null,
        action_counts: pixelReport.action_counts ?? null,
      }
      : null,
    legacy_missing_image_report: missingReport
      ? {
        generated_at: missingReport.generated_at,
        manifest_input: missingReport.manifest_input,
        total_records: missingReport.total_records,
        missing_records: missingReport.missing_records,
        mismatch: Number(missingReport.total_records ?? 0) !== records.length
          ? `legacy report total ${missingReport.total_records} does not match current manifest total ${records.length}`
          : null,
      }
      : null,
    breakdown: {
      by_issue_type: countBy(candidates, (row) => row.issue_type),
      by_severity: countBy(candidates, (row) => row.severity),
    },
    long_run_pixel_audit_command: 'npm run autoresearch:image-quality -- --input data/mtl_archives/manifest_clean.jsonl --output-dir data/mtl_archives/reports/quality_repair_v0/full_image_quality_audit --limit 14822 --concurrency 2 --fetch-timeout-ms 30000 --fetch-attempts 1',
    decision: 'This is a full-manifest coverage audit, not a full pixel-decode audit. It makes manifest/image-key/source-size risks measurable across all rows and folds in the latest bounded pixel audit where available. Full pixel decoding remains a long-running resumable job.',
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'quality-coverage-v0-repair-candidates.jsonl'), candidates);
  fs.writeFileSync(path.join(outputDir, 'quality-coverage-v0-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'quality-coverage-v0-report.md'), renderMarkdown(report), 'utf-8');

  console.log(`Wrote Quality Coverage v0 to ${rel(outputDir)}`);
  console.log(`- manifest_rows=${records.length}`);
  console.log(`- repair_candidate_rows=${candidates.length}`);
  console.log(`- duplicate_image_key_groups=${report.coverage.duplicate_image_key_groups}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
