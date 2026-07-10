import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ALIAS_GROUP_REASON,
  RIGHTS_LICENSE_ID,
  RIGHTS_NOTES,
  deriveSourceDataset,
  type LocalInventoryRow,
} from '../canonical-corpus-v1/model.js';
import { datasetFactoryNowIso } from '../dataset-factory/clock.js';
import {
  CANONICAL_CORPUS_SNAPSHOT_ID,
  CANONICAL_COUNTS,
  CANONICAL_LOCAL_SHA256,
  VFG_SCHEMA_VERSION,
  clean,
  fileEvidence,
  normalizeRecordId,
  normalizeSourceUrl,
  numericRecordId,
  readJson,
  readJsonl,
  sha256,
  stableJson,
  stableId,
  unique,
  writeJson,
  writeJsonl,
  type CorpusInputRow,
} from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_LOCAL = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/canonical_local/local-manifest.jsonl');
const DEFAULT_RAW = path.join(ROOT, 'data/mtl_archives/manifest_clean.jsonl.gz');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1/input');
const DEFAULT_API = 'https://mtl-archives-worker.wiel.workers.dev';

type SitemapItem = { id?: string; imageUrl?: string; name?: string | null; dateValue?: string | null };
type PhotoItem = {
  metadataFilename?: string;
  imageFilename?: string;
  resolvedImageFilename?: string;
  imageUrl?: string;
  name?: string | null;
  description?: string | null;
  dateValue?: string | null;
  cote?: string | null;
  externalUrl?: string | null;
  credits?: string | null;
};

type DetailCacheRow = { record_id: string; item: PhotoItem };

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function repoEvidence(filePath: string, rowCount?: number): Record<string, unknown> {
  return { ...fileEvidence(filePath, rowCount), path: path.relative(ROOT, filePath).split(path.sep).join('/') };
}

function readRawDates(filePath: string): Map<string, string> {
  const bytes = fs.readFileSync(filePath);
  const text = filePath.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const result = new Map<string, string>();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    const id = normalizeRecordId(row.metadata_filename);
    if (!id) throw new Error(`${filePath}:${index + 1}: missing metadata identity`);
    const attributes = (row.attributes_map ?? {}) as Record<string, unknown>;
    result.set(id, clean(row.date_value ?? attributes.Date));
  }
  return result;
}

function safePublicImageUrl(value: unknown, expectedHost?: string): string {
  const text = clean(value);
  if (!text) return '';
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error(`Image URL is not HTTPS for host ${url.hostname}`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`Image URL contains forbidden credentials, query, or fragment for host ${url.hostname}`);
  if (expectedHost && url.hostname !== expectedHost) throw new Error(`Image URL host drift: ${url.hostname}`);
  return url.toString();
}

async function fetchJson<T>(url: URL, timeoutMs: number, attempts = 3): Promise<T> {
  let last = 'unknown failure';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(last);
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return output;
}

function detailToSource(item: PhotoItem): { urls: string[]; datasets: string[]; attribution: string } {
  const urls = unique([normalizeSourceUrl(item.externalUrl)]);
  return {
    urls,
    datasets: unique(urls.map(deriveSourceDataset).filter((value) => value !== 'unknown')),
    attribution: clean(item.credits) || 'Archives de la Ville de Montreal',
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      local: { type: 'string', default: DEFAULT_LOCAL },
      'raw-manifest': { type: 'string', default: DEFAULT_RAW },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'api-origin': { type: 'string', default: DEFAULT_API },
      concurrency: { type: 'string', default: '8' },
      'timeout-ms': { type: 'string', default: '20000' },
      'reuse-public-snapshot': { type: 'boolean', default: false },
      mode: { type: 'string', default: 'live' },
    },
  });
  const startedAt = datasetFactoryNowIso();
  const startedMs = Date.now();
  const localPath = resolvePath(values.local!);
  const rawPath = resolvePath(values['raw-manifest']!);
  const outputDir = resolvePath(values.output!);
  const apiOrigin = new URL(values['api-origin']!);
  const concurrency = Number.parseInt(values.concurrency!, 10);
  const timeoutMs = Number.parseInt(values['timeout-ms']!, 10);
  const mode = values.mode!;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency must be 1..16');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('timeout-ms must be 1000..120000');
  if (apiOrigin.protocol !== 'https:') throw new Error('api-origin must use HTTPS');
  fs.mkdirSync(outputDir, { recursive: true });

  const localRows = readJsonl<LocalInventoryRow>(localPath);
  const rawDates = readRawDates(rawPath);
  const localEvidence = repoEvidence(localPath, localRows.length);
  if (mode === 'live') {
    if (localRows.length !== CANONICAL_COUNTS.local) throw new Error(`Canonical local count drift: ${localRows.length}`);
    if (localEvidence.sha256 !== CANONICAL_LOCAL_SHA256) throw new Error(`Canonical local hash drift: ${localEvidence.sha256}`);
    if (rawDates.size !== CANONICAL_COUNTS.local) throw new Error(`Raw date coverage drift: ${rawDates.size}`);
  }

  const sitemapPath = path.join(outputDir, 'd1-sitemap.json');
  const sitemapUrl = new URL('/api/sitemap', apiOrigin);
  const sitemap = values['reuse-public-snapshot']
    ? readJson<{ items?: SitemapItem[]; count?: number }>(sitemapPath)
    : await fetchJson<{ items?: SitemapItem[]; count?: number }>(sitemapUrl, timeoutMs);
  const sitemapItems = [...(sitemap.items ?? [])].map((item) => ({
    id: normalizeRecordId(item.id),
    imageUrl: clean(item.imageUrl),
    name: clean(item.name),
    dateValue: clean(item.dateValue),
  })).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(sitemapItems.map((row) => row.id)).size !== sitemapItems.length) throw new Error('Sitemap contains duplicate record IDs');
  if (sitemap.count !== sitemapItems.length) throw new Error(`Sitemap count mismatch: ${sitemap.count} != ${sitemapItems.length}`);
  if (mode === 'live' && sitemapItems.length !== CANONICAL_COUNTS.d1) throw new Error(`D1 sitemap count drift: ${sitemapItems.length}`);
  const firstPublicUrl = sitemapItems.map((row) => row.imageUrl).find(Boolean);
  if (!firstPublicUrl) throw new Error('Sitemap has no public image URL');
  const publicHost = new URL(safePublicImageUrl(firstPublicUrl)).hostname;
  for (const row of sitemapItems) row.imageUrl = safePublicImageUrl(row.imageUrl, publicHost);
  writeJson(sitemapPath, { schema_version: VFG_SCHEMA_VERSION, items: sitemapItems, count: sitemapItems.length });

  const localById = new Map(localRows.map((row) => [row.identity, row]));
  const sitemapById = new Map(sitemapItems.map((row) => [row.id, row]));
  const productionOnly = sitemapItems.filter((row) => !localById.has(row.id)).map((row) => row.id);
  const cachePath = path.join(outputDir, 'd1-production-only-details.jsonl');
  const cached = fs.existsSync(cachePath) ? readJsonl<DetailCacheRow>(cachePath) : [];
  const detailById = new Map(cached.map((row) => [row.record_id, row.item]));
  const missingDetails = productionOnly.filter((id) => !detailById.has(id));
  if (values['reuse-public-snapshot'] && missingDetails.length) throw new Error(`Frozen public snapshot is missing ${missingDetails.length} production detail rows`);
  const failures: Array<{ record_id: string; error: string }> = [];
  let completed = 0;
  const fetched = await mapConcurrent(missingDetails, concurrency, async (recordId): Promise<DetailCacheRow | null> => {
    const url = new URL('/api/photos', apiOrigin);
    url.searchParams.set('id', recordId);
    try {
      const payload = await fetchJson<{ items?: PhotoItem[] }>(url, timeoutMs);
      if (payload.items?.length !== 1) throw new Error(`expected one item, received ${payload.items?.length ?? 0}`);
      completed += 1;
      if (completed % 250 === 0) console.log(`[vfg-v1:collect] production details ${completed}/${missingDetails.length}`);
      return { record_id: recordId, item: payload.items[0] };
    } catch (error) {
      failures.push({ record_id: recordId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  for (const row of fetched) if (row) detailById.set(row.record_id, row.item);
  const detailRows = [...detailById.entries()].map(([record_id, item]) => ({ record_id, item })).sort((a, b) => a.record_id.localeCompare(b.record_id));
  writeJsonl(cachePath, detailRows);
  writeJsonl(path.join(outputDir, 'collection-failures.jsonl'), failures.sort((a, b) => a.record_id.localeCompare(b.record_id)));
  if (failures.length) throw new Error(`Production detail collection has ${failures.length} individually reported failures`);
  if (detailRows.length !== productionOnly.length) throw new Error(`Production detail coverage mismatch: ${detailRows.length} != ${productionOnly.length}`);
  const sitemapEvidence = repoEvidence(sitemapPath);
  const detailsEvidence = repoEvidence(cachePath, detailRows.length);
  const acquisitionSnapshotId = sha256(stableJson({
    schema_version: VFG_SCHEMA_VERSION,
    acquisition_kind: 'public_api_read_only_snapshot',
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    api_origin: apiOrigin.origin,
    local_sha256: localEvidence.sha256,
    sitemap_sha256: sitemapEvidence.sha256,
    production_details_sha256: detailsEvidence.sha256,
    methods: ['GET /api/sitemap', 'GET /api/photos?id=<production-only-id>'],
  }));

  const allIds = unique([...localById.keys(), ...sitemapById.keys()]);
  const provisional = allIds.map((recordId) => {
    const local = localById.get(recordId);
    const sitemapRow = sitemapById.get(recordId);
    const detail = detailById.get(recordId);
    const imageKey = clean(local?.resolved_image_filename || local?.image_filename || detail?.resolvedImageFilename || detail?.imageFilename)
      || new URL(sitemapRow?.imageUrl ?? '').pathname.replace(/^\/+/, '');
    const imageUrl = sitemapRow?.imageUrl || `https://${publicHost}/${imageKey}`;
    const source = local
      ? {
          urls: unique(local.source_urls.map(normalizeSourceUrl)),
          datasets: local.source_datasets,
          attribution: local.attribution,
        }
      : detailToSource(detail ?? {});
    const sourceIdentity = normalizeSourceUrl(local?.primary_source_url || detail?.externalUrl || source.urls[0]);
    if (!sourceIdentity) throw new Error(`${recordId}: missing source identity`);
    return {
      recordId,
      numericId: numericRecordId(recordId),
      local,
      sitemapRow,
      detail,
      imageKey,
      imageUrl: safePublicImageUrl(imageUrl, publicHost),
      source,
      sourceIdentity,
    };
  });

  const bySource = new Map<string, typeof provisional>();
  for (const row of provisional) bySource.set(row.sourceIdentity, [...(bySource.get(row.sourceIdentity) ?? []), row]);
  let aliasCount = 0;
  const corpusRows: CorpusInputRow[] = [];
  for (const group of bySource.values()) {
    const members = [...group].sort((a, b) => a.recordId.localeCompare(b.recordId));
    const d1Members = members.filter((row) => Boolean(row.sitemapRow));
    if (d1Members.length !== 1) throw new Error(`Source group ${sha256(members[0].sourceIdentity)} has ${d1Members.length} D1 members`);
    const canonical = d1Members[0].recordId;
    const groupId = members.length > 1 ? stableId('source-group', [members[0].sourceIdentity]) : null;
    for (const row of members) {
      const isAlias = row.recordId !== canonical;
      if (isAlias) aliasCount += 1;
      const attribution = clean(row.source.attribution) || 'Archives de la Ville de Montreal';
      corpusRows.push({
        schema_version: VFG_SCHEMA_VERSION,
        corpus_snapshot_id: acquisitionSnapshotId,
        canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
        record_id: row.recordId,
        numeric_id: row.numericId,
        systems: { local: Boolean(row.local), d1: Boolean(row.sitemapRow) },
        corpus_state: isAlias ? 'alias' : row.local ? 'canonical' : 'production_only',
        canonical_source_record_id: isAlias ? canonical : null,
        alias_group_id: groupId,
        image_key: row.imageKey,
        image_url: row.imageUrl,
        name: clean(row.local?.name || row.detail?.name || row.sitemapRow?.name || row.recordId),
        description: clean(row.local?.description || row.detail?.description),
        date: clean((row.local && rawDates.get(row.recordId)) || row.detail?.dateValue || row.sitemapRow?.dateValue),
        cote: clean(row.local?.cote || row.detail?.cote),
        source_identity: row.sourceIdentity,
        source_urls: unique(row.source.urls),
        source_datasets: unique(row.source.datasets),
        source_record_ids: row.local?.source_record_ids ?? [],
        source_record_sha256: row.local?.source_record_sha256 ?? null,
        rights: {
          license_id: RIGHTS_LICENSE_ID,
          attribution,
          notes: RIGHTS_NOTES,
          complete: Boolean(row.source.urls.length && attribution),
        },
      });
    }
  }
  corpusRows.sort((a, b) => a.record_id.localeCompare(b.record_id));
  const corpusPath = path.join(outputDir, 'corpus-input-v1.jsonl');
  writeJsonl(corpusPath, corpusRows);

  if (mode === 'live') {
    const checks: Array<[string, number, number]> = [
      ['corpus', corpusRows.length, CANONICAL_COUNTS.corpus],
      ['local', corpusRows.filter((row) => row.systems.local).length, CANONICAL_COUNTS.local],
      ['d1', corpusRows.filter((row) => row.systems.d1).length, CANONICAL_COUNTS.d1],
      ['aliases', aliasCount, CANONICAL_COUNTS.aliases],
      ['source groups', bySource.size, CANONICAL_COUNTS.sourceGroups],
      ['production only', productionOnly.length, CANONICAL_COUNTS.corpus - CANONICAL_COUNTS.local],
    ];
    for (const [label, actual, expected] of checks) if (actual !== expected) throw new Error(`${label} drift: ${actual} != ${expected}`);
  }

  const completedAt = datasetFactoryNowIso();
  const summary = {
    schema_version: VFG_SCHEMA_VERSION,
    input_version: 'visual_family_graph_corpus_input_v1',
    acquisition_snapshot_id: acquisitionSnapshotId,
    canonical_corpus_reference_snapshot_id: CANONICAL_CORPUS_SNAPSHOT_ID,
    byte_equivalent_to_canonical_reference: false,
    generated_at: completedAt,
    acquisition: {
      mode,
      api_origin: apiOrigin.origin,
      public_image_host: publicHost,
      methods: ['GET /api/sitemap', 'GET /api/photos?id=<production-only-id>'],
      production_writes: 0,
      reused_frozen_public_snapshot: values['reuse-public-snapshot'],
      acquisition_boundary: 'Public read-only API snapshot; no D1, R2, Vectorize, deployment, or configuration mutation.',
      source_group_reason: ALIAS_GROUP_REASON,
    },
    counts: {
      corpus_records: corpusRows.length,
      local_records: corpusRows.filter((row) => row.systems.local).length,
      d1_records: corpusRows.filter((row) => row.systems.d1).length,
      production_only_records: productionOnly.length,
      aliases: aliasCount,
      source_groups: bySource.size,
      rights_complete: corpusRows.filter((row) => row.rights.complete).length,
      collection_failures: failures.length,
    },
    runtime: { started_at: startedAt, completed_at: completedAt, elapsed_ms: Date.now() - startedMs, cost_usd: 0 },
    lineage: {
      canonical_local: localEvidence,
      tracked_raw_manifest_sha256: sha256(fs.readFileSync(rawPath)),
      sitemap: sitemapEvidence,
      production_details: detailsEvidence,
      corpus_input: repoEvidence(corpusPath, corpusRows.length),
    },
  };
  writeJson(path.join(outputDir, 'corpus-input-summary-v1.json'), summary);
  console.log(JSON.stringify({ status: 'ok', counts: summary.counts, output: outputDir }));
}

main().catch((error) => {
  console.error(`[vfg-v1:collect] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
