import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { datasetFactoryNowIso } from './clock.js';
import { requireArtifacts } from './artifact-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_QUALITY_LABELS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl',
);
const DEFAULT_QUALITY_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_image_quality/quality_report.json',
);
const DEFAULT_CLEANUP_ROWS = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_rows.jsonl',
);
const DEFAULT_CLEANUP_REPORT = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_report.json',
);
const DEFAULT_MISSING_ROWS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/missing_images.jsonl');
const DEFAULT_MISSING_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/missing_images_report.json');
const DEFAULT_ORIENTATION_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_orientation_audit.json');
const DEFAULT_ORIENTATION_SQL = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_orientation_updates.sql');
const DEFAULT_ARTIFACT_REPORT = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_artifact_audit.json');
const DEFAULT_ARTIFACT_DECISIONS = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/image_artifact_decisions.ndjson');
const DEFAULT_SEARCH_BASELINE = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_baseline_current.json',
);
const DEFAULT_OUTPUT_DIR = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/quality_repair_v0');

type Severity = 'none' | 'low' | 'medium' | 'high';
type RepairPriority = 'critical' | 'high' | 'medium' | 'low';
type RepairAction =
  | 'rotate_metadata_backfill'
  | 'manual_crop_tone_review'
  | 'fetch_decode_retry'
  | 'border_crop_review'
  | 'rank_or_index_guardrail'
  | 'no_action';
type SafeBackfill = 'yes' | 'no' | 'review_only';

type QualityLabel = {
  id: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  source?: string;
  audited?: boolean;
  labels?: string[];
  severity?: Severity;
  recommendedAction?: string;
  confidence?: number;
  dimensions?: { width: number | null; height: number | null };
  metrics?: {
    cropKeepRatio?: number;
    borderPx?: Record<string, number>;
    exifOrientation?: number | null;
    recommendedRotationDegrees?: number | null;
    meanBrightness?: number;
    contrastStd?: number;
    edgeEnergy?: number;
    darkFraction?: number;
    lightFraction?: number;
  };
  notes?: string[];
  error?: string;
};

type CleanupRow = {
  id: string;
  title?: string;
  date?: string;
  imageUrl?: string;
  imagePath?: string;
  labels?: string[];
  cleanupMethod?: string;
  originalPath?: string;
  cleanedPath?: string;
  cropKeepRatio?: number;
  embeddingCosine?: number;
  embeddingShift?: number;
  categoryBefore?: string;
  categoryAfter?: string;
  categoryChanged?: boolean;
  recommendation?: string;
};

type MissingImageRow = {
  dataset?: string;
  primary_external_url?: string;
  primary_file_url_key?: string;
  external_urls?: string[];
  record?: Record<string, unknown>;
};

type ArtifactDecisionRow = {
  id?: string;
  imageUrl?: string;
  imageKey?: string;
  actions?: string[];
  metrics?: {
    cropAreaRatio?: number;
    borderPx?: Record<string, number>;
    headerRows?: number;
    footerRows?: number;
  };
};

type RepairQueueRow = {
  queue_id: string;
  record_id: string;
  title: string;
  date: string;
  image_url: string | null;
  image_path: string | null;
  priority: RepairPriority;
  recommended_action: RepairAction;
  safe_backfill: SafeBackfill;
  evidence_sources: string[];
  labels: string[];
  confidence: number;
  reason: string;
  metrics: {
    severity: string | null;
    crop_keep_ratio: number | null;
    embedding_cosine: number | null;
    embedding_shift: number | null;
    category_changed: boolean | null;
    audited: boolean | null;
  };
  review: {
    before_path: string | null;
    after_path: string | null;
    notes: string[];
  };
};

function resolveRepoPath(input: string): string {
  return path.isAbsolute(input) ? input : path.resolve(MONOREPO_ROOT, input);
}

function rel(filePath: string): string {
  return path.relative(MONOREPO_ROOT, filePath);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
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

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function htmlEscape(value: unknown): string {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pathForHtml(outputDir: string, maybePath: string | null): string | null {
  if (!maybePath) return null;
  if (/^https?:\/\//.test(maybePath)) return maybePath;
  const absolutePath = resolveRepoPath(maybePath);
  return path.relative(outputDir, absolutePath).replaceAll(path.sep, '/');
}

function firstRecordValue(record: Record<string, unknown> | undefined, keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return '';
}

function severityRank(severity: string | undefined): number {
  if (severity === 'high') return 4;
  if (severity === 'medium') return 3;
  if (severity === 'low') return 2;
  return 1;
}

function priorityRank(priority: RepairPriority): number {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function actionFromQuality(row: QualityLabel): RepairAction {
  const labels = new Set(row.labels ?? []);
  if (labels.has('image_fetch_or_decode_failure') || labels.has('image_fetch_network_failure')) return 'fetch_decode_retry';
  if (labels.has('unsafe_crop_candidate') || labels.has('border_heavy') || labels.has('washed_out_scan')) return 'manual_crop_tone_review';
  if (labels.has('border_light')) return 'border_crop_review';
  if (labels.has('orientation_exif_rotation') || row.recommendedAction === 'rotate') return 'rotate_metadata_backfill';
  if (row.recommendedAction === 'lower_rank') return 'rank_or_index_guardrail';
  return 'no_action';
}

function priorityFromQuality(row: QualityLabel, action: RepairAction): RepairPriority {
  const labels = new Set(row.labels ?? []);
  if (action === 'fetch_decode_retry' || row.recommendedAction === 'exclude_until_fixed') return 'critical';
  if (row.severity === 'high' || labels.has('unsafe_crop_candidate')) return 'high';
  if (row.severity === 'medium' || action === 'rotate_metadata_backfill') return 'medium';
  return 'low';
}

function safeBackfillFor(row: QualityLabel, action: RepairAction): SafeBackfill {
  if (action === 'rotate_metadata_backfill' && row.audited && (row.confidence ?? 0) >= 0.8) return 'review_only';
  if (action === 'fetch_decode_retry') return 'no';
  if (action === 'no_action') return 'yes';
  return 'review_only';
}

function mergeQueueRows(base: RepairQueueRow, incoming: RepairQueueRow): RepairQueueRow {
  const priority = priorityRank(incoming.priority) > priorityRank(base.priority) ? incoming.priority : base.priority;
  const safeBackfill: SafeBackfill = base.safe_backfill === 'no' || incoming.safe_backfill === 'no'
    ? 'no'
    : base.safe_backfill === 'review_only' || incoming.safe_backfill === 'review_only'
      ? 'review_only'
      : 'yes';
  return {
    ...base,
    priority,
    recommended_action: base.recommended_action === 'no_action' ? incoming.recommended_action : base.recommended_action,
    safe_backfill: safeBackfill,
    evidence_sources: unique([...base.evidence_sources, ...incoming.evidence_sources]),
    labels: unique([...base.labels, ...incoming.labels]),
    confidence: Math.max(base.confidence, incoming.confidence),
    reason: unique([base.reason, incoming.reason]).join(' | '),
    metrics: {
      severity: severityRank(clean(incoming.metrics.severity)) > severityRank(clean(base.metrics.severity))
        ? incoming.metrics.severity
        : base.metrics.severity,
      crop_keep_ratio: base.metrics.crop_keep_ratio ?? incoming.metrics.crop_keep_ratio,
      embedding_cosine: base.metrics.embedding_cosine ?? incoming.metrics.embedding_cosine,
      embedding_shift: base.metrics.embedding_shift ?? incoming.metrics.embedding_shift,
      category_changed: base.metrics.category_changed ?? incoming.metrics.category_changed,
      audited: base.metrics.audited ?? incoming.metrics.audited,
    },
    review: {
      before_path: base.review.before_path ?? incoming.review.before_path,
      after_path: base.review.after_path ?? incoming.review.after_path,
      notes: unique([...base.review.notes, ...incoming.review.notes]),
    },
  };
}

function queueRowFromQuality(row: QualityLabel, index: number): RepairQueueRow {
  const action = actionFromQuality(row);
  const labels = row.labels ?? [];
  const reason = [
    labels.length ? `labels=${labels.join(',')}` : '',
    row.error ? `error=${row.error}` : '',
    row.notes?.slice(0, 2).join('; ') ?? '',
  ].filter(Boolean).join('; ');
  return {
    queue_id: `quality-repair-v0-quality-${String(index + 1).padStart(5, '0')}`,
    record_id: row.id,
    title: clean(row.title || row.id),
    date: clean(row.date),
    image_url: row.imageUrl ?? null,
    image_path: row.imagePath ?? null,
    priority: priorityFromQuality(row, action),
    recommended_action: action,
    safe_backfill: safeBackfillFor(row, action),
    evidence_sources: ['autoresearch_image_quality'],
    labels,
    confidence: clamp01(row.confidence ?? 0.5),
    reason: reason || 'Quality audit row selected for repair planning.',
    metrics: {
      severity: row.severity ?? null,
      crop_keep_ratio: row.metrics?.cropKeepRatio ?? null,
      embedding_cosine: null,
      embedding_shift: null,
      category_changed: null,
      audited: row.audited ?? null,
    },
    review: {
      before_path: null,
      after_path: null,
      notes: row.notes ?? [],
    },
  };
}

function queueRowFromCleanup(row: CleanupRow, index: number): RepairQueueRow {
  const action: RepairAction = row.recommendation === 'manual_review' || row.categoryChanged
    ? 'manual_crop_tone_review'
    : 'border_crop_review';
  return {
    queue_id: `quality-repair-v0-cleanup-${String(index + 1).padStart(5, '0')}`,
    record_id: row.id,
    title: clean(row.title || row.id),
    date: clean(row.date),
    image_url: row.imageUrl ?? null,
    image_path: row.imagePath ?? null,
    priority: row.recommendation === 'manual_review' || row.categoryChanged ? 'high' : 'medium',
    recommended_action: action,
    safe_backfill: 'review_only',
    evidence_sources: ['autoresearch_cleanup_embedding'],
    labels: row.labels ?? [],
    confidence: row.embeddingCosine === undefined ? 0.65 : clamp01(row.embeddingCosine),
    reason: `cleanup=${row.cleanupMethod ?? 'unknown'}; recommendation=${row.recommendation ?? 'unknown'}; embedding_shift=${row.embeddingShift ?? 'unknown'}; category=${row.categoryBefore ?? 'unknown'}>${row.categoryAfter ?? 'unknown'}`,
    metrics: {
      severity: row.recommendation === 'manual_review' || row.categoryChanged ? 'high' : 'medium',
      crop_keep_ratio: row.cropKeepRatio ?? null,
      embedding_cosine: row.embeddingCosine ?? null,
      embedding_shift: row.embeddingShift ?? null,
      category_changed: row.categoryChanged ?? null,
      audited: true,
    },
    review: {
      before_path: row.originalPath ?? null,
      after_path: row.cleanedPath ?? null,
      notes: [
        `category_before=${row.categoryBefore ?? 'unknown'}`,
        `category_after=${row.categoryAfter ?? 'unknown'}`,
        `recommendation=${row.recommendation ?? 'unknown'}`,
      ],
    },
  };
}

function queueRowFromMissing(row: MissingImageRow, index: number): RepairQueueRow {
  const title = firstRecordValue(row.record, ['Cote/Titre', 'Titre', 'title', 'name']) || `missing-image-${index + 1}`;
  const date = firstRecordValue(row.record, ['Dates', 'Date', 'date']);
  const id = row.record?._id === undefined
    ? `missing-${clean(row.dataset || 'unknown')}-${index + 1}`
    : `open-data-${clean(row.dataset || 'unknown')}-${clean(row.record._id)}`;
  return {
    queue_id: `quality-repair-v0-missing-${String(index + 1).padStart(5, '0')}`,
    record_id: id,
    title,
    date,
    image_url: row.primary_external_url ?? row.external_urls?.[0] ?? null,
    image_path: null,
    priority: 'critical',
    recommended_action: 'fetch_decode_retry',
    safe_backfill: 'no',
    evidence_sources: ['missing_images_report'],
    labels: ['missing_r2_or_manifest_image'],
    confidence: 0.9,
    reason: `Missing image candidate from dataset=${row.dataset ?? 'unknown'} via ${row.primary_file_url_key ?? 'unknown_url_field'}.`,
    metrics: {
      severity: 'high',
      crop_keep_ratio: null,
      embedding_cosine: null,
      embedding_shift: null,
      category_changed: null,
      audited: false,
    },
    review: {
      before_path: null,
      after_path: null,
      notes: ['Retry source fetch/decode before any index or product decision.'],
    },
  };
}

function buildQueue(
  qualityRows: QualityLabel[],
  cleanupRows: CleanupRow[],
  missingRows: MissingImageRow[],
  maxQueue: number,
): RepairQueueRow[] {
  const rowsById = new Map<string, RepairQueueRow>();
  const candidates = [
    ...qualityRows
      .filter((row) => row.id && row.recommendedAction !== 'none')
      .map((row, index) => queueRowFromQuality(row, index)),
    ...cleanupRows
      .filter((row) => row.id)
      .map((row, index) => queueRowFromCleanup(row, index)),
    ...missingRows
      .slice(0, Math.max(0, maxQueue))
      .map((row, index) => queueRowFromMissing(row, index)),
  ];

  for (const row of candidates) {
    const existing = rowsById.get(row.record_id);
    rowsById.set(row.record_id, existing ? mergeQueueRows(existing, row) : row);
  }

  const sortedRows = Array.from(rowsById.values())
    .sort((a, b) => {
      const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDiff) return priorityDiff;
      const severityDiff = severityRank(clean(b.metrics.severity)) - severityRank(clean(a.metrics.severity));
      if (severityDiff) return severityDiff;
      return a.record_id.localeCompare(b.record_id);
    });

  const quotas: Array<[RepairAction, number]> = [
    ['fetch_decode_retry', Math.max(40, Math.floor(maxQueue * 0.38))],
    ['rotate_metadata_backfill', Math.max(40, Math.floor(maxQueue * 0.28))],
    ['manual_crop_tone_review', Math.max(30, Math.floor(maxQueue * 0.22))],
    ['border_crop_review', Math.max(20, Math.floor(maxQueue * 0.08))],
    ['rank_or_index_guardrail', Math.max(10, Math.floor(maxQueue * 0.02))],
    ['no_action', Math.max(0, Math.floor(maxQueue * 0.02))],
  ];

  const selected = new Map<string, RepairQueueRow>();
  for (const [action, quota] of quotas) {
    for (const row of sortedRows.filter((candidate) => candidate.recommended_action === action).slice(0, quota)) {
      selected.set(row.record_id, row);
    }
  }
  for (const row of sortedRows) {
    if (selected.size >= maxQueue) break;
    selected.set(row.record_id, row);
  }

  return Array.from(selected.values())
    .sort((a, b) => {
      const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDiff) return priorityDiff;
      const severityDiff = severityRank(clean(b.metrics.severity)) - severityRank(clean(a.metrics.severity));
      if (severityDiff) return severityDiff;
      const actionDiff = a.recommended_action.localeCompare(b.recommended_action);
      if (actionDiff) return actionDiff;
      return a.record_id.localeCompare(b.record_id);
    })
    .map((row, index) => ({ ...row, queue_id: `quality-repair-v0-${String(index + 1).padStart(5, '0')}` }));
}

function safeSqlFromOrientation(orientationSqlPath: string): string[] {
  if (!fs.existsSync(orientationSqlPath)) return [];
  const statements = fs.readFileSync(orientationSqlPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^UPDATE\s/i.test(line));
  return statements;
}

function safeSqlFromQualityRows(qualityRows: QualityLabel[], fullQualityAudit: boolean): string[] {
  if (!fullQualityAudit) return [];
  const statements: string[] = [];
  for (const row of qualityRows) {
    const rotation = row.metrics?.recommendedRotationDegrees;
    if (
      row.audited
      && row.labels?.includes('orientation_exif_rotation')
      && row.recommendedAction === 'rotate'
      && typeof rotation === 'number'
      && [90, 180, 270].includes(rotation)
      && (row.confidence ?? 0) >= 0.8
    ) {
      statements.push(
        `UPDATE manifest SET rotation_degrees=${rotation} WHERE metadata_filename='${row.id.replace(/'/g, "''")}';`,
      );
    }
  }
  return statements;
}

function renderBackfillSql(report: Record<string, unknown>, safeUpdates: string[]): string {
  const header = [
    '-- Quality Repair v0 conservative backfill plan.',
    `-- Generated at: ${report.generated_at}`,
    '-- This file is intentionally safe-by-default. Review before applying to D1 or any production index.',
    `-- Queue rows: ${report.repair_queue_rows}`,
    `-- Safe orientation UPDATE statements imported: ${safeUpdates.length}`,
    '',
    'BEGIN TRANSACTION;',
    '',
  ];
  const body = safeUpdates.length
    ? [
      '-- Imported orientation updates from the existing orientation audit.',
      '-- Apply only after verifying the source audit covered the intended records.',
      ...safeUpdates,
    ]
    : [
      '-- No UPDATE statements emitted.',
      '-- Current orientation audit does not contain safe full-dataset rotation updates.',
      '-- Crop, tone, and derivative-image changes are review-only until before/after checks pass.',
      '-- Fetch/decode retries should run through ingestion tooling before any D1/image_url backfill.',
    ];
  return [...header, ...body, '', 'COMMIT;', ''].join('\n');
}

function renderReviewSheet(outputDir: string, rows: RepairQueueRow[], report: Record<string, unknown>): string {
  const visibleRows = rows
    .filter((row) => row.review.before_path || row.review.after_path || row.image_url)
    .slice(0, 80);
  const cards = visibleRows.map((row) => {
    const before = pathForHtml(outputDir, row.review.before_path) ?? row.image_url;
    const after = pathForHtml(outputDir, row.review.after_path);
    const notes = row.review.notes.map((note) => `<li>${htmlEscape(note)}</li>`).join('');
    return `<article class="card">
  <header>
    <div>
      <h2>${htmlEscape(row.title)}</h2>
      <p>${htmlEscape(row.record_id)} ${row.date ? `· ${htmlEscape(row.date)}` : ''}</p>
    </div>
    <span class="priority ${htmlEscape(row.priority)}">${htmlEscape(row.priority)}</span>
  </header>
  <div class="meta">
    <span>${htmlEscape(row.recommended_action)}</span>
    <span>${htmlEscape(row.safe_backfill)}</span>
    <span>${htmlEscape(row.labels.join(', ') || 'no labels')}</span>
  </div>
  <div class="images">
    <figure>
      ${before ? `<img src="${htmlEscape(before)}" alt="Before or source image for ${htmlEscape(row.record_id)}">` : '<div class="missing">No source image</div>'}
      <figcaption>Before / source</figcaption>
    </figure>
    <figure>
      ${after ? `<img src="${htmlEscape(after)}" alt="After candidate image for ${htmlEscape(row.record_id)}">` : '<div class="missing">No after image</div>'}
      <figcaption>After candidate</figcaption>
    </figure>
  </div>
  <p>${htmlEscape(row.reason)}</p>
  <ul>${notes}</ul>
</article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quality Repair v0 Review Sheet</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f1ea; color: #191715; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .stat { border: 1px solid #d8d1c6; background: #fffaf2; padding: 14px; border-radius: 8px; }
    .stat strong { display: block; font-size: 24px; }
    .card { border-top: 1px solid #ccc3b6; padding: 24px 0; }
    header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
    h2 { margin: 0; font-size: 20px; }
    p { line-height: 1.45; }
    header p { margin: 4px 0 0; color: #625b52; }
    .priority { border: 1px solid #1f2937; padding: 4px 8px; border-radius: 999px; text-transform: uppercase; font-size: 12px; }
    .critical { background: #3f1d1b; color: #fff; }
    .high { background: #8e3d24; color: #fff; }
    .medium { background: #f1c46b; color: #191715; }
    .low { background: #dbe7d5; color: #191715; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .meta span { background: #fffaf2; border: 1px solid #d8d1c6; border-radius: 999px; padding: 4px 8px; font-size: 13px; }
    .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 16px 0; }
    figure { margin: 0; background: #fffaf2; border: 1px solid #d8d1c6; border-radius: 8px; overflow: hidden; }
    img { display: block; width: 100%; height: 320px; object-fit: contain; background: #211f1c; }
    figcaption { padding: 8px 10px; color: #625b52; font-size: 13px; }
    .missing { height: 320px; display: grid; place-items: center; color: #625b52; }
    ul { margin: 0; padding-left: 20px; color: #3d3832; }
  </style>
</head>
<body>
  <main>
    <h1>Quality Repair v0 Review Sheet</h1>
    <p>Generated at ${htmlEscape(report.generated_at)}. This sheet is for human review before image derivatives, D1 backfills, or re-indexing.</p>
    <section class="summary">
      <div class="stat"><strong>${htmlEscape(report.repair_queue_rows)}</strong><span>repair queue rows</span></div>
      <div class="stat"><strong>${htmlEscape(report.review_sheet_rows)}</strong><span>visual review rows</span></div>
      <div class="stat"><strong>${htmlEscape(report.safe_sql_updates)}</strong><span>safe SQL updates emitted</span></div>
      <div class="stat"><strong>${htmlEscape(report.full_audit_ready)}</strong><span>full-audit ready</span></div>
    </section>
    ${cards}
  </main>
</body>
</html>`;
}

function renderMarkdown(report: Record<string, unknown>): string {
  return `# Quality Repair v0 Report

Generated at: ${report.generated_at}

## Summary

- Repair queue rows: ${report.repair_queue_rows}
- Review sheet rows: ${report.review_sheet_rows}
- Safe SQL updates emitted: ${report.safe_sql_updates}
- Full audit ready: ${report.full_audit_ready}
- Output directory: \`${report.output_dir}\`

## Input Coverage

\`\`\`json
${JSON.stringify(report.input_coverage, null, 2)}
\`\`\`

## Queue Breakdown

\`\`\`json
${JSON.stringify(report.queue_breakdown, null, 2)}
\`\`\`

## Benchmark Guardrail

\`\`\`json
${JSON.stringify(report.benchmark_guardrail, null, 2)}
\`\`\`

## Decision

${report.decision}

## Caveats

${(report.caveats as string[]).map((line) => `- ${line}`).join('\n')}
`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'quality-labels': { type: 'string', default: DEFAULT_QUALITY_LABELS },
      'quality-report': { type: 'string', default: DEFAULT_QUALITY_REPORT },
      'cleanup-rows': { type: 'string', default: DEFAULT_CLEANUP_ROWS },
      'cleanup-report': { type: 'string', default: DEFAULT_CLEANUP_REPORT },
      'missing-rows': { type: 'string', default: DEFAULT_MISSING_ROWS },
      'missing-report': { type: 'string', default: DEFAULT_MISSING_REPORT },
      'orientation-report': { type: 'string', default: DEFAULT_ORIENTATION_REPORT },
      'orientation-sql': { type: 'string', default: DEFAULT_ORIENTATION_SQL },
      'artifact-report': { type: 'string', default: DEFAULT_ARTIFACT_REPORT },
      'artifact-decisions': { type: 'string', default: DEFAULT_ARTIFACT_DECISIONS },
      'search-baseline': { type: 'string', default: DEFAULT_SEARCH_BASELINE },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      'max-queue': { type: 'string', default: '500' },
    },
  });

  const outputDir = resolveRepoPath(values.output!);
  const maxQueue = Number.parseInt(values['max-queue']!, 10);
  if (!Number.isFinite(maxQueue) || maxQueue <= 0) {
    throw new Error(`--max-queue must be a positive integer, received ${values['max-queue']}`);
  }

  const qualityLabelsPath = resolveRepoPath(values['quality-labels']!);
  const cleanupRowsPath = resolveRepoPath(values['cleanup-rows']!);
  const missingRowsPath = resolveRepoPath(values['missing-rows']!);
  const orientationSqlPath = resolveRepoPath(values['orientation-sql']!);
  const artifactDecisionsPath = resolveRepoPath(values['artifact-decisions']!);
  requireArtifacts([
    { path: qualityLabelsPath, label: 'image-quality labels' },
    { path: resolveRepoPath(values['quality-report']!), label: 'image-quality report' },
    { path: cleanupRowsPath, label: 'cleanup embedding rows' },
    { path: resolveRepoPath(values['cleanup-report']!), label: 'cleanup embedding report' },
    { path: missingRowsPath, label: 'missing-image rows' },
    { path: resolveRepoPath(values['missing-report']!), label: 'missing-image report' },
    { path: resolveRepoPath(values['orientation-report']!), label: 'orientation audit report' },
    { path: orientationSqlPath, label: 'orientation SQL review input' },
    { path: resolveRepoPath(values['artifact-report']!), label: 'image artifact audit report' },
    { path: artifactDecisionsPath, label: 'image artifact decisions' },
    { path: resolveRepoPath(values['search-baseline']!), label: 'benchmark search baseline report' },
  ]);

  const qualityRows = readJsonl<QualityLabel>(qualityLabelsPath);
  const cleanupRows = readJsonl<CleanupRow>(cleanupRowsPath);
  const missingRows = readJsonl<MissingImageRow>(missingRowsPath);
  const artifactDecisions = readJsonl<ArtifactDecisionRow>(artifactDecisionsPath);

  const qualityReport = readJson<Record<string, unknown>>(resolveRepoPath(values['quality-report']!));
  const cleanupReport = readJson<Record<string, unknown>>(resolveRepoPath(values['cleanup-report']!));
  const missingReport = readJson<Record<string, unknown>>(resolveRepoPath(values['missing-report']!));
  const orientationReport = readJson<Record<string, unknown>>(resolveRepoPath(values['orientation-report']!));
  const artifactReport = readJson<Record<string, unknown>>(resolveRepoPath(values['artifact-report']!));
  const searchBaseline = readJson<Record<string, unknown>>(resolveRepoPath(values['search-baseline']!));

  fs.mkdirSync(outputDir, { recursive: true });

  const qualitySummary = qualityReport?.summary as { input_rows?: unknown; sample_rows?: unknown; audited?: unknown } | undefined;
  const inputRows = Number(qualitySummary?.input_rows ?? 0);
  const sampleRows = Number(qualitySummary?.sample_rows ?? 0);
  const auditedRows = Number(qualitySummary?.audited ?? 0);
  const fullQualityAudit = inputRows > 0 && sampleRows >= inputRows && qualityRows.length >= inputRows;
  const queue = buildQueue(qualityRows, cleanupRows, missingRows, maxQueue);
  const safeUpdates = unique([
    ...safeSqlFromOrientation(orientationSqlPath),
    ...safeSqlFromQualityRows(qualityRows, fullQualityAudit),
  ]);
  const reviewSheetRows = queue.filter((row) => row.review.before_path || row.review.after_path || row.image_url).length;
  const fullAuditReady = fullQualityAudit && auditedRows > 0;

  const report = {
    generated_at: datasetFactoryNowIso(),
    issue: 53,
    output_dir: rel(outputDir),
    repair_queue_rows: queue.length,
    review_sheet_rows: Math.min(80, reviewSheetRows),
    safe_sql_updates: safeUpdates.length,
    full_audit_ready: fullAuditReady,
    inputs: {
      quality_labels: rel(qualityLabelsPath),
      cleanup_rows: rel(cleanupRowsPath),
      missing_rows: rel(missingRowsPath),
      artifact_decisions: rel(artifactDecisionsPath),
    },
    input_coverage: {
      quality_report_summary: qualityReport?.summary ?? null,
      quality_report_params: qualityReport?.params ?? null,
      full_quality_audit: fullQualityAudit
        ? {
          covers: ['fetch_decode', 'exif_orientation', 'border_crop', 'template_bands', 'tone_contrast', 'soft_blur', 'resolution'],
          input_rows: inputRows,
          emitted_rows: qualityRows.length,
          audited_rows: auditedRows,
        }
        : null,
      cleanup_report_summary: cleanupReport?.summary ?? null,
      missing_report_summary: missingReport
        ? {
          total_records: missingReport.total_records,
          missing_records: missingReport.missing_records,
          datasets: missingReport.datasets,
        }
        : null,
      orientation_audit: orientationReport
        ? {
          scanned: orientationReport.scanned,
          processed: orientationReport.processed,
          skipped: orientationReport.skipped,
          recommended: orientationReport.recommended,
          generatedAt: orientationReport.generatedAt,
        }
        : null,
      artifact_audit: artifactReport
        ? {
          params: artifactReport.params,
          counts: artifactReport.counts,
          generatedAt: artifactReport.generatedAt,
        }
        : null,
      artifact_decisions: artifactDecisions.length,
    },
    queue_breakdown: {
      by_priority: countBy(queue, (row) => row.priority),
      by_action: countBy(queue, (row) => row.recommended_action),
      by_safe_backfill: countBy(queue, (row) => row.safe_backfill),
      by_evidence_source: countBy(queue.flatMap((row) => row.evidence_sources), (source) => source),
      top_labels: Object.entries(countBy(queue.flatMap((row) => row.labels), (label) => label))
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20),
    },
    benchmark_guardrail: searchBaseline
      ? {
        benchmark_id: searchBaseline.benchmark_id,
        baseline_id: searchBaseline.baseline_id,
        generated_at: searchBaseline.generated_at,
        aggregate: searchBaseline.aggregate,
        policy: 'No quality transform should be promoted unless this benchmark is rerun on the transformed derivative/index and does not regress retrieval/provenance slices.',
      }
      : null,
    decision: fullAuditReady
      ? 'Quality Repair v0 has full-dataset audit coverage for fetch/decode, EXIF orientation, border/crop, tone/contrast, blur, and resolution. Safe EXIF rotation metadata updates may be reviewed; crop, tone, and derivative-image changes remain review-only until benchmark reruns pass.'
      : 'Do not close the loop as a full repair yet: current evidence supports a prioritized repair queue and review sheet, but not blind full-dataset cleanup or production backfill.',
    caveats: fullAuditReady
      ? [
        'Full audit coverage means every manifest row emitted a quality label row; some rows can still be unaudited because fetch/decode failed and are queued for retry.',
        'Only EXIF-derived rotation metadata can produce conservative SQL. Crop, tone, border, and derivative changes remain review-only.',
        'Cleanup embedding experiment covered 12 before/after pairs and found category changes on some rows; derivatives need human review plus benchmark reruns.',
        'Missing-image counts are from an older 13,499-record manifest and should be reconciled against the current 14,822-row dev manifest before treating source coverage as final.',
      ]
      : [
        'Existing image-quality evidence is a 700-row sample, not a full 14,822-row pixel audit.',
        'The existing orientation audit scanned 2 records and emitted no safe UPDATE statements.',
        'The artifact audit was a 200-candidate run with 190 fetch failures, so it is not a reliable full artifact pass.',
        'Cleanup embedding experiment covered 12 before/after pairs and found category changes on some rows; derivatives need human review plus benchmark reruns.',
        'Missing-image counts are from an older 13,499-record manifest and should be reconciled against the current 14,822-row dev manifest before treating coverage as final.',
      ],
  };

  const queuePath = path.join(outputDir, 'quality-repair-v0-review-queue.jsonl');
  const reportJsonPath = path.join(outputDir, 'quality-repair-v0-report.json');
  const reportMdPath = path.join(outputDir, 'quality-repair-v0-report.md');
  const backfillPath = path.join(outputDir, 'quality-repair-v0-backfill.sql');
  const reviewSheetPath = path.join(outputDir, 'quality-repair-v0-review-sheet.html');

  writeJsonl(queuePath, queue);
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(reportMdPath, renderMarkdown(report), 'utf-8');
  fs.writeFileSync(backfillPath, renderBackfillSql(report, safeUpdates), 'utf-8');
  fs.writeFileSync(reviewSheetPath, renderReviewSheet(outputDir, queue, report), 'utf-8');

  console.log(`Wrote Quality Repair v0 to ${rel(outputDir)}`);
  console.log(`- repair_queue_rows=${queue.length}`);
  console.log(`- safe_sql_updates=${safeUpdates.length}`);
  console.log(`- full_audit_ready=${fullAuditReady}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
