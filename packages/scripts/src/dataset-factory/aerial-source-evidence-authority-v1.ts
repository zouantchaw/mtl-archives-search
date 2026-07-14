import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { createGunzip, createGzip } from 'node:zlib';

type Json = Record<string, any>;
type Member = { path: string; bytes: number; sha256: string; member_kind: string };
const VERSION = 'aerial_source_evidence_authority_v1.0.0';
const ARTIFACT_ID = 'aerial-source-evidence-v1';
const CANDIDATE_FILES = ['descriptor-v1.json', 'evidence-ledger-v1.json', 'external-archive-descriptor-v1.json', 'independent-source-review-receipt.template-v1.json', 'source-body-evidence-v1.json', 'status-report-v1.json'];
const ARCHIVED_FILES = [...CANDIDATE_FILES, 'candidate-descriptor-v1.json', 'external-archive-upload-readback-receipt-v1.json', 'archived-candidate-descriptor-v1.json'];
const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const canonical = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256 = (value: Buffer): string => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file: string, value: unknown): void => fs.writeFileSync(file, canonical(value), { flag: 'wx', mode: 0o600 });
const bind = (file: string, relative = path.basename(file)): Json => { const raw = fs.readFileSync(file); return { path: relative, bytes: raw.length, sha256: sha256(raw) }; };
const treeHash = (members: Json[]): string => sha256(Buffer.from(`${members.map(row => `${row.path}\t${row.sha256}\t${row.bytes}`).join('\n')}\n`));

function exactKeys(value: Json, keys: string[], label: string): void {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label}: exact schema keys required`);
}
function digest(value: unknown, label: string): void { assert(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), `${label}: sha256 required`); }
function dateTime(value: unknown, label: string): void { assert(typeof value === 'string' && !Number.isNaN(Date.parse(value)), `${label}: RFC3339 time required`); }
function safePath(value: string): string {
  assert(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 100, 'archive path invalid');
  assert(!path.posix.isAbsolute(value) && !value.includes('\\') && path.posix.normalize(value) === value && !value.split('/').includes('..'), 'archive path traversal rejected');
  return value;
}
function stableFile(file: string): Buffer {
  assert(path.resolve(file) === file, 'external file path must be normalized absolute');
  const before = fs.lstatSync(file); assert(before.isFile() && !before.isSymbolicLink(), 'external regular file required');
  const raw = fs.readFileSync(file), after = fs.lstatSync(file);
  assert(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'external file changed while reading'); return raw;
}
function newDirectory(root: string): void { assert(path.resolve(root) === root && !fs.existsSync(root), 'output directory must be new normalized absolute path'); fs.mkdirSync(root, { mode: 0o700 }); }
function exactFiles(root: string, expected: string[], label: string): void {
  const actual = fs.readdirSync(root).sort(); assert(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label}: exact file set drift`);
  for (const name of actual) assert(fs.lstatSync(path.join(root, name)).isFile() && !fs.lstatSync(path.join(root, name)).isSymbolicLink(), `${label}: regular files only`);
}
function copyExact(source: string, target: string, names: string[]): void {
  exactFiles(source, names, 'input state'); for (const name of names) fs.copyFileSync(path.join(source, name), path.join(target, name), fs.constants.COPYFILE_EXCL);
}
function archiveMembers(candidate: string): Member[] {
  const archive = readJson(path.join(candidate, 'external-archive-descriptor-v1.json'));
  assert(Array.isArray(archive.members) && archive.members.length === 44, 'archive descriptor must name exactly 44 members');
  const members = archive.members.map((row: Json) => { exactKeys(row, ['path', 'bytes', 'sha256', 'member_kind'], `archive member ${row.path}`); safePath(row.path); assert(Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'archive member bytes invalid'); digest(row.sha256, 'archive member'); assert(['exact_official_media', 'sanitized_transport_receipt'].includes(row.member_kind), 'archive member kind invalid'); return row as Member; });
  assert(new Set(members.map(row => row.path)).size === 44, 'archive duplicate member');
  assert(members.filter(row => row.member_kind === 'exact_official_media').length === 22 && members.filter(row => row.member_kind === 'sanitized_transport_receipt').length === 22, 'archive 22+22 membership required');
  assert(JSON.stringify(members.map(row => row.path)) === JSON.stringify([...members.map(row => row.path)].sort()), 'archive member order must be lexical'); return members;
}
function sanitizedReceipt(record: Json): Buffer { return canonical({ schema_version: 'aerial_acquisition_transport_receipt_v1.1.0', numeric_id: record.numeric_id, requested_url: record.official_metadata.source_url, media: { path: record.media.private_member, bytes: record.media.bytes, sha256: record.media.sha256 }, transport: record.media.transport }); }
function tarOctal(header: Buffer, value: number, offset: number, width: number): void { const text = `${value.toString(8).padStart(width - 1, '0')}\0`; assert(text.length === width, 'tar numeric overflow'); header.write(text, offset, width, 'ascii'); }
function tarHeader(name: string, size: number): Buffer {
  safePath(name); const header = Buffer.alloc(512); header.write(name, 0, 100, 'utf8'); tarOctal(header, 0o600, 100, 8); tarOctal(header, 0, 108, 8); tarOctal(header, 0, 116, 8); tarOctal(header, size, 124, 12); tarOctal(header, 0, 136, 12); header.fill(0x20, 148, 156); header[156] = 0x30; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii'); const sum = header.reduce((total, byte) => total + byte, 0); header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii'); return header;
}
function appendFile(output: number, file: string, expected: Member): void {
  const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink(), `archive input regular file required ${expected.path}`); const input = fs.openSync(file, 'r'); const hash = crypto.createHash('sha256'); let bytes = 0; try { const chunk = Buffer.alloc(1024 * 1024); for (;;) { const count = fs.readSync(input, chunk); if (!count) break; const body = chunk.subarray(0, count); fs.writeSync(output, body); hash.update(body); bytes += count; } } finally { fs.closeSync(input); }
  assert(bytes === expected.bytes && hash.digest('hex') === expected.sha256, `archive input substitution ${expected.path}`);
}
async function pack(candidate: string, mediaRoot: string, output: string): Promise<Json> {
  verifyCandidate(candidate); assert(path.resolve(output) === output && !fs.existsSync(output), 'archive output must be new normalized absolute');
  const members = archiveMembers(candidate), records = readJson(path.join(candidate, 'evidence-ledger-v1.json')).records, tar = `${output}.uncompressed-${process.pid}`; assert(!fs.existsSync(tar), 'temporary tar collision');
  const fd = fs.openSync(tar, 'wx', 0o600); try { for (const member of members) { fs.writeSync(fd, tarHeader(member.path, member.bytes)); if (member.member_kind === 'exact_official_media') { const id = Number(member.path.match(/^media\/(\d+)\./)?.[1]); assert(id, 'media member identity invalid'); appendFile(fd, path.join(mediaRoot, `${id}.media`), member); } else { const id = Number(member.path.match(/^receipts\/(\d+)\.json$/)?.[1]), record = records.find((row: Json) => row.numeric_id === id); assert(record, 'receipt member identity invalid'); const body = sanitizedReceipt(record); assert(body.length === member.bytes && sha256(body) === member.sha256, `receipt derivation drift ${id}`); fs.writeSync(fd, body); } const padding = (512 - member.bytes % 512) % 512; if (padding) fs.writeSync(fd, Buffer.alloc(padding)); } fs.writeSync(fd, Buffer.alloc(1024)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { await pipeline(fs.createReadStream(tar), createGzip({ level: 9, mtime: 0 } as any), fs.createWriteStream(output, { flags: 'wx', mode: 0o600 })); } finally { fs.rmSync(tar, { force: true }); }
  return verifyArchive(candidate, output);
}
function parseTar(tar: string, expected: Member[]): void {
  const stat = fs.statSync(tar), fd = fs.openSync(tar, 'r'); let offset = 0, zeros = 0; const found: Json[] = [], names = new Set<string>();
  try { while (offset < stat.size) { const header = Buffer.alloc(512); assert(fs.readSync(fd, header, 0, 512, offset) === 512, 'archive truncated header'); offset += 512; if (header.every(byte => byte === 0)) { zeros++; if (zeros === 2) break; continue; } assert(zeros === 0, 'archive member after terminator'); const check = Buffer.from(header), storedText = header.subarray(148, 154).toString('ascii'); assert(/^[0-7]{6}$/.test(storedText), 'archive checksum encoding invalid'); check.fill(0x20, 148, 156); assert(Number.parseInt(storedText, 8) === check.reduce((sum, byte) => sum + byte, 0), 'archive checksum mismatch'); const name = safePath(header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')); assert(!names.has(name), 'archive duplicate member'); names.add(name); assert(header[156] === 0x30 && header.subarray(157, 257).every(byte => byte === 0) && header.subarray(257, 263).equals(Buffer.from('ustar\0')) && header.subarray(263, 265).equals(Buffer.from('00')), 'archive regular ustar files only'); const mode = header.subarray(100, 107).toString('ascii'), uid = header.subarray(108, 115).toString('ascii'), gid = header.subarray(116, 123).toString('ascii'), mtime = header.subarray(136, 147).toString('ascii'); assert(mode === '0000600' && uid === '0000000' && gid === '0000000' && mtime === '00000000000', 'archive deterministic metadata drift'); const sizeText = header.subarray(124, 135).toString('ascii'); assert(/^[0-7]{11}$/.test(sizeText), 'archive size encoding invalid'); const size = Number.parseInt(sizeText, 8), hash = crypto.createHash('sha256'); let remaining = size; while (remaining > 0) { const chunk = Buffer.alloc(Math.min(1024 * 1024, remaining)), count = fs.readSync(fd, chunk, 0, chunk.length, offset); assert(count > 0, 'archive member truncated'); hash.update(chunk.subarray(0, count)); offset += count; remaining -= count; } const padding = (512 - size % 512) % 512; if (padding) { const pad = Buffer.alloc(padding); assert(fs.readSync(fd, pad, 0, padding, offset) === padding && pad.every(byte => byte === 0), 'archive nonzero padding'); offset += padding; } found.push({ path: name, bytes: size, sha256: hash.digest('hex') }); }
    assert(zeros === 2 && offset === stat.size, 'archive terminator or trailing bytes rejected');
  } finally { fs.closeSync(fd); }
  const projected = expected.map(({ path: name, bytes, sha256: hash }) => ({ path: name, bytes, sha256: hash })); assert(JSON.stringify(found) === JSON.stringify(projected), 'archive exact ordered member set/content drift');
}
async function verifyArchive(candidate: string, archive: string): Promise<Json> {
  const raw = stableFile(archive), expected = archiveMembers(candidate), temp = path.join(os.tmpdir(), `gate-f-${crypto.randomUUID()}.tar`);
  try { await pipeline(fs.createReadStream(archive), createGunzip(), fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 })); parseTar(temp, expected); } catch (error) { throw new Error(`archive gzip/tar verification failed: ${String(error)}`); } finally { fs.rmSync(temp, { force: true }); }
  return { status: 'verified', format: 'ustar+gzip', archive_sha256: sha256(raw), archive_bytes: raw.length, members: 44 };
}
function verifyCandidate(root: string): Json {
  exactFiles(root, CANDIDATE_FILES, 'candidate'); const descriptor = readJson(path.join(root, 'descriptor-v1.json')); assert(descriptor.authority_status === 'candidate_held_external_review_required', 'ordinary candidate rebuild/transition authority refused'); const members = descriptor.members.map((row: Json) => bind(path.join(root, row.path), row.path)); assert(JSON.stringify(members) === JSON.stringify(descriptor.members) && treeHash(members) === descriptor.tree_sha256, 'candidate descriptor/tree drift'); archiveMembers(root); return descriptor;
}
function uploadReceipt(raw: Buffer, archiveResult?: Json): Json {
  const value = JSON.parse(raw.toString('utf8')); exactKeys(value, ['schema_version', 'artifact_id', 'status', 'provider', 'bucket', 'object_key', 'durable_locator', 'archive_sha256', 'archive_bytes', 'uploaded_at', 'local', 'readback', 'signed_url'], 'upload receipt'); assert(value.schema_version === VERSION && value.artifact_id === ARTIFACT_ID && value.status === 'completed' && value.provider === 'r2', 'upload receipt identity/status invalid'); assert(typeof value.bucket === 'string' && /^[A-Za-z0-9._-]+$/.test(value.bucket) && typeof value.object_key === 'string' && value.object_key.length > 0 && !value.object_key.includes('..'), 'R2 bucket/key invalid'); assert(value.durable_locator === `r2://${value.bucket}/${value.object_key}` && value.signed_url === null, 'non-signed durable R2 locator required'); digest(value.archive_sha256, 'archive receipt'); if (archiveResult) assert(value.archive_sha256 === archiveResult.archive_sha256 && value.archive_bytes === archiveResult.archive_bytes, 'upload receipt local archive substitution'); dateTime(value.uploaded_at, 'upload time'); exactKeys(value.local, ['sha256', 'bytes'], 'local archive receipt'); exactKeys(value.readback, ['status', 'observed_at', 'sha256', 'bytes'], 'readback receipt'); assert(value.local.sha256 === value.archive_sha256 && value.local.bytes === value.archive_bytes && value.readback.status === 'byte_identical' && value.readback.sha256 === value.archive_sha256 && value.readback.bytes === value.archive_bytes, 'upload/readback byte equality required'); dateTime(value.readback.observed_at, 'readback time'); assert(Date.parse(value.readback.observed_at) >= Date.parse(value.uploaded_at), 'readback predates upload'); return value;
}
function stateDescriptor(root: string, state: string, names: string[]): Json { const members = names.filter(name => name !== 'archived-candidate-descriptor-v1.json').sort().map(name => bind(path.join(root, name), name)), receipt = uploadReceipt(fs.readFileSync(path.join(root, 'external-archive-upload-readback-receipt-v1.json'))); return { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: state, archive: { sha256: receipt.archive_sha256, bytes: receipt.archive_bytes, durable_locator: receipt.durable_locator, upload_readback_receipt_sha256: sha256(fs.readFileSync(path.join(root, 'external-archive-upload-readback-receipt-v1.json'))) }, members, tree_sha256: treeHash(members), production_mutation: false }; }
async function sealArchived(candidate: string, archive: string, receiptFile: string, output: string): Promise<Json> {
  const original = verifyCandidate(candidate), archiveResult = await verifyArchive(candidate, archive), receiptRaw = stableFile(receiptFile); uploadReceipt(receiptRaw, archiveResult); newDirectory(output); copyExact(candidate, output, CANDIDATE_FILES); fs.copyFileSync(path.join(candidate, 'descriptor-v1.json'), path.join(output, 'candidate-descriptor-v1.json'), fs.constants.COPYFILE_EXCL); fs.writeFileSync(path.join(output, 'external-archive-upload-readback-receipt-v1.json'), receiptRaw, { flag: 'wx', mode: 0o600 }); const archived = stateDescriptor(output, 'archived_candidate_external_review_required', [...CANDIDATE_FILES, 'candidate-descriptor-v1.json', 'external-archive-upload-readback-receipt-v1.json']); writeJson(path.join(output, 'archived-candidate-descriptor-v1.json'), archived); verifyArchived(output, archive); return { status: archived.authority_status, original_candidate_tree_sha256: original.tree_sha256, archived_tree_sha256: archived.tree_sha256, archive_sha256: archiveResult.archive_sha256 };
}
async function verifyArchived(root: string, archive?: string): Promise<Json> {
  exactFiles(root, ARCHIVED_FILES, 'archived candidate'); const originalRaw = fs.readFileSync(path.join(root, 'candidate-descriptor-v1.json')), currentRaw = fs.readFileSync(path.join(root, 'descriptor-v1.json')); assert(originalRaw.equals(currentRaw), 'original candidate descriptor not byte-preserved'); const archived = readJson(path.join(root, 'archived-candidate-descriptor-v1.json')), expected = stateDescriptor(root, 'archived_candidate_external_review_required', [...CANDIDATE_FILES, 'candidate-descriptor-v1.json', 'external-archive-upload-readback-receipt-v1.json']); assert(JSON.stringify(archived) === JSON.stringify(expected), 'archived candidate descriptor/tree drift'); const receiptRaw = fs.readFileSync(path.join(root, 'external-archive-upload-readback-receipt-v1.json')); uploadReceipt(receiptRaw, archive ? await verifyArchive(root, archive) : undefined); return archived;
}
function mutateTar(file: string, edit: (header: Buffer) => void): void { const raw = fs.readFileSync(file); edit(raw.subarray(0, 512)); raw.fill(0x20, 148, 156); const sum = raw.subarray(0, 512).reduce((n, byte) => n + byte, 0); raw.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii'); fs.writeFileSync(file, raw); }
async function selfTest(): Promise<Json> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-f-authority-self-')); let rejected = 0; const reject = async (label: string, run: () => unknown | Promise<unknown>, pattern: RegExp) => { let message = ''; try { await run(); } catch (error) { message = String(error); } assert(pattern.test(message), `${label}: expected rejection, got ${message}`); rejected++; };
  try { const body = Buffer.from('test-body'), member: Member = { path: 'media/1.bin', bytes: body.length, sha256: sha256(body), member_kind: 'exact_official_media' }, make = (name: string) => { const file = path.join(temp, name), fd = fs.openSync(file, 'wx'); fs.writeSync(fd, tarHeader(member.path, body.length)); fs.writeSync(fd, body); fs.writeSync(fd, Buffer.alloc((512 - body.length % 512) % 512)); fs.writeSync(fd, Buffer.alloc(1024)); fs.closeSync(fd); return file; }; parseTar(make('valid.tar'), [member]);
    const traversal = make('traversal.tar'); mutateTar(traversal, h => { h.fill(0, 0, 100); h.write('../x'); }); await reject('traversal', () => parseTar(traversal, [member]), /traversal/);
    const link = make('link.tar'); mutateTar(link, h => { h[156] = 0x32; }); await reject('link', () => parseTar(link, [member]), /regular ustar/);
    const extra = make('extra.tar'); fs.appendFileSync(extra, Buffer.alloc(512)); await reject('extra', () => parseTar(extra, [member]), /trailing bytes/);
    const truncated = make('truncated.tar'); fs.truncateSync(truncated, 600); await reject('truncated', () => parseTar(truncated, [member]), /truncated|terminator|padding/);
    const substitute = make('substitute.tar'); const raw = fs.readFileSync(substitute); raw[512] ^= 1; fs.writeFileSync(substitute, raw); await reject('substitution', () => parseTar(substitute, [member]), /content drift/);
    const duplicate = path.join(temp, 'duplicate.tar'), one = fs.readFileSync(make('one.tar')); fs.writeFileSync(duplicate, Buffer.concat([one.subarray(0, 1024), one])); await reject('duplicate', () => parseTar(duplicate, [member]), /duplicate/);
    const archiveResult = { archive_sha256: 'a'.repeat(64), archive_bytes: 1234 }, validReceipt = { schema_version: VERSION, artifact_id: ARTIFACT_ID, status: 'completed', provider: 'r2', bucket: 'private-evidence', object_key: 'issue90/archive.tar.gz', durable_locator: 'r2://private-evidence/issue90/archive.tar.gz', archive_sha256: archiveResult.archive_sha256, archive_bytes: archiveResult.archive_bytes, uploaded_at: '2026-07-14T10:00:00.000Z', local: { sha256: archiveResult.archive_sha256, bytes: archiveResult.archive_bytes }, readback: { status: 'byte_identical', observed_at: '2026-07-14T10:05:00.000Z', sha256: archiveResult.archive_sha256, bytes: archiveResult.archive_bytes }, signed_url: null }; uploadReceipt(canonical(validReceipt), archiveResult);
    await reject('readback-substitution', () => uploadReceipt(canonical({ ...validReceipt, readback: { ...validReceipt.readback, sha256: 'b'.repeat(64) } }), archiveResult), /byte equality/);
    await reject('archive-substitution', () => uploadReceipt(canonical({ ...validReceipt, archive_bytes: 1235, local: { ...validReceipt.local, bytes: 1235 }, readback: { ...validReceipt.readback, bytes: 1235 } }), archiveResult), /local archive substitution/);
    await reject('signed-locator', () => uploadReceipt(canonical({ ...validReceipt, durable_locator: 'https://signed.example/object' }), archiveResult), /non-signed durable R2/);
    return { status: 'passed', adversarial_rejections: rejected, cases: ['traversal', 'link', 'extra', 'truncation', 'substitution', 'duplicate', 'readback substitution', 'archive substitution', 'signed locator'], production_mutation: false };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

const parsed = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' }, archived: { type: 'string' }, output: { type: 'string' }, archive: { type: 'string' }, 'media-root': { type: 'string' }, receipt: { type: 'string' } } });
const command = parsed.positionals[0]; const absolute = (name: keyof typeof parsed.values): string => path.resolve(String(parsed.values[name]));
if (command === 'pack') console.log(JSON.stringify(await pack(absolute('candidate'), absolute('media-root'), absolute('output'))));
else if (command === 'verify-archive') console.log(JSON.stringify(await verifyArchive(absolute('candidate'), absolute('archive'))));
else if (command === 'seal-archived') console.log(JSON.stringify(await sealArchived(absolute('candidate'), absolute('archive'), absolute('receipt'), absolute('output'))));
else if (command === 'verify-archived') console.log(JSON.stringify(await verifyArchived(absolute('archived'), parsed.values.archive ? absolute('archive') : undefined)));
else if (command === 'self-test') console.log(JSON.stringify(await selfTest()));
else throw new Error('command required: pack|verify-archive|seal-archived|verify-archived|self-test');
