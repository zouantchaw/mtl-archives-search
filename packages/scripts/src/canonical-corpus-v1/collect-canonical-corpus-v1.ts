import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import {
  CORPUS_VERSION,
  RIGHTS_LICENSE_ID,
  RIGHTS_NOTES,
  SCHEMA_VERSION,
  classifyR2Key,
  cleanText,
  deriveSourceDataset,
  detectMagic,
  fileEvidence,
  idRange,
  parseArchiveImageKey,
  parseMetadataIdentity,
  readJsonlStream,
  sha256,
  sortedUnique,
  stableJson,
  writeJson,
  writeJsonl,
  type LocalInventoryRow,
  type R2InventoryRow,
  type R2SampleRow,
} from './model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const DEFAULT_OUTPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports/canonical_corpus_v1/live');
const DEFAULT_LOCAL_INPUT = path.join(MONOREPO_ROOT, 'data/mtl_archives/manifest_clean.jsonl.gz');
const DEFAULT_FIXTURE = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-corpus-v1');
const REQUIRED_R2_EVIDENCE = ['mtl_archives_image_9247.jpg', 'mtl_archives_image_9696.jpg'];

function resolveCliPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(MONOREPO_ROOT, value);
}

type WranglerResult = {
  results: Array<Record<string, unknown>>;
  success: boolean;
  meta?: {
    changes?: number;
    changed_db?: boolean;
    rows_read?: number;
    rows_written?: number;
  };
};

type VectorPage = {
  count: number;
  totalCount: number;
  isTruncated: boolean;
  nextCursor?: string;
  vectors: Array<{ id: string }>;
};

function requiredString(record: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = cleanText(record[name]);
    if (value) return value;
  }
  throw new Error(`Approved env file is missing required variable name(s): ${names.join(', ')}`);
}

function loadNamedEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) throw new Error(`Approved env file does not exist: ${filePath}`);
  return dotenv.parse(fs.readFileSync(filePath));
}

function relativeOutput(filePath: string, root: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function outputEvidence(filePath: string, rowCount?: number): ReturnType<typeof fileEvidence> {
  return { ...fileEvidence(filePath, rowCount), path: relativeOutput(filePath, MONOREPO_ROOT) };
}

function attributionFromLocal(record: Record<string, unknown>): string {
  const attributes = (record.attributes_map ?? {}) as Record<string, unknown>;
  const portal = (record.portal_record ?? {}) as Record<string, unknown>;
  const aerial = Array.isArray(record.aerial_matches) ? record.aerial_matches : [];
  const aerialCredits = aerial.flatMap((match) => {
    const child = (match && typeof match === 'object' ? (match as Record<string, unknown>).record : {}) as Record<string, unknown>;
    return [cleanText(child['Mention de crédits'])];
  });
  return sortedUnique([
    cleanText(record.credits),
    cleanText(attributes.Credits),
    cleanText(portal['Mention de crédits']),
    ...aerialCredits,
  ]).join('; ');
}

function sourceDetails(record: Record<string, unknown>): {
  sourceUrls: string[];
  sourceDatasets: string[];
  sourceRecordIds: string[];
} {
  const portal = (record.portal_record ?? {}) as Record<string, unknown>;
  const aerial = Array.isArray(record.aerial_matches) ? record.aerial_matches : [];
  const sourceUrls = sortedUnique([
    cleanText(record.external_url),
    cleanText(portal['Fichier jpg - 200 dpi']),
    ...aerial.flatMap((match) => {
      const child = (match && typeof match === 'object' ? (match as Record<string, unknown>).record : {}) as Record<string, unknown>;
      return Object.entries(child)
        .filter(([key]) => /fichier/i.test(key))
        .map(([, value]) => cleanText(value));
    }),
  ]);
  const aerialDatasets = aerial.map((match) => cleanText((match as Record<string, unknown>).dataset));
  const sourceDatasets = sortedUnique(
    aerialDatasets.length > 0
      ? aerialDatasets
      : record.portal_match === true
        ? ['phototheque_archives']
        : sourceUrls.map(deriveSourceDataset),
  ).filter((value) => value !== 'unknown');
  const sourceRecordIds = sortedUnique([
    ...(portal._id === undefined ? [] : [`phototheque_archives:${cleanText(portal._id)}`]),
    ...aerial.map((match) => {
      const parent = match as Record<string, unknown>;
      const child = (parent.record ?? {}) as Record<string, unknown>;
      return `${cleanText(parent.dataset)}:${cleanText(child._id)}`;
    }),
  ]);
  return { sourceUrls, sourceDatasets, sourceRecordIds };
}

async function collectLocal(inputPath: string, outputDir: string): Promise<void> {
  const rows: LocalInventoryRow[] = [];
  const seenMetadata = new Set<string>();
  const seenImages = new Set<string>();
  for await (const { value: record, raw } of readJsonlStream(inputPath)) {
    const identity = parseMetadataIdentity(record.metadata_filename);
    if (!identity) throw new Error(`Invalid local metadata identity: ${cleanText(record.metadata_filename) || '<empty>'}`);
    const imageFilename = cleanText(record.image_filename);
    const resolvedImageFilename = cleanText(record.resolved_image_filename) || imageFilename;
    const parsedImage = parseArchiveImageKey(imageFilename);
    const parsedResolved = parseArchiveImageKey(resolvedImageFilename);
    if (!parsedImage || parsedImage.identity !== identity.identity) {
      throw new Error(`${identity.identity}: image_filename does not match the metadata identity`);
    }
    if (!parsedResolved || parsedResolved.identity !== identity.identity) {
      throw new Error(`${identity.identity}: resolved_image_filename does not match the metadata identity`);
    }
    if (seenMetadata.has(identity.identity)) throw new Error(`Duplicate local metadata identity: ${identity.identity}`);
    if (seenImages.has(imageFilename)) throw new Error(`Duplicate local image identity: ${imageFilename}`);
    seenMetadata.add(identity.identity);
    seenImages.add(imageFilename);
    const sources = sourceDetails(record);
    const attribution = attributionFromLocal(record);
    const attributes = (record.attributes_map ?? {}) as Record<string, unknown>;
    rows.push({
      schema_version: SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      identity: identity.identity,
      numeric_id: identity.numericId,
      metadata_filename: identity.identity,
      image_filename: imageFilename,
      resolved_image_filename: resolvedImageFilename,
      image_exists: typeof record.image_exists === 'boolean' ? record.image_exists : null,
      image_size_bytes: typeof record.image_size_bytes === 'number' ? record.image_size_bytes : null,
      name: cleanText(record.name),
      description: cleanText(record.description),
      primary_source_url: cleanText(record.external_url),
      source_urls: sources.sourceUrls,
      source_datasets: sources.sourceDatasets,
      source_record_ids: sources.sourceRecordIds,
      source_record_sha256: sha256(raw),
      cote: cleanText(record.cote) || cleanText(attributes.Cote),
      attribution,
      rights: {
        license_id: RIGHTS_LICENSE_ID,
        attribution,
        notes: RIGHTS_NOTES,
        complete: sources.sourceUrls.length > 0 && attribution.length > 0,
      },
    });
  }
  rows.sort((a, b) => a.identity.localeCompare(b.identity));
  const output = path.join(outputDir, 'local-manifest.jsonl');
  writeJsonl(output, rows);
  const sourceBytes = fs.readFileSync(inputPath);
  const sourceUrlCounts = new Map<string, number>();
  for (const row of rows) {
    for (const url of row.source_urls) sourceUrlCounts.set(url, (sourceUrlCounts.get(url) ?? 0) + 1);
  }
  writeJson(path.join(outputDir, 'local-snapshot.json'), {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    collection_mode: 'local_read_only',
    source_artifact: {
      locator: path.basename(inputPath),
      compression: inputPath.endsWith('.gz') ? 'gzip' : 'none',
      sha256: sha256(sourceBytes),
      byte_count: sourceBytes.byteLength,
    },
    output: outputEvidence(output, rows.length),
    counts: {
      rows: rows.length,
      unique_metadata_ids: seenMetadata.size,
      unique_image_filenames: seenImages.size,
      rights_complete: rows.filter((row) => row.rights.complete).length,
      source_url_duplicate_groups: [...sourceUrlCounts.values()].filter((count) => count > 1).length,
    },
  });
}

function assertSelectOnly(sql: string): void {
  const normalized = sql.trim();
  if (!/^SELECT\b/i.test(normalized)) throw new Error('D1 collector rejected a command that is not SELECT-only');
  if (normalized.includes(';')) throw new Error('D1 collector rejected a multi-statement command');
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(normalized)) {
    throw new Error('D1 collector rejected a mutation token');
  }
}

function runWrangler(args: string[], accountId: string): string {
  const executable = path.join(MONOREPO_ROOT, 'node_modules/.bin/wrangler');
  if (!fs.existsSync(executable)) throw new Error('Wrangler is not installed; run npm ci first');
  const result = spawnSync(executable, args, {
    cwd: path.join(MONOREPO_ROOT, 'apps/api'),
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`Read-only Wrangler command failed: ${cleanText(result.stderr || result.stdout).slice(0, 1200)}`);
  }
  return result.stdout;
}

function runD1Select(sql: string, accountId: string): WranglerResult {
  assertSelectOnly(sql);
  const parsed = JSON.parse(runWrangler([
    'd1', 'execute', 'mtl-archives', '--remote', '--command', sql, '--json',
  ], accountId)) as WranglerResult[];
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0].success) throw new Error('Unexpected D1 SELECT response');
  const result = parsed[0];
  if ((result.meta?.changes ?? 0) !== 0 || (result.meta?.rows_written ?? 0) !== 0 || result.meta?.changed_db === true) {
    throw new Error('D1 read-only guard observed a changed database or written row');
  }
  return result;
}

const D1_COLUMNS = [
  'metadata_filename', 'image_filename', 'resolved_image_filename', 'image_size_bytes', 'name', 'description',
  'date_value', 'credits', 'cote', 'external_url', 'portal_match', 'portal_title', 'portal_description',
  'portal_date', 'portal_cote', 'aerial_datasets', 'created_at', 'vlm_caption', 'latitude', 'longitude',
  'geocode_confidence', 'geocode_source', 'ocr_text', 'trust_score', 'rotation_degrees',
  'taxonomy_primary_category', 'taxonomy_themes', 'taxonomy_search_facets', 'taxonomy_review_required',
  'taxonomy_exclude_default_visual', 'image_quality_labels', 'image_quality_severity', 'image_quality_action',
] as const;

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function collectD1(outputDir: string, envFile: string, pageSize: number): Promise<void> {
  const namedEnv = loadNamedEnv(envFile);
  const accountId = requiredString(namedEnv, ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID']);
  const startedAt = new Date().toISOString();
  const schemaSql = `SELECT name,type,"notnull" AS not_null,dflt_value,pk FROM pragma_table_info('manifest') ORDER BY cid`;
  const countSql = `SELECT COUNT(*) AS row_count,COUNT(DISTINCT metadata_filename) AS metadata_id_count,COUNT(DISTINCT image_filename) AS image_id_count,MIN(created_at) AS min_created_at,MAX(created_at) AS max_created_at FROM manifest`;
  const schema = runD1Select(schemaSql, accountId).results;
  const before = runD1Select(countSql, accountId).results[0];
  const rows: Array<Record<string, unknown>> = [];
  const pageEvidence: Array<{ page: number; row_count: number; rows_read: number; first_id: string | null; last_id: string | null }> = [];
  let cursor = '';
  let page = 0;
  while (true) {
    const where = cursor ? ` WHERE metadata_filename > ${quoteSqlLiteral(cursor)}` : '';
    const sql = `SELECT ${D1_COLUMNS.join(',')} FROM manifest${where} ORDER BY metadata_filename LIMIT ${pageSize}`;
    const result = runD1Select(sql, accountId);
    const pageRows = result.results;
    page += 1;
    const firstId = pageRows.length ? cleanText(pageRows[0].metadata_filename) : null;
    const lastId = pageRows.length ? cleanText(pageRows.at(-1)?.metadata_filename) : null;
    pageEvidence.push({
      page,
      row_count: pageRows.length,
      rows_read: result.meta?.rows_read ?? pageRows.length,
      first_id: firstId,
      last_id: lastId,
    });
    if (pageRows.length === 0) break;
    if (!lastId || lastId === cursor) throw new Error('D1 pagination cursor did not advance');
    rows.push(...pageRows);
    cursor = lastId;
    if (pageRows.length < pageSize) break;
  }
  const after = runD1Select(countSql, accountId).results[0];
  if (stableJson(before) !== stableJson(after)) throw new Error('D1 aggregate changed during the read-only snapshot');
  const ids = rows.map((row) => cleanText(row.metadata_filename));
  if (new Set(ids).size !== ids.length) throw new Error('D1 pagination produced duplicate metadata identities');
  if (rows.length !== Number(before.row_count)) throw new Error(`D1 snapshot count mismatch: ${rows.length} != ${before.row_count}`);
  const output = path.join(outputDir, 'd1-manifest.jsonl');
  writeJsonl(output, rows);
  writeJson(path.join(outputDir, 'd1-query-manifest.json'), {
    schema_version: SCHEMA_VERSION,
    database: 'mtl-archives',
    binding: 'DB',
    statements: [
      { purpose: 'schema', sql: schemaSql, sha256: sha256(schemaSql) },
      { purpose: 'aggregate_before_and_after', sql: countSql, sha256: sha256(countSql) },
      {
        purpose: 'keyset_page',
        sql_template: `SELECT ${D1_COLUMNS.join(',')} FROM manifest WHERE metadata_filename > :cursor ORDER BY metadata_filename LIMIT :page_size`,
        page_size: pageSize,
      },
    ],
    mutation_guard: 'Every statement must begin SELECT; semicolons and mutation tokens are rejected; Wrangler metadata must report changes=0, rows_written=0, changed_db=false.',
  });
  writeJson(path.join(outputDir, 'd1-snapshot.json'), {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    collection_mode: 'production_select_only',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    aggregate_before: before,
    aggregate_after: after,
    schema,
    selected_columns: [...D1_COLUMNS],
    pagination: { method: 'metadata_filename_keyset', page_size: pageSize, pages: pageEvidence, terminal_short_page: pageEvidence.at(-1)?.row_count !== pageSize },
    output: outputEvidence(output, rows.length),
  });
}

function r2Row(object: _Object): R2InventoryRow {
  const key = cleanText(object.Key);
  const archive = parseArchiveImageKey(key);
  return {
    schema_version: SCHEMA_VERSION,
    key,
    object_class: classifyR2Key(key),
    normalized_identity: archive?.identity ?? null,
    numeric_id: archive?.numericId ?? null,
    size_bytes: object.Size ?? 0,
    etag: object.ETag ? object.ETag.replace(/^"|"$/g, '') : null,
    checksum_algorithms: [...(object.ChecksumAlgorithm ?? [])].map(String).sort(),
    checksum_type: object.ChecksumType ?? null,
    last_modified: object.LastModified?.toISOString() ?? null,
    storage_class: object.StorageClass ?? null,
  };
}

function sampleStratum(row: R2InventoryRow): string {
  if (row.object_class === 'archive_image') return `archive_image:${idRange(row.numeric_id)}`;
  const parts = row.key.split('/').filter(Boolean);
  const prefix = parts.slice(0, Math.min(2, parts.length)).join('/') || '<root>';
  return `${row.object_class}:${prefix}`;
}

function chooseSampleKeys(rows: R2InventoryRow[], perStratum: number, seed: string): Set<string> {
  const groups = new Map<string, R2InventoryRow[]>();
  for (const row of rows) {
    const stratum = sampleStratum(row);
    const group = groups.get(stratum) ?? [];
    group.push(row);
    groups.set(stratum, group);
  }
  const selected = new Set<string>();
  for (const group of groups.values()) {
    group.sort((a, b) => sha256(`${seed}\0${a.key}`).localeCompare(sha256(`${seed}\0${b.key}`)) || a.key.localeCompare(b.key));
    for (const row of group.slice(0, perStratum)) selected.add(row.key);
  }
  for (const key of REQUIRED_R2_EVIDENCE) {
    if (rows.some((row) => row.key === key)) selected.add(key);
  }
  return selected;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body && typeof body === 'object' && 'transformToByteArray' in body) {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  throw new Error('R2 range response did not expose a byte-array transform');
}

function safeR2Error(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? cleanText((error as { name: unknown }).name) : 'R2ReadError';
  const status = error && typeof error === 'object' && '$metadata' in error
    ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    : undefined;
  return status ? `${name}:HTTP_${status}` : name;
}

async function collectR2(outputDir: string, envFile: string, samplePerStratum: number): Promise<void> {
  const namedEnv = loadNamedEnv(envFile);
  const accountId = requiredString(namedEnv, ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID']);
  const bucket = requiredString(namedEnv, ['CLOUDFLARE_R2_BUCKET']);
  const accessKeyId = requiredString(namedEnv, ['CLOUDFLARE_R2_ACCESS_KEY', 'R2_ACCESS_KEY_ID']);
  const secretAccessKey = requiredString(namedEnv, ['CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY']);
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const startedAt = new Date().toISOString();
  const rows: R2InventoryRow[] = [];
  let continuationToken: string | undefined;
  let pages = 0;
  const cursorHashes: string[] = [];
  while (true) {
    const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: continuationToken }));
    pages += 1;
    for (const object of response.Contents ?? []) rows.push(r2Row(object));
    if (!response.IsTruncated) {
      if (response.NextContinuationToken) throw new Error('R2 terminal page unexpectedly included a continuation token');
      break;
    }
    if (!response.NextContinuationToken || response.NextContinuationToken === continuationToken) {
      throw new Error('R2 pagination did not provide a new continuation token');
    }
    cursorHashes.push(sha256(response.NextContinuationToken));
    continuationToken = response.NextContinuationToken;
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(rows.map((row) => row.key)).size !== rows.length) throw new Error('R2 listing contained duplicate keys');
  const selectedKeys = chooseSampleKeys(rows, samplePerStratum, CORPUS_VERSION);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const samples: R2SampleRow[] = [];
  for (const key of [...selectedKeys].sort()) {
    const inventory = byKey.get(key)!;
    let headOk = false;
    let rangeGetOk = false;
    let contentType: string | null = null;
    let contentLength: number | null = null;
    let etag: string | null = null;
    let checksumSha256: string | null = null;
    let magicKind: R2SampleRow['magic_kind'] = 'unavailable';
    let sampledBytes = 0;
    let errorMessage: string | null = null;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }));
      headOk = true;
      contentType = head.ContentType ?? null;
      contentLength = head.ContentLength ?? null;
      etag = head.ETag ? head.ETag.replace(/^"|"$/g, '') : null;
      checksumSha256 = head.ChecksumSHA256 ?? null;
      const range = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-31' }));
      const bytes = await bodyBytes(range.Body);
      rangeGetOk = true;
      sampledBytes = bytes.byteLength;
      magicKind = detectMagic(bytes);
    } catch (error) {
      errorMessage = safeR2Error(error);
    }
    samples.push({
      schema_version: SCHEMA_VERSION,
      key,
      object_class: inventory.object_class,
      stratum: sampleStratum(inventory),
      required_evidence: REQUIRED_R2_EVIDENCE.includes(key),
      head_ok: headOk,
      range_get_ok: rangeGetOk,
      content_type: contentType,
      content_length: contentLength,
      etag,
      checksum_sha256: checksumSha256,
      magic_kind: magicKind,
      sampled_bytes: sampledBytes,
      error: errorMessage,
    });
  }
  const objectOutput = path.join(outputDir, 'r2-objects.jsonl');
  const sampleOutput = path.join(outputDir, 'r2-samples.jsonl');
  writeJsonl(objectOutput, rows);
  writeJsonl(sampleOutput, samples);
  const classCounts = Object.fromEntries(['archive_image', 'social_content', 'content_asset', 'other'].map((kind) => [kind, rows.filter((row) => row.object_class === kind).length]));
  writeJson(path.join(outputDir, 'r2-snapshot.json'), {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    collection_mode: 'production_s3_read_only',
    operations: ['ListObjectsV2', 'HeadObject (bounded stratified sample)', 'GetObject bytes=0-31 (bounded stratified sample)'],
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    bucket,
    pagination: {
      page_size: 1000,
      page_count: pages,
      cursor_count: cursorHashes.length,
      cursor_chain_sha256: sha256(`${cursorHashes.join('\n')}\n`),
      terminal_is_truncated: false,
      unique_key_count: rows.length,
    },
    counts: {
      objects: rows.length,
      bytes: rows.reduce((sum, row) => sum + row.size_bytes, 0),
      by_class: classCounts,
      samples: samples.length,
      sample_failures: samples.filter((sample) => !sample.head_ok || !sample.range_get_ok).length,
    },
    sample_design: {
      seed: CORPUS_VERSION,
      method: 'lowest SHA-256(seed + NUL + key) per object-class/ID-range-or-prefix stratum',
      per_stratum: samplePerStratum,
      first_byte_range: '0-31',
      required_keys: REQUIRED_R2_EVIDENCE,
      inference_boundary: 'Content type and magic-byte findings apply only to sampled keys.',
    },
    outputs: [
      outputEvidence(objectOutput, rows.length),
      outputEvidence(sampleOutput, samples.length),
    ],
  });
  client.destroy();
}

function parseVectorPage(output: string): VectorPage {
  const parsed = JSON.parse(output) as VectorPage;
  if (!Array.isArray(parsed.vectors) || typeof parsed.totalCount !== 'number') throw new Error('Unexpected Vectorize list response');
  return parsed;
}

async function collectVectorIndex(
  indexName: string,
  outputPrefix: 'text' | 'clip',
  modelContract: string,
  outputDir: string,
  accountId: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const index = JSON.parse(runWrangler(['vectorize', 'get', indexName, '--json'], accountId)) as Record<string, unknown>;
  const ids: string[] = [];
  const cursorHashes: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const args = ['vectorize', 'list-vectors', indexName, '--count', '1000', '--json'];
    if (cursor) args.push('--cursor', cursor);
    const page = parseVectorPage(runWrangler(args, accountId));
    pages += 1;
    if (expectedTotal === null) expectedTotal = page.totalCount;
    if (page.totalCount !== expectedTotal) throw new Error(`${indexName}: totalCount changed during pagination`);
    if (page.count !== page.vectors.length) throw new Error(`${indexName}: page count did not match vector rows`);
    ids.push(...page.vectors.map((vector) => cleanText(vector.id)));
    if (!page.isTruncated) {
      if (page.nextCursor) throw new Error(`${indexName}: terminal page included nextCursor`);
      break;
    }
    if (!page.nextCursor || page.nextCursor === cursor) throw new Error(`${indexName}: pagination cursor did not advance`);
    cursorHashes.push(sha256(page.nextCursor));
    cursor = page.nextCursor;
  }
  ids.sort((a, b) => a.localeCompare(b));
  if (ids.some((id) => !id)) throw new Error(`${indexName}: empty vector ID`);
  if (new Set(ids).size !== ids.length) throw new Error(`${indexName}: duplicate vector ID`);
  if (ids.length !== expectedTotal) throw new Error(`${indexName}: enumerated ${ids.length}, metadata reported ${expectedTotal}`);
  const output = path.join(outputDir, `${outputPrefix}-vector-ids.jsonl`);
  writeJsonl(output, ids.map((id) => {
    const parsed = parseMetadataIdentity(id);
    return { schema_version: SCHEMA_VERSION, id, normalized_identity: parsed?.identity ?? null, valid_identity: parsed !== null };
  }));
  writeJson(path.join(outputDir, `${outputPrefix}-vector-index.json`), {
    schema_version: SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    collection_mode: 'production_vectorize_read_only',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    index,
    model_contract: modelContract,
    model_contract_basis: 'tracked ingestion implementation; Vectorize index metadata does not expose model identity',
    pagination: {
      page_size: 1000,
      page_count: pages,
      cursor_count: cursorHashes.length,
      cursor_chain_sha256: sha256(`${cursorHashes.join('\n')}\n`),
      terminal_is_truncated: false,
      enumerated_count: ids.length,
      reported_total_count: expectedTotal,
      unique_count: new Set(ids).size,
      count_agreement: ids.length === expectedTotal,
    },
    output: outputEvidence(output, ids.length),
  });
}

async function collectVectorize(outputDir: string, envFile: string): Promise<void> {
  const namedEnv = loadNamedEnv(envFile);
  const accountId = requiredString(namedEnv, ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID']);
  await collectVectorIndex('mtl-archives', 'text', '@cf/baai/bge-m3', outputDir, accountId);
  await collectVectorIndex('mtl-archives-clip', 'clip', 'Xenova/clip-vit-base-patch32', outputDir, accountId);
}

function collectFixture(fixtureDir: string, outputDir: string): void {
  if (!fs.existsSync(fixtureDir)) throw new Error(`Fixture directory does not exist: ${fixtureDir}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const required = [
    'local-manifest.jsonl', 'local-snapshot.json', 'd1-manifest.jsonl', 'd1-query-manifest.json', 'd1-snapshot.json',
    'r2-objects.jsonl', 'r2-samples.jsonl', 'r2-snapshot.json', 'text-vector-ids.jsonl', 'text-vector-index.json',
    'clip-vector-ids.jsonl', 'clip-vector-index.json',
  ];
  for (const name of required) fs.copyFileSync(path.join(fixtureDir, name), path.join(outputDir, name));
  writeJson(path.join(outputDir, 'fixture-collection.json'), {
    schema_version: SCHEMA_VERSION,
    collection_mode: 'tracked_fixture_no_network',
    source: path.relative(MONOREPO_ROOT, fixtureDir).split(path.sep).join('/'),
    files: required.sort(),
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: 'string', default: 'all' },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      'local-input': { type: 'string', default: DEFAULT_LOCAL_INPUT },
      'env-file': { type: 'string' },
      'd1-page-size': { type: 'string', default: '1000' },
      'r2-sample-per-stratum': { type: 'string', default: '2' },
      fixture: { type: 'boolean', default: false },
      'fixture-dir': { type: 'string', default: DEFAULT_FIXTURE },
    },
  });
  const outputDir = resolveCliPath(values.output!);
  if (values.fixture) {
    collectFixture(resolveCliPath(values['fixture-dir']!), outputDir);
    console.log(stableJson({ status: 'ok', mode: 'fixture', output: outputDir }));
    return;
  }
  const source = values.source!;
  if (!['all', 'local', 'd1', 'r2', 'vectorize'].includes(source)) throw new Error(`Unknown source: ${source}`);
  const envFile = values['env-file'] ? resolveCliPath(values['env-file']) : '';
  if (source !== 'local' && !envFile) throw new Error('--env-file is required for live D1/R2/Vectorize collection');
  fs.mkdirSync(outputDir, { recursive: true });
  if (source === 'all' || source === 'local') await collectLocal(resolveCliPath(values['local-input']!), outputDir);
  if (source === 'all' || source === 'd1') await collectD1(outputDir, envFile, Number(values['d1-page-size']));
  if (source === 'all' || source === 'r2') await collectR2(outputDir, envFile, Number(values['r2-sample-per-stratum']));
  if (source === 'all' || source === 'vectorize') await collectVectorize(outputDir, envFile);
  console.log(stableJson({ status: 'ok', mode: 'live_read_only', source, output: outputDir }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
