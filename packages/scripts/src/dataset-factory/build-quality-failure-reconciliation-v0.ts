import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_MANIFEST = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl');
const DEFAULT_FAILURES = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_full_derivatives_14822/derivatives_failures.jsonl',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  MONOREPO_ROOT,
  'data/mtl_archives/reports/quality_repair_v0/kami_failure_reconciliation_v0',
);

type ArchiveRecord = {
  metadata_filename?: string;
  image_filename?: string;
  resolved_image_filename?: string;
  image_size_bytes?: number;
  name?: string;
  external_url?: string;
  portal_record?: Record<string, unknown> | null;
  aerial_matches?: Array<{ record?: Record<string, unknown> }>;
  attributes_map?: Record<string, unknown>;
};

type FailureRow = {
  id: string;
  title?: string;
  imagePath?: string;
  originalImageUrl?: string;
  error?: string;
  generatedAt?: string;
};

type FetchResult = {
  url: string;
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number;
  error: string | null;
  decoded: boolean;
  format: string | null;
  magicKind: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
};

type ReconciliationRow = {
  record_id: string;
  title: string;
  image_path: string;
  manifest_external_url: string | null;
  original_failure_error: string | null;
  expected_size_bytes: number | null;
  r2_probe: FetchResult | null;
  fallback_probe: FetchResult | null;
  fallback_candidates: string[];
  derivative_path: string | null;
  derivative_bytes: number | null;
  derivative_width: number | null;
  derivative_height: number | null;
  classification:
    | 'r2_retry_ok'
    | 'r2_missing_source_reachable'
    | 'r2_pdf_object_document_source'
    | 'non_image_pdf_source'
    | 'source_decode_failed'
    | 'source_unreachable';
  recommended_action:
    | 'clear_failure_after_r2_retry'
    | 'backfill_r2_from_source_url'
    | 'remediate_r2_pdf_object_or_exclude_image_surface'
    | 'document_source_review'
    | 'manual_source_decode_review'
    | 'manual_source_url_review';
  notes: string[];
};

class FetchError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'FetchError';
  }
}

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

function writeJsonl<T>(filePath: string, rows: T[]): void {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function metadataId(record: ArchiveRecord): string {
  return clean(record.metadata_filename);
}

function imagePath(record: ArchiveRecord): string {
  return clean(record.resolved_image_filename || record.image_filename);
}

function title(record: ArchiveRecord, fallback: FailureRow | undefined): string {
  return clean(record.name || fallback?.title || record.metadata_filename);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function sourceUrls(record: ArchiveRecord): string[] {
  const portal = record.portal_record ?? {};
  const urls = [
    record.external_url,
    portal['Fichier jpg - 200 dpi'],
    portal['Fichier jpg - 300 dpi'],
    portal['Fichier tif - 300 dpi'],
    portal['Fichier jpeg - 200 dpi'],
  ];
  for (const match of record.aerial_matches ?? []) {
    for (const value of Object.values(match.record ?? {})) {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.push(value);
    }
  }
  return unique(urls.filter((url): url is string => typeof url === 'string'));
}

function derivativeFileName(id: string): string {
  return `${id.replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_')}.jpg`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function magicKind(buffer: Buffer): string | null {
  if (buffer.subarray(0, 4).toString('utf-8') === '%PDF') return 'pdf';
  if (buffer.subarray(0, 2).toString('hex') === 'ffd8') return 'jpeg';
  if (buffer.subarray(0, 4).toString('hex') === '89504e47') return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'II*\u0000' || buffer.subarray(0, 4).toString('ascii') === 'MM\u0000*') return 'tiff';
  return null;
}

async function fetchBuffer(url: string, timeoutMs: number): Promise<{ buffer: Buffer; status: number; contentType: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'image/*,*/*;q=0.8' } });
    if (!response.ok) throw new FetchError(`HTTP ${response.status}`, response.status);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      status: response.status,
      contentType: response.headers.get('content-type'),
    };
  } catch (error) {
    if (error instanceof FetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new FetchError(message, null);
  } finally {
    clearTimeout(timeout);
  }
}

async function probeUrl(url: string, timeoutMs: number, attempts: number): Promise<{ result: FetchResult; buffer: Buffer | null }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { buffer, status, contentType } = await fetchBuffer(url, timeoutMs);
      const kind = magicKind(buffer);
      if (kind === 'pdf') {
        return {
          buffer,
          result: {
            url,
            ok: true,
            httpStatus: status,
            contentType,
            bytes: buffer.length,
            error: 'PDF source is not an image derivative source',
            decoded: false,
            format: null,
            magicKind: kind,
            width: null,
            height: null,
            orientation: null,
          },
        };
      }
      try {
        const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
        return {
          buffer,
          result: {
            url,
            ok: true,
            httpStatus: status,
            contentType,
            bytes: buffer.length,
            error: null,
            decoded: Boolean(metadata.format),
            format: metadata.format ?? null,
            magicKind: kind,
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            orientation: metadata.orientation ?? null,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          buffer,
          result: {
            url,
            ok: true,
            httpStatus: status,
            contentType,
            bytes: buffer.length,
            error: message,
            decoded: false,
            format: null,
            magicKind: kind,
            width: null,
            height: null,
            orientation: null,
          },
        };
      }
    } catch (error) {
      lastError = error;
      const status = error instanceof FetchError ? error.status : null;
      if (status && status >= 400 && status < 500) break;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown fetch error');
  return {
    buffer: null,
    result: {
      url,
      ok: false,
      httpStatus: lastError instanceof FetchError ? lastError.status : null,
      contentType: null,
      bytes: 0,
      error: message,
      decoded: false,
      format: null,
      magicKind: null,
      width: null,
      height: null,
      orientation: null,
    },
  };
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()));
  return results;
}

function classify(r2: FetchResult | null, fallback: FetchResult | null): Pick<ReconciliationRow, 'classification' | 'recommended_action'> {
  if (r2?.decoded) return { classification: 'r2_retry_ok', recommended_action: 'clear_failure_after_r2_retry' };
  if (fallback?.decoded) return { classification: 'r2_missing_source_reachable', recommended_action: 'backfill_r2_from_source_url' };
  if (r2?.magicKind === 'pdf') return { classification: 'r2_pdf_object_document_source', recommended_action: 'remediate_r2_pdf_object_or_exclude_image_surface' };
  if (r2?.magicKind === 'pdf' || fallback?.magicKind === 'pdf') return { classification: 'non_image_pdf_source', recommended_action: 'document_source_review' };
  if (fallback?.ok && !fallback.decoded) return { classification: 'source_decode_failed', recommended_action: 'manual_source_decode_review' };
  return { classification: 'source_unreachable', recommended_action: 'manual_source_url_review' };
}

function countBy<T>(rows: T[], keyFn: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderMarkdown(report: Record<string, unknown>, rows: ReconciliationRow[]): string {
  const summary = report.summary as Record<string, unknown>;
  const lines = [
    '# Quality Failure Reconciliation v0',
    '',
    `Generated at: ${report.generated_at}`,
    '',
    '## Summary',
    '',
    `- Failure rows: ${summary.failure_rows}`,
    `- R2 retry decoded: ${summary.r2_retry_decoded}`,
    `- Source fallback decoded: ${summary.source_fallback_decoded}`,
    `- Source fallback failed: ${summary.source_fallback_failed}`,
    `- R2 PDF object remediation rows: ${summary.r2_pdf_object_remediation}`,
    `- Local fallback derivatives written: ${summary.derivative_rows}`,
    `- Source MB read: ${summary.source_mb_read}`,
    `- Derivative MB written: ${summary.derivative_mb_written}`,
    '',
    '## Classification',
    '',
    '| Classification | Rows |',
    '|---|---:|',
  ];
  const byClassification = summary.by_classification as Record<string, number>;
  for (const [key, value] of Object.entries(byClassification)) lines.push(`| ${key} | ${value} |`);
  lines.push(
    '',
    '## Backfill Candidates',
    '',
    '| Record | Title | Source | Derivative | Notes |',
    '|---|---|---|---|---|',
  );
  for (const row of rows.filter((item) => item.recommended_action === 'backfill_r2_from_source_url').slice(0, 50)) {
    lines.push(`| ${row.record_id} | ${row.title.replace(/\|/g, '\\|')} | ${row.fallback_probe?.url ?? ''} | ${row.derivative_path ?? ''} | ${row.notes.join('; ').replace(/\|/g, '\\|')} |`);
  }
  const remediationRows = rows.filter((item) => item.recommended_action === 'remediate_r2_pdf_object_or_exclude_image_surface');
  lines.push('', '## R2 PDF Object Remediation', '');
  if (!remediationRows.length) {
    lines.push('No R2 PDF-as-image objects were found.');
  } else {
    lines.push('| Record | Title | R2 URL | Source | Notes |', '|---|---|---|---|---|');
    for (const row of remediationRows) {
      lines.push(`| ${row.record_id} | ${row.title.replace(/\|/g, '\\|')} | ${row.r2_probe?.url ?? ''} | ${row.fallback_probe?.url ?? ''} | ${row.notes.join('; ').replace(/\|/g, '\\|')} |`);
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
    '- This writes local derivative evidence only. It does not upload to R2, mutate D1, or update Vectorize.',
    '- Backfill candidates should be uploaded only after a human confirms the source URL still matches the manifest record.',
    '- R2 PDF-as-image rows are production image-surface remediation candidates. They need R2 replacement, explicit document handling, or image-surface exclusion before claiming production quality repair is complete.',
    '',
  );
  return `${lines.join('\n')}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      manifest: { type: 'string', default: DEFAULT_MANIFEST },
      failures: { type: 'string', default: DEFAULT_FAILURES },
      output: { type: 'string', default: DEFAULT_OUTPUT_DIR },
      concurrency: { type: 'string', default: '2' },
      'fetch-timeout-ms': { type: 'string', default: '90000' },
      'fetch-attempts': { type: 'string', default: '2' },
      width: { type: 'string', default: '1024' },
      height: { type: 'string', default: '1024' },
      quality: { type: 'string', default: '82' },
      'write-derivatives': { type: 'boolean', default: true },
    },
  });

  const manifestPath = resolveRepoPath(values.manifest!);
  const failuresPath = resolveRepoPath(values.failures!);
  const outputDir = resolveRepoPath(values.output!);
  const imageDir = path.join(outputDir, 'images');
  const concurrency = Math.max(1, Number(values.concurrency ?? 2));
  const timeoutMs = Math.max(1000, Number(values['fetch-timeout-ms'] ?? 90000));
  const fetchAttempts = Math.max(1, Number(values['fetch-attempts'] ?? 2));
  const width = Math.max(1, Number(values.width ?? 1024));
  const height = Math.max(1, Number(values.height ?? 1024));
  const quality = Math.max(1, Math.min(100, Number(values.quality ?? 82)));
  const writeDerivatives = Boolean(values['write-derivatives']);

  fs.mkdirSync(imageDir, { recursive: true });
  const manifestRows = readJsonl<ArchiveRecord>(manifestPath);
  const manifestById = new Map(manifestRows.map((row) => [metadataId(row), row]));
  const failureRows = readJsonl<FailureRow>(failuresPath);

  const rows = await runWithConcurrency(failureRows, concurrency, async (failure, index) => {
    const record = manifestById.get(failure.id);
    if (!record) throw new Error(`Missing manifest record for ${failure.id}`);
    const candidates = sourceUrls(record);
    const r2Url = clean(failure.originalImageUrl);
    const r2Probe = r2Url ? await probeUrl(r2Url, timeoutMs, fetchAttempts) : null;
    let fallbackProbe: { result: FetchResult; buffer: Buffer | null } | null = null;
    for (const url of candidates.filter((candidate) => candidate !== r2Url)) {
      const probe = await probeUrl(url, timeoutMs, fetchAttempts);
      fallbackProbe = probe;
      if (probe.result.decoded) break;
    }

    const fallback = fallbackProbe?.result ?? null;
    const classification = classify(r2Probe?.result ?? null, fallback);
    let derivativePath: string | null = null;
    let derivativeBytes: number | null = null;
    let derivativeWidth: number | null = null;
    let derivativeHeight: number | null = null;
    if (writeDerivatives && fallback?.decoded && fallbackProbe?.buffer) {
      const derivative = await sharp(fallbackProbe.buffer, { failOn: 'none' })
        .resize({ width, height, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const derivativeMetadata = await sharp(derivative, { failOn: 'none' }).metadata();
      const outPath = path.join(imageDir, derivativeFileName(failure.id));
      fs.writeFileSync(outPath, derivative);
      derivativePath = rel(outPath);
      derivativeBytes = derivative.length;
      derivativeWidth = derivativeMetadata.width ?? null;
      derivativeHeight = derivativeMetadata.height ?? null;
    }

    const notes = [
      r2Probe?.result.ok ? 'R2 URL fetched during retry.' : `R2 retry failed: ${r2Probe?.result.error ?? 'no R2 URL'}`,
      fallback?.decoded ? `Fallback source decoded as ${fallback.format}.` : `Fallback source did not decode: ${fallback?.error ?? 'no fallback URL'}`,
    ];
    const row: ReconciliationRow = {
      record_id: failure.id,
      title: title(record, failure),
      image_path: imagePath(record),
      manifest_external_url: clean(record.external_url) || null,
      original_failure_error: clean(failure.error) || null,
      expected_size_bytes: typeof record.image_size_bytes === 'number' ? record.image_size_bytes : null,
      r2_probe: r2Probe?.result ?? null,
      fallback_probe: fallback,
      fallback_candidates: candidates,
      derivative_path: derivativePath,
      derivative_bytes: derivativeBytes,
      derivative_width: derivativeWidth,
      derivative_height: derivativeHeight,
      ...classification,
      notes,
    };
    console.log(`[quality-failure-reconciliation-v0] ${index + 1}/${failureRows.length} ${failure.id} ${row.classification}`);
    return row;
  });

  const sourceBytes = rows.reduce((sum, row) => sum + (row.fallback_probe?.bytes ?? 0), 0);
  const derivativeBytes = rows.reduce((sum, row) => sum + (row.derivative_bytes ?? 0), 0);
  const report = {
    generated_at: new Date().toISOString(),
    issue: 53,
    inputs: {
      manifest: rel(manifestPath),
      failures: rel(failuresPath),
    },
    params: {
      concurrency,
      timeoutMs,
      fetchAttempts,
      width,
      height,
      quality,
      writeDerivatives,
    },
    summary: {
      failure_rows: rows.length,
      r2_retry_decoded: rows.filter((row) => row.classification === 'r2_retry_ok').length,
      source_fallback_decoded: rows.filter((row) => row.classification === 'r2_missing_source_reachable').length,
      source_fallback_failed: rows.filter((row) => row.classification === 'source_decode_failed' || row.classification === 'source_unreachable').length,
      r2_pdf_object_remediation: rows.filter((row) => row.classification === 'r2_pdf_object_document_source').length,
      derivative_rows: rows.filter((row) => row.derivative_path).length,
      source_mb_read: Number((sourceBytes / 1e6).toFixed(2)),
      derivative_mb_written: Number((derivativeBytes / 1e6).toFixed(2)),
      by_classification: countBy(rows, (row) => row.classification),
      by_recommended_action: countBy(rows, (row) => row.recommended_action),
    },
    artifacts: {
      rows: 'quality-failure-reconciliation-v0-rows.jsonl',
      backfill_candidates: 'quality-failure-reconciliation-v0-backfill-candidates.jsonl',
      r2_pdf_object_remediation: 'quality-failure-reconciliation-v0-r2-pdf-object-remediation.jsonl',
      report_json: 'quality-failure-reconciliation-v0-report.json',
      report_md: 'quality-failure-reconciliation-v0-report.md',
      images: writeDerivatives ? 'images/' : null,
    },
    decision: rows.every((row) => row.recommended_action === 'backfill_r2_from_source_url')
      ? 'All failed derivative rows are source-reachable outside R2. Treat the 38 failures as R2/object-key backfill candidates, not search-quality demotion candidates.'
      : rows.every((row) => ['backfill_r2_from_source_url', 'document_source_review', 'remediate_r2_pdf_object_or_exclude_image_surface'].includes(row.recommended_action))
        ? 'All failed derivative rows are reconciled: source-reachable image rows are R2/object-key backfill candidates, and remaining PDF-backed rows are production image-surface remediation candidates rather than search-quality demotion candidates.'
      : 'Some failed derivative rows still need manual source URL or decode review before the quality repair issue can be closed.',
  };

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(path.join(outputDir, 'quality-failure-reconciliation-v0-rows.jsonl'), rows);
  writeJsonl(
    path.join(outputDir, 'quality-failure-reconciliation-v0-backfill-candidates.jsonl'),
    rows.filter((row) => row.recommended_action === 'backfill_r2_from_source_url'),
  );
  writeJsonl(
    path.join(outputDir, 'quality-failure-reconciliation-v0-r2-pdf-object-remediation.jsonl'),
    rows.filter((row) => row.recommended_action === 'remediate_r2_pdf_object_or_exclude_image_surface'),
  );
  fs.writeFileSync(path.join(outputDir, 'quality-failure-reconciliation-v0-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outputDir, 'quality-failure-reconciliation-v0-report.md'), renderMarkdown(report, rows), 'utf-8');
  console.log(`[quality-failure-reconciliation-v0] output=${rel(outputDir)}`);
  console.log(`[quality-failure-reconciliation-v0] summary=${JSON.stringify(report.summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
