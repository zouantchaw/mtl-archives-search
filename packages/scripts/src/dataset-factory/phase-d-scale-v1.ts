import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';

type Json = any;
type SourceRef = { artifact_id: string; member_path: string; member_sha256: string; line: number };
type Row = { value: Json; raw: Buffer; sha256: string; source?: SourceRef };
type PredecessorSpec = { id: string; commit: string; path: string; blob: string; sha256: string; bytes: number };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURE_REL = 'docs/dataset-factory/fixtures/phase-d-scale-v1';
const FIXTURE = path.join(ROOT, FIXTURE_REL);
const SCHEMAS = path.join(ROOT, 'docs/dataset-factory/schemas/phase-d-scale-v1');
const REGISTRY = path.join(ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');
const REGISTRY_SCHEMA = path.join(ROOT, 'docs/dataset-factory/artifact-registry.schema.v0.json');
const ARTIFACT_ID = 'dfv0_issue69_phase_d_scale_v1_20260713';
const CREATED_AT = '2026-07-13T00:00:00.000Z';
const GOLD_PREFIX = 'data/mtl_archives/reports/gold_label_batch_002/';
const RECOVERY_PREFIX = 'data/mtl_archives/reports/canonical_image_recovery_v1/';
const GOLD_DESCRIPTOR_REL = 'docs/dataset-factory/fixtures/gold-label-batch-002/final-bundle-v1.json';
const RECOVERY_DESCRIPTOR_REL = 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/reproducibility-bundle-v1.json';
const PILOT_PROMOTION_REL = 'docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-visual-promotion-v1.json';
const PILOT_REVIEW_REL = 'docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-independent-visual-review-v1.json';
const PILOT_INTELLIGENCE_DESCRIPTOR_REL = 'docs/dataset-factory/fixtures/real-pilot-intelligence-v1/descriptor-v1.json';
const PILOT_INTELLIGENCE_ROOT_REL = path.posix.dirname(PILOT_INTELLIGENCE_DESCRIPTOR_REL);
const SELECTION = 'candidate-selection-evidence-v1.json';
const ARCHIVE_MANIFEST = 'archive-verification-manifest-v1.json';
const RECEIPT_TEMPLATE = 'reviewer-selection-receipt.template-v1.json';
const COMPLETED_RECEIPT = 'reviewer-selection-receipt-v1.json';
const MEMBERS = [SELECTION, ARCHIVE_MANIFEST, RECEIPT_TEMPLATE, 'status-report-v1.json'] as const;
const CANDIDATE_FILES = [...MEMBERS, 'descriptor-v1.json'] as const;
const FINAL_FILES = [...CANDIDATE_FILES, COMPLETED_RECEIPT] as const;
const PILOT_IDS = [0, 10, 100, 101, 102, 105, 8132, 8134, 8139, 8143, 10145, 11118] as const;
const PILOT_ONLY_IDS = [0, 11118] as const;
const PILOT_STRATA: Record<number, string> = { 0: 'ground', 10: 'ground', 100: 'ground', 101: 'ground', 102: 'ground', 105: 'ground', 8132: 'aerial', 8134: 'aerial', 8139: 'aerial', 8143: 'aerial', 10145: 'control', 11118: 'control' };
const TARGETS = ['ground', 'aerial', 'control'] as const;
const TARGET_COUNTS = { ground: 30, aerial: 20, control: 10 } as const;

const PREDECESSORS: readonly PredecessorSpec[] = [
  { id: 'visual-family-graph-v1', commit: 'a64ffc9bd1205bc1e3abb5ed72ba4ed33bfca866', path: 'docs/dataset-factory/visual-family-graph-v1-evidence.json', blob: '5a64da5a5a1fa0be25b21938a1aa481a2834aada', sha256: '5473417695cef9bf4acbff43d3038346795d048eae474cfa830c02bef332fbe0', bytes: 13506 },
  { id: 'canonical-image-recovery-v1', commit: 'ab0f302172d260129e641bbd449f55f3442da13f', path: RECOVERY_DESCRIPTOR_REL, blob: 'bb3158bc243b28f1a19f1208e018bcf5d4a67519', sha256: 'bf76a4d59b0f5dfd6b59d61539b2ada017f89d00cb74f76f4b8a0688056e3b37', bytes: 62600 },
  { id: 'gold-label-batch-002', commit: '078c25d36e2f8cf1438d4c046d7dcdc0867909bf', path: GOLD_DESCRIPTOR_REL, blob: 'b84612a8f565eef2290b411b47cbe85d7f6cc7b6', sha256: '1b51abf1fd9c385f71447c8bead85dfb61268068e4f30b6b0c219b90fd032098', bytes: 343764 },
  { id: 'real-pilot-visual-promotion-v1', commit: 'b245ba379271fbad139afc120a613de461cb7558', path: PILOT_PROMOTION_REL, blob: 'a36da11504ea3394f689b0b88788b34f7a1756a6', sha256: '8fe075ab8770891662b3b78045ea77d179455af893fdef5f68a28b4e6f2f075a', bytes: 1367 },
  { id: 'real-pilot-independent-visual-review-v1', commit: 'b245ba379271fbad139afc120a613de461cb7558', path: PILOT_REVIEW_REL, blob: '5d5e3600d02cd25064b57b6a018e875f7a72f718', sha256: 'e614092da109c9fc90802dafae1b62741669aa748323bb43b98c2ad6235513e7', bytes: 1228 },
  { id: 'real-pilot-intelligence-v1', commit: 'c013d346be8b12cf107e359152d78784b86a59e3', path: PILOT_INTELLIGENCE_DESCRIPTOR_REL, blob: 'c0788394bbb080b818b0e6ac501db92c6a3b0830', sha256: '178ceef735838c85c800c5c57f0b69808c4ba23157bbad00187a02d93f7ab137', bytes: 6504 },
] as const;

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function sha(value: Buffer | string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function bytes(file: string): Buffer { return fs.readFileSync(file); }
function json(file: string): Json { return JSON.parse(bytes(file).toString('utf8')); }
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function writeJson(file: string, value: Json): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${canonical(value)}\n`); }
function safeRelative(value: unknown, label: string): string {
  const relative = String(value);
  assert(relative.length > 0 && !relative.includes('\\') && !relative.includes('//') && !relative.includes('\0'), `${label} unsafe separator`);
  assert(!path.posix.isAbsolute(relative) && !/^[A-Za-z]:/.test(relative), `${label} absolute path rejected`);
  const parts = relative.split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..') && path.posix.normalize(relative) === relative, `${label} traversal rejected`);
  return relative;
}
function resolveContained(root: string, relativeValue: unknown, label: string, kind: 'file' | 'directory' = 'file'): string {
  const relative = safeRelative(relativeValue, label), rootStat = fs.lstatSync(root);
  assert(!rootStat.isSymbolicLink() && rootStat.isDirectory(), `${label} root symlink/non-directory rejected`);
  const rootReal = fs.realpathSync(root), parts = relative.split('/'); let current = root;
  for (const part of parts) { current = path.join(current, part); const stat = fs.lstatSync(current); assert(!stat.isSymbolicLink(), `${label} symlink rejected: ${relative}`); }
  const real = fs.realpathSync(current); assert(real.startsWith(`${rootReal}${path.sep}`), `${label} escapes approved root`);
  const stat = fs.lstatSync(current); assert(kind === 'file' ? stat.isFile() : stat.isDirectory(), `${label} wrong file type`); return current;
}
function resolveReceiptInput(receiptPath: string): { file: string; stat: fs.Stats } {
  assert(receiptPath && !receiptPath.includes('\\') && !receiptPath.includes('\0'), 'completed receipt input unsafe separator');
  assert(receiptPath.split('/').every(part => part !== '..'), 'completed receipt input traversal rejected');
  const absolute = path.isAbsolute(receiptPath) ? receiptPath : path.resolve(ROOT, receiptPath), lexicalParent = path.dirname(absolute), leaf = path.basename(absolute);
  const canonicalParent = fs.realpathSync(lexicalParent), parentStat = fs.lstatSync(canonicalParent);
  assert(!parentStat.isSymbolicLink() && parentStat.isDirectory(), 'completed receipt input root symlink/non-directory rejected');
  const receiptFile = resolveContained(canonicalParent, leaf, 'completed receipt input');
  assert(fs.realpathSync(lexicalParent) === canonicalParent && fs.realpathSync(absolute) === receiptFile, 'completed receipt input path changed during resolution');
  return { file: receiptFile, stat: fs.lstatSync(receiptFile) };
}
function readStableReceipt(file: string, resolvedStat: fs.Stats): Buffer {
  const sameFile = (left: fs.Stats, right: fs.Stats) => left.dev === right.dev && left.ino === right.ino;
  const unchanged = (left: fs.Stats, right: fs.Stats) => sameFile(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const before = fs.lstatSync(file); assert(!before.isSymbolicLink() && before.isFile(), 'completed receipt input symlink/non-file rejected'); assert(unchanged(resolvedStat, before), 'completed receipt input changed after resolution');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const openedBefore = fs.fstatSync(fd); assert(sameFile(before, openedBefore), 'completed receipt input changed before read');
    const raw = fs.readFileSync(fd), openedAfter = fs.fstatSync(fd), after = fs.lstatSync(file);
    assert(unchanged(openedBefore, openedAfter) && unchanged(openedAfter, after), 'completed receipt input changed during read');
    return raw;
  } finally { fs.closeSync(fd); }
}
function pin(file: string, relative = path.relative(ROOT, file)): Json { const safe = safeRelative(relative, 'pin'); const contained = resolveContained(ROOT, safe, 'pin'); assert(path.resolve(file) === path.resolve(contained), 'pin path/root mismatch'); const raw = bytes(contained); return { path: safe, bytes: raw.length, sha256: sha(raw) }; }
function readJsonl(file: string, source?: Omit<SourceRef, 'line'>): Row[] { const memberRaw = bytes(file); if (source) assert(sha(memberRaw) === source.member_sha256, `source member hash mismatch: ${source.member_path}`); return memberRaw.toString('utf8').split('\n').map((line, index) => ({ line, index })).filter(x => x.line.length > 0).map(x => ({ value: JSON.parse(x.line), raw: Buffer.from(x.line), sha256: sha(x.line), source: source ? { ...source, line: x.index + 1 } : undefined })); }
function mapRows(rows: Row[], key: string): Map<string, Row> { const out = new Map<string, Row>(); for (const row of rows) { const id = String(row.value[key]); assert(!out.has(id), `duplicate ${key}: ${id}`); out.set(id, row); } return out; }
function rowRef(row: Row): Json { assert(row.source, 'source membership missing from embedded row'); return { row_sha256: row.sha256, value_json: row.raw.toString('utf8'), source: row.source }; }
function rowValue(ref: Json): Json { assert(sha(ref.value_json) === ref.row_sha256, 'embedded row hash mismatch'); return JSON.parse(ref.value_json); }
function numericId(recordId: string): number { const match = /^mtl_archives_metadata_(\d+)\.json$/.exec(recordId); assert(match, `invalid record id: ${recordId}`); return Number(match[1]); }
function pilotStratum(promotion: Json): string { assert(promotion.disposition === 'selected', `pilot source disposition not selected: ${promotion.record_id}`); if (promotion.lane === 'ground_ocr_entity_place') return 'ground'; assert(promotion.lane === 'aerial_land_use_georeference', `pilot lane unsupported: ${promotion.record_id}`); return /non-photographic map\/index|low-information abstention/.test(promotion.hard_control_role) ? 'control' : 'aerial'; }
function pilotControlPredicate(promotion: Json | null): string { if (!promotion) return 'not_control'; if (/non-photographic map\/index/.test(promotion.hard_control_role)) return 'pilot_non_photographic_map'; if (/low-information abstention/.test(promotion.hard_control_role)) return 'pilot_low_information_abstention'; return 'not_control'; }
function treeDigest(root: string, names: readonly string[]): string { return sha(names.map(name => `${name}\0${bytes(path.join(root, name)).length}\0${sha(bytes(path.join(root, name)))}\n`).join('')); }
function registryTreeDigest(root: string, names: readonly string[]): string { return sha(`${[...names].sort().map(name => `${name}\t${sha(bytes(path.join(root, name)))}\t${bytes(path.join(root, name)).length}`).join('\n')}\n`); }
function listFiles(root: string): string[] { const rootStat = fs.lstatSync(root); assert(!rootStat.isSymbolicLink() && rootStat.isDirectory(), 'fixture root symlink/non-directory rejected'); const out: string[] = []; const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink(), `symlink rejected: ${file}`); if (stat.isDirectory()) walk(file); else { assert(stat.isFile(), `non-file rejected: ${file}`); out.push(path.relative(root, file)); } } }; walk(root); return out; }

function validators(): Record<string, (value: Json) => void> {
  const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => any;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return Object.fromEntries(['candidate-selection-evidence', 'archive-verification-manifest', 'reviewer-selection-receipt-template', 'reviewer-selection-receipt', 'status-report', 'descriptor'].map(name => {
    const validate = ajv.compile(json(path.join(SCHEMAS, `${name}.schema.v1.json`)));
    return [name, (value: Json) => { assert(validate(value), `${name} schema validation: ${ajv.errorsText(validate.errors)}`); }];
  }));
}
function validateRegistryEntry(value: Json): void {
  const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => any;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  (addFormatsImport as unknown as (instance: any) => void)(ajv);
  const validate = ajv.compile(json(REGISTRY_SCHEMA));
  assert(validate(value), `artifact registry schema validation: ${ajv.errorsText(validate.errors)}`);
}

function collectSourceRefs(value: Json): Json[] {
  const found: Json[] = []; const walk = (item: Json) => { if (Array.isArray(item)) item.forEach(walk); else if (item && typeof item === 'object') { if (item.row_sha256 && item.source) found.push({ ...item.source, row_sha256: item.row_sha256 }); Object.values(item).forEach(walk); } }; walk(value);
  const logicalRows = new Map<string, string>();
  for (const ref of found) {
    const identity = `${ref.artifact_id}\0${ref.member_path}\0${ref.line}\0${ref.row_sha256}`, tuple = canonical(ref), prior = logicalRows.get(identity);
    assert(!prior || prior === tuple, `conflicting source reference for logical row: ${ref.artifact_id}/${ref.member_path}:${ref.line}`);
    logicalRows.set(identity, tuple);
  }
  return found.sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
function receiptArchiveBindings(sourceArchives: Json): Json { return Object.fromEntries(Object.entries(sourceArchives).map(([id, source]: [string, any]) => [id, { descriptor_sha256: source.descriptor.sha256, bundle_sha256: source.bundle_sha256 ?? null, tree_sha256: source.tree_sha256, member_count: source.member_count, byte_count: source.byte_count }])); }
function receiptTemplate(selectionSha: string, manifestPin: Json, refs: Json[], sourceArchives: Json): Json {
  return { schema_version: 'issue69_phase_d_reviewer_selection_receipt_template_v1.0.0', artifact_id: ARTIFACT_ID, authority_status: 'blank_template_not_authoritative', bindings: { candidate_selection_sha256: selectionSha, archive_verification_manifest_sha256: manifestPin.sha256, source_membership_reference_count: refs.length, source_membership_references_sha256: sha(`${refs.map(canonical).join('\n')}\n`), source_archives: receiptArchiveBindings(sourceArchives), counts: { selected: 60, ground: 30, aerial: 20, control: 10 } }, reviewer: { reviewer_id: null, session_id: null, model: 'gpt-5.6-sol', reasoning_effort: 'high', reviewed_at: null }, attestation: { archives_freshly_restored_and_every_descriptor_member_reverified: null, exact_selection_independently_recomputed: null, every_record_join_and_predicate_reverified: null, source_membership_references_reverified: null, approved_for_publication: null }, notes: null };
}

function predecessorPins(): Json[] {
  return PREDECESSORS.map(spec => {
    const commit = execFileSync('git', ['rev-parse', `${spec.commit}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert(commit === spec.commit, `predecessor commit drift: ${spec.id}`);
    const blob = execFileSync('git', ['rev-parse', `${commit}:${spec.path}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert(blob === spec.blob, `predecessor blob drift: ${spec.id}`);
    const raw = execFileSync('git', ['cat-file', 'blob', blob], { cwd: ROOT });
    assert(raw.length === spec.bytes && sha(raw) === spec.sha256, `predecessor blob bytes drift: ${spec.id}`);
    return { id: spec.id, commit, path: spec.path, git_blob_sha1: blob, sha256: spec.sha256, bytes: spec.bytes };
  });
}

function verifyArchive(id: string, descriptor: Json, root: string, prefix: string): Json {
  const rootReal = fs.realpathSync(root), rootStat = fs.lstatSync(root); assert(!rootStat.isSymbolicLink() && rootStat.isDirectory(), `${id} archive root symlink/non-directory rejected`);
  const rootIsReportDirectory = rootReal.split(path.sep).join('/').endsWith(prefix.replace(/\/$/, ''));
  assert(descriptor.members.length === descriptor.counts.files, 'archive descriptor member count mismatch');
  let total = 0; const members: Json[] = [];
  for (const member of descriptor.members) {
    const memberPath = safeRelative(member.path, `${id} archive member`); const relative = rootIsReportDirectory ? (assert(memberPath.startsWith(prefix), `${id} archive member lies outside supplied report root: ${memberPath}`), safeRelative(memberPath.slice(prefix.length), `${id} archive member relative path`)) : memberPath, file = resolveContained(rootReal, relative, `${id} archive member`), raw = bytes(file);
    assert(raw.length === member.bytes, `archive member byte drift: ${memberPath}`); assert(sha(raw) === member.sha256, `archive member hash drift: ${memberPath}`); total += raw.length; members.push({ path: memberPath, relative_path: relative, sha256: member.sha256, bytes: member.bytes, ...(member.rows ? { rows: member.rows } : {}) });
  }
  assert(total === descriptor.counts.bytes, 'archive descriptor byte total mismatch');
  return { artifact_id: id, descriptor: id === 'gold_label_batch_002' ? pin(path.join(ROOT, GOLD_DESCRIPTOR_REL), GOLD_DESCRIPTOR_REL) : pin(path.join(ROOT, RECOVERY_DESCRIPTOR_REL), RECOVERY_DESCRIPTOR_REL), output_root: prefix.replace(/\/$/, ''), bundle_sha256: descriptor.bundle.sha256, tree_sha256: descriptor.tree_sha256, member_count: descriptor.counts.files, byte_count: descriptor.counts.bytes, members };
}
function artifactDataRoot(approvedRoot: string, prefix: string, label: string): string { const real = fs.realpathSync(approvedRoot); return real.split(path.sep).join('/').endsWith(prefix.replace(/\/$/, '')) ? real : resolveContained(real, prefix.replace(/\/$/, ''), label, 'directory'); }

function verifyPilotArtifact(id: string, descriptorRel: string, root: string): Json {
  const descriptor = json(path.join(ROOT, descriptorRel)), rootStat = fs.lstatSync(root); assert(!rootStat.isSymbolicLink() && rootStat.isDirectory(), `${id} root symlink/non-directory rejected`);
  let total = 0; const members = descriptor.members.map((member: Json) => { const relative = safeRelative(member.path, `${id} member`), raw = bytes(resolveContained(root, relative, `${id} member`)); assert(raw.length === member.bytes && sha(raw) === member.sha256, `${id} member drift: ${relative}`); total += raw.length; return { path: `${descriptor.output_root}/${relative}`, relative_path: relative, sha256: member.sha256, bytes: member.bytes, ...(member.rows ? { rows: member.rows } : {}) }; });
  assert(total === descriptor.counts.bytes && members.length === descriptor.counts.files, `${id} descriptor totals drift`);
  return { artifact_id: id, descriptor: pin(path.join(ROOT, descriptorRel), descriptorRel), output_root: descriptor.output_root, tree_sha256: descriptor.tree_sha256, member_count: descriptor.counts.files, byte_count: descriptor.counts.bytes, members };
}
function verifyPilotIntelligenceArtifact(approvedRoot = ROOT): Json {
  const spec = PREDECESSORS.find(x => x.id === 'real-pilot-intelligence-v1')!;
  const authenticatedDescriptorRaw = execFileSync('git', ['cat-file', 'blob', spec.blob], { cwd: ROOT });
  assert(authenticatedDescriptorRaw.length === spec.bytes && sha(authenticatedDescriptorRaw) === spec.sha256, 'pilot intelligence predecessor descriptor Git blob drift');
  const descriptorFile = resolveContained(approvedRoot, PILOT_INTELLIGENCE_DESCRIPTOR_REL, 'pilot intelligence descriptor'), descriptorRaw = bytes(descriptorFile);
  assert(descriptorRaw.equals(authenticatedDescriptorRaw), 'pilot intelligence descriptor differs from authenticated predecessor Git blob');
  const descriptor = JSON.parse(authenticatedDescriptorRaw.toString('utf8')), artifactRoot = resolveContained(approvedRoot, PILOT_INTELLIGENCE_ROOT_REL, 'pilot intelligence artifact root', 'directory');
  assert(descriptor.artifact_id === 'dfv0_real_pilot_intelligence_v1' && Array.isArray(descriptor.members), 'pilot intelligence descriptor identity drift');
  const memberPaths = descriptor.members.map((member: Json) => safeRelative(member.path, 'pilot intelligence member'));
  assert(canonical(memberPaths) === canonical([...memberPaths].sort()) && new Set(memberPaths).size === memberPaths.length, 'pilot intelligence descriptor member ordering/uniqueness drift');
  let total = 0;
  const members = descriptor.members.map((member: Json, index: number) => {
    const relative = memberPaths[index], raw = bytes(resolveContained(artifactRoot, relative, 'pilot intelligence member'));
    assert(raw.length === member.bytes && sha(raw) === member.sha256, `pilot intelligence predecessor member drift: ${relative}`); total += raw.length;
    return { path: `${PILOT_INTELLIGENCE_ROOT_REL}/${relative}`, relative_path: relative, sha256: member.sha256, bytes: member.bytes };
  });
  const tree = sha(`${descriptor.members.map((member: Json) => `${member.path}\t${member.bytes}\t${member.sha256}`).join('\n')}\n`);
  assert(members.length === descriptor.counts.files && total === descriptor.counts.bytes && tree === descriptor.tree_sha256, 'pilot intelligence predecessor descriptor member/tree/count drift');
  return { artifact_id: 'real_pilot_intelligence_v1', descriptor: { path: PILOT_INTELLIGENCE_DESCRIPTOR_REL, bytes: descriptorRaw.length, sha256: sha(descriptorRaw) }, output_root: PILOT_INTELLIGENCE_ROOT_REL, tree_sha256: descriptor.tree_sha256, member_count: descriptor.counts.files, byte_count: descriptor.counts.bytes, members };
}
function memberSource(artifact: Json, memberRelative: string): Omit<SourceRef, 'line'> { const member = artifact.members.find((x: Json) => x.relative_path === memberRelative || x.path === `${artifact.output_root}/${memberRelative}`); assert(member, `descriptor member absent: ${artifact.artifact_id}/${memberRelative}`); return { artifact_id: artifact.artifact_id, member_path: member.path, member_sha256: member.sha256 }; }
function pilotDossierMember(artifact: Json, numericId: number): Json { const relative = `dossiers/${numericId}.json`, member = artifact.members.find((x: Json) => x.relative_path === relative); assert(member, `pilot dossier absent from authenticated predecessor descriptor: ${numericId}`); return member; }
function verifyPilotDossierPin(filePin: Json, artifact: Json, approvedRoot = ROOT): Json {
  const member = artifact.members.find((x: Json) => x.path === filePin.path);
  assert(member && member.bytes === filePin.bytes && member.sha256 === filePin.sha256, `pilot dossier pin not authorized by predecessor descriptor: ${filePin.path}`);
  const raw = bytes(resolveContained(approvedRoot, filePin.path, 'pilot dossier predecessor member'));
  assert(raw.length === member.bytes && sha(raw) === member.sha256, `pilot dossier predecessor member drift: ${filePin.path}`);
  return JSON.parse(raw.toString('utf8'));
}
function verifyPilotPixelAuthority(dossier: Json, recoveryArtifact: Json, approvedRoot = ROOT): void {
  const raw = bytes(resolveContained(approvedRoot, dossier.pixel_scope.path, 'pilot dossier pixel'));
  const matches = recoveryArtifact.members.filter((x: Json) => x.sha256 === dossier.pixel_scope.sha256 && x.bytes === raw.length);
  assert(matches.length > 0, `pilot pixel bytes not authorized by canonical recovery descriptor: ${dossier.record_id}`);
  assert(sha(raw) === dossier.pixel_scope.sha256, `pilot pixel predecessor member drift: ${dossier.record_id}`);
}
function pilotRights(dossier: Json): Json {
  const rights = dossier.rights;
  assert(rights?.license_id && rights?.attribution && Array.isArray(rights.license_evidence_ids) && rights.license_evidence_ids.length > 0 && rights.attribution_evidence_id && rights.scope_note, `pilot rights evidence incomplete: ${dossier.record_id}`);
  return { license_id: rights.license_id, attribution: rights.attribution, complete: true, commercial_use_allowed: rights.commercial_use_allowed ?? null, notes: rights.scope_note };
}

function loadGold(root: string, artifact: Json): Json {
  const read = (relative: string) => readJsonl(resolveContained(root, relative, 'Gold source'), memberSource(artifact, relative));
  const selection = mapRows(read('batch/selection-v1.jsonl'), 'neutral_id');
  const trusted = mapRows(read('batch/trusted-neutral-map-v1.jsonl'), 'neutral_id');
  const lineage = mapRows(read('packets/image-lineage-v1.jsonl'), 'neutral_id');
  const adjudication = mapRows(read('adjudication/adjudications-v1.jsonl'), 'neutral_id');
  const packet = new Map<string, Row>(), primary = new Map<string, Row>(), blind = new Map<string, Row>();
  for (let i = 1; i <= 12; i++) {
    const dir = path.join(root, `packets/glb002-p${String(i).padStart(2, '0')}`);
    for (const [name, target] of [['rows.jsonl', packet], ['primary-labels.completed.jsonl', primary], ['blind-labels.completed.jsonl', blind]] as const) {
      const relative = `packets/glb002-p${String(i).padStart(2, '0')}/${name}`;
      for (const row of read(relative)) { const id = row.value.neutral_id; assert(!target.has(id), `duplicate Gold ${name}: ${id}`); target.set(id, row); }
    }
  }
  for (const source of [selection, trusted, lineage, adjudication, packet, primary, blind]) assert(source.size === 300, 'Gold source must contain exactly 300 rows');
  return { selection, trusted, lineage, adjudication, packet, primary, blind };
}

function goldEvidence(neutralId: string, gold: Json): Json {
  const rows: Record<string, Row> = Object.fromEntries(['selection', 'trusted', 'lineage', 'adjudication', 'packet', 'primary', 'blind'].map(name => [name, gold[name].get(neutralId)]));
  for (const [name, row] of Object.entries(rows)) assert(row, `missing Gold ${name} row: ${neutralId}`);
  const values = Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.value]));
  const recordId = values.adjudication.record_id, packetId = values.packet.packet_id, evidenceHash = values.packet.image.original_evidence_sha256;
  for (const name of ['selection', 'trusted', 'lineage', 'adjudication']) assert(values[name].record_id === recordId, `Gold record mismatch in ${name}: ${neutralId}`);
  for (const name of ['packet', 'primary', 'blind']) assert(values[name].neutral_id === neutralId && values[name].packet_id === packetId, `Gold packet mismatch in ${name}: ${neutralId}`);
  assert(values.lineage.original_evidence_sha256 === evidenceHash && values.primary.image_evidence_hash === evidenceHash && values.blind.image_evidence_hash === evidenceHash, `Gold pixel/review lineage mismatch: ${neutralId}`);
  assert(values.selection.component_id === values.trusted.component_id && values.selection.split === values.trusted.split, `Gold component/split mismatch: ${neutralId}`);
  return { neutral_id: neutralId, packet_id: packetId, disposition: values.adjudication.disposition, source_rows: Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, rowRef(row)])) };
}

function seal(goldRoot: string, recoveryRoot: string, pilotRoot: string): Json {
  assert(goldRoot && recoveryRoot && pilotRoot, 'seal requires --gold-root, --recovery-root, and --pilot-root');
  predecessorPins();
  const goldDescriptor = json(path.join(ROOT, GOLD_DESCRIPTOR_REL)), recoveryDescriptor = json(path.join(ROOT, RECOVERY_DESCRIPTOR_REL));
  const goldArtifact = verifyArchive('gold_label_batch_002', goldDescriptor, goldRoot, GOLD_PREFIX), recoveryArtifact = verifyArchive('canonical_image_recovery_v1', recoveryDescriptor, recoveryRoot, RECOVERY_PREFIX), goldDataRoot = artifactDataRoot(goldRoot, GOLD_PREFIX, 'Gold data root'), recoveryDataRoot = artifactDataRoot(recoveryRoot, RECOVERY_PREFIX, 'recovery data root');
  const promotionRoot = resolveContained(pilotRoot, 'promotion', 'pilot promotion root', 'directory'), reviewRoot = resolveContained(pilotRoot, 'independent-review', 'pilot review root', 'directory');
  const promotionArtifact = verifyPilotArtifact('real_pilot_visual_promotion_v1', PILOT_PROMOTION_REL, promotionRoot), reviewArtifact = verifyPilotArtifact('real_pilot_independent_visual_review_v1', PILOT_REVIEW_REL, reviewRoot), intelligenceArtifact = verifyPilotIntelligenceArtifact();
  const archiveManifest = { schema_version: 'issue69_phase_d_archive_verification_manifest_v1.0.0', artifact_id: ARTIFACT_ID, proof_boundary: 'descriptor_member_verification_and_exact_source_row_locations_only;_member_sha256_is_not_a_Merkle_inclusion_proof', artifacts: [goldArtifact, recoveryArtifact, promotionArtifact, reviewArtifact, intelligenceArtifact] };
  fs.mkdirSync(FIXTURE, { recursive: true }); writeJson(path.join(FIXTURE, ARCHIVE_MANIFEST), archiveManifest);
  const gold = loadGold(goldDataRoot, goldArtifact);
  const recoveryRead = (relative: string) => readJsonl(resolveContained(recoveryDataRoot, relative, 'recovery source'), memberSource(recoveryArtifact, relative));
  const nodes = mapRows(recoveryRead('graph-after/nodes-v1.jsonl'), 'record_id');
  const leakage = mapRows(recoveryRead('graph-after/record-leakage-map-v1.jsonl'), 'record_id');
  const splits = mapRows(recoveryRead('graph-after/benchmark-splits-v1.jsonl'), 'record_id');
  const promotions = mapRows(readJsonl(resolveContained(promotionRoot, 'promotions-v1.jsonl', 'promotion rows'), memberSource(promotionArtifact, 'promotions-v1.jsonl')), 'record_id');
  const pilotReviews = mapRows(readJsonl(resolveContained(reviewRoot, 'independent-review-v1.jsonl', 'review rows'), memberSource(reviewArtifact, 'independent-review-v1.jsonl')), 'record_id');
  assert(nodes.size === 18462 && leakage.size === 18462 && splits.size === 18462, 'canonical graph coverage mismatch');
  const goldByRecord = new Map<string, string>(); for (const [neutral, row] of gold.adjudication) { assert(!goldByRecord.has(row.value.record_id), `duplicate Gold record: ${row.value.record_id}`); goldByRecord.set(row.value.record_id, neutral); }
  const records: Json[] = [], usedRecords = new Set<string>(), usedComponents = new Set<string>();
  const add = (recordId: string, stratum: string, basis: string, neutralId: string | null) => {
    assert(!usedRecords.has(recordId), `duplicate selected record: ${recordId}`);
    const node = nodes.get(recordId), component = leakage.get(recordId), split = splits.get(recordId); assert(node && component && split, `missing canonical evidence: ${recordId}`);
    assert(component.value.component_id === split.value.component_id && component.value.benchmark_split === split.value.split, `canonical component/split mismatch: ${recordId}`);
    assert(!usedComponents.has(component.value.component_id), `duplicate selected component: ${component.value.component_id}`);
    const id = numericId(recordId), pilot = PILOT_IDS.includes(id as any), goldRef = neutralId ? goldEvidence(neutralId, gold) : null;
    assert(!PILOT_ONLY_IDS.includes(id as any) || !goldRef, `pilot-only record cannot carry Gold authority: ${recordId}`);
    const dossierPath = pilot ? `docs/dataset-factory/fixtures/real-pilot-intelligence-v1/dossiers/${id}.json` : null;
    const dossierMember = pilot ? pilotDossierMember(intelligenceArtifact, id) : null;
    const dossierPin = dossierMember ? { path: dossierMember.path, bytes: dossierMember.bytes, sha256: dossierMember.sha256 } : null;
    const dossier = dossierPin ? verifyPilotDossierPin(dossierPin, intelligenceArtifact) : null;
    if (dossier) { assert(dossierPath === dossierMember!.path && dossier.record_id === recordId && dossier.numeric_id === id && dossier.dossier.fully_verified === false, `pilot dossier mismatch: ${recordId}`); verifyPilotPixelAuthority(dossier, recoveryArtifact); }
    const packet = goldRef ? rowValue(goldRef.source_rows.packet) : null;
    const trusted = goldRef ? rowValue(goldRef.source_rows.trusted) : null;
    const adjudicated = goldRef ? rowValue(goldRef.source_rows.adjudication) : null, selectedSource = goldRef ? rowValue(goldRef.source_rows.selection) : null, promotion = pilot ? promotions.get(recordId)!.value : null;
    const mode = adjudicated?.final_labels?.image_mode, signal = adjudicated ? ['scene_text_presence', 'storefront_presence', 'billboard_presence', 'brand_presence', 'landmark_presence', 'street_sign_presence'].filter(key => adjudicated.final_labels[key]?.status === 'observed' && adjudicated.final_labels[key]?.value === 'yes').length : null;
    const pixel = goldRef ? { evidence_class: 'gold_archive_review_views', original_evidence_sha256: packet.image.original_evidence_sha256, views: packet.image.views.map((view: Json) => ({ path: `${GOLD_PREFIX}${view.local_path}`, sha256: view.sha256, bytes: view.bytes, width: view.width, height: view.height, format: view.format })) } : { evidence_class: 'tracked_pilot_derivative_256', original_evidence_sha256: dossier.pixel_scope.sha256, views: [{ path: dossier.pixel_scope.path, sha256: dossier.pixel_scope.sha256, bytes: bytes(resolveContained(ROOT, dossier.pixel_scope.path, 'pilot dossier pixel')).length, width: dossier.pixel_scope.width, height: dossier.pixel_scope.height, format: 'jpeg' }] };
    const rights = goldRef ? { license_id: trusted.rights.license_id, attribution: trusted.rights.attribution, complete: trusted.rights.complete, commercial_use_allowed: trusted.rights.commercial_use_allowed ?? null, notes: trusted.rights.notes } : pilotRights(dossier);
    usedRecords.add(recordId); usedComponents.add(component.value.component_id);
    records.push({
      selection_index: records.length + 1, record_id: recordId, numeric_id: id, primary_stratum: stratum, selection_basis: basis,
      selection_derivation: { image_mode_status: mode?.status ?? null, image_mode_value: mode?.value ?? null, observed_ground_signal_count: signal, gold_rank: selectedSource?.rank ?? null, control_predicate: mode?.value === 'document_map' && adjudicated?.disposition === 'promoted' ? 'promoted_document_map' : mode?.value === 'low_information' && adjudicated?.disposition === 'rejected' ? 'rejected_low_information' : pilotControlPredicate(promotion), pilot_lane: promotion?.lane ?? null },
      authority_class: pilot ? (goldRef ? 'gold_and_pilot' : 'pilot_independent_review_only') : 'gold_added',
      component_id: component.value.component_id, split: split.value.split,
      canonical_evidence: { node: rowRef(node), component: rowRef(component), split: rowRef(split) },
      pixel_evidence: pixel,
      review_evidence: {
        gold: goldRef,
        pilot: pilot ? { dossier: dossierPin, promotion: rowRef(promotions.get(recordId)!), independent_review: rowRef(pilotReviews.get(recordId)!) } : null,
      },
      rights,
      claim_boundary: { newly_externally_verified_claims: 0, verified_dossier: false, accepted_tasks: 0, gold_labels_authoritative_only_for_exact_target_semantics: true, selection_proxies_are_labels: false },
      aerial_measurement_boundary: { exact_location: null, scale: null, area: null, acreage: null, distance: null },
    });
  };
  for (const id of PILOT_IDS) add(`mtl_archives_metadata_${id}.json`, PILOT_STRATA[id], 'retained_fixed_pilot_component_safe', goldByRecord.get(`mtl_archives_metadata_${id}.json`) ?? null);
  const candidates = [...gold.adjudication.entries()].map(([neutralId, row]) => { const selection = gold.selection.get(neutralId)!.value, mode = row.value.final_labels.image_mode; const signal = ['scene_text_presence', 'storefront_presence', 'billboard_presence', 'brand_presence', 'landmark_presence', 'street_sign_presence'].filter(key => row.value.final_labels[key]?.status === 'observed' && row.value.final_labels[key]?.value === 'yes').length; return { neutralId, row: row.value, selection, mode: mode?.value, modeStatus: mode?.status, signal }; });
  const eligible = (candidate: Json) => !usedRecords.has(candidate.row.record_id) && !usedComponents.has(candidate.selection.component_id);
  const ground = candidates.filter(c => c.row.disposition === 'promoted' && c.modeStatus === 'observed' && String(c.mode).startsWith('ground_') && c.signal > 0).sort((a, b) => b.signal - a.signal || a.selection.rank - b.selection.rank || a.row.record_id.localeCompare(b.row.record_id));
  for (const c of ground) { if (records.filter(r => r.primary_stratum === 'ground').length === TARGET_COUNTS.ground) break; if (eligible(c)) add(c.row.record_id, 'ground', 'gold_promoted_observed_ground_high_signal', c.neutralId); }
  const aerial = candidates.filter(c => c.row.disposition === 'promoted' && c.modeStatus === 'observed' && ['aerial_vertical', 'aerial_oblique'].includes(c.mode)).sort((a, b) => a.selection.rank - b.selection.rank || a.row.record_id.localeCompare(b.row.record_id));
  for (const c of aerial) { if (records.filter(r => r.primary_stratum === 'aerial').length === TARGET_COUNTS.aerial) break; if (eligible(c)) add(c.row.record_id, 'aerial', 'gold_promoted_observed_aerial_mode', c.neutralId); }
  const controls = candidates.filter(c => (c.row.disposition === 'promoted' && c.mode === 'document_map') || (c.row.disposition === 'rejected' && c.mode === 'low_information')).sort((a, b) => (a.mode === 'document_map' ? 0 : 1) - (b.mode === 'document_map' ? 0 : 1) || a.selection.rank - b.selection.rank || a.row.record_id.localeCompare(b.row.record_id));
  for (const c of controls) { if (records.filter(r => r.primary_stratum === 'control').length === TARGET_COUNTS.control) break; if (eligible(c)) add(c.row.record_id, 'control', c.mode === 'document_map' ? 'gold_promoted_document_map_control' : 'gold_rejected_low_information_control_retaining_rejection', c.neutralId); }
  const replayCandidates = candidates.map(candidate => ({ neutral_id: candidate.neutralId, selection: rowRef(gold.selection.get(candidate.neutralId)!), adjudication: rowRef(gold.adjudication.get(candidate.neutralId)!) })).sort((a, b) => a.neutral_id.localeCompare(b.neutral_id));
  const dispositions = records.filter(r => r.review_evidence.gold).map(r => r.review_evidence.gold.disposition);
  const sealed = {
    schema_version: 'issue69_phase_d_candidate_selection_evidence_v1.2.0', artifact_id: ARTIFACT_ID, authority_status: 'candidate_not_authoritative_pending_fresh_sol_high_receipt', archive_verification_manifest: pin(path.join(FIXTURE, ARCHIVE_MANIFEST), `${FIXTURE_REL}/${ARCHIVE_MANIFEST}`),
    source_archives: { gold_label_batch_002: { descriptor: goldArtifact.descriptor, bundle_sha256: goldArtifact.bundle_sha256, tree_sha256: goldArtifact.tree_sha256, member_count: goldArtifact.member_count, byte_count: goldArtifact.byte_count }, canonical_image_recovery_v1: { descriptor: recoveryArtifact.descriptor, bundle_sha256: recoveryArtifact.bundle_sha256, tree_sha256: recoveryArtifact.tree_sha256, member_count: recoveryArtifact.member_count, byte_count: recoveryArtifact.byte_count }, real_pilot_visual_promotion_v1: { descriptor: promotionArtifact.descriptor, tree_sha256: promotionArtifact.tree_sha256, member_count: promotionArtifact.member_count, byte_count: promotionArtifact.byte_count }, real_pilot_independent_visual_review_v1: { descriptor: reviewArtifact.descriptor, tree_sha256: reviewArtifact.tree_sha256, member_count: reviewArtifact.member_count, byte_count: reviewArtifact.byte_count }, real_pilot_intelligence_v1: { descriptor: intelligenceArtifact.descriptor, tree_sha256: intelligenceArtifact.tree_sha256, member_count: intelligenceArtifact.member_count, byte_count: intelligenceArtifact.byte_count } },
    selection_policy: { fixed_pilot_numeric_ids: [...PILOT_IDS], target_primary_strata: TARGET_COUNTS, component_rule: 'exactly_one_record_per_visual_family_graph_component', ground_order: 'descending_observed_high_signal_count_then_gold_rank_then_record_id', aerial_order: 'gold_rank_then_record_id', control_order: 'document_map_before_rejected_low_information_then_gold_rank_then_record_id', authority_boundary: 'records_0_and_11118_are_pilot_independent_review_only_never_gold;_gold_dispositions_and_labels_are_preserved_without_proxy_promotion' },
    selection_replay_inputs: { gold_candidates: replayCandidates },
    counts: { selected: records.length, ground: records.filter(r => r.primary_stratum === 'ground').length, aerial: records.filter(r => r.primary_stratum === 'aerial').length, control: records.filter(r => r.primary_stratum === 'control').length, components: usedComponents.size, pilots: records.filter(r => r.authority_class !== 'gold_added').length, gold_and_pilot: records.filter(r => r.authority_class === 'gold_and_pilot').length, pilot_independent_review_only: records.filter(r => r.authority_class === 'pilot_independent_review_only').length, gold_added: records.filter(r => r.authority_class === 'gold_added').length, gold_promoted: dispositions.filter(x => x === 'promoted').length, gold_held: dispositions.filter(x => x === 'held').length, gold_rejected: dispositions.filter(x => x === 'rejected').length, gold_abstained: dispositions.filter(x => x === 'abstained').length },
    records,
  };
  validators()['candidate-selection-evidence'](sealed); verifySelection(sealed, archiveManifest);
  const target = path.join(FIXTURE, SELECTION), rendered = Buffer.from(`${canonical(sealed)}\n`);
  if (fs.existsSync(target)) { const existing = bytes(target); if (!existing.equals(rendered)) fs.writeFileSync(target, rendered); } else { fs.mkdirSync(FIXTURE, { recursive: true }); fs.writeFileSync(target, rendered); }
  const manifestRaw = bytes(path.join(FIXTURE, ARCHIVE_MANIFEST)), refs = collectSourceRefs(sealed), template = receiptTemplate(sha(rendered), { path: ARCHIVE_MANIFEST, bytes: manifestRaw.length, sha256: sha(manifestRaw) }, refs, sealed.source_archives);
  writeJson(path.join(FIXTURE, RECEIPT_TEMPLATE), template);
  return { candidate_sealed: true, authoritative: false, selected: 60, distribution: TARGET_COUNTS, candidate_selection_sha256: sha(rendered), archive_verification_manifest_sha256: sha(bytes(path.join(FIXTURE, ARCHIVE_MANIFEST))), source_membership_reference_count: refs.length, archive_members_verified: goldArtifact.member_count + recoveryArtifact.member_count + promotionArtifact.member_count + reviewArtifact.member_count + intelligenceArtifact.member_count };
}

function verifyPin(filePin: Json, label: string, approvedRoot = ROOT): void { const file = resolveContained(approvedRoot, filePin.path, label), raw = bytes(file); assert(raw.length === filePin.bytes && sha(raw) === filePin.sha256, `${label} pin drift`); }
function verifyArchiveDescriptorPins(sealed: Json): void {
  for (const [key, relative] of [['gold_label_batch_002', GOLD_DESCRIPTOR_REL], ['canonical_image_recovery_v1', RECOVERY_DESCRIPTOR_REL]] as const) {
    const source = sealed.source_archives[key], descriptor = json(path.join(ROOT, relative)); verifyPin(source.descriptor, `${key} descriptor`);
    assert(source.bundle_sha256 === descriptor.bundle.sha256 && source.tree_sha256 === descriptor.tree_sha256 && source.member_count === descriptor.counts.files && source.byte_count === descriptor.counts.bytes, `${key} archive descriptor summary drift`);
  }
  for (const [key, relative] of [['real_pilot_visual_promotion_v1', PILOT_PROMOTION_REL], ['real_pilot_independent_visual_review_v1', PILOT_REVIEW_REL]] as const) {
    const source = sealed.source_archives[key], descriptor = json(path.join(ROOT, relative)); verifyPin(source.descriptor, `${key} descriptor`);
    assert(source.bundle_sha256 === undefined && source.tree_sha256 === descriptor.tree_sha256 && source.member_count === descriptor.counts.files && source.byte_count === descriptor.counts.bytes, `${key} archive descriptor summary drift`);
  }
  const intelligence = verifyPilotIntelligenceArtifact(), source = sealed.source_archives.real_pilot_intelligence_v1;
  assert(source.bundle_sha256 === undefined && canonical(source) === canonical({ descriptor: intelligence.descriptor, tree_sha256: intelligence.tree_sha256, member_count: intelligence.member_count, byte_count: intelligence.byte_count }), 'real_pilot_intelligence_v1 archive descriptor summary drift');
}
function deriveReplayCandidate(candidate: Json): Json { const selection = rowValue(candidate.selection), adjudication = rowValue(candidate.adjudication); assert(selection.neutral_id === candidate.neutral_id && adjudication.neutral_id === candidate.neutral_id && selection.record_id === adjudication.record_id && selection.component_id, `Gold replay authenticated join drift: ${candidate.neutral_id}`); const mode = adjudication.final_labels.image_mode; const signal = ['scene_text_presence', 'storefront_presence', 'billboard_presence', 'brand_presence', 'landmark_presence', 'street_sign_presence'].filter(key => adjudication.final_labels[key]?.status === 'observed' && adjudication.final_labels[key]?.value === 'yes').length; return { neutral_id: candidate.neutral_id, record_id: adjudication.record_id, disposition: adjudication.disposition, image_mode_status: mode?.status, image_mode_value: mode?.value, observed_ground_signal_count: signal, gold_rank: selection.rank, component_id: selection.component_id }; }
function replaySelectedGold(sealed: Json): Json[] {
  const candidates = sealed.selection_replay_inputs.gold_candidates.map(deriveReplayCandidate);
  assert(candidates.length === 300 && new Set(candidates.map((c: Json) => c.neutral_id)).size === 300, 'Gold replay candidate coverage drift');
  const usedRecords = new Set(sealed.records.slice(0, 12).map((r: Json) => r.record_id)), usedComponents = new Set(sealed.records.slice(0, 12).map((r: Json) => r.component_id)), chosen: Json[] = [];
  const take = (rows: Json[], count: number, primary_stratum: string, selectionBasis: string) => { for (const candidate of rows) { if (chosen.length === count) break; if (!usedRecords.has(candidate.record_id) && !usedComponents.has(candidate.component_id)) { const selection_basis = selectionBasis === 'derived_per_control_predicate' ? (candidate.image_mode_value === 'document_map' ? 'gold_promoted_document_map_control' : 'gold_rejected_low_information_control_retaining_rejection') : selectionBasis; chosen.push({ ...candidate, primary_stratum, selection_basis }); usedRecords.add(candidate.record_id); usedComponents.add(candidate.component_id); } } assert(chosen.length === count, `Gold replay shortfall at ${count}`); };
  take(candidates.filter((c: Json) => c.disposition === 'promoted' && c.image_mode_status === 'observed' && String(c.image_mode_value).startsWith('ground_') && c.observed_ground_signal_count > 0).sort((a: Json, b: Json) => b.observed_ground_signal_count - a.observed_ground_signal_count || a.gold_rank - b.gold_rank || a.record_id.localeCompare(b.record_id)), 24, 'ground', 'gold_promoted_observed_ground_high_signal');
  take(candidates.filter((c: Json) => c.disposition === 'promoted' && c.image_mode_status === 'observed' && ['aerial_vertical', 'aerial_oblique'].includes(c.image_mode_value)).sort((a: Json, b: Json) => a.gold_rank - b.gold_rank || a.record_id.localeCompare(b.record_id)), 40, 'aerial', 'gold_promoted_observed_aerial_mode');
  take(candidates.filter((c: Json) => (c.disposition === 'promoted' && c.image_mode_value === 'document_map') || (c.disposition === 'rejected' && c.image_mode_value === 'low_information')).sort((a: Json, b: Json) => (a.image_mode_value === 'document_map' ? 0 : 1) - (b.image_mode_value === 'document_map' ? 0 : 1) || a.gold_rank - b.gold_rank || a.record_id.localeCompare(b.record_id)), 48, 'control', 'derived_per_control_predicate');
  return chosen;
}
function verifySourceMembership(value: Json, manifest: Json): void { for (const ref of collectSourceRefs(value)) { const artifact = manifest.artifacts.find((x: Json) => x.artifact_id === ref.artifact_id); assert(artifact, `source artifact not in archive manifest: ${ref.artifact_id}`); const member = artifact.members.find((x: Json) => x.path === ref.member_path); assert(member && member.sha256 === ref.member_sha256, `source member not in archive manifest: ${ref.member_path}`); assert(Number.isInteger(ref.line) && ref.line > 0 && (!member.rows || ref.line <= member.rows), `source row line outside member: ${ref.member_path}`); } }
function assertSameSourceReference(left: Json, right: Json, label: string): void { assert(canonical({ ...left.source, row_sha256: left.row_sha256 }) === canonical({ ...right.source, row_sha256: right.row_sha256 }), `${label} complete source reference conflict`); }
function verifySelection(sealed: Json, manifest = json(path.join(FIXTURE, ARCHIVE_MANIFEST))): Json {
  assert(sealed.authority_status === 'candidate_not_authoritative_pending_fresh_sol_high_receipt', 'candidate authority status drift'); verifyPin(sealed.archive_verification_manifest, 'archive verification manifest'); verifySourceMembership(sealed, manifest);
  const intelligenceArtifact = verifyPilotIntelligenceArtifact(), manifestedIntelligence = manifest.artifacts.find((x: Json) => x.artifact_id === intelligenceArtifact.artifact_id);
  assert(manifestedIntelligence && canonical(manifestedIntelligence) === canonical(intelligenceArtifact), 'pilot intelligence manifest differs from authenticated predecessor descriptor/member tree');
  const recoveryDescriptor = json(path.join(ROOT, RECOVERY_DESCRIPTOR_REL)), recoveryAuthority = { members: recoveryDescriptor.members.map((member: Json) => ({ path: member.path, sha256: member.sha256, bytes: member.bytes })) };
  assert(sealed.records.length === 60 && sealed.counts.selected === 60, 'selected count drift');
  const ids = new Set<string>(), components = new Set<string>(), authority = { gold_and_pilot: 0, pilot_independent_review_only: 0, gold_added: 0 }, dispositions = { promoted: 0, held: 0, rejected: 0, abstained: 0 };
  for (const [index, record] of sealed.records.entries()) {
    assert(record.selection_index === index + 1 && record.numeric_id === numericId(record.record_id), `selection identity drift: ${record.record_id}`); assert(!ids.has(record.record_id), `duplicate record: ${record.record_id}`); assert(!components.has(record.component_id), `duplicate component: ${record.component_id}`); ids.add(record.record_id); components.add(record.component_id);
    const node = rowValue(record.canonical_evidence.node), component = rowValue(record.canonical_evidence.component), split = rowValue(record.canonical_evidence.split);
    assert(node.record_id === record.record_id && component.record_id === record.record_id && split.record_id === record.record_id, `canonical record mismatch: ${record.record_id}`); assert(component.component_id === record.component_id && split.component_id === record.component_id && component.benchmark_split === record.split && split.split === record.split, `component-safe split mismatch: ${record.record_id}`);
    assert(record.pixel_evidence.original_evidence_sha256 && record.pixel_evidence.views.length > 0, `missing pixel evidence: ${record.record_id}`); assert(record.rights.complete && record.rights.license_id && record.rights.attribution, `missing rights: ${record.record_id}`);
    assert(Object.values(record.aerial_measurement_boundary).every(value => value === null), `aerial measurement claim forbidden: ${record.record_id}`); assert(record.claim_boundary.newly_externally_verified_claims === 0 && !record.claim_boundary.verified_dossier && record.claim_boundary.accepted_tasks === 0 && !record.claim_boundary.selection_proxies_are_labels, `claim/task/proxy inflation: ${record.record_id}`);
    authority[record.authority_class as keyof typeof authority]++;
    const pilot = record.review_evidence.pilot, gold = record.review_evidence.gold;
    if (record.authority_class === 'pilot_independent_review_only') { assert(PILOT_ONLY_IDS.includes(record.numeric_id) && pilot && !gold, `pilot-only authority inflation: ${record.record_id}`); }
    if (record.authority_class === 'gold_and_pilot') assert(PILOT_IDS.includes(record.numeric_id) && pilot && gold, `Gold+pilot authority mismatch: ${record.record_id}`);
    if (record.authority_class === 'gold_added') assert(!PILOT_IDS.includes(record.numeric_id) && !pilot && gold, `Gold-added authority mismatch: ${record.record_id}`);
    if (pilot) { const dossier = verifyPilotDossierPin(pilot.dossier, intelligenceArtifact); verifyPilotPixelAuthority(dossier, recoveryAuthority); const promotion = rowValue(pilot.promotion), independent = rowValue(pilot.independent_review); assert(dossier.record_id === record.record_id && dossier.numeric_id === record.numeric_id && dossier.dossier.fully_verified === false, `pilot dossier identity/state mismatch: ${record.record_id}`); assert(promotion.record_id === record.record_id && promotion.numeric_id === record.numeric_id && promotion.disposition === 'selected', `pilot promotion row mismatch: ${record.record_id}`); assert(independent.record_id === record.record_id && independent.numeric_id === record.numeric_id && independent.promotion_id === promotion.promotion_id && independent.promotion_row_sha256 === pilot.promotion.row_sha256, `pilot review/promotion link mismatch: ${record.record_id}`); assert(independent.primary_reviewer_id === promotion.reviewer_id && independent.independent_reviewer_id !== promotion.reviewer_id && independent.reviewer_independence_confirmed === true, `pilot reviewer independence mismatch: ${record.record_id}`); assert(independent.agreement === true && independent.primary_disposition === 'selected' && independent.independent_disposition === 'selected', `pilot independent disposition mismatch: ${record.record_id}`); assert(independent.reviewed_image.sha256 === promotion.reviewed_image.sha256 && promotion.reviewed_image.sha256 === dossier.pixel_scope.sha256, `pilot reviewed-image/dossier pixel link mismatch: ${record.record_id}`); assert(record.primary_stratum === pilotStratum(promotion) && record.selection_derivation.pilot_lane === promotion.lane, `pilot primary stratum/lane derivation drift: ${record.record_id}`); const expectedRights = pilotRights(dossier); if (!gold) { assert(canonical(record.selection_derivation) === canonical({ image_mode_status: null, image_mode_value: null, observed_ground_signal_count: null, gold_rank: null, control_predicate: pilotControlPredicate(promotion), pilot_lane: promotion.lane }), `pilot-only mode/signal/rank/control derivation drift: ${record.record_id}`); assert(dossier.pixel_scope.sha256 === record.pixel_evidence.original_evidence_sha256, `pilot pixel mismatch: ${record.record_id}`); assert(canonical(record.pixel_evidence.views) === canonical([{ path: dossier.pixel_scope.path, sha256: dossier.pixel_scope.sha256, bytes: bytes(resolveContained(ROOT, dossier.pixel_scope.path, 'pilot pixel')).length, width: dossier.pixel_scope.width, height: dossier.pixel_scope.height, format: 'jpeg' }]), `pilot pixel view drift: ${record.record_id}`); assert(canonical(record.rights) === canonical(expectedRights), `pilot rights drift: ${record.record_id}`); } }
    if (gold) {
      const values = Object.fromEntries(Object.entries(gold.source_rows).map(([name, ref]) => [name, rowValue(ref)]));
      for (const name of ['selection', 'trusted', 'lineage', 'adjudication']) assert(values[name].record_id === record.record_id, `Gold row substitution: ${record.record_id}/${name}`);
      for (const name of ['packet', 'primary', 'blind']) assert(values[name].neutral_id === gold.neutral_id && values[name].packet_id === gold.packet_id, `Gold packet substitution: ${record.record_id}/${name}`);
      assert(values.adjudication.disposition === gold.disposition && ['promoted', 'held', 'rejected', 'abstained'].includes(gold.disposition), `Gold disposition drift: ${record.record_id}`); dispositions[gold.disposition as keyof typeof dispositions]++;
      const imageHash = values.packet.image.original_evidence_sha256; assert(values.lineage.original_evidence_sha256 === imageHash && values.primary.image_evidence_hash === imageHash && values.blind.image_evidence_hash === imageHash && record.pixel_evidence.original_evidence_sha256 === imageHash, `Gold pixel/review lineage mismatch: ${record.record_id}`);
      const expectedViews = values.packet.image.views.map((view: Json) => ({ path: `${GOLD_PREFIX}${view.local_path}`, sha256: view.sha256, bytes: view.bytes, width: view.width, height: view.height, format: view.format })); assert(canonical(record.pixel_evidence.views) === canonical(expectedViews), `Gold pixel view drift: ${record.record_id}`);
      const expectedRights = { license_id: values.trusted.rights.license_id, attribution: values.trusted.rights.attribution, complete: values.trusted.rights.complete, commercial_use_allowed: values.trusted.rights.commercial_use_allowed ?? null, notes: values.trusted.rights.notes }; assert(canonical(record.rights) === canonical(expectedRights), `Gold rights drift: ${record.record_id}`);
      assert(values.selection.component_id === record.component_id && values.trusted.component_id === record.component_id && values.selection.split === record.split && values.trusted.split === record.split, `Gold component/split drift: ${record.record_id}`);
      const replayRef = sealed.selection_replay_inputs.gold_candidates.find((candidate: Json) => candidate.neutral_id === gold.neutral_id), replay = replayRef && deriveReplayCandidate(replayRef); assert(replay && replay.record_id === record.record_id && replay.disposition === gold.disposition && replay.component_id === record.component_id, `Gold replay row/hash substitution: ${record.record_id}`); assertSameSourceReference(replayRef.selection, gold.source_rows.selection, `Gold selection replay ${record.record_id}`); assertSameSourceReference(replayRef.adjudication, gold.source_rows.adjudication, `Gold adjudication replay ${record.record_id}`); assert(canonical(record.selection_derivation) === canonical({ image_mode_status: replay.image_mode_status ?? null, image_mode_value: replay.image_mode_value ?? null, observed_ground_signal_count: replay.observed_ground_signal_count, gold_rank: replay.gold_rank, control_predicate: replay.image_mode_value === 'document_map' && replay.disposition === 'promoted' ? 'promoted_document_map' : replay.image_mode_value === 'low_information' && replay.disposition === 'rejected' ? 'rejected_low_information' : 'not_control', pilot_lane: pilot ? rowValue(pilot.promotion).lane : null }), `selection source derivation drift: ${record.record_id}`);
    }
  }
  const distribution = Object.fromEntries(TARGETS.map(target => [target, sealed.records.filter((r: Json) => r.primary_stratum === target).length])); assert(canonical(distribution) === canonical(TARGET_COUNTS), 'distribution drift'); assert(components.size === 60, 'component count drift');
  assert(canonical(authority) === canonical({ gold_and_pilot: 10, pilot_independent_review_only: 2, gold_added: 48 }), 'authority distribution drift'); assert(canonical(dispositions) === canonical({ promoted: 53, held: 4, rejected: 1, abstained: 0 }), 'Gold disposition distribution drift');
  assert(sealed.records.find((r: Json) => r.numeric_id === 0).authority_class === 'pilot_independent_review_only' && sealed.records.find((r: Json) => r.numeric_id === 11118).authority_class === 'pilot_independent_review_only', 'pilot-only IDs drift');
  for (const [index, id] of PILOT_IDS.entries()) { const record = sealed.records[index]; assert(record.numeric_id === id && record.primary_stratum === PILOT_STRATA[id] && record.selection_basis === 'retained_fixed_pilot_component_safe', `fixed pilot order/lane/basis drift: ${id}`); }
  const replay = replaySelectedGold(sealed), actual = sealed.records.slice(12).map((record: Json) => ({ neutral_id: record.review_evidence.gold.neutral_id, record_id: record.record_id, primary_stratum: record.primary_stratum, selection_basis: record.selection_basis })), expected = replay.map((x: Json) => ({ neutral_id: x.neutral_id, record_id: x.record_id, primary_stratum: x.primary_stratum, selection_basis: x.selection_basis })); assert(canonical(expected) === canonical(actual), 'deterministic Gold selection/order/lane/basis replay drift');
  const expectedCounts = { selected: 60, ground: 30, aerial: 20, control: 10, components: 60, pilots: 12, ...authority, gold_promoted: dispositions.promoted, gold_held: dispositions.held, gold_rejected: dispositions.rejected, gold_abstained: dispositions.abstained }; assert(canonical(sealed.counts) === canonical(expectedCounts), 'selection count summary drift');
  return { distribution, authority, dispositions };
}

function buildCandidate(source: string, output: string): Json {
  predecessorPins(); const schema = validators(), sealedFile = path.join(source, SELECTION), sealed = json(sealedFile), archiveManifest = json(path.join(source, ARCHIVE_MANIFEST)), receiptTemplateValue = json(path.join(source, RECEIPT_TEMPLATE)); schema['candidate-selection-evidence'](sealed); schema['archive-verification-manifest'](archiveManifest); schema['reviewer-selection-receipt-template'](receiptTemplateValue); const summary = verifySelection(sealed, archiveManifest);
  verifyArchiveDescriptorPins(sealed);
  const status = { schema_version: 'issue69_phase_d_status_report_v1.2.0', artifact_id: ARTIFACT_ID, issue: 69, issue_open: true, authority_status: 'candidate_not_authoritative_pending_fresh_sol_high_receipt', production_mutation: false, counts: { visually_and_provenance_processed: 60, newly_externally_verified_claims: 0, verified_dossiers: 0, accepted_tasks: 0, remaining_dossier_shortfall: 25 }, authority: summary.authority, gold_dispositions: summary.dispositions, limitations: ['Candidate only: no operational inclusion authority exists until a fresh Sol High reviewer authors and publishes the exact completed receipt.', 'Gold labels retain their exact target semantics and disposition; selection proxies are not labels.', 'No exact aerial location, scale, area, acreage, or distance is asserted.'] };
  schema['status-report'](status); fs.mkdirSync(output, { recursive: true }); for (const name of [SELECTION, ARCHIVE_MANIFEST, RECEIPT_TEMPLATE]) fs.copyFileSync(resolveContained(source, name, 'candidate input'), path.join(output, name)); writeJson(path.join(output, 'status-report-v1.json'), status);
  const selectionPin = { path: SELECTION, bytes: bytes(path.join(output, SELECTION)).length, sha256: sha(bytes(path.join(output, SELECTION))) }, manifest = MEMBERS.map(name => ({ path: name, bytes: bytes(path.join(output, name)).length, sha256: sha(bytes(path.join(output, name))) }));
  const descriptor = { schema_version: 'issue69_phase_d_descriptor_v1.2.0', artifact_id: ARTIFACT_ID, scope: 'candidate_60_record_selection_pending_fresh_reviewer_receipt', authority_status: status.authority_status, created_at: CREATED_AT, production_mutation: false, candidate_selection: selectionPin, reviewer_receipt: null, predecessor_pins: predecessorPins(), counts: status.counts, manifest, tree_sha256: treeDigest(output, MEMBERS), generation: { seal_command: 'npm run dataset-factory:phase-d-scale-seal-v1 -- --gold-root /restored/.../gold_label_batch_002 --recovery-root /restored/.../canonical_image_recovery_v1 --pilot-root /restored/.../verified_multimodal_batch_001_real_pilot', build_command: 'npm run dataset-factory:phase-d-scale-build-v1', publish_command: 'npm run dataset-factory:phase-d-scale-publish-receipt-v1 -- --receipt /path/to/fresh-sol-high-completed-receipt.json', code_ref: 'packages/scripts/src/dataset-factory/phase-d-scale-v1.ts' } };
  schema.descriptor(descriptor); writeJson(path.join(output, 'descriptor-v1.json'), descriptor); return { built: true, authoritative: false, selected: 60, distribution: summary.distribution, candidate_selection_sha256: selectionPin.sha256, archive_verification_manifest_sha256: sha(bytes(path.join(output, ARCHIVE_MANIFEST))), tree_sha256: descriptor.tree_sha256 };
}
function build(output = FIXTURE): Json {
  assert(!fs.existsSync(path.join(FIXTURE, COMPLETED_RECEIPT)), 'ordinary build cannot overwrite a published reviewer receipt');
  return buildCandidate(FIXTURE, output);
}

function expectedRegistry(descriptor: Json, root = FIXTURE): Json {
  const dependencies = ['ccv1_visual_family_graph_recovery_terminal_20260711', 'dfv0_gold_label_batch_002_phase_1', 'dfv0_verified_multimodal_batch_001_real_pilot_visual_promotion_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_independent_visual_review_v1', 'dfv0_real_pilot_intelligence_v1'];
  assert(descriptor.authority_status === 'authoritative_fresh_sol_high_receipt_published' && descriptor.reviewer_receipt, 'registry derivation requires published exact reviewer receipt');
  const entry = { stable_id: ARTIFACT_ID, schema_version: 'dataset_factory_artifact_registry_v0', artifact_schema_version: 'issue69_phase_d_descriptor_v1.2.0', artifact_kind: 'directory', content_digest: { algorithm: 'sha256', value: registryTreeDigest(root, FINAL_FILES), scope: 'sorted_tree_manifest' }, counts: { file_count: FINAL_FILES.length, byte_count: FINAL_FILES.reduce((sum, name) => sum + bytes(path.join(root, name)).length, 0) }, source_lineage: { description: `Issue #69 Phase D 60-record selection published only under fresh Sol High receipt SHA-256 ${descriptor.reviewer_receipt.sha256}, binding candidate selection ${descriptor.candidate_selection.sha256}; zero externally verified claims, verified dossiers, or accepted tasks.`, source_artifact_ids: dependencies, source_urls: ['https://github.com/zouantchaw/mtl-archives-search/issues/69'] }, storage: { storage_class: 'tracked_repository', path_class: 'tracked_fixture', locator: FIXTURE_REL }, generation: { method: 'review_assisted', command: 'npm run dataset-factory:phase-d-scale-publish-receipt-v1 -- --receipt /path/to/completed-receipt.json', code_ref: 'codex/69-scale-batch', human_input_ids: [] }, dependency_ids: dependencies, required_by: ['issue #69 Phase D external-evidence successor gate'], rights_boundary: { license_id: 'mixed_predecessor_rights_preserved', attribution: 'Archives de la Ville de Montreal / Ville de Montreal as bound per record', commercial_use_allowed: false, notes: 'Conservative artifact-level flag. Exact per-record rights are complete; no source body, verified dossier, or external claim is added.' }, created_at: CREATED_AT, creation_time_basis: 'report_metadata' };
  validateRegistryEntry(entry);
  return entry;
}
function registryRow(): Json | null { return readJsonl(REGISTRY).map(row => row.value).find(row => row.stable_id === ARTIFACT_ID) ?? null; }
function verifyCompletedReceipt(receipt: Json, raw: Buffer, sealed: Json, archiveManifest: Json, root = FIXTURE): void {
  assert(raw.length > 0 && receipt.authority_status === 'approved_for_publication', 'completed receipt authority/status drift'); const refs = collectSourceRefs(sealed), expectedArchives = receiptArchiveBindings(sealed.source_archives);
  assert(receipt.bindings.candidate_selection_sha256 === sha(bytes(path.join(root, SELECTION))), 'receipt selection binding drift'); assert(receipt.bindings.archive_verification_manifest_sha256 === sha(bytes(path.join(root, ARCHIVE_MANIFEST))), 'receipt archive manifest binding drift'); assert(receipt.bindings.source_membership_reference_count === refs.length && receipt.bindings.source_membership_references_sha256 === sha(`${refs.map(canonical).join('\n')}\n`), 'receipt source membership reference binding drift'); assert(canonical(receipt.bindings.source_archives) === canonical(expectedArchives), 'receipt archive descriptor/bundle/tree/member binding drift'); assert(canonical(receipt.bindings.counts) === canonical({ selected: 60, ground: 30, aerial: 20, control: 10 }), 'receipt count/distribution binding drift'); assert(receipt.reviewer.reviewer_id && receipt.reviewer.session_id && receipt.reviewer.reviewed_at && receipt.reviewer.model === 'gpt-5.6-sol' && receipt.reviewer.reasoning_effort === 'high', 'receipt reviewer/session identity incomplete'); assert(Object.values(receipt.attestation).every(value => value === true), 'receipt attestation incomplete'); verifySourceMembership(sealed, archiveManifest);
}
function writeRegistryRow(expected: Json): void { const lines = bytes(REGISTRY).toString('utf8').split('\n').filter(Boolean); let found = false; const next = lines.map(line => { const value = JSON.parse(line); if (value.stable_id !== ARTIFACT_ID) return line; assert(!found, 'duplicate Phase D registry row'); found = true; return canonical(expected); }); if (!found) next.push(canonical(expected)); fs.writeFileSync(REGISTRY, `${next.join('\n')}\n`); }
function publishReceiptToRoot(root: string, raw: Buffer): Json {
  assert(!fs.existsSync(path.join(root, COMPLETED_RECEIPT)), 'a reviewer receipt is already published and immutable'); verify(root, false); const receipt = JSON.parse(raw.toString('utf8')), schema = validators(); schema['reviewer-selection-receipt'](receipt); const sealed = json(path.join(root, SELECTION)), archiveManifest = json(path.join(root, ARCHIVE_MANIFEST)); verifyCompletedReceipt(receipt, raw, sealed, archiveManifest, root); fs.writeFileSync(path.join(root, COMPLETED_RECEIPT), raw);
  const status = json(path.join(root, 'status-report-v1.json')); status.authority_status = 'authoritative_fresh_sol_high_receipt_published'; status.limitations[0] = `Selection inclusion authority is limited to fresh Sol High reviewer receipt SHA-256 ${sha(raw)}; dossier-level review remains pending.`; schema['status-report'](status); writeJson(path.join(root, 'status-report-v1.json'), status);
  const descriptor = json(path.join(root, 'descriptor-v1.json')); descriptor.authority_status = status.authority_status; descriptor.scope = 'authoritative_60_record_selection_bound_to_fresh_sol_high_receipt'; descriptor.reviewer_receipt = { path: COMPLETED_RECEIPT, bytes: raw.length, sha256: sha(raw) }; descriptor.manifest = [...MEMBERS, COMPLETED_RECEIPT].map(name => localPin(root, name)); descriptor.tree_sha256 = treeDigest(root, [...MEMBERS, COMPLETED_RECEIPT]); schema.descriptor(descriptor); writeJson(path.join(root, 'descriptor-v1.json'), descriptor);
  const registry = expectedRegistry(descriptor, root); verify(root, false); return { registry, descriptor };
}
function publishReceipt(receiptPath: string): Json {
  assert(receiptPath, 'publish-receipt requires --receipt'); assert(!fs.existsSync(path.join(FIXTURE, COMPLETED_RECEIPT)), 'a reviewer receipt is already published and immutable'); const resolvedReceipt = resolveReceiptInput(receiptPath), raw = readStableReceipt(resolvedReceipt.file, resolvedReceipt.stat), publication = publishReceiptToRoot(FIXTURE, raw); writeRegistryRow(publication.registry); const result = verify(); return { published: true, receipt_sha256: sha(raw), ...result };
}
function verify(root = FIXTURE, checkRegistry = true): Json {
  const schema = validators(), files = listFiles(root), published = files.includes(COMPLETED_RECEIPT), expectedFiles = published ? FINAL_FILES : CANDIDATE_FILES; assert(canonical(files) === canonical([...expectedFiles].sort()), `fixture file set drift: ${files.join(',')}`);
  const sealed = json(path.join(root, SELECTION)), archiveManifest = json(path.join(root, ARCHIVE_MANIFEST)), template = json(path.join(root, RECEIPT_TEMPLATE)), status = json(path.join(root, 'status-report-v1.json')), descriptor = json(path.join(root, 'descriptor-v1.json')); schema['candidate-selection-evidence'](sealed); schema['archive-verification-manifest'](archiveManifest); schema['reviewer-selection-receipt-template'](template); schema['status-report'](status); schema.descriptor(descriptor); const summary = verifySelection(sealed, archiveManifest);
  verifyArchiveDescriptorPins(sealed);
  const selectionBytes = bytes(path.join(root, SELECTION)); assert(sha(selectionBytes) === descriptor.candidate_selection.sha256 && selectionBytes.length === descriptor.candidate_selection.bytes, 'immutable candidate-selection SHA drift'); assert(canonical(descriptor.predecessor_pins) === canonical(predecessorPins()), 'predecessor Git/blob pin drift');
  const manifestBytes = bytes(path.join(root, ARCHIVE_MANIFEST)), refs = collectSourceRefs(sealed), expectedTemplate = receiptTemplate(sha(selectionBytes), { path: ARCHIVE_MANIFEST, bytes: manifestBytes.length, sha256: sha(manifestBytes) }, refs, sealed.source_archives); assert(canonical(template) === canonical(expectedTemplate), 'immutable reviewer receipt template drift');
  assert(canonical(status.counts) === canonical({ visually_and_provenance_processed: 60, newly_externally_verified_claims: 0, verified_dossiers: 0, accepted_tasks: 0, remaining_dossier_shortfall: 25 }), 'status inflation drift'); assert(canonical(status.authority) === canonical(summary.authority) && canonical(status.gold_dispositions) === canonical(summary.dispositions), 'status authority/disposition drift');
  const manifestNames = published ? [...MEMBERS, COMPLETED_RECEIPT] : [...MEMBERS]; assert(canonical(descriptor.manifest.map((m: Json) => m.path)) === canonical(manifestNames), 'descriptor manifest drift'); for (const member of descriptor.manifest) { const raw = bytes(resolveContained(root, member.path, 'descriptor member')); assert(raw.length === member.bytes && sha(raw) === member.sha256, `descriptor member drift: ${member.path}`); } assert(treeDigest(root, manifestNames) === descriptor.tree_sha256, 'descriptor tree drift');
  if (published) { const receiptRaw = bytes(path.join(root, COMPLETED_RECEIPT)), receipt = JSON.parse(receiptRaw.toString('utf8')); schema['reviewer-selection-receipt'](receipt); verifyCompletedReceipt(receipt, receiptRaw, sealed, archiveManifest, root); const receiptPin = { path: COMPLETED_RECEIPT, bytes: receiptRaw.length, sha256: sha(receiptRaw) }; assert(status.authority_status === 'authoritative_fresh_sol_high_receipt_published' && descriptor.authority_status === status.authority_status && descriptor.scope === 'authoritative_60_record_selection_bound_to_fresh_sol_high_receipt' && canonical(descriptor.reviewer_receipt) === canonical(receiptPin), 'published receipt/status/descriptor drift'); if (checkRegistry && root === FIXTURE) { const row = registryRow(); assert(row && canonical(row) === canonical(expectedRegistry(descriptor, root)), 'artifact registry row drift'); } } else { assert(status.authority_status === 'candidate_not_authoritative_pending_fresh_sol_high_receipt' && descriptor.authority_status === status.authority_status && descriptor.scope === 'candidate_60_record_selection_pending_fresh_reviewer_receipt' && descriptor.reviewer_receipt === null, 'candidate authority inflation'); if (checkRegistry && root === FIXTURE) assert(!registryRow(), 'candidate must not have artifact registry authority row'); }
  return { verified: true, authoritative: published, selected: 60, distribution: summary.distribution, authority: summary.authority, gold_dispositions: summary.dispositions, candidate_selection_sha256: descriptor.candidate_selection.sha256, archive_verification_manifest_sha256: sha(bytes(path.join(root, ARCHIVE_MANIFEST))), tree_sha256: descriptor.tree_sha256 };
}
function verifyFreshSources(goldRoot: string, recoveryRoot: string, pilotRoot: string): Json {
  assert(goldRoot && recoveryRoot && pilotRoot, 'fresh source verification requires --gold-root, --recovery-root, and --pilot-root'); const result = verify(), sealed = json(path.join(FIXTURE, SELECTION)), tracked = json(path.join(FIXTURE, ARCHIVE_MANIFEST)), goldDescriptor = json(path.join(ROOT, GOLD_DESCRIPTOR_REL)), recoveryDescriptor = json(path.join(ROOT, RECOVERY_DESCRIPTOR_REL));
  const promotionRoot = resolveContained(pilotRoot, 'promotion', 'pilot promotion root', 'directory'), reviewRoot = resolveContained(pilotRoot, 'independent-review', 'pilot review root', 'directory'); const verified = [verifyArchive('gold_label_batch_002', goldDescriptor, goldRoot, GOLD_PREFIX), verifyArchive('canonical_image_recovery_v1', recoveryDescriptor, recoveryRoot, RECOVERY_PREFIX), verifyPilotArtifact('real_pilot_visual_promotion_v1', PILOT_PROMOTION_REL, promotionRoot), verifyPilotArtifact('real_pilot_independent_visual_review_v1', PILOT_REVIEW_REL, reviewRoot), verifyPilotIntelligenceArtifact()]; assert(canonical(verified) === canonical(tracked.artifacts), 'fresh archive verification manifest differs from candidate');
  const roots: Record<string,string> = { gold_label_batch_002: goldRoot, canonical_image_recovery_v1: recoveryRoot, real_pilot_visual_promotion_v1: promotionRoot, real_pilot_independent_visual_review_v1: reviewRoot }; for (const ref of collectSourceRefs(sealed)) { const artifact = verified.find(x => x.artifact_id === ref.artifact_id), member = artifact?.members.find((x: Json) => x.path === ref.member_path); assert(artifact && member, `fresh source member missing: ${ref.member_path}`); const lines = bytes(resolveContained(roots[ref.artifact_id], member.relative_path, 'fresh source member')).toString('utf8').split('\n'); assert(ref.line <= lines.length && sha(lines[ref.line - 1]) === ref.row_sha256, `fresh source row membership drift: ${ref.member_path}:${ref.line}`); }
  return { ...result, fresh_source_members_verified: verified.reduce((sum,x)=>sum+x.member_count,0), fresh_source_rows_reverified: collectSourceRefs(sealed).length };
}

function copyFixture(root: string): void { fs.cpSync(FIXTURE, root, { recursive: true }); }
function copyCandidateInputs(root: string): void { fs.mkdirSync(root, { recursive: true }); for (const name of [SELECTION, ARCHIVE_MANIFEST, RECEIPT_TEMPLATE]) fs.copyFileSync(path.join(FIXTURE, name), path.join(root, name)); }
function localPin(root: string, name: string): Json { const raw = bytes(resolveContained(root, name, 'local fixture pin')); return { path: name, bytes: raw.length, sha256: sha(raw) }; }
function resealDescriptor(root: string): void { const descriptor = json(path.join(root, 'descriptor-v1.json')); descriptor.candidate_selection = localPin(root, SELECTION); descriptor.manifest = MEMBERS.map(name => localPin(root, name)); descriptor.tree_sha256 = treeDigest(root, MEMBERS); writeJson(path.join(root, 'descriptor-v1.json'), descriptor); }
function selfTest(): Json {
  verify(); let cases = 0; const mutate = (name: string, edit: (root: string) => void, expected: RegExp, reseal = true) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-self-test-')); try { copyFixture(root); edit(root); if (reseal) resealDescriptor(root); let rejected = false; try { verify(root, false); } catch (error) { rejected = expected.test(String(error)); } assert(rejected, `self-test failed to reject ${name}`); cases++; } finally { fs.rmSync(root, { recursive: true, force: true }); } };
  const selectionEdit = (edit: (selection: Json) => void) => (root: string) => { const file = path.join(root, MEMBERS[0]), value = json(file); edit(value); writeJson(file, value); };
  const statusEdit = (edit: (status: Json) => void) => (root: string) => { const file = path.join(root, 'status-report-v1.json'), value = json(file); edit(value); writeJson(file, value); };
  const templateEdit = (edit: (template: Json) => void) => (root: string) => { const file = path.join(root, RECEIPT_TEMPLATE), value = json(file); edit(value); writeJson(file, value); };
  const selectedGold = (selection: Json): Json => selection.records.find((record: Json) => record.review_evidence.gold);
  mutate('record drift', selectionEdit(x => { x.records[0].record_id = 'mtl_archives_metadata_999.json'; }), /selection identity|canonical record/);
  mutate('component drift', selectionEdit(x => { x.records[1].component_id = x.records[0].component_id; }), /duplicate component|component-safe/);
  mutate('count drift', selectionEdit(x => { x.counts.selected = 59; }), /schema validation|selected count|summary drift/);
  mutate('distribution drift', selectionEdit(x => { x.records[0].primary_stratum = 'control'; }), /pilot primary stratum|distribution drift/);
  mutate('pilot authority inflation', selectionEdit(x => { x.records.find((r: Json) => r.numeric_id === 0).authority_class = 'gold_and_pilot'; }), /Gold\+pilot authority|authority distribution/);
  mutate('pilot-only gains Gold', selectionEdit(x => { const a = x.records.find((r: Json) => r.numeric_id === 0), b = x.records.find((r: Json) => r.authority_class === 'gold_added'); a.review_evidence.gold = b.review_evidence.gold; }), /pilot-only authority inflation/);
  mutate('Gold row substitution', selectionEdit(x => { const rows = x.records.filter((r: Json) => r.review_evidence.gold); rows[0].review_evidence.gold.source_rows.adjudication = rows[1].review_evidence.gold.source_rows.adjudication; }), /Gold row substitution|disposition drift/);
  mutate('Gold hash substitution', selectionEdit(x => { const ref = x.records.find((r: Json) => r.review_evidence.gold).review_evidence.gold.source_rows.adjudication; ref.row_sha256 = 'a'.repeat(64); }), /embedded row hash/);
  mutate('forged duplicate member hash suppression', selectionEdit(x => { selectedGold(x).review_evidence.gold.source_rows.selection.source.member_sha256 = '0'.repeat(64); }), /conflicting source reference|source member not in archive manifest/);
  mutate('duplicate row hash conflict', selectionEdit(x => { const ref = selectedGold(x).review_evidence.gold.source_rows.selection, value = JSON.parse(ref.value_json); value.phase_d_adversarial_marker = true; ref.value_json = canonical(value); ref.row_sha256 = sha(ref.value_json); }), /complete source reference conflict/);
  mutate('duplicate member conflict', selectionEdit(x => { const record = selectedGold(x), ref = record.review_evidence.gold.source_rows.selection, other = record.review_evidence.gold.source_rows.adjudication.source; ref.source = { ...other }; }), /complete source reference conflict/);
  mutate('duplicate artifact conflict', selectionEdit(x => { const record = selectedGold(x), ref = record.review_evidence.gold.source_rows.selection, other = record.canonical_evidence.node.source; ref.source = { ...other }; }), /complete source reference conflict/);
  mutate('source membership path substitution', selectionEdit(x => { x.records[0].canonical_evidence.node.source.member_path = '../outside-identical.jsonl'; }), /source member not in archive manifest|schema validation/);
  mutate('Gold replay row substitution', selectionEdit(x => { x.selection_replay_inputs.gold_candidates[0].record_id = 'mtl_archives_metadata_999999.json'; }), /schema validation|Gold replay row\/hash substitution|deterministic Gold selection replay|Gold replay candidate/);
  mutate('missing rights', selectionEdit(x => { x.records[0].rights.attribution = ''; }), /schema validation|missing rights/);
  mutate('missing pixels', selectionEdit(x => { x.records[0].pixel_evidence.views = []; }), /schema validation|missing pixel/);
  mutate('missing review lineage', selectionEdit(x => { x.records[0].review_evidence.pilot = null; }), /pilot-only authority|schema validation/);
  mutate('proxy promotion', selectionEdit(x => { x.records[0].claim_boundary.selection_proxies_are_labels = true; }), /schema validation|claim\/task\/proxy/);
  mutate('held promotion', selectionEdit(x => { x.records.find((r: Json) => r.review_evidence.gold?.disposition === 'held').review_evidence.gold.disposition = 'promoted'; }), /Gold disposition drift/);
  mutate('rejected promotion', selectionEdit(x => { x.records.find((r: Json) => r.review_evidence.gold?.disposition === 'rejected').review_evidence.gold.disposition = 'promoted'; }), /Gold disposition drift/);
  mutate('aerial measurement', selectionEdit(x => { x.records.find((r: Json) => r.primary_stratum === 'aerial').aerial_measurement_boundary.area = 12; }), /schema validation|aerial measurement/);
  mutate('archive descriptor drift', selectionEdit(x => { x.source_archives.gold_label_batch_002.descriptor.sha256 = 'a'.repeat(64); }), /descriptor pin drift|schema validation/);
  mutate('archive summary drift', selectionEdit(x => { x.source_archives.gold_label_batch_002.tree_sha256 = 'a'.repeat(64); }), /archive descriptor summary drift/);
  mutate('receipt template archive binding drift', templateEdit(x => { x.bindings.source_archives.gold_label_batch_002.tree_sha256 = 'a'.repeat(64); }), /immutable reviewer receipt template drift/);
  mutate('predecessor drift', root => { const file = path.join(root, 'descriptor-v1.json'), value = json(file); value.predecessor_pins[0].git_blob_sha1 = 'a'.repeat(40); writeJson(file, value); }, /predecessor Git\/blob pin/, false);
  mutate('coordinated lane/basis swap', selectionEdit(x => { const a=x.records[0], b=x.records.find((r:Json)=>r.primary_stratum==='aerial'); [a.primary_stratum,b.primary_stratum]=[b.primary_stratum,a.primary_stratum]; [a.selection_basis,b.selection_basis]=[b.selection_basis,a.selection_basis]; }), /pilot primary stratum|fixed pilot order|deterministic Gold selection|distribution/);
  mutate('predicate drift', selectionEdit(x => { const r=x.records.find((v:Json)=>v.review_evidence.gold && v.primary_stratum==='ground'); const a=JSON.parse(r.review_evidence.gold.source_rows.adjudication.value_json); a.final_labels.image_mode.value='aerial_vertical'; r.review_evidence.gold.source_rows.adjudication.value_json=canonical(a); r.review_evidence.gold.source_rows.adjudication.row_sha256=sha(canonical(a)); }), /source derivation|row\/hash substitution|deterministic Gold selection|complete source reference conflict/);
  mutate('immutable selection reseal', selectionEdit(x => { x.records[0].selection_basis = 'gold_promoted_observed_ground_high_signal'; }), /fixed pilot order|immutable candidate-selection SHA/, false);
  mutate('fake dossier count', statusEdit(x => { x.counts.verified_dossiers = 1; }), /schema validation|status inflation/);
  mutate('fake task count', statusEdit(x => { x.counts.accepted_tasks = 1; }), /schema validation|status inflation/);
  mutate('fake external claim count', statusEdit(x => { x.counts.newly_externally_verified_claims = 1; }), /schema validation|status inflation/);
  mutate('published receipt byte drift', root => { fs.appendFileSync(path.join(root, COMPLETED_RECEIPT), ' '); }, /descriptor member drift|receipt.*drift/, false);
  mutate('published status downgrade', statusEdit(x => { x.authority_status = 'candidate_not_authoritative_pending_fresh_sol_high_receipt'; }), /descriptor member drift|published receipt\/status\/descriptor drift/, false);
  mutate('published descriptor receipt substitution', root => { const file = path.join(root, 'descriptor-v1.json'), value = json(file); value.reviewer_receipt.sha256 = 'a'.repeat(64); writeJson(file, value); }, /published receipt\/status\/descriptor drift/, false);
  const validRegistry = expectedRegistry(json(path.join(FIXTURE, 'descriptor-v1.json')));
  for (const [name, edit] of [
    ['invalid registry method', (entry: Json) => { entry.generation.method = 'independent_reviewer_receipt'; }],
    ['raw registry human input hash', (entry: Json) => { entry.generation.human_input_ids = [sha(bytes(path.join(FIXTURE, COMPLETED_RECEIPT)))]; }],
  ] as const) {
    const entry = JSON.parse(JSON.stringify(validRegistry)); edit(entry); let rejected = false;
    try { validateRegistryEntry(entry); } catch (error) { rejected = /artifact registry schema validation/.test(String(error)); }
    assert(rejected, `self-test failed to reject ${name}`); cases++;
  }
  const pilotAuthorityMutation = (name: string, editDossier: (dossier: Json) => void, editRecord: (record: Json, dossier: Json) => void, expected: RegExp) => {
    const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-pilot-authority-'));
    try {
      const artifactRoot = path.join(approvedRoot, PILOT_INTELLIGENCE_ROOT_REL); fs.mkdirSync(path.dirname(artifactRoot), { recursive: true }); fs.cpSync(path.join(ROOT, PILOT_INTELLIGENCE_ROOT_REL), artifactRoot, { recursive: true });
      const selection = json(path.join(FIXTURE, SELECTION)), record = selection.records.find((x: Json) => x.numeric_id === 0), dossierFile = path.join(artifactRoot, 'dossiers/0.json'), dossier = json(dossierFile); editDossier(dossier); writeJson(dossierFile, dossier);
      const raw = bytes(dossierFile); record.review_evidence.pilot.dossier = { path: `${PILOT_INTELLIGENCE_ROOT_REL}/dossiers/0.json`, bytes: raw.length, sha256: sha(raw) }; editRecord(record, dossier);
      let rejected = false; try { const artifact = verifyPilotIntelligenceArtifact(approvedRoot); verifyPilotDossierPin(record.review_evidence.pilot.dossier, artifact, approvedRoot); } catch (error) { rejected = expected.test(String(error)); }
      assert(rejected, `self-test failed to reject ${name}`); cases++;
    } finally { fs.rmSync(approvedRoot, { recursive: true, force: true }); }
  };
  pilotAuthorityMutation('coordinated pilot rights substitution', dossier => { dossier.rights.license_id = 'forged-license'; }, (record, dossier) => { record.rights = pilotRights(dossier); }, /predecessor member drift/);
  pilotAuthorityMutation('coordinated pilot claim substitution', dossier => { dossier.claims.visual_observation[0].text = 'forged claim'; }, () => {}, /predecessor member drift/);
  pilotAuthorityMutation('coordinated pilot pixel substitution', dossier => { dossier.pixel_scope.sha256 = 'a'.repeat(64); }, (record, dossier) => { record.pixel_evidence.original_evidence_sha256 = dossier.pixel_scope.sha256; record.pixel_evidence.views[0].sha256 = dossier.pixel_scope.sha256; }, /predecessor member drift/);
  const pilotAuthorityAttack = (name: string, edit: (approvedRoot: string) => void, expected: RegExp) => { const approvedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-pilot-authority-')); try { const artifactRoot = path.join(approvedRoot, PILOT_INTELLIGENCE_ROOT_REL); fs.mkdirSync(path.dirname(artifactRoot), { recursive: true }); fs.cpSync(path.join(ROOT, PILOT_INTELLIGENCE_ROOT_REL), artifactRoot, { recursive: true }); edit(approvedRoot); let rejected = false; try { verifyPilotIntelligenceArtifact(approvedRoot); } catch (error) { rejected = expected.test(String(error)); } assert(rejected, `self-test failed to reject ${name}`); cases++; } finally { fs.rmSync(approvedRoot, { recursive: true, force: true }); } };
  pilotAuthorityAttack('pilot dossier member drift', approvedRoot => { fs.appendFileSync(path.join(approvedRoot, PILOT_INTELLIGENCE_ROOT_REL, 'dossiers/0.json'), ' '); }, /predecessor member drift/);
  pilotAuthorityAttack('pilot descriptor member drift', approvedRoot => { const file = path.join(approvedRoot, PILOT_INTELLIGENCE_DESCRIPTOR_REL), value = json(file); value.members.find((x: Json) => x.path === 'dossiers/0.json').sha256 = 'a'.repeat(64); writeJson(file, value); }, /descriptor differs from authenticated predecessor/);
  pilotAuthorityAttack('pilot descriptor tree drift', approvedRoot => { const file = path.join(approvedRoot, PILOT_INTELLIGENCE_DESCRIPTOR_REL), value = json(file); value.tree_sha256 = 'a'.repeat(64); writeJson(file, value); }, /descriptor differs from authenticated predecessor/);
  pilotAuthorityAttack('pilot descriptor path attack', approvedRoot => { const file = path.join(approvedRoot, PILOT_INTELLIGENCE_DESCRIPTOR_REL), value = json(file); value.members.find((x: Json) => x.path === 'dossiers/0.json').path = '../0.json'; writeJson(file, value); }, /descriptor differs from authenticated predecessor/);
  pilotAuthorityAttack('pilot dossier symlink attack', approvedRoot => { const file = path.join(approvedRoot, PILOT_INTELLIGENCE_ROOT_REL, 'dossiers/0.json'), outside = path.join(approvedRoot, 'outside.json'); fs.copyFileSync(file, outside); fs.unlinkSync(file); fs.symlinkSync(outside, file); }, /symlink rejected/);
  const pathRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-path-test-')); try { fs.mkdirSync(path.join(pathRoot,'safe','parent'),{recursive:true}); fs.writeFileSync(path.join(pathRoot,'safe','member'),'x'); fs.writeFileSync(path.join(pathRoot,'outside'),'x'); fs.symlinkSync(path.join(pathRoot,'outside'),path.join(pathRoot,'safe','leaf-link')); fs.symlinkSync(path.join(pathRoot,'safe'),path.join(pathRoot,'parent-link')); const rejects: Array<[string,()=>void]> = [['traversal',()=>resolveContained(path.join(pathRoot,'safe'),'../outside','test')],['absolute',()=>resolveContained(path.join(pathRoot,'safe'),path.join(pathRoot,'outside'),'test')],['separator variant',()=>resolveContained(path.join(pathRoot,'safe'),'..\\outside','test')],['outside identical file',()=>resolveContained(path.join(pathRoot,'safe'),'../outside','test')],['leaf symlink',()=>resolveContained(path.join(pathRoot,'safe'),'leaf-link','test')],['parent symlink',()=>resolveContained(pathRoot,'parent-link/member','test')],['archive member symlink',()=>resolveContained(path.join(pathRoot,'safe'),'leaf-link','archive member')],['archive root symlink',()=>verifyArchive('gold_label_batch_002',json(path.join(ROOT,GOLD_DESCRIPTOR_REL)),path.join(pathRoot,'parent-link'),GOLD_PREFIX)]]; for(const [name,fn] of rejects){let rejected=false;try{fn()}catch{rejected=true}assert(rejected,`path self-test failed: ${name}`);cases++;} } finally { fs.rmSync(pathRoot,{recursive:true,force:true}); }
  const receiptRoot = fs.mkdtempSync('/tmp/phase-d-receipt-path-test-'); try {
    const receiptFile = path.join(receiptRoot, 'receipt.json'), receiptLink = path.join(receiptRoot, 'receipt-link.json'); fs.writeFileSync(receiptFile, 'receipt bytes'); fs.symlinkSync(receiptFile, receiptLink);
    const resolved = resolveReceiptInput(receiptFile); assert(resolved.file === fs.realpathSync(receiptFile) && readStableReceipt(resolved.file, resolved.stat).equals(Buffer.from('receipt bytes')), 'macOS /tmp receipt alias did not resolve byte-identically'); cases++;
    const rejects: Array<[string, () => void]> = [
      ['receipt leaf symlink', () => resolveReceiptInput(receiptLink)],
      ['receipt parent traversal', () => resolveReceiptInput(`${receiptRoot}/nested/../receipt.json`)],
      ['receipt leaf traversal', () => resolveReceiptInput(`${receiptRoot}/receipt.json/..`)],
      ['missing receipt', () => resolveReceiptInput(path.join(receiptRoot, 'missing.json'))],
      ['receipt directory', () => resolveReceiptInput(receiptRoot)],
    ];
    for (const [name, fn] of rejects) { let rejected = false; try { fn(); } catch { rejected = true; } assert(rejected, `path self-test failed: ${name}`); cases++; }
  } finally { fs.rmSync(receiptRoot, { recursive: true, force: true }); }
  return { self_test: 'passed', adversarial_rejections: cases, production_mutation: false };
}
function integration(): Json {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-d-integration-'));
  try {
    const inputA = path.join(root, 'candidate-input-a'), inputB = path.join(root, 'candidate-input-b'), a = path.join(root, 'candidate-a'), b = path.join(root, 'candidate-b');
    copyCandidateInputs(inputA); copyCandidateInputs(inputB); buildCandidate(inputA, a); buildCandidate(inputB, b);
    const candidateA = verify(a, false), candidateB = verify(b, false); assert(!candidateA.authoritative && !candidateB.authoritative, 'candidate replay gained publication authority');
    for (const name of CANDIDATE_FILES) assert(bytes(path.join(a, name)).equals(bytes(path.join(b, name))), `candidate replay differs between builds: ${name}`);

    const receiptRaw = bytes(path.join(FIXTURE, COMPLETED_RECEIPT)), trackedReceiptHash = sha(receiptRaw), trackedSelectionHash = sha(bytes(path.join(FIXTURE, SELECTION)));
    const publication = publishReceiptToRoot(a, receiptRaw), published = verify(a, false);
    assert(published.authoritative, 'published replay did not gain receipt-bound authority');
    for (const name of FINAL_FILES) assert(bytes(path.join(a, name)).equals(bytes(path.join(FIXTURE, name))), `published replay differs from authoritative fixture: ${name}`);
    const row = registryRow(); assert(row && canonical(row) === canonical(publication.registry), 'published replay registry contract differs from tracked Phase D row'); validateRegistryEntry(publication.registry);

    const trackedBefore = FINAL_FILES.map(name => localPin(FIXTURE, name)), ordinaryOutput = path.join(root, 'ordinary-build'); let buildRejected = false;
    try { build(ordinaryOutput); } catch (error) { buildRejected = /ordinary build cannot overwrite a published reviewer receipt/.test(String(error)); }
    assert(buildRejected && !fs.existsSync(ordinaryOutput), 'ordinary build did not fail closed before writing against published state');
    assert(canonical(trackedBefore) === canonical(FINAL_FILES.map(name => localPin(FIXTURE, name))), 'ordinary build changed published fixture bytes');

    const replayBefore = FINAL_FILES.map(name => localPin(a, name)); let republishRejected = false;
    try { publishReceiptToRoot(a, receiptRaw); } catch (error) { republishRejected = /already published and immutable/.test(String(error)); }
    assert(republishRejected && canonical(replayBefore) === canonical(FINAL_FILES.map(name => localPin(a, name))), 'second publication changed immutable replay bytes');

    const adversarial = (name: string, edit: (testRoot: string) => void, expected: RegExp) => { const testRoot = path.join(root, `adversarial-${name}`); fs.cpSync(a, testRoot, { recursive: true }); edit(testRoot); let rejected = false; try { verify(testRoot, false); } catch (error) { rejected = expected.test(String(error)); } assert(rejected, `published integration failed to reject ${name}`); };
    adversarial('receipt', testRoot => fs.appendFileSync(path.join(testRoot, COMPLETED_RECEIPT), ' '), /descriptor member drift|receipt.*drift/);
    adversarial('status', testRoot => { const file = path.join(testRoot, 'status-report-v1.json'), value = json(file); value.authority_status = 'candidate_not_authoritative_pending_fresh_sol_high_receipt'; writeJson(file, value); }, /descriptor member drift|published receipt\/status\/descriptor drift/);
    adversarial('descriptor', testRoot => { const file = path.join(testRoot, 'descriptor-v1.json'), value = json(file); value.reviewer_receipt.sha256 = 'a'.repeat(64); writeJson(file, value); }, /published receipt\/status\/descriptor drift/);

    assert(trackedReceiptHash === '12f5c0a6b97c04bf6acf2417bd4aac2358ef98385decd55b3b4a8d5a0fc65898' && receiptRaw.length === 3224, 'authoritative receipt identity drift');
    assert(trackedSelectionHash === 'd6aec52d39d83a3fda645d56f101890ad176b3e1851851b2787db98d2645f78d', 'candidate selection identity drift');
    return { integration_test: 'passed', candidate_replay: { authoritative: false, files: CANDIDATE_FILES.length, tree_sha256: candidateA.tree_sha256 }, published_replay: { authoritative: true, files: FINAL_FILES.length, tree_sha256: published.tree_sha256, receipt_sha256: trackedReceiptHash }, ordinary_build_rejected: true, republish_rejected: true, registry_contract_valid: true };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function arg(name: string): string { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? '' : ''; }
const command = process.argv[2] ?? 'verify';
if (command === 'seal') console.log(JSON.stringify(seal(path.resolve(arg('--gold-root')), path.resolve(arg('--recovery-root')), path.resolve(arg('--pilot-root')))));
else if (command === 'build') console.log(JSON.stringify(build()));
else if (command === 'verify') console.log(JSON.stringify(verify()));
else if (command === 'verify-fresh-sources') console.log(JSON.stringify(verifyFreshSources(path.resolve(arg('--gold-root')), path.resolve(arg('--recovery-root')), path.resolve(arg('--pilot-root')))));
else if (command === 'self-test') console.log(JSON.stringify(selfTest()));
else if (command === 'integration-test') console.log(JSON.stringify(integration()));
else if (command === 'publish-receipt') console.log(JSON.stringify(publishReceipt(arg('--receipt'))));
else throw new Error(`unknown command: ${command}`);
