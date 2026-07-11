import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { computeVisualFeature } from '../visual-family-graph-v1/extract-phash-v1.js';
import type { CorpusInputRow, PhashFeatureRow } from '../visual-family-graph-v1/model.js';
import {
  HISTORICAL_ACQUISITION_SNAPSHOT_ID,
  HISTORICAL_CORPUS_INPUT_SHA256,
  HISTORICAL_FAILURE_STREAM_SHA256,
  BASELINE_DERIVATIVE_CONTRACT_ID,
  PINNED_BASELINE_FAILURE_SHA256,
  PINNED_BASELINE_FEATURE_SHA256,
  PINNED_BASELINE_REPORT_SHA256,
  RECOVERY_CONTRACT_ID,
  RECOVERY_TRANSFORM_CONTRACT,
  RECOVERY_SCHEMA_VERSION,
  assertCompleteLedger,
  readJsonl,
  sha256,
  stableId,
  stableJson,
  validateResumeRows,
  verifyHistoricalBaseline,
  writeJson,
  writeJsonl,
  type LaneEvidence,
  type LaneName,
  type RecoveryRow,
  type RootCause,
} from './model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_BASE = path.join(ROOT, 'data/mtl_archives/reports/visual_family_graph_v1');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/mtl_archives/reports/canonical_image_recovery_v1');
const DEFAULT_QUALITY_DERIVATIVES = path.join(ROOT, 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/registered-quality-derivatives');
const PINNED_BASELINE_MANIFEST = path.join(ROOT, 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/pinned-baseline-bundle-v1.json');
const THUMB_ORIGIN = 'https://mtl-archives-worker.wiel.workers.dev';
const ALLOWED_SOURCE_HOSTS = new Set(['depot.ville.montreal.qc.ca', 'archivesdemontreal.com', 'donnees.montreal.ca']);

type FetchResult = { evidence: LaneEvidence; buffer: Buffer | null };
type DerivativeManifest = { schema_version: string; tree_sha256: string; rows: Array<{ record_id: string; path: string; sha256: string; bytes: number; width: number; height: number; format: string; magic: string }> };

function containedRegularFile(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`unsafe derivative path: ${relativePath}`);
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(root, relativePath);
  if (!candidate.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`derivative path escapes root: ${relativePath}`);
  let cursor = candidate;
  while (cursor !== path.resolve(root)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`derivative path uses symlink: ${relativePath}`);
    cursor = path.dirname(cursor);
  }
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${resolvedRoot}${path.sep}`) || !fs.statSync(real).isFile()) throw new Error(`derivative path is not a contained file: ${relativePath}`);
  return real;
}

export async function verifyDerivativeManifest(root: string): Promise<Map<string, DerivativeManifest['rows'][number]>> {
  const manifestPath = path.join(root, 'manifest-v1.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DerivativeManifest;
  const rows = [...manifest.rows].sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(rows.map((row) => row.record_id)).size !== rows.length) throw new Error('derivative manifest has duplicate record IDs');
  const treeRows: string[] = [];
  for (const row of rows) {
    const filePath = containedRegularFile(root, row.path); const bytes = fs.readFileSync(filePath);
    if (sha256(bytes) !== row.sha256 || bytes.length !== row.bytes) throw new Error(`${row.record_id}: derivative manifest byte mismatch`);
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (metadata.width !== row.width || metadata.height !== row.height || metadata.format !== row.format || bytes.subarray(0, 2).toString('hex') !== row.magic) throw new Error(`${row.record_id}: derivative manifest decode/magic mismatch`);
    treeRows.push(`${row.path}\t${row.sha256}\t${row.bytes}\t${row.width}x${row.height}\t${row.format}\t${row.magic}`);
  }
  if (sha256(`${treeRows.join('\n')}\n`) !== manifest.tree_sha256) throw new Error('derivative manifest tree digest mismatch');
  return new Map(rows.map((row) => [row.record_id, row]));
}

export function verifyPinnedBaseline(base: string, expected = { feature: PINNED_BASELINE_FEATURE_SHA256, failure: PINNED_BASELINE_FAILURE_SHA256, report: PINNED_BASELINE_REPORT_SHA256, rows: 18_462, successes: 18_253, failures: 209, contract: BASELINE_DERIVATIVE_CONTRACT_ID }): { features: PhashFeatureRow[]; failures: PhashFeatureRow[]; report: Record<string, any> } {
  if (expected.feature === PINNED_BASELINE_FEATURE_SHA256) {
    const manifest = JSON.parse(fs.readFileSync(PINNED_BASELINE_MANIFEST, 'utf8'));
    if (manifest.members?.['phash-features-v1.jsonl']?.sha256 !== expected.feature || manifest.members?.['phash-failures-v1.jsonl']?.sha256 !== expected.failure
      || manifest.members?.['phash-report-v1.json']?.sha256 !== expected.report || manifest.transform_contract_id !== expected.contract
      || manifest.failure_record_id_stream_sha256 !== HISTORICAL_FAILURE_STREAM_SHA256) throw new Error('tracked pinned baseline manifest mismatch');
  }
  const featurePath = path.join(base, 'phash/phash-features-v1.jsonl'); const failurePath = path.join(base, 'phash/phash-failures-v1.jsonl'); const reportPath = path.join(base, 'phash/phash-report-v1.json');
  if (sha256(fs.readFileSync(featurePath)) !== expected.feature || sha256(fs.readFileSync(failurePath)) !== expected.failure || sha256(fs.readFileSync(reportPath)) !== expected.report) throw new Error('pinned baseline bundle member hash mismatch');
  const features = readJsonl<PhashFeatureRow>(featurePath); const failures = readJsonl<PhashFeatureRow>(failurePath); const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, any>;
  const { derivative_contract_id: contractId, ...contract } = report.transform_contract ?? {};
  if (contractId !== expected.contract || contractId !== stableId('derivative-contract', [stableJson(contract)])) throw new Error('pinned baseline transform contract mismatch');
  if (report.lineage?.features?.sha256 !== expected.feature || report.coverage?.successful !== expected.successes || report.coverage?.failures !== expected.failures || features.length !== expected.rows) throw new Error('pinned baseline report/count mismatch');
  const expectedFailures = features.filter((row) => row.status === 'failure');
  if (JSON.stringify(expectedFailures) !== JSON.stringify(failures)) throw new Error('pinned baseline failure file is not exact feature subset');
  if (features.some((row) => row.derivative_contract_id !== expected.contract)) throw new Error('pinned baseline row contract mismatch');
  return { features, failures, report };
}

export async function validateResumeArtifacts(rows: RecoveryRow[], corpusById: Map<string, CorpusInputRow>, outputRoot: string): Promise<void> {
  for (const row of rows) {
    const corpus = corpusById.get(row.record_id);
    if (!corpus || row.image_key !== corpus.image_key || row.canonical_identity !== (corpus.canonical_source_record_id ?? corpus.record_id)) throw new Error(`${row.record_id}: stale resume checkpoint: corpus/image identity mismatch`);
    if (!row.recovered) continue;
    const derivative = fs.readFileSync(containedRegularFile(outputRoot, row.derivative_path!));
    if (sha256(derivative) !== row.derivative_sha256) throw new Error(`${row.record_id}: stale resume checkpoint: derivative hash mismatch`);
    const metadata = await sharp(derivative, { failOn: 'error' }).metadata();
    if (metadata.width !== 256 || metadata.height !== 256 || metadata.format !== 'jpeg') throw new Error(`${row.record_id}: stale resume checkpoint: derivative decode/dimensions mismatch`);
    const feature = await computeVisualFeature(derivative);
    if (feature.normalizedPixelSha256 !== row.normalized_pixel_sha256 || feature.phash64 !== row.phash64) throw new Error(`${row.record_id}: stale resume checkpoint: derived feature mismatch`);
  }
}

export function safeUrl(raw: string, lane: LaneName, expectedR2Host: string): URL {
  const url = new URL(raw);
  const sourceLane = lane === 'authoritative_source';
  if (url.username || url.password || url.search || url.hash) throw new Error('unsafe_url_credentials_query_or_fragment');
  if (sourceLane) {
    if (url.protocol !== 'https:' || !ALLOWED_SOURCE_HOSTS.has(url.hostname)) throw new Error('unsafe_url_source_host_or_protocol');
  } else if (url.protocol !== 'https:' || url.hostname !== expectedR2Host) {
    throw new Error('unsafe_url_public_r2_host_or_protocol');
  }
  return url;
}

async function readCapped(response: Response, cap: number, controller: AbortController): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    throw new Error('size_cap_declared');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        controller.abort();
        await reader.cancel('bounded response exceeded');
        throw new Error('size_cap_actual');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

function emptyEvidence(lane: LaneName, outcome: LaneEvidence['outcome'], code: string, attempt = 1): LaneEvidence {
  return { attempt, lane, outcome, url_class: lane, http_status: null, content_type: null, bytes: null, width: null, height: null, evidence_code: code };
}

export function upgradeAuthoritativeUrl(raw: string): string | null {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(url.hostname)) return url.toString();
  if (url.protocol === 'http:' && url.hostname === 'depot.ville.montreal.qc.ca') {
    url.protocol = 'https:';
    return url.toString();
  }
  return null;
}

export async function fetchLane(rawUrl: string, lane: LaneName, options: {
  expectedR2Host: string; timeoutMs: number; maxBytes: number; fetchImpl?: typeof fetch;
}): Promise<FetchResult> {
  let url: URL;
  try { url = safeUrl(rawUrl, lane, options.expectedR2Host); }
  catch (error) { return { evidence: emptyEvidence(lane, 'unsafe_url', error instanceof Error ? error.message : 'unsafe_url'), buffer: null }; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'image/*' } });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || null;
    if (!response.ok) return { evidence: { ...emptyEvidence(lane, 'http_error', `http_${response.status}`), http_status: response.status, content_type: contentType }, buffer: null };
    if (contentType && !contentType.startsWith('image/')) return { evidence: { ...emptyEvidence(lane, 'non_image', 'unsupported_content_type'), http_status: response.status, content_type: contentType }, buffer: null };
    const buffer = await readCapped(response, options.maxBytes, controller);
    try {
      const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) throw new Error('missing dimensions');
      return { evidence: { attempt: 1, lane, outcome: 'success', url_class: lane, http_status: response.status, content_type: contentType, bytes: buffer.length, width: metadata.width, height: metadata.height, evidence_code: 'decoded_image' }, buffer };
    } catch {
      return { evidence: { ...emptyEvidence(lane, 'decode_failure', 'image_decode_failure'), http_status: response.status, content_type: contentType, bytes: buffer.length }, buffer: null };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/size_cap/.test(message)) return { evidence: emptyEvidence(lane, 'size_cap', message), buffer: null };
    if (/abort|timeout/i.test(message) || controller.signal.aborted) return { evidence: emptyEvidence(lane, 'timeout', 'request_timeout'), buffer: null };
    return { evidence: emptyEvidence(lane, 'http_error', 'transport_error'), buffer: null };
  } finally { clearTimeout(timeout); }
}

export function classify(evidence: LaneEvidence[], recoveredLane: LaneName | null): { root: RootCause; disposition: RecoveryRow['disposition']; reason: string } {
  const byLane = new Map(evidence.map((row) => [row.lane, row]));
  const thumb = byLane.get('public_thumbnail');
  const direct = byLane.get('direct_public_r2');
  if (recoveredLane === 'public_thumbnail') return { root: 'transient_thumbnail_api_failure', disposition: 'recovered_public_r2', reason: 'historical thumbnail failure succeeded under the identical bounded transform contract' };
  if (recoveredLane === 'direct_public_r2') return { root: 'source_object_reachable_but_r2_derivative_unavailable', disposition: 'recovered_public_r2', reason: 'public R2 object decoded while thumbnail path failed' };
  if (recoveredLane === 'known_alias') return { root: 'incorrect_or_stale_image_key', disposition: 'recovered_alias', reason: 'known corpus alias decoded while the current key did not' };
  if (recoveredLane === 'authoritative_source' || recoveredLane === 'registered_quality_derivative') {
    return { root: direct?.http_status === 404 ? 'r2_object_absent' : 'source_object_reachable_but_r2_derivative_unavailable', disposition: 'recovered_authoritative_source', reason: 'authorized archive source decoded; source bytes remain distinct from public-R2 evidence' };
  }
  if (evidence.some((row) => row.outcome === 'size_cap')) return { root: 'bounded_response_size_failure', disposition: 'held_over_contract', reason: 'a reachable candidate exceeded the bounded response contract; this is not evidence of source unavailability' };
  if (evidence.some((row) => row.outcome === 'non_image')) return { root: 'unsupported_non_image_payload', disposition: 'reviewed_unavailable', reason: 'a reachable candidate declared a non-image media type' };
  if (evidence.some((row) => row.outcome === 'decode_failure')) return { root: 'corrupt_or_undecodable_image', disposition: 'reviewed_unavailable', reason: 'a bounded image response could not be decoded' };
  if (evidence.some((row) => row.http_status === 401 || row.http_status === 403)) return { root: 'rights_or_access_blocked', disposition: 'reviewed_unavailable', reason: 'a candidate denied public access; no rights expansion attempted' };
  const source = byLane.get('authoritative_source');
  if (direct?.http_status === 404 && source?.http_status === 404) return { root: 'source_archive_unavailable', disposition: 'reviewed_unavailable', reason: 'both public object and authoritative source returned not found' };
  if (direct?.http_status === 404 && source?.outcome === 'not_attempted') return { root: 'r2_object_absent', disposition: 'reviewed_unavailable', reason: 'public object is absent and no rights-eligible authoritative source URL exists' };
  if (thumb?.outcome === 'timeout' || evidence.some((row) => row.outcome === 'timeout')) return { root: 'indeterminate', disposition: 'indeterminate', reason: 'bounded read timed out; evidence is insufficient for a stronger conclusion' };
  return { root: 'indeterminate', disposition: 'indeterminate', reason: 'bounded public evidence is insufficient for a stronger root-cause conclusion' };
}

function thumbUrl(imageUrl: string): string {
  const url = new URL('/api/thumb', THUMB_ORIGIN);
  url.searchParams.set('src', imageUrl);
  url.searchParams.set('w', '256'); url.searchParams.set('h', '256');
  url.searchParams.set('fit', 'scale-down'); url.searchParams.set('q', '80'); url.searchParams.set('format', 'jpeg');
  return url.toString();
}

async function fetchThumbOnce(imageUrl: string, timeoutMs: number, maxBytes: number, attempt: number, fetchImpl: typeof fetch): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(thumbUrl(imageUrl), { signal: controller.signal, redirect: 'error', headers: { accept: 'image/*' } });
    if (!response.ok) return { evidence: { ...emptyEvidence('public_thumbnail', 'http_error', `http_${response.status}`, attempt), http_status: response.status, content_type: response.headers.get('content-type') }, buffer: null };
    const buffer = await readCapped(response, maxBytes, controller);
    try {
      const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
      if (!metadata.width || !metadata.height) throw new Error('dimensions');
      return { evidence: { attempt, lane: 'public_thumbnail', outcome: 'success', url_class: 'public_thumbnail', http_status: response.status, content_type: response.headers.get('content-type'), bytes: buffer.length, width: metadata.width, height: metadata.height, evidence_code: 'decoded_image' }, buffer };
    } catch { return { evidence: { ...emptyEvidence('public_thumbnail', 'decode_failure', 'image_decode_failure', attempt), http_status: response.status, bytes: buffer.length }, buffer: null }; }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { evidence: emptyEvidence('public_thumbnail', /size_cap/.test(message) ? 'size_cap' : 'timeout', /size_cap/.test(message) ? message : 'request_timeout', attempt), buffer: null };
  } finally { clearTimeout(timeout); }
}

export async function fetchThumbnailAttempts(imageUrl: string, options: { timeoutMs: number; maxBytes: number; attempts: number; backoffMs: number; fetchImpl?: typeof fetch }): Promise<{ evidence: LaneEvidence[]; buffer: Buffer | null }> {
  const evidence: LaneEvidence[] = [];
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const result = await fetchThumbOnce(imageUrl, options.timeoutMs, options.maxBytes, attempt, options.fetchImpl ?? fetch);
    evidence.push(result.evidence);
    if (result.buffer) return { evidence, buffer: result.buffer };
    if (attempt < options.attempts && options.backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, options.backoffMs * attempt));
  }
  return { evidence, buffer: null };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    base: { type: 'string', default: DEFAULT_BASE }, output: { type: 'string', default: DEFAULT_OUTPUT },
    concurrency: { type: 'string', default: '6' }, 'timeout-ms': { type: 'string', default: '15000' },
    'max-response-bytes': { type: 'string', default: '33554432' }, 'no-resume': { type: 'boolean', default: false },
    'quality-derivative-root': { type: 'string', default: DEFAULT_QUALITY_DERIVATIVES },
    'thumbnail-attempts': { type: 'string', default: '3' },
    'thumbnail-backoff-ms': { type: 'string', default: '300' },
    'retry-registered-derivatives': { type: 'boolean', default: false },
    'retry-size-capped': { type: 'boolean', default: false },
    'retry-thumbnail-diagnosis': { type: 'boolean', default: false },
  } });
  const base = path.resolve(values.base!); const output = path.resolve(values.output!);
  const concurrency = Number(values.concurrency); const timeoutMs = Number(values['timeout-ms']); const maxBytes = Number(values['max-response-bytes']);
  const qualityDerivativeRoot = values['quality-derivative-root'] ? path.resolve(values['quality-derivative-root']) : null;
  const thumbnailAttempts = Number(values['thumbnail-attempts']); const thumbnailBackoffMs = Number(values['thumbnail-backoff-ms']);
  const qualityManifest = qualityDerivativeRoot ? await verifyDerivativeManifest(qualityDerivativeRoot) : new Map<string, DerivativeManifest['rows'][number]>();
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be 1..8');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('timeout-ms must be 1000..60000');
  if (!Number.isInteger(maxBytes) || maxBytes < 65536 || maxBytes > 128 * 1024 * 1024) throw new Error('max-response-bytes must be 65536..134217728');
  if (thumbnailAttempts !== RECOVERY_TRANSFORM_CONTRACT.thumbnail_diagnosis.attempts
    || thumbnailBackoffMs !== RECOVERY_TRANSFORM_CONTRACT.thumbnail_diagnosis.backoff_ms) throw new Error('thumbnail retry policy does not match recovery contract');
  const corpusPath = path.join(base, 'input/corpus-input-v1.jsonl');
  if (sha256(fs.readFileSync(corpusPath)) !== HISTORICAL_CORPUS_INPUT_SHA256) throw new Error('historical corpus input hash drift');
  const corpus = readJsonl<CorpusInputRow>(corpusPath);
  if (corpus.some((row) => row.corpus_snapshot_id !== HISTORICAL_ACQUISITION_SNAPSHOT_ID)) throw new Error('historical acquisition snapshot drift');
  const pinnedBaseline = verifyPinnedBaseline(base);
  const failures = pinnedBaseline.failures;
  const ids = failures.map((row) => row.record_id); verifyHistoricalBaseline(ids);
  const byId = new Map(corpus.map((row) => [row.record_id, row]));
  const bySource = new Map<string, CorpusInputRow[]>();
  for (const row of corpus) for (const key of [row.source_identity, ...row.source_record_ids]) {
    if (!key) continue; const group = bySource.get(key) ?? []; group.push(row); bySource.set(key, group);
  }
  const ledgerPath = path.join(output, 'recovery-ledger-v1.jsonl');
  const existing = !values['no-resume'] && fs.existsSync(ledgerPath) ? readJsonl<RecoveryRow>(ledgerPath) : [];
  validateResumeRows(existing, ids, HISTORICAL_CORPUS_INPUT_SHA256);
  await validateResumeArtifacts(existing, byId, output);
  const retryRegistered = values['retry-registered-derivatives'] && qualityDerivativeRoot
    ? new Set(existing.filter((row) => !row.recovered && qualityManifest.has(row.record_id)).map((row) => row.record_id))
    : new Set<string>();
  const retrySizeCapped = values['retry-size-capped'] ? new Set(existing.filter((row) => row.root_cause === 'bounded_response_size_failure').map((row) => row.record_id)) : new Set<string>();
  const rowsById = new Map(existing.filter((row) => !retryRegistered.has(row.record_id) && !retrySizeCapped.has(row.record_id)).map((row) => [row.record_id, row]));
  if (values['retry-thumbnail-diagnosis']) {
    const retryRows = [...rowsById.values()]; let retryCursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (retryCursor < retryRows.length) {
        const row = retryRows[retryCursor++]; const corpusRow = byId.get(row.record_id)!;
        const thumbnail = await fetchThumbnailAttempts(corpusRow.image_url, { timeoutMs, maxBytes: Math.min(maxBytes, 1024 * 1024), attempts: thumbnailAttempts, backoffMs: thumbnailBackoffMs });
        const attemptedLanes = [...thumbnail.evidence, ...row.attempted_lanes.filter((lane) => lane.lane !== 'public_thumbnail')];
        const classified = classify(attemptedLanes, thumbnail.buffer ? 'public_thumbnail' : row.recovered_lane);
        let replacement: Partial<RecoveryRow> = {};
        if (thumbnail.buffer) {
          const derivative = await sharp(thumbnail.buffer, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
          const feature = await computeVisualFeature(derivative); const derivativePath = `derivatives/${row.record_id.replace(/\.json$/, '')}.jpg`;
          fs.writeFileSync(path.join(output, derivativePath), derivative);
          replacement = { recovered_payload_sha256: sha256(thumbnail.buffer), derivative_path: derivativePath, derivative_sha256: sha256(derivative), normalized_pixel_sha256: feature.normalizedPixelSha256, phash64: feature.phash64 };
        }
        rowsById.set(row.record_id, { ...row, ...replacement, attempted_lanes: attemptedLanes, root_cause: classified.root, root_cause_evidence: classified.reason,
          disposition: classified.disposition, recovered_lane: thumbnail.buffer ? 'public_thumbnail' : row.recovered_lane });
      }
    }));
  }
  const queue = ids.filter((id) => !rowsById.has(id)).sort();
  let cursor = 0; let completed = 0;
  const sharedAerial1964Fetches = new Map<string, Promise<FetchResult>>();
  const sharedAerial1964Derivatives = new Map<string, Promise<{ derivative: Buffer; normalizedPixelSha256: string; phash64: string }>>();
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const recordId = queue[cursor++]; const row = byId.get(recordId);
      if (!row) throw new Error(`${recordId}: missing corpus row`);
      const expectedR2Host = new URL(row.image_url).hostname;
      const attempts: LaneEvidence[] = [];
      let recovered: { lane: LaneName; buffer: Buffer } | null = null;
      const thumb = await fetchThumbnailAttempts(row.image_url, { timeoutMs, maxBytes: Math.min(maxBytes, 1024 * 1024), attempts: thumbnailAttempts, backoffMs: thumbnailBackoffMs }); attempts.push(...thumb.evidence);
      if (thumb.buffer) recovered = { lane: 'public_thumbnail', buffer: thumb.buffer };
      const shared1964 = row.source_datasets.includes('aerial_1964') && maxBytes >= 128 * 1024 * 1024;
      if (!recovered && shared1964) {
        const canonicalId = row.canonical_source_record_id ?? row.record_id; const canonicalRow = byId.get(canonicalId)!;
        let pending = sharedAerial1964Fetches.get(row.source_identity);
        if (!pending) { pending = fetchLane(canonicalRow.image_url, 'direct_public_r2', { expectedR2Host, timeoutMs, maxBytes }); sharedAerial1964Fetches.set(row.source_identity, pending); }
        const shared = await pending;
        const lane: LaneName = canonicalId === row.record_id ? 'direct_public_r2' : 'known_alias';
        attempts.push({ ...shared.evidence, lane, url_class: lane, evidence_code: shared.buffer ? 'decoded_image_reused_by_verified_source_identity' : shared.evidence.evidence_code });
        if (shared.buffer) recovered = { lane, buffer: shared.buffer };
      }
      if (!recovered && !shared1964) { const direct = await fetchLane(row.image_url, 'direct_public_r2', { expectedR2Host, timeoutMs, maxBytes }); attempts.push(direct.evidence); if (direct.buffer) recovered = { lane: 'direct_public_r2', buffer: direct.buffer }; }
      const canonicalAlias = row.canonical_source_record_id ? byId.get(row.canonical_source_record_id)?.image_url : null;
      const aliases = [...new Set([canonicalAlias, ...[row.source_identity, ...row.source_record_ids].flatMap((key) => (bySource.get(key) ?? []).map((candidate) => candidate.image_url))].filter((url): url is string => Boolean(url) && url !== row.image_url))].sort();
      if (!recovered && aliases.length) {
        let aliasResult: FetchResult | null = null;
        for (const alias of aliases.slice(0, 8)) { aliasResult = await fetchLane(alias, 'known_alias', { expectedR2Host, timeoutMs, maxBytes }); if (aliasResult.buffer) break; }
        attempts.push(aliasResult?.evidence ?? emptyEvidence('known_alias', 'not_attempted', 'no_safe_alias'));
        if (aliasResult?.buffer) recovered = { lane: 'known_alias', buffer: aliasResult.buffer };
      } else if (!recovered) attempts.push(emptyEvidence('known_alias', 'not_attempted', 'no_known_alias'));
      if (!recovered) {
        const sourceUrls = [...new Set([row.source_identity, ...row.source_urls].filter(Boolean).map(upgradeAuthoritativeUrl).filter((url): url is string => Boolean(url)))].sort();
        let sourceResult: FetchResult | null = null;
        for (const sourceUrl of sourceUrls.slice(0, 4)) { sourceResult = await fetchLane(sourceUrl, 'authoritative_source', { expectedR2Host, timeoutMs, maxBytes }); if (sourceResult.buffer) break; }
        attempts.push(sourceResult?.evidence ?? emptyEvidence('authoritative_source', 'not_attempted', 'no_rights_eligible_source'));
        if (sourceResult?.buffer) recovered = { lane: 'authoritative_source', buffer: sourceResult.buffer };
      }
      if (!recovered && qualityDerivativeRoot) {
        const qualityRow = qualityManifest.get(recordId);
        if (qualityRow) {
          const qualityPath = containedRegularFile(qualityDerivativeRoot, qualityRow.path);
          const qualityBuffer = fs.readFileSync(qualityPath);
          const metadata = await sharp(qualityBuffer, { failOn: 'error' }).metadata();
          attempts.push({ attempt: 1, lane: 'registered_quality_derivative', outcome: 'success', url_class: 'registered_local_artifact', http_status: null,
            content_type: 'image/jpeg', bytes: qualityBuffer.length, width: metadata.width ?? null, height: metadata.height ?? null,
            evidence_code: 'dfv0_quality_kami_failure_reconciliation_v0' });
          recovered = { lane: 'registered_quality_derivative', buffer: qualityBuffer };
        } else attempts.push(emptyEvidence('registered_quality_derivative', 'not_attempted', 'registered_derivative_absent'));
      }
      const classified = classify(attempts, recovered?.lane ?? null);
      let derivativePath: string | null = null; let derivativeSha: string | null = null; let normalized: string | null = null; let phash: string | null = null;
      if (recovered) {
        let derived = shared1964 ? sharedAerial1964Derivatives.get(row.source_identity) : null;
        if (!derived) {
          derived = (async () => {
            const derivative = await sharp(recovered!.buffer, { failOn: 'error' }).rotate().flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
            const feature = await computeVisualFeature(derivative);
            return { derivative, normalizedPixelSha256: feature.normalizedPixelSha256, phash64: feature.phash64 };
          })();
          if (shared1964) sharedAerial1964Derivatives.set(row.source_identity, derived);
        }
        const { derivative, normalizedPixelSha256, phash64 } = await derived;
        derivativePath = `derivatives/${recordId.replace(/\.json$/, '')}.jpg`;
        fs.mkdirSync(path.join(output, 'derivatives'), { recursive: true }); fs.writeFileSync(path.join(output, derivativePath), derivative);
        derivativeSha = sha256(derivative); normalized = normalizedPixelSha256; phash = phash64;
      }
      const result: RecoveryRow = {
        schema_version: RECOVERY_SCHEMA_VERSION, recovery_contract_id: RECOVERY_CONTRACT_ID,
        baseline_failure_stream_sha256: HISTORICAL_FAILURE_STREAM_SHA256, corpus_input_sha256: HISTORICAL_CORPUS_INPUT_SHA256,
        record_id: recordId, image_key: row.image_key, canonical_identity: row.canonical_source_record_id ?? row.record_id,
        source_datasets: row.source_datasets, source_record_ids: row.source_record_ids, attempted_lanes: attempts,
        root_cause: classified.root, root_cause_evidence: classified.reason, disposition: classified.disposition,
        recovered: Boolean(recovered), recovered_lane: recovered?.lane ?? null, recovered_payload_sha256: recovered ? sha256(recovered.buffer) : null,
        recovery_payload_reuse_group_id: recovered && shared1964 ? `source-identity:${sha256(row.source_identity)}` : null,
        recovery_payload_hash_verified: Boolean(recovered && shared1964),
        derivative_path: derivativePath, derivative_sha256: derivativeSha, normalized_pixel_sha256: normalized, phash64: phash,
        source_payload_equality_claimed: false, negative_visual_label: false,
      };
      rowsById.set(recordId, result); completed += 1;
      if (completed % 10 === 0 || completed === queue.length) { writeJsonl(ledgerPath, [...rowsById.values()].sort((a, b) => a.record_id.localeCompare(b.record_id))); console.log(`[recovery-v1] ${completed}/${queue.length}`); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const rows = [...rowsById.values()].map((row): RecoveryRow => row.root_cause === 'bounded_response_size_failure'
    ? { ...row, disposition: 'held_over_contract', root_cause_evidence: 'declared candidate size exceeds the active bounded decode contract; this is not evidence of source unavailability' }
    : row).sort((a, b) => a.record_id.localeCompare(b.record_id));
  assertCompleteLedger(rows, ids); writeJsonl(ledgerPath, rows);
  const baselineFeatures = pinnedBaseline.features;
  const recoveryById = new Map(rows.map((row) => [row.record_id, row]));
  const successorFeatures = baselineFeatures.map((feature): PhashFeatureRow => {
    const recovery = recoveryById.get(feature.record_id); if (!recovery?.recovered) return feature;
    const derivative = fs.readFileSync(path.join(output, recovery.derivative_path!));
    return { ...feature, status: 'success', derivative_contract_id: RECOVERY_CONTRACT_ID, derivative_sha256: recovery.derivative_sha256,
      normalized_pixel_sha256: recovery.normalized_pixel_sha256, phash64: recovery.phash64, derivative_width: 256, derivative_height: 256,
      derivative_bytes: derivative.length, elapsed_ms: 0, attempts: Math.min(5, recovery.attempted_lanes.length), failure_code: null, failure_detail: null };
  });
  writeJsonl(path.join(output, 'successor-phash-features-v1.jsonl'), successorFeatures);
  writeJsonl(path.join(output, 'successor-phash-failures-v1.jsonl'), successorFeatures.filter((row) => row.status === 'failure'));
  const baselineFeatureReport = pinnedBaseline.report;
  const successorFailures = successorFeatures.filter((row) => row.status === 'failure');
  writeJson(path.join(output, 'successor-phash-report-v1.json'), {
    ...baselineFeatureReport,
    schema_version: RECOVERY_SCHEMA_VERSION,
    feature_version: 'phash_dct64_normalized_derivative_v1+canonical_image_recovery_v1',
    coverage: { corpus_records: successorFeatures.length, feature_rows: successorFeatures.length,
      successful: successorFeatures.length - successorFailures.length, failures: successorFailures.length,
      success_rate_percent: Number((((successorFeatures.length - successorFailures.length) / successorFeatures.length) * 100).toFixed(6)),
      failure_codes: Object.fromEntries([...new Set(successorFailures.map((row) => row.failure_code ?? 'unknown'))].sort().map((code) => [code, successorFailures.filter((row) => (row.failure_code ?? 'unknown') === code).length])), individually_reported: successorFailures.length },
    lineage: { ...baselineFeatureReport.lineage, features: { path: 'data/mtl_archives/reports/canonical_image_recovery_v1/successor-phash-features-v1.jsonl', row_count: successorFeatures.length, byte_count: fs.statSync(path.join(output, 'successor-phash-features-v1.jsonl')).size, sha256: sha256(fs.readFileSync(path.join(output, 'successor-phash-features-v1.jsonl'))) } },
    recovery_lineage: { baseline_failure_record_id_stream_sha256: HISTORICAL_FAILURE_STREAM_SHA256, recovery_contract_id: RECOVERY_CONTRACT_ID,
      recovery_transform_contract: RECOVERY_TRANSFORM_CONTRACT,
      recovered_rows: rows.filter((row) => row.recovered).length },
  });
  const noApply = rows.filter((row) => row.recovered && row.recovered_lane !== 'public_thumbnail' && row.recovered_lane !== 'direct_public_r2').map((row) => ({
    schema_version: RECOVERY_SCHEMA_VERSION, action: 'review_object_key_or_backfill', apply: false, record_id: row.record_id, target_image_key: row.image_key,
    source_lane: row.recovered_lane, source_payload_sha256: row.recovered_payload_sha256, derivative_sha256: row.derivative_sha256,
    required_review: ['rights', 'source_byte_selection', 'object_key', 'production_change_approval'],
  }));
  writeJsonl(path.join(output, 'r2-remediation-plan-no-apply-v1.jsonl'), noApply);
  const sizeRows: Array<Record<string, unknown>> = [];
  for (const recovery of rows.filter((row) => row.root_cause === 'bounded_response_size_failure' || row.recovery_payload_reuse_group_id)) {
    const corpusRow = byId.get(recovery.record_id)!;
    const canonical = corpusRow.canonical_source_record_id ? byId.get(corpusRow.canonical_source_record_id) : null;
    const candidates = [canonical?.image_url, corpusRow.image_url, ...corpusRow.source_urls].filter((url): url is string => Boolean(url));
    for (const candidate of [...new Set(candidates)].slice(0, 3)) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(candidate.replace(/^http:/, 'https:'), { method: 'HEAD', signal: controller.signal, redirect: 'error' });
        const declared = Number(response.headers.get('content-length'));
        sizeRows.push({ schema_version: RECOVERY_SCHEMA_VERSION, record_id: recovery.record_id,
          candidate_class: candidate === canonical?.image_url ? 'canonical_public_r2_alias' : candidate === corpusRow.image_url ? 'current_public_r2' : 'authoritative_source',
          status: response.status, content_type: response.headers.get('content-type')?.split(';')[0] ?? null,
          declared_bytes: Number.isFinite(declared) && declared > 0 ? declared : null, exceeds_decode_cap: Number.isFinite(declared) && declared > maxBytes });
      } catch { sizeRows.push({ schema_version: RECOVERY_SCHEMA_VERSION, record_id: recovery.record_id, candidate_class: 'bounded_head_probe', status: null, content_type: null, declared_bytes: null, exceeds_decode_cap: null }); }
      finally { clearTimeout(timeout); }
    }
  }
  writeJsonl(path.join(output, 'source-size-inventory-v1.jsonl'), sizeRows.sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)) || String(a.candidate_class).localeCompare(String(b.candidate_class))));
  const counts = (key: (row: RecoveryRow) => string) => Object.fromEntries([...new Set(rows.map(key))].sort().map((value) => [value, rows.filter((row) => key(row) === value).length]));
  const payloadBytes = new Map<string, number>();
  for (const row of rows.filter((candidate) => candidate.recovered_payload_sha256)) {
    const bytes = row.attempted_lanes.find((lane) => lane.outcome === 'success')?.bytes ?? 0;
    payloadBytes.set(row.recovered_payload_sha256!, bytes);
  }
  writeJson(path.join(output, 'recovery-report-v1.json'), {
    schema_version: RECOVERY_SCHEMA_VERSION, recovery_contract_id: RECOVERY_CONTRACT_ID,
    baseline: { count: ids.length, failure_record_id_stream_sha256: verifyHistoricalBaseline(ids), acquisition_snapshot_id: HISTORICAL_ACQUISITION_SNAPSHOT_ID, corpus_input_sha256: HISTORICAL_CORPUS_INPUT_SHA256 },
    coverage: { ledger_rows: rows.length, unique_rows: new Set(rows.map((row) => row.record_id)).size, recovered: rows.filter((row) => row.recovered).length, unresolved: rows.filter((row) => !row.recovered).length, indeterminate: rows.filter((row) => row.disposition === 'indeterminate').length },
    root_causes: counts((row) => row.root_cause), dispositions: counts((row) => row.disposition), recovered_lanes: counts((row) => row.recovered_lane ?? 'none'),
    recovery_transfer: { unique_payloads: payloadBytes.size, unique_payload_bytes: [...payloadBytes.values()].reduce((sum, value) => sum + value, 0), reused_rows: rows.filter((row) => row.recovery_payload_reuse_group_id).length, reuse_groups: new Set(rows.map((row) => row.recovery_payload_reuse_group_id).filter(Boolean)).size },
    artifacts: { ledger_sha256: sha256(fs.readFileSync(ledgerPath)), successor_features_sha256: sha256(fs.readFileSync(path.join(output, 'successor-phash-features-v1.jsonl'))), no_apply_rows: noApply.length, source_size_rows: sizeRows.length },
    source_artifacts: qualityDerivativeRoot ? [{ stable_id: 'ccv1_recovery_quality_derivatives_20260711', tree_sha256: JSON.parse(fs.readFileSync(path.join(qualityDerivativeRoot, 'manifest-v1.json'), 'utf8')).tree_sha256 }] : [],
    boundaries: { production_mutation: false, source_payload_equality_claimed: false, unavailable_as_negative_visual_label: false, paid_compute: false },
  });
  console.log(JSON.stringify({ status: 'ok', records: rows.length, recovered: rows.filter((row) => row.recovered).length, output }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
