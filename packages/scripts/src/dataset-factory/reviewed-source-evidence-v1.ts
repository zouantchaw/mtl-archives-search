import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

type Json = Record<string, any>;
type SourceConfig = {
  sourceId: string;
  bodyMember?: string;
  rightsId: string;
  rightsMode: 'private_review_snapshot' | 'tracked_permitted_body' | 'citation_only_not_promotion_eligible';
  propositions: Array<{ id: string; passage?: string; locator?: string; method: string }>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURE_REL = 'docs/dataset-factory/fixtures/reviewed-source-evidence-v1';
const FIXTURE = path.join(ROOT, FIXTURE_REL);
const SCHEMAS = path.join(ROOT, 'docs/dataset-factory/schemas/reviewed-source-evidence-v1');
const GATE_B = path.join(ROOT, 'docs/dataset-factory/fixtures/ground-authoritative-research-v1');
const GATE_C = path.join(ROOT, 'docs/dataset-factory/fixtures/ground-claim-adjudication-v1');
const PHASE_D = path.join(ROOT, 'docs/dataset-factory/fixtures/phase-d-scale-v1');
const REGISTRY = path.join(ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');
const REGISTRY_ID = 'dfv0_reviewed_source_evidence_v1';
const VERSION = 'reviewed_source_evidence_v1.0.0';
const ARTIFACT_ID = 'reviewed-source-evidence-v1';
const CREATED_AT = '2026-07-14T02:22:24.000Z';
const DEFAULT_EXTERNAL = '/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-archives/issue89-source-bodies/candidate-v1';
const AUTHORITY = 'independent-source-body-review-receipt-v1.json';
const CLAIM_IDS = ['c0-lovell', 'c0-rpcq', 'c10-spelling', 'c100-date', 'c101-laphkas', 'c102-date-address', 'c105-tilden'];
const CANDIDATE_MEMBERS = [
  'acquisition-manifest-v1.json', 'bounded-review-representations-v1.json', 'source-body-review-input-v1.json',
  'independent-source-body-review-receipt.template-v1.json', 'unresolved-queue-v1.json', 'rights-blocked-queue-v1.json',
  'status-report-v1.json', 'external-snapshot-descriptor-v1.json', 'manifest-v1.json',
] as const;
const PRESERVED_CANDIDATE_DESCRIPTOR = 'candidate-descriptor-v1.json';
const PUBLISHED_MEMBERS = [...CANDIDATE_MEMBERS, AUTHORITY, 'promotion-ledger-v1.json', PRESERVED_CANDIDATE_DESCRIPTOR] as const;
const FINAL_ONLY = [AUTHORITY, 'promotion-ledger-v1.json'];
const PUBLIC_TOKEN_MEMBER = 'bodies/rpcq-105269.html';
const CREDENTIAL_SCAN_POLICY = 'credential_like_scan_v1';
const PRIVATE_ARCHIVE_SHA256 = 'd94857447ad48178cf42c5baa17e54f7e2f430f1141e47dedfde2a24ade424c1';
const PRIVATE_ARCHIVE_BYTES = 53451;
const PRIVATE_R2_BUCKET = 'wiel-codex-worker-cache';
const PRIVATE_R2_OBJECT_KEY = `artifacts/mtl-archives/issue89-reviewed-source-evidence/${PRIVATE_ARCHIVE_SHA256}.tar.gz`;
const PRIVATE_R2_LOCATOR = `r2://${PRIVATE_R2_BUCKET}/${PRIVATE_R2_OBJECT_KEY}`;
const PRIVATE_R2_OBSERVED_AT = '2026-07-14T03:58:13Z';

const bodySpecs = [
  { member: 'bodies/rpcq-13105.html', receiptMember: 'acquisition-receipts/rpcq-13105.json', raw: 'rpcq-13105.html', configuredUrl: 'https://www.patrimoine-culturel.gouv.qc.ca/rpcq/detail.do?id=13105&methode=consulter&type=pge', family: 'rpcq-register', rightsId: 'rights-rpcq' },
  { member: 'bodies/rpcq-105269.html', receiptMember: 'acquisition-receipts/rpcq-105269.json', raw: 'rpcq-105269.html', configuredUrl: 'https://www.patrimoine-culturel.gouv.qc.ca/rpcq/detail.do?id=105269&methode=consulter&type=bien', family: 'rpcq-document-105269', rightsId: 'rights-rpcq' },
  { member: 'bodies/parks-657.html', receiptMember: 'acquisition-receipts/parks-657.json', raw: 'parks-657.html', configuredUrl: 'https://www.pc.gc.ca/apps/dfhd/page_nhs_eng.aspx?id=657', family: 'parks-register', rightsId: 'rights-parks' },
  { member: 'bodies/rpcq-rights.html', receiptMember: 'acquisition-receipts/rpcq-rights.json', raw: 'rpcq-rights.html', configuredUrl: 'https://www.patrimoine-culturel.gouv.qc.ca/rpcq/redirection.do?go=copyright', family: 'rpcq-rights', rightsId: 'rights-rpcq' },
  { member: 'bodies/parks-terms.html', receiptMember: 'acquisition-receipts/parks-terms.json', raw: 'parks-terms.html', configuredUrl: 'https://parks.canada.ca/termes-terms', family: 'parks-rights', rightsId: 'rights-parks' },
] as const;

const sourceConfigs: SourceConfig[] = [
  { sourceId: 'r0-rpcq-gazette', bodyMember: 'bodies/rpcq-13105.html', rightsId: 'rights-rpcq', rightsMode: 'private_review_snapshot', propositions: [
    { id: 'p-c0-rpcq-address', passage: "En 1925, The Gazette s'établit au 1000, rue Saint-Antoine, à Montréal", method: 'html_text_token_sequence_v1' },
    { id: 'p-c0-rpcq-year', passage: 'En 1925', method: 'html_text_token_sequence_v1' },
  ] },
  { sourceId: 'r100-rpcq-laurentien', bodyMember: 'bodies/rpcq-105269.html', rightsId: 'rights-rpcq', rightsMode: 'private_review_snapshot', propositions: [
    { id: 'p-c100-rpcq-built-1947', passage: "En 1947, l'hôtel Laurentien est construit sur la partie nord du lot", method: 'html_text_token_sequence_v1' },
  ] },
  { sourceId: 'r102-rpcq-st-george', bodyMember: 'bodies/rpcq-105269.html', rightsId: 'rights-rpcq', rightsMode: 'private_review_snapshot', propositions: [
    { id: 'p-c102-rpcq-annex-period', passage: '1947 – 1948 (Construction)', method: 'html_text_token_sequence_v1' },
    { id: 'p-c102-rpcq-address', passage: 'Adresse : 1001, avenue des Canadiens-de-Montréal', method: 'html_text_token_sequence_v1' },
  ] },
  { sourceId: 'r102-parks-st-george', bodyMember: 'bodies/parks-657.html', rightsId: 'rights-parks', rightsMode: 'private_review_snapshot', propositions: [
    { id: 'p-c102-parks-address-1101', passage: 'Address : 1101 Avenue des Canadiens-de-Montréal, Montréal, Quebec', method: 'html_text_token_sequence_v1' },
    { id: 'p-c102-parks-plaque-1001', passage: 'Approved Inscription: 1001 Avenue des Canadiens-de-Montréal, Montréal, Quebec', method: 'html_text_token_sequence_v1' },
  ] },
  { sourceId: 'r10-city-archive-predecessor', rightsId: 'rights-city-open-data', rightsMode: 'tracked_permitted_body', propositions: [{ id: 'p-c10-city-perreault', passage: 'Institut Sténographique Perreault', locator: 'selected-ground-rows-v1.json#rows[numeric_id=10].official_row.Description', method: 'predecessor_structured_field_exact_v1' }] },
  { sourceId: 'r102-city-record', rightsId: 'rights-city-open-data', rightsMode: 'tracked_permitted_body', propositions: [
    { id: 'p-c102-city-date', passage: '25-avr.-47', locator: 'selected-ground-rows-v1.json#rows[numeric_id=102].official_row.Date', method: 'predecessor_structured_field_exact_v1' },
    { id: 'p-c102-city-address', passage: '1086, rue Osborne - devenu rue de Lagauchetière', locator: 'selected-ground-rows-v1.json#rows[numeric_id=102].official_row.Titre', method: 'predecessor_structured_field_exact_v1' },
  ] },
];

const unavailableSourceIds = ['r0-lovell-1927', 'r10-lovell-1932-a', 'r100-lapresse-dossier', 'r100-armour-landry', 'r101-lapresse-1927', 'r105-lovell-1944'];
const sha = (value: Buffer | string): string => crypto.createHash('sha256').update(value).digest('hex');
const bytes = (file: string): Buffer => fs.readFileSync(file);
const read = (file: string): any => JSON.parse(bytes(file).toString('utf8'));
const canonical = (value: any): string => `${JSON.stringify(value, null, 2)}\n`;
const write = (file: string, value: any): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, canonical(value)); };
const assert: (condition: any, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const pin = (file: string): Json => ({ path: path.relative(ROOT, file).split(path.sep).join('/'), bytes: bytes(file).length, sha256: sha(bytes(file)) });
const binding = (file: string, relative = path.basename(file)): Json => ({ path: relative, bytes: bytes(file).length, sha256: sha(bytes(file)) });
const exactStrings = (actual: string[], expected: readonly string[], label: string): void => { assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), `${label}: exact ordered values differ`); };
const descriptorTree = (members: Json[]): string => sha(`${members.map(x => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`);

function safeRelative(value: string, label: string): string {
  assert(value.length > 0 && !path.isAbsolute(value) && !value.includes('\\'), `${label}: unsafe path`);
  const normalized = path.posix.normalize(value);
  assert(normalized === value && !value.startsWith('../') && value !== '..' && !value.split('/').includes('..'), `${label}: traversal`);
  return value;
}
function resolveContained(root: string, relative: string, label: string): string {
  safeRelative(relative, label);
  const rootReal = fs.realpathSync(root), file = path.join(rootReal, relative);
  let cursor = file;
  while (cursor !== rootReal) { assert(fs.existsSync(cursor), `${label}: missing path`); assert(!fs.lstatSync(cursor).isSymbolicLink(), `${label}: symlink rejected`); cursor = path.dirname(cursor); }
  assert(fs.lstatSync(file).isFile(), `${label}: not a regular file`);
  return file;
}
function stableExternalFile(input: string): Buffer {
  const resolved = path.resolve(input);
  assert(resolved === input && !input.split(path.sep).includes('..'), 'external input must be an absolute normalized path');
  const stat = fs.lstatSync(resolved); assert(stat.isFile() && !stat.isSymbolicLink(), 'external input symlink/non-file rejected');
  const before = { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }, raw = bytes(resolved), after = fs.lstatSync(resolved);
  assert(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'external input changed while reading');
  return raw;
}
function credentialLikeClassification(member: string, raw: Buffer): Json {
  const text = raw.toString('utf8');
  const publicMapbox = [...text.matchAll(/\bpk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)];
  const assignments = [...text.matchAll(/(?:api[_-]?key|access[_-]?token|accessToken|authToken|secret|password)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi)];
  const unclassifiedAssignments = assignments.filter(match => !publicMapbox.some(token => {
    const tokenStart = token.index ?? -1, assignmentStart = match.index ?? -1;
    return tokenStart >= assignmentStart && tokenStart + token[0].length <= assignmentStart + match[0].length;
  }));
  const unclassifiedPatterns = [
    /\bsk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
    /(?:[?&](?:X-Amz-Signature|signature|sig|token|api[_-]?key)=)[^&#"'\s]+/gi,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  ];
  const unclassified = unclassifiedAssignments.length + unclassifiedPatterns.reduce((count, detector) => count + [...text.matchAll(detector)].length, 0);
  const expectedPublicCount = member === PUBLIC_TOKEN_MEMBER ? 1 : 0;
  assert(publicMapbox.length === expectedPublicCount, `origin-public client token occurrence/member drift: ${member}`);
  assert(unclassified === 0, `unclassified credential-like material detected: ${member}`);
  return {
    scan_policy: CREDENTIAL_SCAN_POLICY,
    classification: expectedPublicCount === 1 ? 'origin_public_client_token' : 'none_detected',
    occurrence_count: expectedPublicCount,
    unclassified_occurrence_count: 0,
    handling: expectedPublicCount === 1
      ? 'Preserved only inside the exact private HTML snapshot; it is an origin-published client token, not an operator credential or project secret.'
      : 'No credential-like material detected by the declared scan policy.',
  };
}
function privateArchiveReceipt(): Json {
  return { receipt_version: 'private_r2_upload_readback_receipt_v1', provider: 'cloudflare_r2', bucket: PRIVATE_R2_BUCKET, object_key: PRIVATE_R2_OBJECT_KEY, durable_locator: PRIVATE_R2_LOCATOR, archive_sha256: PRIVATE_ARCHIVE_SHA256, archive_bytes: PRIVATE_ARCHIVE_BYTES, uploaded: true, readback_status: 'direct_readback_byte_identical', observed_at: PRIVATE_R2_OBSERVED_AT, presigned_url: null };
}
function verifyArchivalEvent(descriptor: Json): void {
  assert(descriptor.status === 'candidate_private_snapshot_archived_readback_verified', 'private archival status drift');
  assert(descriptor.external_locator === PRIVATE_R2_LOCATOR && descriptor.external_locator === `r2://${descriptor.upload_readback_receipt.bucket}/${descriptor.upload_readback_receipt.object_key}` && !/^https?:/.test(descriptor.external_locator), 'private durable locator substitution');
  assert(canonical(descriptor.upload_readback_receipt) === canonical(privateArchiveReceipt()), 'private upload/readback receipt drift');
  assert(descriptor.archive_sha256 === PRIVATE_ARCHIVE_SHA256 && descriptor.archive_bytes === PRIVATE_ARCHIVE_BYTES && descriptor.upload_readback_receipt.archive_sha256 === descriptor.archive_sha256 && descriptor.upload_readback_receipt.archive_bytes === descriptor.archive_bytes, 'private archive receipt/body binding drift');
  assert(descriptor.upload_readback_receipt.presigned_url === null, 'presigned URL storage rejected');
}

const normalizeContentType = (value: string): string => value.split(';').map(part => part.trim().toLowerCase()).filter(Boolean).join('; ');
function parseCurlMeta(raw: Buffer): Json {
  const text = raw.toString('utf8').trim();
  const match = /^(\d{3})\s+(.+?)\s+(https:\/\/\S+)$/.exec(text);
  assert(match, 'curl metadata format rejected');
  const effective = new URL(match[3]);
  assert(effective.protocol === 'https:' && !effective.username && !effective.password && !effective.hash, 'curl effective URL unsafe');
  return { status: Number(match[1]), content_type: normalizeContentType(match[2]), effective_url: effective.toString() };
}
function parseSanitizedHeaders(raw: Buffer): Json {
  const blocks: Array<{ status: number; headers: Map<string, string[]> }> = [];
  let current: { status: number; headers: Map<string, string[]> } | null = null;
  for (const line of raw.toString('latin1').split(/\r?\n/)) {
    if (!line) continue;
    const status = /^HTTP\/\S+\s+(\d{3})(?:\s|$)/i.exec(line);
    if (status) { current = { status: Number(status[1]), headers: new Map() }; blocks.push(current); continue; }
    assert(current && !/^[ \t]/.test(line), 'header format/folding rejected');
    const separator = line.indexOf(':'); assert(separator > 0, 'malformed response header rejected');
    const name = line.slice(0, separator).trim().toLowerCase(); assert(/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name), 'invalid response header name');
    const values = current.headers.get(name) ?? []; values.push(line.slice(separator + 1).trim()); current.headers.set(name, values);
  }
  assert(blocks.length > 0, 'response status missing');
  const final = blocks.at(-1)!;
  const one = (name: string, required: boolean): string | null => { const values = final.headers.get(name) ?? []; assert(!required || values.length === 1, `${name} header missing/duplicate`); assert(values.length <= 1, `${name} header duplicate`); return values[0] ?? null; };
  const date = one('date', true)!, contentType = one('content-type', true)!, contentLengthRaw = one('content-length', false);
  const parsedDate = new Date(date); assert(!Number.isNaN(parsedDate.valueOf()), 'Date header invalid');
  const contentLength = contentLengthRaw === null ? null : Number(contentLengthRaw); assert(contentLength === null || (Number.isSafeInteger(contentLength) && contentLength >= 0), 'Content-Length header invalid');
  return { final_status: final.status, date_utc: parsedDate.toISOString(), content_type: normalizeContentType(contentType), content_length: contentLength };
}
function acquisitionReceipt(spec: typeof bodySpecs[number], rawRoot: string): Json {
  const body = stableExternalFile(path.join(rawRoot, spec.raw)), curlRaw = stableExternalFile(path.join(rawRoot, `${spec.raw}.curl-meta`)), headerRaw = stableExternalFile(path.join(rawRoot, `${spec.raw}.headers`));
  const curl = parseCurlMeta(curlRaw), headers = parseSanitizedHeaders(headerRaw);
  assert(curl.effective_url === new URL(spec.configuredUrl).toString(), `configured request/effective URL mismatch: ${spec.raw}`);
  assert(curl.status === headers.final_status, `curl/header status mismatch: ${spec.raw}`);
  assert(curl.content_type === headers.content_type, `curl/header content-type mismatch: ${spec.raw}`);
  assert(headers.content_length === null || headers.content_length === body.length, `header/body content-length mismatch: ${spec.raw}`);
  const receipt: Json = {
    receipt_version: 'acquisition_transport_receipt_v1', capture_id: `capture-${spec.raw.replace('.html', '')}`,
    request_url: spec.configuredUrl, request_url_basis: 'generator_config_not_separately_observed', request_url_independently_observed: false, request_url_required_to_equal_effective_url: true,
    effective_url: curl.effective_url, status: curl.status, media_type: curl.content_type, captured_at: headers.date_utc,
    final_headers: headers,
    body: { path: spec.member, sha256: sha(body), bytes: body.length },
    raw_audit_digests: { curl_meta: { bytes: curlRaw.length, sha256: sha(curlRaw) }, headers: { bytes: headerRaw.length, sha256: sha(headerRaw) } },
    sanitization: { allowlisted_transport_fields: ['effective_url', 'status', 'date', 'content-type', 'content-length'], raw_headers_archived: false, cookie_values_archived: false, auth_material_archived: false, signed_urls_archived: false },
  };
  const classification = credentialLikeClassification(spec.receiptMember, Buffer.from(canonical(receipt)));
  receipt.credential_like_material = classification;
  validate('acquisition-receipt', receipt);
  return receipt;
}

// Deterministic tokenization is deliberately narrow: scripts/styles are dropped and text nodes retain source order.
function htmlTextNodes(raw: Buffer): Array<{ index: number; text: string }> {
  const html = raw.toString('utf8'), out: Array<{ index: number; text: string }> = [];
  let i = 0, node = 0, suppressed = '';
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i + 1); assert(end >= 0, 'unterminated HTML tag');
      const inside = html.slice(i + 1, end).trim(), closing = inside.startsWith('/'), name = inside.replace(/^\//, '').split(/[\s/>]/, 1)[0]!.toLowerCase();
      if (!closing && (name === 'script' || name === 'style')) suppressed = name;
      else if (closing && name === suppressed) suppressed = '';
      i = end + 1; continue;
    }
    const end = html.indexOf('<', i), rawText = html.slice(i, end < 0 ? html.length : end); i = end < 0 ? html.length : end;
    if (suppressed) continue;
    const text = decodeEntities(rawText).replace(/\s+/g, ' ').trim();
    if (text) out.push({ index: node++, text });
  }
  return out;
}
function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', ndash: '–', mdash: '—', quot: '"', rsquo: '’', lsquo: '‘', eacute: 'é', Eacute: 'É', agrave: 'à', Aacute: 'Á', ocirc: 'ô', oelig: 'œ' };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity] ?? full;
  });
}
const normalized = (value: string): string => value.normalize('NFKC').replace(/[’ ]/g, m => m === '’' ? "'" : ' ').replace(/&ndash;|&#8209;/g, '–').replace(/\s+/g, ' ').trim();
function locatePassage(raw: Buffer, requested: string): { passage: string; locator: string } {
  const nodes = htmlTextNodes(raw), joined = normalized(nodes.map(x => x.text).join(' ')), needle = normalized(requested);
  const at = joined.indexOf(needle); assert(at >= 0, `bounded passage absent: ${requested}`); assert(joined.indexOf(needle, at + 1) < 0, `bounded passage ambiguous: ${requested}`);
  let start = 0, end = 0, offset = 0;
  for (const n of nodes) { const next = offset + normalized(n.text).length + 1; if (offset <= at) start = n.index; if (next < at + needle.length) end = n.index; offset = next; }
  end = Math.max(end, start);
  assert(Buffer.byteLength(needle, 'utf8') <= 240, 'long excerpt rejected');
  return { passage: needle, locator: `html_text_nodes[${start}:${end}]` };
}

function tarHeader(name: string, size: number): Buffer {
  assert(Buffer.byteLength(name) <= 100, 'tar member name too long'); const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8'); h.write('0000644\0', 100, 'ascii'); h.write('0000000\0', 108, 'ascii'); h.write('0000000\0', 116, 'ascii'); h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii'); h.write('00000000000\0', 136, 'ascii'); h.fill(0x20, 148, 156); h[156] = 0x30; h.write('ustar\0', 257, 'ascii'); h.write('00', 263, 'ascii'); h.write('root', 265, 'ascii'); h.write('root', 297, 'ascii');
  const sum = h.reduce((a, b) => a + b, 0); h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii'); return h;
}
function makeBundle(rawRoot: string, externalRoot: string): Json {
  const chunks: Buffer[] = [], members: Json[] = [], acquisitionReceipts: Json[] = [];
  for (const spec of bodySpecs) {
    const raw = stableExternalFile(path.join(rawRoot, spec.raw)), receipt = acquisitionReceipt(spec, rawRoot), receiptRaw = Buffer.from(canonical(receipt)); acquisitionReceipts.push(receipt);
    for (const member of [{ path: spec.member, kind: 'exact_private_body', raw, classification: credentialLikeClassification(spec.member, raw) }, { path: spec.receiptMember, kind: 'sanitized_acquisition_receipt', raw: receiptRaw, classification: credentialLikeClassification(spec.receiptMember, receiptRaw) }]) {
      members.push({ path: member.path, member_kind: member.kind, bytes: member.raw.length, sha256: sha(member.raw), credential_like_material: member.classification });
      chunks.push(tarHeader(member.path, member.raw.length), member.raw, Buffer.alloc((512 - member.raw.length % 512) % 512));
    }
  }
  chunks.push(Buffer.alloc(1024)); const uncompressed = Buffer.concat(chunks); const archive = zlib.gzipSync(uncompressed, { level: 9 });
  assert(archive.length === PRIVATE_ARCHIVE_BYTES && sha(archive) === PRIVATE_ARCHIVE_SHA256, 'private archive bytes/hash drift from completed R2 event');
  const archivePath = path.join(externalRoot, 'reviewed-source-evidence-v1-private-snapshot.tar.gz'); fs.mkdirSync(externalRoot, { recursive: true }); fs.writeFileSync(archivePath, archive);
  return { path: archivePath, bytes: archive.length, sha256: sha(archive), uncompressed_bytes: uncompressed.length, members, acquisitionReceipts };
}
function archiveFromMembers(members: Map<string, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, raw] of members) chunks.push(tarHeader(name, raw.length), raw, Buffer.alloc((512 - raw.length % 512) % 512));
  chunks.push(Buffer.alloc(1024)); return zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
}
function parseTar(archive: Buffer): Map<string, Buffer> {
  const tar = zlib.gunzipSync(archive), members = new Map<string, Buffer>(); let offset = 0;
  while (offset + 512 <= tar.length) { const header = tar.subarray(offset, offset + 512); if (header.every(x => x === 0)) break; const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, ''); safeRelative(name, 'archive member'); const type = header[156]; assert(type === 0 || type === 0x30, 'archive links/non-files rejected'); const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(); assert(/^[0-7]+$/.test(sizeText), 'invalid tar size'); const size = Number.parseInt(sizeText, 8); offset += 512; assert(offset + size <= tar.length && !members.has(name), 'archive truncation/duplicate member'); members.set(name, tar.subarray(offset, offset + size)); offset += Math.ceil(size / 512) * 512; }
  return members;
}

function predecessorPins(): Json[] {
  return [
    path.join(GATE_B, 'descriptor-v1.json'), path.join(GATE_B, 'pending-claims-v1.json'), path.join(GATE_B, 'source-graph-v1.json'),
    path.join(GATE_C, 'descriptor-v1.json'), path.join(GATE_C, 'independent-adjudication-v1.json'),
    path.join(PHASE_D, 'descriptor-v1.json'), path.join(PHASE_D, 'reviewer-selection-receipt-v1.json'),
    path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json'),
  ].map(pin);
}
function candidateArtifacts(rawRoot: string, externalRoot: string): Record<string, any> {
  const bundle = makeBundle(rawRoot, externalRoot), sourceGraph = read(path.join(GATE_B, 'source-graph-v1.json')), pending = read(path.join(GATE_B, 'pending-claims-v1.json'));
  const families = new Map<string, Json>(sourceGraph.families.map((x: Json) => [x.family_id, x]));
  const receiptByCapture = new Map(bundle.acquisitionReceipts.map((receipt: Json) => [receipt.capture_id, receipt]));
  const acquisition = { schema_version: VERSION, artifact_id: ARTIFACT_ID, capture_time_basis: 'sanitized_final_response_date_header_utc', request_url_evidence_limitation: 'Original request URLs were not separately retained. Each configured request URL is declared as generator configuration and required to equal the independently retained curl effective URL.', credential_like_scan_policy: CREDENTIAL_SCAN_POLICY, captures: bodySpecs.map(spec => { const receipt = receiptByCapture.get(`capture-${spec.raw.replace('.html', '')}`)! as Json, receiptRaw = Buffer.from(canonical(receipt)); return { capture_id: receipt.capture_id, request_url: receipt.request_url, request_url_basis: receipt.request_url_basis, request_url_independently_observed: receipt.request_url_independently_observed, effective_url: receipt.effective_url, status: receipt.status, media_type: receipt.media_type, captured_at: receipt.captured_at, final_header_content_length: receipt.final_headers.content_length, body_sha256: receipt.body.sha256, body_bytes: receipt.body.bytes, source_family_id: spec.family, private_snapshot_member: receipt.body.path, acquisition_receipt_member: spec.receiptMember, acquisition_receipt_sha256: sha(receiptRaw), acquisition_receipt_bytes: receiptRaw.length, raw_curl_meta_sha256: receipt.raw_audit_digests.curl_meta.sha256, raw_curl_meta_bytes: receipt.raw_audit_digests.curl_meta.bytes, raw_headers_sha256: receipt.raw_audit_digests.headers.sha256, raw_headers_bytes: receipt.raw_audit_digests.headers.bytes, rights_mode: 'private_review_snapshot', rights_id: spec.rightsId, credential_like_material: receipt.credential_like_material }; }) };
  const acquisitionByMember = new Map(acquisition.captures.map((x: Json) => [x.private_snapshot_member, x]));
  const predecessorRows = read(path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json')).rows;
  const representations: Json[] = sourceConfigs.map(source => {
    const capture = source.bodyMember ? acquisitionByMember.get(source.bodyMember) : null;
    const propositions = source.propositions.map(prop => {
      const located = capture && prop.passage ? locatePassage(stableExternalFile(path.join(rawRoot, bodySpecs.find(x => x.member === source.bodyMember)!.raw)), prop.passage) : { passage: prop.passage, locator: prop.locator };
      if (!capture) { const match = /numeric_id=(\d+)\]\.official_row\.([A-Za-z]+)/.exec(String(prop.locator)); assert(match, `invalid predecessor field locator: ${prop.locator}`); const row = predecessorRows.find((x: Json) => x.numeric_id === Number(match[1])); assert(row && String(row.official_row[match[2]]).includes(String(prop.passage)), `predecessor structured passage absent: ${prop.id}`); }
      return { proposition_id: prop.id, passage: located.passage, locator: located.locator, extraction_method: prop.method };
    });
    return { representation_id: `repr-${source.sourceId}`, source_id: source.sourceId, source_family_id: read(path.join(GATE_B, 'capture-ledger-v1.json')).sources.find((x: Json) => x.source_id === source.sourceId).family_id, body_sha256: capture?.body_sha256 ?? pin(path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json')).sha256, body_bytes: capture?.body_bytes ?? pin(path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json')).bytes, rights_mode: source.rightsMode, rights_id: source.rightsId, reviewer_safe_rights_statement: source.rightsMode === 'private_review_snapshot' ? 'Private review only; commercial redistribution permission is not established. The repository tracks only these short factual passages.' : 'CC BY 4.0 predecessor metadata may be reviewed, but the City archive family cannot count as independent external corroboration.', propositions };
  });
  for (const sourceId of unavailableSourceIds) { const source = read(path.join(GATE_B, 'capture-ledger-v1.json')).sources.find((x: Json) => x.source_id === sourceId); representations.push({ representation_id: `repr-${sourceId}`, source_id: sourceId, source_family_id: source.family_id, body_sha256: null, body_bytes: null, rights_mode: 'citation_only_not_promotion_eligible', rights_id: 'rights-banq-citation-only', reviewer_safe_rights_statement: 'Citation and manual transcription only. No scan or permitted hash-bound representation is available to the reviewer.', propositions: [] }); }
  const rpcqRights = locatePassage(stableExternalFile(path.join(rawRoot, 'rpcq-rights.html')), 'La reproduction multiple de l’un quelconque de ces documents, en tout ou en partie, pour diffusion commerciale est interdite sauf avec la permission écrite'), parksRights = locatePassage(stableExternalFile(path.join(rawRoot, 'parks-terms.html')), 'you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission');
  const rights = [
    { rights_id: 'rights-rpcq', source_url: acquisition.captures[3].effective_url, body_sha256: acquisition.captures[3].body_sha256, body_bytes: acquisition.captures[3].body_bytes, mode: 'private_review_snapshot', statement: 'RPCQ permits specified non-commercial uses; commercial redistribution permission is not established.', passage: rpcqRights.passage, locator: rpcqRights.locator, extraction_method: 'html_text_token_sequence_v1' },
    { rights_id: 'rights-parks', source_url: acquisition.captures[4].effective_url, body_sha256: acquisition.captures[4].body_sha256, body_bytes: acquisition.captures[4].body_bytes, mode: 'private_review_snapshot', statement: 'Parks Canada requires prior permission for commercial redistribution unless otherwise specified.', passage: parksRights.passage, locator: parksRights.locator, extraction_method: 'html_text_token_sequence_v1' },
    { rights_id: 'rights-city-open-data', source_url: 'https://donnees.montreal.ca/pages/licence-d-utilisation', body_sha256: pin(path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json')).sha256, body_bytes: pin(path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/selected-ground-rows-v1.json')).bytes, mode: 'tracked_permitted_body', statement: 'Existing predecessor evidence records CC BY 4.0; it remains the same City family and is not independent external corroboration.', passage: 'CC BY 4.0', locator: 'ground-authoritative-research-v1 predecessor rights evidence', extraction_method: 'predecessor_structured_field_exact_v1' },
    { rights_id: 'rights-banq-citation-only', source_url: 'https://numerique.banq.qc.ca/', body_sha256: null, body_bytes: null, mode: 'citation_only_not_promotion_eligible', statement: 'No scans are captured. Manual transcriptions and leads cannot promote without separately inspectable permitted hash-bound evidence.', passage: 'citation only; no scan captured', locator: 'Gate B source rights_policy fields', extraction_method: 'predecessor_structured_field_exact_v1' },
  ];
  const reprArtifact = { schema_version: VERSION, artifact_id: ARTIFACT_ID, representations, rights };
  const reprBySource = new Map<string, Json>(representations.map(x => [x.source_id, x]));
  const reviewInput = { schema_version: VERSION, artifact_id: ARTIFACT_ID, stage: 'candidate_review_input', predecessor_pins: predecessorPins(), claims: pending.claims.map((claim: Json) => { const sourceIds: string[] = [...claim.supporting_source_ids, ...claim.contradicting_source_ids]; return { claim_id: claim.claim_id, record_id: claim.record_id, exact_claim_text: claim.claim_text, supporting_source_ids: claim.supporting_source_ids, contradicting_source_ids: claim.contradicting_source_ids, dependency_families: [...new Set(sourceIds.map(id => { const representation = reprBySource.get(id); assert(representation, `missing representation: ${id}`); return representation.source_family_id; }))].sort().map(id => ({ family_id: id, independence_rule: families.get(id)?.independence_rule ?? 'Count this family once only.' })), source_representations: sourceIds.map(id => { const representation = reprBySource.get(id); assert(representation, `missing representation: ${id}`); return representation.representation_id; }), required_support_representation_ids: claim.supporting_source_ids.map((id: string) => `repr-${id}`), complete_wording_review_required: true, candidate_disposition: 'unreviewed' }; }), rights_records: rights.map(x => x.rights_id), implementation_decisions: [] };
  const acquisitionRaw = Buffer.from(canonical(acquisition)), representationRaw = Buffer.from(canonical(reprArtifact)), reviewRaw = Buffer.from(canonical(reviewInput));
  const receiptTemplate = { schema_version: VERSION, artifact_id: ARTIFACT_ID, stage: 'independent_source_body_review', status: 'not_started', reviewer: null, reviewed_at: null, independence_attestations: [], bindings: { acquisition_manifest_sha256: sha(acquisitionRaw), representations_sha256: sha(representationRaw), review_input_sha256: sha(reviewRaw), external_snapshot_sha256: bundle.sha256, external_snapshot_bytes: bundle.bytes, external_snapshot_storage_receipt_sha256: sha(canonical(privateArchiveReceipt())), candidate_descriptor_sha256: null, candidate_tree_sha256: null, claims: reviewInput.claims.map((x: Json) => ({ claim_id: x.claim_id, claim_text_sha256: sha(x.exact_claim_text), source_representation_ids: x.source_representations, dependency_family_ids: x.dependency_families.map((f: Json) => f.family_id) })), representations: representations.map(x => ({ representation_id: x.representation_id, body_sha256: x.body_sha256, proposition_ids: x.propositions.map((p: Json) => p.proposition_id), rights_id: x.rights_id })), rights: rights.map(x => ({ rights_id: x.rights_id, mode: x.mode, body_sha256: x.body_sha256 })), predecessor_pins: reviewInput.predecessor_pins }, dispositions: [] };
  const unresolved = { schema_version: VERSION, artifact_id: ARTIFACT_ID, items: reviewInput.claims.map((x: Json) => ({ claim_id: x.claim_id, status: 'pending_independent_source_body_review', blockers: x.source_representations.filter((id: string) => reprBySource.get(id.slice(5))?.rights_mode === 'citation_only_not_promotion_eligible') })) };
  const rightsBlocked = { schema_version: VERSION, artifact_id: ARTIFACT_ID, sources: representations.filter(x => x.rights_mode === 'citation_only_not_promotion_eligible').map(x => ({ source_id: x.source_id, rights_id: x.rights_id, status: 'not_promotion_eligible' })) };
  const status = { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: 'candidate_non_authoritative_pending_fresh_sol_high_receipt', counts: { claims: 7, accepted_claims: 0, verified_dossiers: 0, tasks: 0 }, reviewer_receipt_present: false, registry_row_present: false, production_mutation: false };
  const externalDescriptor = { schema_version: VERSION, artifact_id: ARTIFACT_ID, status: 'candidate_private_snapshot_archived_readback_verified', local_locator: path.join(DEFAULT_EXTERNAL, 'reviewed-source-evidence-v1-private-snapshot.tar.gz'), external_locator: PRIVATE_R2_LOCATOR, upload_readback_receipt: privateArchiveReceipt(), archive_bytes: bundle.bytes, archive_sha256: bundle.sha256, uncompressed_bytes: bundle.uncompressed_bytes, credential_like_scan_policy: CREDENTIAL_SCAN_POLICY, credential_boundary: 'No operator/private credentials, cookie values, raw response headers, signed URLs, or project secrets are bundled. Five sanitized acquisition receipts retain only allowlisted transport facts and raw metadata audit digests. One origin-published Mapbox client token remains inside its exact private HTML member.', members: bundle.members };
  const members: Record<string, any> = { 'acquisition-manifest-v1.json': acquisition, 'bounded-review-representations-v1.json': reprArtifact, 'source-body-review-input-v1.json': reviewInput, 'independent-source-body-review-receipt.template-v1.json': receiptTemplate, 'unresolved-queue-v1.json': unresolved, 'rights-blocked-queue-v1.json': rightsBlocked, 'status-report-v1.json': status, 'external-snapshot-descriptor-v1.json': externalDescriptor };
  const manifestMembers = Object.entries(members).map(([p, v]) => ({ path: p, bytes: Buffer.byteLength(canonical(v)), sha256: sha(canonical(v)) })).sort((a, b) => a.path.localeCompare(b.path));
  members['manifest-v1.json'] = { schema_version: VERSION, artifact_id: ARTIFACT_ID, members: manifestMembers, tree_sha256: sha(`${manifestMembers.map(x => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`) };
  return members;
}

function validators(): Map<string, any> {
  const Ajv = Ajv2020Import as unknown as new(options: any) => any, ajv = new Ajv({ allErrors: true, strict: false }); (addFormatsImport as unknown as (value: any) => void)(ajv);
  return new Map(fs.readdirSync(SCHEMAS).filter(x => x.endsWith('.schema.v1.json')).map(file => [file.replace('.schema.v1.json', ''), ajv.compile(read(path.join(SCHEMAS, file)))]));
}
function validate(name: string, value: Json, all = validators()): void { const validator = all.get(name); assert(validator && validator(value), `${name} schema validation failed: ${JSON.stringify(validator?.errors)}`); }
function listFiles(root: string): string[] { assert(!fs.lstatSync(root).isSymbolicLink(), 'fixture symlink rejected'); return fs.readdirSync(root).sort().filter(x => fs.lstatSync(path.join(root, x)).isFile()); }
function verifyBundle(descriptor: Json, archivePath: string, acquisition?: Json): void {
  verifyArchivalEvent(descriptor); const raw = stableExternalFile(path.resolve(archivePath)); assert(raw.length === descriptor.archive_bytes && sha(raw) === descriptor.archive_sha256, 'external snapshot digest/bytes drift'); const members = parseTar(raw);
  assert([...members.keys()].sort().join('\n') === descriptor.members.map((x: Json) => x.path).sort().join('\n'), 'external snapshot member set drift');
  for (const expected of descriptor.members) { const actual = members.get(expected.path)!; assert(actual.length === expected.bytes && sha(actual) === expected.sha256, `external snapshot member drift: ${expected.path}`); assert(canonical(credentialLikeClassification(expected.path, actual)) === canonical(expected.credential_like_material), `credential-like classification drift: ${expected.path}`); }
  for (const spec of bodySpecs) {
    const receiptRaw = members.get(spec.receiptMember); assert(receiptRaw, `acquisition receipt member missing: ${spec.receiptMember}`);
    const receipt = JSON.parse(receiptRaw.toString('utf8')); validate('acquisition-receipt', receipt);
    const body = members.get(spec.member); assert(body, `body member missing: ${spec.member}`);
    assert(receipt.body.path === spec.member && receipt.body.bytes === body.length && receipt.body.sha256 === sha(body), `acquisition receipt/body mismatch: ${spec.raw}`);
    assert(receipt.request_url_basis === 'generator_config_not_separately_observed' && receipt.request_url_independently_observed === false && receipt.request_url_required_to_equal_effective_url === true && receipt.request_url === receipt.effective_url, `request URL evidence basis drift: ${spec.raw}`);
    assert(receipt.status === receipt.final_headers.final_status && receipt.media_type === receipt.final_headers.content_type, `acquisition transport mismatch: ${spec.raw}`);
    assert(receipt.final_headers.content_length === null || receipt.final_headers.content_length === receipt.body.bytes, `acquisition content-length/body mismatch: ${spec.raw}`);
    if (acquisition) { const capture = acquisition.captures.find((item: Json) => item.capture_id === receipt.capture_id); assert(capture, `acquisition manifest capture missing: ${receipt.capture_id}`); const expected = { request_url: capture.request_url, request_url_basis: capture.request_url_basis, request_url_independently_observed: capture.request_url_independently_observed, effective_url: capture.effective_url, status: capture.status, media_type: capture.media_type, captured_at: capture.captured_at, final_header_content_length: capture.final_header_content_length, body_sha256: capture.body_sha256, body_bytes: capture.body_bytes, private_snapshot_member: capture.private_snapshot_member, acquisition_receipt_member: capture.acquisition_receipt_member, acquisition_receipt_sha256: capture.acquisition_receipt_sha256, acquisition_receipt_bytes: capture.acquisition_receipt_bytes, raw_curl_meta_sha256: capture.raw_curl_meta_sha256, raw_curl_meta_bytes: capture.raw_curl_meta_bytes, raw_headers_sha256: capture.raw_headers_sha256, raw_headers_bytes: capture.raw_headers_bytes }; const actual = { request_url: receipt.request_url, request_url_basis: receipt.request_url_basis, request_url_independently_observed: receipt.request_url_independently_observed, effective_url: receipt.effective_url, status: receipt.status, media_type: receipt.media_type, captured_at: receipt.captured_at, final_header_content_length: receipt.final_headers.content_length, body_sha256: receipt.body.sha256, body_bytes: receipt.body.bytes, private_snapshot_member: receipt.body.path, acquisition_receipt_member: spec.receiptMember, acquisition_receipt_sha256: sha(receiptRaw), acquisition_receipt_bytes: receiptRaw.length, raw_curl_meta_sha256: receipt.raw_audit_digests.curl_meta.sha256, raw_curl_meta_bytes: receipt.raw_audit_digests.curl_meta.bytes, raw_headers_sha256: receipt.raw_audit_digests.headers.sha256, raw_headers_bytes: receipt.raw_audit_digests.headers.bytes }; assert(canonical(actual) === canonical(expected), `acquisition receipt/manifest mismatch: ${spec.raw}`); }
  }
}
function validateDescriptor(root: string, descriptorFile: string, expectedMembers: readonly string[], verifyMemberBytes: boolean): { descriptor: Json; raw: Buffer } {
  const raw = bytes(path.join(root, descriptorFile)), descriptor = JSON.parse(raw.toString('utf8')), expectedPaths = [...expectedMembers].sort(), actualPaths = descriptor.members.map((x: Json) => x.path);
  validate('descriptor', descriptor); exactStrings(actualPaths, expectedPaths, `${descriptorFile} member paths`);
  assert(canonical(descriptor.predecessor_pins) === canonical(predecessorPins()), `${descriptorFile} predecessor pin drift`);
  if (verifyMemberBytes) for (const member of descriptor.members) { const memberRaw = bytes(path.join(root, member.path)); assert(memberRaw.length === member.bytes && sha(memberRaw) === member.sha256, `${descriptorFile} member drift: ${member.path}`); }
  assert(descriptor.tree_sha256 === descriptorTree(descriptor.members), `${descriptorFile} tree_sha256 drift`);
  return { descriptor, raw };
}
function candidateSeal(root: string, outerDescriptor: Json): Json {
  if (outerDescriptor.scope === 'candidate_non_authoritative_source_body_review_boundary') {
    const validated = validateDescriptor(root, 'descriptor-v1.json', CANDIDATE_MEMBERS, true);
    return { candidate_descriptor_sha256: sha(validated.raw), candidate_tree_sha256: validated.descriptor.tree_sha256 };
  }
  assert(outerDescriptor.scope === 'published_independent_source_body_review_authority', 'descriptor scope unsupported for candidate seal');
  const preserved = validateDescriptor(root, PRESERVED_CANDIDATE_DESCRIPTOR, CANDIDATE_MEMBERS, false);
  assert(preserved.descriptor.scope === 'candidate_non_authoritative_source_body_review_boundary' && preserved.descriptor.authority_member === null && preserved.descriptor.registry_authority === false, 'preserved candidate descriptor authority drift');
  return { candidate_descriptor_sha256: sha(preserved.raw), candidate_tree_sha256: preserved.descriptor.tree_sha256 };
}
function deriveReceiptBindings(root: string, seal: Json): Json {
  const acquisitionFile = path.join(root, 'acquisition-manifest-v1.json'), representationsFile = path.join(root, 'bounded-review-representations-v1.json'), inputFile = path.join(root, 'source-body-review-input-v1.json'), externalFile = path.join(root, 'external-snapshot-descriptor-v1.json');
  const representations = read(representationsFile), input = read(inputFile), external = read(externalFile), expectedPredecessors = predecessorPins();
  assert(canonical(input.predecessor_pins) === canonical(expectedPredecessors), 'review input predecessor binding drift'); verifyArchivalEvent(external);
  return {
    acquisition_manifest_sha256: sha(bytes(acquisitionFile)),
    representations_sha256: sha(bytes(representationsFile)),
    review_input_sha256: sha(bytes(inputFile)),
    external_snapshot_sha256: external.archive_sha256,
    external_snapshot_bytes: external.archive_bytes,
    external_snapshot_storage_receipt_sha256: external.upload_readback_receipt === null ? null : sha(canonical(external.upload_readback_receipt)),
    candidate_descriptor_sha256: seal.candidate_descriptor_sha256,
    candidate_tree_sha256: seal.candidate_tree_sha256,
    claims: input.claims.map((claim: Json) => ({ claim_id: claim.claim_id, claim_text_sha256: sha(claim.exact_claim_text), source_representation_ids: claim.source_representations, dependency_family_ids: claim.dependency_families.map((family: Json) => family.family_id) })),
    representations: representations.representations.map((representation: Json) => ({ representation_id: representation.representation_id, body_sha256: representation.body_sha256, proposition_ids: representation.propositions.map((proposition: Json) => proposition.proposition_id), rights_id: representation.rights_id })),
    rights: representations.rights.map((right: Json) => ({ rights_id: right.rights_id, mode: right.mode, body_sha256: right.body_sha256 })),
    predecessor_pins: expectedPredecessors,
  };
}
function expectedTemplateBindings(root: string): Json {
  return { ...deriveReceiptBindings(root, { candidate_descriptor_sha256: null, candidate_tree_sha256: null }), candidate_descriptor_sha256: null, candidate_tree_sha256: null };
}
function semantic(root = FIXTURE, archivePath?: string, allowPublished = false, registryPath = REGISTRY): Json {
  const all = validators(), files = listFiles(root), authorityPresent = files.includes(AUTHORITY), expected = authorityPresent ? [...PUBLISHED_MEMBERS, 'descriptor-v1.json'].sort() : [...CANDIDATE_MEMBERS, 'descriptor-v1.json'].sort();
  assert(files.join('\n') === expected.join('\n'), authorityPresent ? 'published fixture file set drift' : 'candidate fixture file set drift'); assert(allowPublished || !authorityPresent, 'candidate verification refuses published authority');
  const outer = validateDescriptor(root, 'descriptor-v1.json', authorityPresent ? PUBLISHED_MEMBERS : CANDIDATE_MEMBERS, true), descriptor = outer.descriptor;
  if (authorityPresent) assert(descriptor.scope === 'published_independent_source_body_review_authority' && descriptor.authority_member === AUTHORITY && descriptor.registry_authority === true, 'published descriptor authority state drift');
  else assert(descriptor.scope === 'candidate_non_authoritative_source_body_review_boundary' && descriptor.authority_member === null && descriptor.registry_authority === false, 'candidate descriptor authority state drift');
  const schemaMap: Record<string, string> = { 'acquisition-manifest-v1.json': 'acquisition-manifest', 'bounded-review-representations-v1.json': 'bounded-review-representations', 'source-body-review-input-v1.json': 'source-body-review-input', 'independent-source-body-review-receipt.template-v1.json': 'review-receipt-template', 'unresolved-queue-v1.json': 'unresolved-queue', 'rights-blocked-queue-v1.json': 'rights-blocked-queue', 'status-report-v1.json': 'status-report', 'external-snapshot-descriptor-v1.json': 'external-snapshot-descriptor', 'manifest-v1.json': 'manifest', 'descriptor-v1.json': 'descriptor' };
  if (authorityPresent) Object.assign(schemaMap, { [AUTHORITY]: 'review-receipt', 'promotion-ledger-v1.json': 'promotion-ledger' });
  for (const [file, schema] of Object.entries(schemaMap)) validate(schema, read(path.join(root, file)), all);
  const manifest = read(path.join(root, 'manifest-v1.json')), manifestPaths = manifest.members.map((x: Json) => x.path), expectedManifestPaths = (authorityPresent ? PUBLISHED_MEMBERS : CANDIDATE_MEMBERS).filter(x => x !== 'manifest-v1.json').sort(); exactStrings(manifestPaths, expectedManifestPaths, 'manifest member paths');
  for (const member of manifest.members) { const raw = bytes(path.join(root, member.path)); assert(raw.length === member.bytes && sha(raw) === member.sha256, `manifest member drift: ${member.path}`); }
  assert(manifest.tree_sha256 === sha(`${manifest.members.map((x: Json) => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`), 'manifest tree drift');
  const acquisition = read(path.join(root, 'acquisition-manifest-v1.json')), reps = read(path.join(root, 'bounded-review-representations-v1.json')), input = read(path.join(root, 'source-body-review-input-v1.json')), template = read(path.join(root, 'independent-source-body-review-receipt.template-v1.json')), status = read(path.join(root, 'status-report-v1.json')), queue = read(path.join(root, 'unresolved-queue-v1.json')), externalDescriptor = read(path.join(root, 'external-snapshot-descriptor-v1.json'));
  assert(input.claims.map((x: Json) => x.claim_id).join() === CLAIM_IDS.join(), 'seven claim coverage/order drift'); assert(input.claims.every((x: Json) => x.candidate_disposition === 'unreviewed'), 'candidate minted reviewer disposition'); assert(status.counts.verified_dossiers === 0 && status.counts.tasks === 0, 'downstream output count inflation');
  if (!authorityPresent) { assert(status.counts.accepted_claims === 0 && !status.reviewer_receipt_present && !status.registry_row_present, 'candidate authority/count inflation'); assert(queue.items.every((item: Json) => item.status === 'pending_independent_source_body_review'), 'candidate unresolved queue state drift'); }
  const externalMembers = new Map<string, Json>(externalDescriptor.members.map((member: Json) => [member.path, member]));
  for (const capture of acquisition.captures) { const bodyMember = externalMembers.get(capture.private_snapshot_member), receiptMember = externalMembers.get(capture.acquisition_receipt_member); assert(bodyMember?.member_kind === 'exact_private_body' && bodyMember.sha256 === capture.body_sha256 && bodyMember.bytes === capture.body_bytes, `acquisition body descriptor mismatch: ${capture.capture_id}`); assert(receiptMember?.member_kind === 'sanitized_acquisition_receipt' && receiptMember.sha256 === capture.acquisition_receipt_sha256 && receiptMember.bytes === capture.acquisition_receipt_bytes, `acquisition receipt descriptor mismatch: ${capture.capture_id}`); assert(capture.request_url_basis === 'generator_config_not_separately_observed' && capture.request_url_independently_observed === false && capture.request_url === capture.effective_url, `acquisition request URL evidence drift: ${capture.capture_id}`); assert(capture.final_header_content_length === null || capture.final_header_content_length === capture.body_bytes, `acquisition manifest content-length mismatch: ${capture.capture_id}`); assert(capture.credential_like_material.unclassified_occurrence_count === 0, `unclassified acquisition metadata: ${capture.capture_id}`); }
  const sourceIds = new Set(reps.representations.map((x: Json) => x.source_id)); for (const claim of input.claims) for (const id of [...claim.supporting_source_ids, ...claim.contradicting_source_ids]) assert(sourceIds.has(id), `claim source representation missing: ${id}`);
  for (const rep of reps.representations) { assert(rep.rights_mode !== 'private_review_snapshot' || rep.propositions.every((p: Json) => Buffer.byteLength(p.passage) <= 240), 'long excerpt rejected'); assert(rep.rights_mode !== 'citation_only_not_promotion_eligible' || rep.propositions.length === 0, 'citation-only promotion evidence rejected'); }
  assert(canonical(template.bindings) === canonical(expectedTemplateBindings(root)), 'receipt template independently rederived binding drift');
  verifyArchivalEvent(externalDescriptor);
  if (archivePath) verifyBundle(read(path.join(root, 'external-snapshot-descriptor-v1.json')), archivePath, acquisition);
  if (authorityPresent) { const receipt = validateReceipt(bytes(path.join(root, AUTHORITY)), root), ledger = read(path.join(root, 'promotion-ledger-v1.json')), accepted = ledger.rows.filter((x: Json) => x.promotion_eligible).length; assert(ledger.authority_receipt_sha256 === sha(bytes(path.join(root, AUTHORITY))) && ledger.rows.map((x: Json) => x.claim_id).join() === CLAIM_IDS.join(), 'promotion ledger authority/claim drift'); assert(status.counts.accepted_claims === accepted && status.reviewer_receipt_present && status.registry_row_present, 'published status/ledger drift'); assert(receipt.dispositions.every((x: Json, index: number) => ledger.rows[index].disposition === x.disposition), 'promotion ledger disposition drift'); const queueStates: Record<string, string> = { accepted: 'accepted_resolved', held: 'held_for_additional_evidence', rejected: 'rejected_resolved', abstained: 'abstained_unresolved' }; assert(receipt.dispositions.every((x: Json, index: number) => queue.items[index].claim_id === x.claim_id && queue.items[index].status === queueStates[x.disposition]), 'published queue/receipt state drift'); }
  if (!authorityPresent) assert(!fs.readFileSync(registryPath, 'utf8').split('\n').filter(Boolean).some(line => JSON.parse(line).stable_id === REGISTRY_ID), 'registry before receipt rejected');
  return { authoritative: authorityPresent, files: files.length, tree_sha256: descriptor.tree_sha256, external_snapshot_verified: Boolean(archivePath), production_mutation: false };
}
function writeCandidate(root: string, rawRoot: string, externalRoot: string, registryPath = REGISTRY): Json {
  assert(!fs.existsSync(path.join(root, AUTHORITY)), 'ordinary build cannot overwrite published reviewer authority'); const generated = candidateArtifacts(rawRoot, externalRoot); fs.mkdirSync(root, { recursive: true });
  for (const existing of fs.readdirSync(root)) fs.rmSync(path.join(root, existing), { recursive: true, force: true }); for (const [file, value] of Object.entries(generated)) write(path.join(root, file), value);
  const members = Object.keys(generated).sort().map(file => binding(path.join(root, file), file)); const descriptor = { schema_version: VERSION, artifact_id: ARTIFACT_ID, scope: 'candidate_non_authoritative_source_body_review_boundary', created_at: CREATED_AT, authority_member: null, registry_authority: false, predecessor_pins: predecessorPins(), members, tree_sha256: sha(`${members.map(x => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`), production_mutation: false }; write(path.join(root, 'descriptor-v1.json'), descriptor);
  return semantic(root, path.join(externalRoot, 'reviewed-source-evidence-v1-private-snapshot.tar.gz'), false, registryPath);
}
function resealCandidate(root: string): void {
  const manifestPaths = CANDIDATE_MEMBERS.filter(file => file !== 'manifest-v1.json').sort(), manifestMembers = manifestPaths.map(file => binding(path.join(root, file), file));
  write(path.join(root, 'manifest-v1.json'), { schema_version: VERSION, artifact_id: ARTIFACT_ID, members: manifestMembers, tree_sha256: descriptorTree(manifestMembers) });
  const descriptor = read(path.join(root, 'descriptor-v1.json')), descriptorMembers = [...CANDIDATE_MEMBERS].sort().map(file => binding(path.join(root, file), file)); descriptor.members = descriptorMembers; descriptor.tree_sha256 = descriptorTree(descriptorMembers); write(path.join(root, 'descriptor-v1.json'), descriptor);
}
function validateReceipt(raw: Buffer, root = FIXTURE): Json {
  const receipt = JSON.parse(raw.toString('utf8')); validate('review-receipt', receipt); const template = read(path.join(root, 'independent-source-body-review-receipt.template-v1.json')), input = read(path.join(root, 'source-body-review-input-v1.json')), reps = read(path.join(root, 'bounded-review-representations-v1.json')), outerDescriptor = read(path.join(root, 'descriptor-v1.json'));
  const seal = candidateSeal(root, outerDescriptor), independentlyDerived = deriveReceiptBindings(root, seal), receiptWithNullSeal = { ...receipt.bindings, candidate_descriptor_sha256: null, candidate_tree_sha256: null };
  assert(canonical(template.bindings) === canonical(expectedTemplateBindings(root)), 'review receipt template does not match independently rederived candidate bindings');
  assert(canonical(receiptWithNullSeal) === canonical(template.bindings), 'completed receipt may differ from template only in candidate descriptor/tree seal');
  assert(canonical(receipt.bindings) === canonical(independentlyDerived), 'review receipt independently rederived binding substitution'); assert(receipt.reviewer.identity === receipt.reviewer.review_session_id, 'reviewer identity/session mismatch'); assert(receipt.reviewer.identity !== 'sol-medium-implementation-worker-issue89-gate-e-v1', 'reviewer identity overlap'); assert(receipt.dispositions.map((x: Json) => x.claim_id).join() === CLAIM_IDS.join(), 'receipt claim coverage/order drift');
  const repById = new Map<string, Json>(reps.representations.map((x: Json) => [x.representation_id, x])); for (const disposition of receipt.dispositions) {
    const claim = input.claims.find((x: Json) => x.claim_id === disposition.claim_id); assert(claim, 'receipt unknown claim'); const allowed = new Set<string>(claim.source_representations), cited = new Set<string>(disposition.supported_source_representation_ids);
    for (const id of cited) assert(allowed.has(id) && repById.has(id), `disposition representation outside claim graph: ${disposition.claim_id}/${id}`);
    const propositionOwners = new Map<string, string>(); for (const id of cited) for (const proposition of repById.get(id)!.propositions) propositionOwners.set(proposition.proposition_id, id);
    for (const id of disposition.supported_proposition_ids) assert(propositionOwners.has(id), `disposition proposition not owned by cited representation: ${disposition.claim_id}/${id}`);
    for (const id of cited) assert(disposition.supported_proposition_ids.some((propositionId: string) => propositionOwners.get(propositionId) === id), `cited representation lacks owned proposition: ${disposition.claim_id}/${id}`);
    assert((cited.size === 0) === (disposition.supported_proposition_ids.length === 0), `disposition evidence arrays must both be empty or non-empty: ${disposition.claim_id}`);
    if (disposition.disposition === 'rejected' || disposition.disposition === 'abstained') assert(cited.size === 0 && disposition.complete_claim_wording_supported === false, `${disposition.disposition} disposition requires explicit empty evidence`);
    if (disposition.disposition === 'held') assert(disposition.complete_claim_wording_supported === false, 'held disposition cannot claim complete wording support');
    if (disposition.disposition === 'accepted') { assert(disposition.supported_proposition_ids.length > 0, 'accepted claim without reviewed propositions'); assert(disposition.supported_source_representation_ids.every((id: string) => repById.get(id)?.rights_mode !== 'citation_only_not_promotion_eligible'), 'citation-only promotion rejected'); assert(canonical(disposition.supported_source_representation_ids) === canonical(claim.required_support_representation_ids), 'accepted claim must cover every supporting representation'); const requiredPropositions = claim.required_support_representation_ids.flatMap((id: string) => repById.get(id)?.propositions.map((p: Json) => p.proposition_id) ?? []); assert(requiredPropositions.length > 0 && canonical(disposition.supported_proposition_ids) === canonical(requiredPropositions), 'accepted claim must cover every bound supporting proposition'); assert(disposition.complete_claim_wording_supported === true, 'unsupported composite claim rejected'); }
  }
  return receipt;
}
function publishToRoot(root: string, registryPath: string, raw: Buffer): Json {
  assert(!fs.existsSync(path.join(root, AUTHORITY)), 'second publication rejected'); const receipt = validateReceipt(raw, root), candidateBefore = semantic(root, undefined, false, registryPath);
  fs.copyFileSync(path.join(root, 'descriptor-v1.json'), path.join(root, PRESERVED_CANDIDATE_DESCRIPTOR));
  fs.writeFileSync(path.join(root, AUTHORITY), raw); assert(bytes(path.join(root, AUTHORITY)).equals(raw), 'receipt byte preservation failed');
  const ledger = { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_receipt_sha256: sha(raw), rows: receipt.dispositions.map((x: Json) => ({ claim_id: x.claim_id, disposition: x.disposition, promotion_eligible: x.disposition === 'accepted' && x.complete_claim_wording_supported })) }; write(path.join(root, 'promotion-ledger-v1.json'), ledger);
  const status = read(path.join(root, 'status-report-v1.json')), accepted = ledger.rows.filter((x: Json) => x.promotion_eligible).length; status.authority_status = 'published_independent_source_body_review'; status.counts.accepted_claims = accepted; status.reviewer_receipt_present = true; status.registry_row_present = true; write(path.join(root, 'status-report-v1.json'), status);
  const queue = read(path.join(root, 'unresolved-queue-v1.json')), queueStates: Record<string, string> = { accepted: 'accepted_resolved', held: 'held_for_additional_evidence', rejected: 'rejected_resolved', abstained: 'abstained_unresolved' }; queue.items = receipt.dispositions.map((disposition: Json, index: number) => ({ claim_id: disposition.claim_id, status: queueStates[disposition.disposition], blockers: disposition.disposition === 'accepted' || disposition.disposition === 'rejected' ? [] : queue.items[index].blockers })); write(path.join(root, 'unresolved-queue-v1.json'), queue);
  const manifestMembers = PUBLISHED_MEMBERS.filter(x => x !== 'manifest-v1.json').map(file => binding(path.join(root, file), file)).sort((a, b) => a.path.localeCompare(b.path)); write(path.join(root, 'manifest-v1.json'), { schema_version: VERSION, artifact_id: ARTIFACT_ID, members: manifestMembers, tree_sha256: sha(`${manifestMembers.map(x => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`) });
  const members = [...PUBLISHED_MEMBERS].sort().map(file => binding(path.join(root, file), file)), descriptor = read(path.join(root, 'descriptor-v1.json')); Object.assign(descriptor, { scope: 'published_independent_source_body_review_authority', authority_member: AUTHORITY, registry_authority: true, members, tree_sha256: sha(`${members.map((x: Json) => `${x.path}\t${x.sha256}\t${x.bytes}`).join('\n')}\n`) }); write(path.join(root, 'descriptor-v1.json'), descriptor);
  const registryLines = fs.readFileSync(registryPath, 'utf8').split('\n').filter(Boolean); assert(!registryLines.some(line => JSON.parse(line).stable_id === REGISTRY_ID), 'second publication registry row exists'); const allFiles = [...PUBLISHED_MEMBERS, 'descriptor-v1.json'].sort(), byteCount = allFiles.reduce((n, f) => n + bytes(path.join(root, f)).length, 0), tree = sha(`${allFiles.map(f => `${f}\t${sha(bytes(path.join(root, f)))}\t${bytes(path.join(root, f)).length}`).join('\n')}\n`);
  const directInputs = ['dfv0_ground_authoritative_research_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1', 'dfv0_ground_claim_adjudication_v1', 'dfv0_issue69_phase_d_scale_v1_20260713'];
  const row = { stable_id: REGISTRY_ID, schema_version: 'dataset_factory_artifact_registry_v0', artifact_schema_version: VERSION, artifact_kind: 'directory', content_digest: { algorithm: 'sha256', value: tree, scope: 'sorted_tree_manifest' }, counts: { file_count: allFiles.length, byte_count: byteCount }, source_lineage: { description: `Issue #89 Gate E independently reviewed source-body evidence, receipt SHA-256 ${sha(raw)}.`, source_artifact_ids: directInputs, source_urls: ['https://github.com/zouantchaw/mtl-archives-search/issues/89'] }, storage: { storage_class: 'tracked_repository', path_class: 'tracked_fixture', locator: FIXTURE_REL }, generation: { method: 'review_assisted', command: 'npm run dataset-factory:reviewed-source-evidence-publish-v1 -- --receipt /path/to/fresh-sol-high-receipt.json', code_ref: 'codex/89-reviewed-source-bodies', human_input_ids: [] }, dependency_ids: directInputs, required_by: ['issue #89 Gate E reviewed source-body evidence'], rights_boundary: { license_id: 'mixed-private-review-and-citation-boundary', attribution: 'RPCQ, Parks Canada, Ville de Montreal, and BAnQ as recorded in the artifact.', commercial_use_allowed: false, notes: 'Raw RPCQ and Parks bodies remain private; tracked passages are short factual review fields. Citation-only sources cannot promote.' }, created_at: CREATED_AT, creation_time_basis: 'report_metadata' };
  fs.writeFileSync(registryPath, `${[...registryLines, JSON.stringify(row)].join('\n')}\n`); semantic(root, undefined, true, registryPath); return { status: 'published', receipt_sha256: sha(raw), receipt_bytes: raw.length, accepted_claims: accepted, candidate_tree_sha256: candidateBefore.tree_sha256, registry_written: true };
}
function publish(receiptPath: string): Json {
  const raw = stableExternalFile(path.resolve(receiptPath)); return publishToRoot(FIXTURE, REGISTRY, raw);
}
function mutate(root: string, registryPath: string, label: string, edit: () => void, expected: RegExp): void { edit(); let message = ''; try { semantic(root, undefined, false, registryPath); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); }
function registryWithoutAuthority(destination: string): string {
  const lines = fs.readFileSync(REGISTRY, 'utf8').split('\n').filter(Boolean).filter(line => JSON.parse(line).stable_id !== REGISTRY_ID);
  fs.writeFileSync(destination, `${lines.join('\n')}\n`);
  return destination;
}
function selfTest(rawRoot: string): Json {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed-source-self-test-')); let cases = 0;
  try {
    const candidateRoot = path.join(temp, 'candidate'), candidateExternal = path.join(temp, 'external'), candidateRegistry = registryWithoutAuthority(path.join(temp, 'artifact-registry.v0.jsonl'));
    writeCandidate(candidateRoot, rawRoot, candidateExternal, candidateRegistry);
    const run = (label: string, edit: (copy: string) => void, expected: RegExp) => { const copy = path.join(temp, label); fs.cpSync(candidateRoot, copy, { recursive: true }); mutate(copy, candidateRegistry, label, () => edit(copy), expected); cases++; };
    run('source-substitution', r => { const f = path.join(r, 'bounded-review-representations-v1.json'), x = read(f); x.representations[0].source_id = 'r102-parks-st-george'; write(f, x); }, /descriptor-v1\.json member drift|manifest member drift/);
    run('body-substitution', r => { const f = path.join(r, 'bounded-review-representations-v1.json'), x = read(f); x.representations[0].body_sha256 = 'a'.repeat(64); write(f, x); }, /descriptor-v1\.json member drift|manifest member drift/);
    run('claim-substitution', r => { const f = path.join(r, 'source-body-review-input-v1.json'), x = read(f); x.claims[0].exact_claim_text = 'changed'; write(f, x); }, /descriptor-v1\.json member drift|manifest member drift/);
    run('family-substitution', r => { const f = path.join(r, 'source-body-review-input-v1.json'), x = read(f); x.claims[0].dependency_families[0].family_id = 'forged'; write(f, x); }, /descriptor-v1\.json member drift|manifest member drift/);
    run('rights-substitution', r => { const f = path.join(r, 'bounded-review-representations-v1.json'), x = read(f); x.representations[0].rights_mode = 'tracked_permitted_body'; write(f, x); }, /descriptor-v1\.json member drift|manifest member drift/);
    run('long-excerpt', r => { const f = path.join(r, 'bounded-review-representations-v1.json'), x = read(f); x.representations[0].propositions[0].passage = 'x'.repeat(241); write(f, x); }, /schema validation|descriptor-v1\.json member drift|manifest member drift/);
    const pathRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed-source-path-')); fs.writeFileSync(path.join(pathRoot, 'file'), 'x'); fs.symlinkSync(path.join(pathRoot, 'file'), path.join(pathRoot, 'link')); for (const [label, fn] of [['traversal', () => resolveContained(pathRoot, '../file', 'test')], ['symlink', () => resolveContained(pathRoot, 'link', 'test')]] as const) { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, `${label} not rejected`); cases++; } fs.rmSync(pathRoot, { recursive: true, force: true });
    const metadataCase = (label: string, spec: typeof bodySpecs[number], edit: (copy: string) => void, expected: RegExp) => { const copy = path.join(temp, `raw-${label}`); fs.cpSync(rawRoot, copy, { recursive: true }); edit(copy); let message = ''; try { acquisitionReceipt(spec, copy); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected metadata rejection, got ${message}`); cases++; };
    metadataCase('effective-url-substitution', bodySpecs[0], copy => { const file = path.join(copy, `${bodySpecs[0].raw}.curl-meta`), value = bytes(file).toString('utf8').replace(/https:\/\/\S+\s*$/, 'https://example.invalid/substituted'); fs.writeFileSync(file, value); }, /configured request\/effective URL mismatch/);
    metadataCase('status-mismatch', bodySpecs[0], copy => { const file = path.join(copy, `${bodySpecs[0].raw}.curl-meta`); fs.writeFileSync(file, bytes(file).toString('utf8').replace(/^200/, '201')); }, /curl\/header status mismatch/);
    metadataCase('date-invalid', bodySpecs[0], copy => { const file = path.join(copy, `${bodySpecs[0].raw}.headers`); fs.writeFileSync(file, bytes(file).toString('latin1').replace(/^date:.*$/im, 'date: invalid-date')); }, /Date header invalid/);
    metadataCase('content-type-mismatch', bodySpecs[0], copy => { const file = path.join(copy, `${bodySpecs[0].raw}.curl-meta`); fs.writeFileSync(file, bytes(file).toString('utf8').replace('text/html', 'application/json')); }, /curl\/header content-type mismatch/);
    metadataCase('content-length-mismatch', bodySpecs[2], copy => { const file = path.join(copy, `${bodySpecs[2].raw}.headers`); fs.writeFileSync(file, bytes(file).toString('latin1').replace(/^Content-Length:\s*\d+$/im, 'Content-Length: 1')); }, /header\/body content-length mismatch/);
    for (const [label, header] of [['cookie-leakage', 'Set-Cookie: synthetic-sensitive-marker=must-not-survive'], ['forbidden-auth-header', 'Authorization: Bearer synthetic-sensitive-marker']] as const) { const copy = path.join(temp, `raw-${label}`); fs.cpSync(rawRoot, copy, { recursive: true }); const file = path.join(copy, `${bodySpecs[0].raw}.headers`); fs.appendFileSync(file, `${header}\r\n`); const sanitized = canonical(acquisitionReceipt(bodySpecs[0], copy)); assert(!sanitized.includes('synthetic-sensitive-marker') && !/set-cookie|authorization/i.test(sanitized), `${label}: forbidden header leaked into receipt`); cases++; }
    const forbiddenReceipt = acquisitionReceipt(bodySpecs[0], rawRoot); forbiddenReceipt.authorization = 'synthetic-sensitive-marker'; let forbiddenMessage = ''; try { validate('acquisition-receipt', forbiddenReceipt); } catch (error) { forbiddenMessage = String(error); } assert(/schema validation failed/.test(forbiddenMessage), `forbidden receipt field not rejected: ${forbiddenMessage}`); cases++;
    const rawDriftRoot = path.join(temp, 'raw-meta-drift'); fs.cpSync(rawRoot, rawDriftRoot, { recursive: true }); const rawDriftFile = path.join(rawDriftRoot, `${bodySpecs[0].raw}.curl-meta`), baselineReceipt = acquisitionReceipt(bodySpecs[0], rawRoot); fs.appendFileSync(rawDriftFile, ' '); const driftReceipt = acquisitionReceipt(bodySpecs[0], rawDriftRoot); assert(baselineReceipt.raw_audit_digests.curl_meta.sha256 !== driftReceipt.raw_audit_digests.curl_meta.sha256 && baselineReceipt.effective_url === driftReceipt.effective_url, 'raw metadata drift did not alter audit binding'); cases++;
    const candidateReceipt = read(path.join(candidateRoot, 'independent-source-body-review-receipt.template-v1.json')), trackedCandidateSeal = candidateSeal(candidateRoot, read(path.join(candidateRoot, 'descriptor-v1.json'))); Object.assign(candidateReceipt.bindings, trackedCandidateSeal); candidateReceipt.status = 'completed'; candidateReceipt.reviewer = { identity: 'sol-medium-implementation-worker-issue89-gate-e-v1', review_session_id: 'sol-medium-implementation-worker-issue89-gate-e-v1', role: 'independent_source_body_reviewer', model_route: 'sol_high' }; candidateReceipt.reviewed_at = CREATED_AT; candidateReceipt.independence_attestations = ['I independently inspected each bound representation.', 'I did not infer support from availability, markers, hashes, or same-family duplication.']; candidateReceipt.dispositions = CLAIM_IDS.map(id => ({ claim_id: id, disposition: 'abstained', complete_claim_wording_supported: false, supported_source_representation_ids: [], supported_proposition_ids: [], rationale: 'Synthetic test only.', limitations: ['Synthetic test only.'] }));
    const receiptCase = (label: string, edit: (x: Json) => void, expected: RegExp) => { const x = structuredClone(candidateReceipt); edit(x); let message = ''; try { validateReceipt(Buffer.from(canonical(x)), candidateRoot); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); cases++; };
    receiptCase('reviewer-overlap', () => {}, /overlap/); receiptCase('reviewer-session', x => { x.reviewer.identity = 'fresh-reviewer'; }, /identity\/session/); receiptCase('citation-only-promotion', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[0]; d.disposition = 'accepted'; d.complete_claim_wording_supported = true; d.supported_source_representation_ids = ['repr-r0-lovell-1927']; d.supported_proposition_ids = ['p-c0-fake']; }, /citation-only|outside claim graph|not owned by cited representation/); receiptCase('unsupported-composite', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[1]; d.disposition = 'accepted'; d.complete_claim_wording_supported = false; d.supported_source_representation_ids = ['repr-r0-rpcq-gazette']; d.supported_proposition_ids = ['p-c0-rpcq-address']; }, /accepted claim must cover|unsupported composite/); receiptCase('receipt-regeneration', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; x.bindings.acquisition_manifest_sha256 = 'a'.repeat(64); }, /completed receipt may differ|independently rederived binding substitution/);
    receiptCase('held-unknown-representation', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[2]; d.disposition = 'held'; d.supported_source_representation_ids = ['repr-r999-unknown']; d.supported_proposition_ids = ['p-c999-unknown']; }, /outside claim graph/);
    receiptCase('held-cross-claim-representation', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[2]; d.disposition = 'held'; d.supported_source_representation_ids = ['repr-r100-rpcq-laurentien']; d.supported_proposition_ids = ['p-c100-rpcq-built-1947']; }, /outside claim graph/);
    receiptCase('held-mismatched-proposition-owner', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[2]; d.disposition = 'held'; d.supported_source_representation_ids = ['repr-r10-city-archive-predecessor']; d.supported_proposition_ids = ['p-c100-rpcq-built-1947']; }, /not owned by cited representation/);
    receiptCase('rejected-nonempty-evidence', x => { x.reviewer.identity = x.reviewer.review_session_id = 'fresh-reviewer'; const d = x.dispositions[4]; d.disposition = 'rejected'; d.supported_source_representation_ids = ['repr-r101-lapresse-1927']; d.supported_proposition_ids = ['p-c101-forbidden']; }, /not owned by cited representation|requires explicit empty evidence/);
    const resealedCase = (label: string, mutateRoot: (root: string, receipt: Json) => void, expected: RegExp) => { const root = path.join(temp, `resealed-${label}`); fs.cpSync(candidateRoot, root, { recursive: true }); const receipt = structuredClone(candidateReceipt); receipt.reviewer.identity = receipt.reviewer.review_session_id = 'fresh-resealed-reviewer'; mutateRoot(root, receipt); let message = ''; try { validateReceipt(Buffer.from(canonical(receipt)), root); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); cases++; };
    resealedCase('descriptor-tree-drift', (root) => { const file = path.join(root, 'descriptor-v1.json'), descriptor = read(file); descriptor.tree_sha256 = 'a'.repeat(64); write(file, descriptor); }, /descriptor-v1\.json tree_sha256 drift/);
    resealedCase('descriptor-member-set-drift', (root) => { const file = path.join(root, 'descriptor-v1.json'), descriptor = read(file); descriptor.members[0].path = descriptor.members[1].path; descriptor.tree_sha256 = descriptorTree(descriptor.members); write(file, descriptor); }, /descriptor-v1\.json member paths/);
    resealedCase('detailed-representation-binding-drift', (root, receipt) => { const templateFile = path.join(root, 'independent-source-body-review-receipt.template-v1.json'), template = read(templateFile); template.bindings.representations[0].body_sha256 = receipt.bindings.representations[0].body_sha256 = 'a'.repeat(64); write(templateFile, template); resealCandidate(root); Object.assign(receipt.bindings, candidateSeal(root, read(path.join(root, 'descriptor-v1.json')))); }, /template does not match independently rederived/);
    resealedCase('external-snapshot-binding-drift', (root, receipt) => { const templateFile = path.join(root, 'independent-source-body-review-receipt.template-v1.json'), template = read(templateFile); template.bindings.external_snapshot_sha256 = receipt.bindings.external_snapshot_sha256 = 'a'.repeat(64); write(templateFile, template); resealCandidate(root); Object.assign(receipt.bindings, candidateSeal(root, read(path.join(root, 'descriptor-v1.json')))); }, /template does not match independently rederived/);
    resealedCase('external-storage-receipt-binding-drift', (root, receipt) => { const templateFile = path.join(root, 'independent-source-body-review-receipt.template-v1.json'), template = read(templateFile); template.bindings.external_snapshot_storage_receipt_sha256 = receipt.bindings.external_snapshot_storage_receipt_sha256 = 'a'.repeat(64); write(templateFile, template); resealCandidate(root); Object.assign(receipt.bindings, candidateSeal(root, read(path.join(root, 'descriptor-v1.json')))); }, /template does not match independently rederived/);
    resealedCase('predecessor-binding-drift', (root, receipt) => { const templateFile = path.join(root, 'independent-source-body-review-receipt.template-v1.json'), template = read(templateFile); template.bindings.predecessor_pins[0].sha256 = receipt.bindings.predecessor_pins[0].sha256 = 'a'.repeat(64); write(templateFile, template); resealCandidate(root); Object.assign(receipt.bindings, candidateSeal(root, read(path.join(root, 'descriptor-v1.json')))); }, /template does not match independently rederived/);
    resealedCase('candidate-descriptor-tree-receipt-substitution', (_root, receipt) => { receipt.bindings.candidate_descriptor_sha256 = 'a'.repeat(64); receipt.bindings.candidate_tree_sha256 = 'b'.repeat(64); }, /independently rederived binding substitution/);
    const snapshotDescriptor = read(path.join(candidateRoot, 'external-snapshot-descriptor-v1.json')), snapshotAcquisition = read(path.join(candidateRoot, 'acquisition-manifest-v1.json')), snapshotRaw = bytes(snapshotDescriptor.local_locator), snapshotMembers = parseTar(snapshotRaw);
    const archiveCase = (label: string, members: Map<string, Buffer>, descriptorEdit: (descriptor: Json, archiveRaw: Buffer) => void, expected: RegExp) => { const archiveRaw = archiveFromMembers(members), archivePath = path.join(temp, `${label}.tar.gz`), descriptor = structuredClone(snapshotDescriptor); fs.writeFileSync(archivePath, archiveRaw); descriptorEdit(descriptor, archiveRaw); let message = ''; try { verifyBundle(descriptor, archivePath, snapshotAcquisition); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); cases++; };
    const resealArchive = (descriptor: Json, archiveRaw: Buffer, members: Map<string, Buffer>): void => { descriptor.archive_sha256 = sha(archiveRaw); descriptor.archive_bytes = archiveRaw.length; for (const member of descriptor.members) { const raw = members.get(member.path)!; member.sha256 = sha(raw); member.bytes = raw.length; member.credential_like_material = credentialLikeClassification(member.path, raw); } };
    const mutatedMembers = new Map(snapshotMembers), mutationTarget = Buffer.from(mutatedMembers.get('bodies/rpcq-13105.html')!); mutationTarget[0] ^= 1; mutatedMembers.set('bodies/rpcq-13105.html', mutationTarget);
    archiveCase('mutated-tar-member-bytes', mutatedMembers, () => {}, /external snapshot digest\/bytes drift/);
    const bodyMismatchMembers = new Map(snapshotMembers), changedBody = Buffer.from(bodyMismatchMembers.get('bodies/rpcq-13105.html')!); changedBody[0] ^= 1; bodyMismatchMembers.set('bodies/rpcq-13105.html', changedBody); archiveCase('resealed-body-receipt-mismatch', bodyMismatchMembers, (descriptor, archiveRaw) => resealArchive(descriptor, archiveRaw, bodyMismatchMembers), /private archive receipt\/body binding drift/);
    const rawMetaDriftMembers = new Map(snapshotMembers), receiptMember = bodySpecs[0].receiptMember, driftedReceipt = JSON.parse(rawMetaDriftMembers.get(receiptMember)!.toString('utf8')); driftedReceipt.raw_audit_digests.curl_meta.sha256 = 'a'.repeat(64); const driftedReceiptRaw = Buffer.from(canonical(driftedReceipt)); rawMetaDriftMembers.set(receiptMember, driftedReceiptRaw); archiveCase('resealed-raw-meta-binding-drift', rawMetaDriftMembers, (descriptor, archiveRaw) => resealArchive(descriptor, archiveRaw, rawMetaDriftMembers), /private archive receipt\/body binding drift/);
    const relocatedMembers = new Map(snapshotMembers), publicBody = Buffer.from(relocatedMembers.get(PUBLIC_TOKEN_MEMBER)!), publicText = publicBody.toString('utf8'), tokenMatch = /\bpk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.exec(publicText); assert(tokenMatch, 'synthetic relocation source marker missing'); const token = tokenMatch[0], replacement = ' '.repeat(Buffer.byteLength(token)); relocatedMembers.set(PUBLIC_TOKEN_MEMBER, Buffer.from(`${publicText.slice(0, tokenMatch.index)}${replacement}${publicText.slice(tokenMatch.index + token.length)}`)); const relocationTarget = 'bodies/rpcq-13105.html', targetBody = relocatedMembers.get(relocationTarget)!; relocatedMembers.set(relocationTarget, Buffer.concat([targetBody, Buffer.from(`\n${token}`)]));
    const relocatedArchive = archiveFromMembers(relocatedMembers), relocatedParsed = parseTar(relocatedArchive); let relocationMessage = ''; try { for (const [member, raw] of relocatedParsed) credentialLikeClassification(member, raw); } catch (error) { relocationMessage = String(error); } assert(/origin-public client token occurrence\/member drift/.test(relocationMessage), `origin-public-token-relocation: expected rejection, got ${relocationMessage}`); cases++;
    const archivalCase = (label: string, edit: (descriptor: Json) => void, expected: RegExp) => { const descriptor = structuredClone(snapshotDescriptor); edit(descriptor); let message = ''; try { verifyArchivalEvent(descriptor); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); cases++; };
    archivalCase('r2-provider-substitution', x => { x.upload_readback_receipt.provider = 'substituted'; }, /receipt drift/);
    archivalCase('r2-bucket-substitution', x => { x.upload_readback_receipt.bucket = 'substituted'; }, /durable locator substitution|receipt drift/);
    archivalCase('r2-object-key-substitution', x => { x.upload_readback_receipt.object_key = 'artifacts/substituted.tar.gz'; }, /durable locator substitution|receipt drift/);
    archivalCase('r2-locator-substitution', x => { x.external_locator = 'r2://substituted/object'; }, /durable locator substitution/);
    archivalCase('r2-receipt-locator-substitution', x => { x.upload_readback_receipt.durable_locator = 'r2://substituted/object'; }, /receipt drift/);
    archivalCase('r2-archive-hash-drift', x => { x.archive_sha256 = 'a'.repeat(64); }, /archive receipt\/body binding drift/);
    archivalCase('r2-receipt-archive-hash-drift', x => { x.upload_readback_receipt.archive_sha256 = 'a'.repeat(64); }, /receipt drift|archive receipt\/body binding drift/);
    archivalCase('r2-archive-byte-drift', x => { x.archive_bytes++; }, /archive receipt\/body binding drift/);
    archivalCase('r2-readback-status-drift', x => { x.upload_readback_receipt.readback_status = 'uploaded_only'; }, /receipt drift/);
    archivalCase('r2-observed-time-drift', x => { x.upload_readback_receipt.observed_at = '2026-07-14T03:58:14Z'; }, /receipt drift/);
    archivalCase('presigned-url-injection', x => { x.upload_readback_receipt.presigned_url = 'https://example.invalid/private'; }, /receipt drift|presigned URL/);
    assert(!fs.readFileSync(candidateRegistry, 'utf8').includes(`\"stable_id\":\"${REGISTRY_ID}\"`), 'registry before receipt'); cases++;
    return { self_test: 'passed', adversarial_rejections: cases, production_mutation: false };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function integration(rawRoot: string, externalRoot: string): Json {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewed-source-integration-'));
  const trackedFiles = listFiles(FIXTURE), trackedBefore = new Map(trackedFiles.map(file => [file, bytes(path.join(FIXTURE, file))])), registryBefore = bytes(REGISTRY);
  try {
    const a = path.join(temp, 'a'), b = path.join(temp, 'b'), extA = path.join(temp, 'ext-a'), extB = path.join(temp, 'ext-b'), tempRegistry = registryWithoutAuthority(path.join(temp, 'artifact-registry.v0.jsonl')); const va = writeCandidate(a, rawRoot, extA, tempRegistry), vb = writeCandidate(b, rawRoot, extB, tempRegistry);
    for (const file of [...CANDIDATE_MEMBERS, 'descriptor-v1.json']) assert(bytes(path.join(a, file)).equals(bytes(path.join(b, file))), `candidate replay differs: ${file}`); assert(bytes(path.join(extA, 'reviewed-source-evidence-v1-private-snapshot.tar.gz')).equals(bytes(path.join(extB, 'reviewed-source-evidence-v1-private-snapshot.tar.gz'))), 'snapshot bundle replay differs');
    const receipt = read(path.join(a, 'independent-source-body-review-receipt.template-v1.json')); Object.assign(receipt.bindings, candidateSeal(a, read(path.join(a, 'descriptor-v1.json')))); receipt.status = 'completed'; receipt.reviewer = { identity: 'synthetic-sol-high-publication-test-only', review_session_id: 'synthetic-sol-high-publication-test-only', role: 'independent_source_body_reviewer', model_route: 'sol_high' }; receipt.reviewed_at = CREATED_AT; receipt.independence_attestations = ['Synthetic isolated publication test; this is not reviewer authority.', 'Synthetic dispositions remain inside a temporary fixture and are never published.']; receipt.dispositions = CLAIM_IDS.map(id => ({ claim_id: id, disposition: 'abstained', complete_claim_wording_supported: false, supported_source_representation_ids: [], supported_proposition_ids: [], rationale: 'Synthetic isolated publication test only.', limitations: ['Not reviewer authority.'] })); Object.assign(receipt.dispositions[1], { disposition: 'accepted', complete_claim_wording_supported: true, supported_source_representation_ids: ['repr-r0-rpcq-gazette'], supported_proposition_ids: ['p-c0-rpcq-address', 'p-c0-rpcq-year'] }); Object.assign(receipt.dispositions[2], { disposition: 'held', supported_source_representation_ids: ['repr-r10-city-archive-predecessor'], supported_proposition_ids: ['p-c10-city-perreault'] }); Object.assign(receipt.dispositions[4], { disposition: 'rejected' }); const receiptRaw = Buffer.from(canonical(receipt));
    const publication = publishToRoot(a, tempRegistry, receiptRaw), published = semantic(a, undefined, true, tempRegistry); assert(publication.status === 'published' && published.authoritative && bytes(path.join(a, AUTHORITY)).equals(receiptRaw), 'isolated publication/byte preservation failed');
    const publishedQueue = read(path.join(a, 'unresolved-queue-v1.json')); exactStrings(publishedQueue.items.map((item: Json) => item.status), ['abstained_unresolved', 'accepted_resolved', 'held_for_additional_evidence', 'abstained_unresolved', 'rejected_resolved', 'abstained_unresolved', 'abstained_unresolved'], 'isolated publication queue derivation');
    const publishedRegistryRow = JSON.parse(fs.readFileSync(tempRegistry, 'utf8').trim().split('\n').at(-1)!); const expectedDirectInputs = ['dfv0_ground_authoritative_research_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1', 'dfv0_ground_claim_adjudication_v1', 'dfv0_issue69_phase_d_scale_v1_20260713']; assert(canonical(publishedRegistryRow.dependency_ids) === canonical(expectedDirectInputs) && canonical(publishedRegistryRow.source_lineage.source_artifact_ids) === canonical(expectedDirectInputs), 'published registry direct input lineage drift');
    let secondPublicationRejected = false; try { publishToRoot(a, tempRegistry, receiptRaw); } catch (error) { secondPublicationRejected = /second publication rejected/.test(String(error)); } assert(secondPublicationRejected, 'isolated second publication was not rejected');
    assert(listFiles(FIXTURE).join('\n') === trackedFiles.join('\n') && trackedFiles.every(file => bytes(path.join(FIXTURE, file)).equals(trackedBefore.get(file)!)) && bytes(REGISTRY).equals(registryBefore), 'isolated publication changed tracked candidate or registry bytes');
    return { integration_test: 'passed', candidate_replay: 'byte_identical', bundle_replay: 'byte_identical', tree_sha256: va.tree_sha256, second_tree_sha256: vb.tree_sha256, isolated_publication: 'passed', receipt_byte_preservation: 'passed', second_publication_rejected: true, tracked_candidate_unchanged: true, tracked_registry_unchanged: true };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
const arg = (name: string, fallback = ''): string => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? '' : fallback; };
const command = process.argv[2] ?? 'verify', external = path.resolve(arg('--external-root', DEFAULT_EXTERNAL)), rawRoot = path.resolve(arg('--raw-root', path.join(external, 'raw'))), archive = arg('--bundle', path.join(external, 'reviewed-source-evidence-v1-private-snapshot.tar.gz'));
if (command === 'build') console.log(JSON.stringify(writeCandidate(FIXTURE, rawRoot, external)));
else if (command === 'verify') console.log(JSON.stringify(semantic(FIXTURE, undefined, fs.existsSync(path.join(FIXTURE, AUTHORITY)))));
else if (command === 'verify-snapshot') { semantic(FIXTURE, undefined, fs.existsSync(path.join(FIXTURE, AUTHORITY))); verifyBundle(read(path.join(FIXTURE, 'external-snapshot-descriptor-v1.json')), archive, read(path.join(FIXTURE, 'acquisition-manifest-v1.json'))); console.log(JSON.stringify({ status: 'verified', bundle: archive })); }
else if (command === 'self-test') console.log(JSON.stringify(selfTest(rawRoot)));
else if (command === 'integration-test') console.log(JSON.stringify(integration(rawRoot, external)));
else if (command === 'validate-receipt') { const raw = stableExternalFile(path.resolve(arg('--receipt'))); validateReceipt(raw); console.log(JSON.stringify({ status: 'valid', bytes: raw.length, sha256: sha(raw) })); }
else if (command === 'publish') console.log(JSON.stringify(publish(arg('--receipt'))));
else throw new Error(`unknown command: ${command}`);
