import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';

type Json = Record<string, any>;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIXTURE_REL = 'docs/dataset-factory/fixtures/aerial-source-evidence-v1';
const FIXTURE = path.join(ROOT, FIXTURE_REL);
const SCHEMAS = path.join(ROOT, 'docs/dataset-factory/schemas/aerial-source-evidence-v1');
const PHASE_D = path.join(ROOT, 'docs/dataset-factory/fixtures/phase-d-scale-v1/candidate-selection-evidence-v1.json');
const PHASE_D_DESCRIPTOR = path.join(ROOT, 'docs/dataset-factory/fixtures/phase-d-scale-v1/descriptor-v1.json');
const GATE_E_DESCRIPTOR = path.join(ROOT, 'docs/dataset-factory/fixtures/reviewed-source-evidence-v1/descriptor-v1.json');
const GATE_E_CANDIDATE = path.join(ROOT, 'docs/dataset-factory/fixtures/reviewed-source-evidence-v1/candidate-descriptor-v1.json');
const GATE_E_RECEIPT = path.join(ROOT, 'docs/dataset-factory/fixtures/reviewed-source-evidence-v1/independent-source-body-review-receipt-v1.json');
const SOURCE_DESCRIPTOR = path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/descriptor-v1.json');
const SOURCE_LEDGER = path.join(ROOT, 'docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/source-ledger-v1.json');
const MANIFEST = path.join(ROOT, 'data/mtl_archives/export/manifest_enriched.ndjson');
const REGISTRY = path.join(ROOT, 'docs/dataset-factory/artifact-registry.v0.jsonl');
const VERSION = 'aerial_source_evidence_v1.0.0';
const ARTIFACT_ID = 'aerial-source-evidence-v1';
const REGISTRY_ID = 'dfv0_aerial_source_evidence_v1_candidate';
const CREATED_AT = '2026-07-14T05:52:31.000Z';
const MEMBERS = ['evidence-ledger-v1.json', 'external-archive-descriptor-v1.json', 'independent-source-review-receipt.template-v1.json', 'status-report-v1.json'] as const;
const ABSTENTIONS = ['exact_location', 'scale', 'footprint', 'area', 'acreage', 'distance', 'land_use', 'measurement'] as const;
const Ajv2020 = Ajv2020Import as unknown as new (options: Json) => { compile(schema: Json): any };

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function sha256(value: Buffer | string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function readJson(file: string): Json { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function json(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function pin(file: string): Json { const raw = fs.readFileSync(file); return { path: path.relative(ROOT, file).split(path.sep).join('/'), bytes: raw.length, sha256: sha256(raw) }; }
function safeRelative(value: string, label: string): string {
  assert(value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'), `${label} must be a contained relative path`);
  return value;
}
function contained(root: string, relative: string, label: string): string {
  const target = path.resolve(root, safeRelative(relative, label));
  const rel = path.relative(path.resolve(root), target);
  assert(rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel), `${label} escapes root`);
  return target;
}
function containedFile(root: string, relative: string, label: string): string {
  const target = contained(root, relative, label); let current = path.resolve(root); assert(!fs.lstatSync(current).isSymbolicLink(), `${label} root symlink rejected`);
  for (const part of path.relative(current, target).split(path.sep)) { current = path.join(current, part); const stat = fs.lstatSync(current); assert(!stat.isSymbolicLink(), `${label} symlink rejected`); }
  assert(fs.lstatSync(target).isFile(), `${label} must be a regular file`); const realRoot = fs.realpathSync(root); const realTarget = fs.realpathSync(target); const rel = path.relative(realRoot, realTarget); assert(rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel), `${label} real path escapes root`); return target;
}
function parseManifest(): Map<number, Json> {
  return new Map(fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').map(line => {
    const row = JSON.parse(line); const match = row.metadata_filename.match(/_(\d+)\.json$/); assert(match, 'manifest record id missing'); return [Number(match[1]), row];
  }));
}
function selectedCandidates(): Json[] {
  const phase = readJson(PHASE_D); const selected = phase.records.filter((row: Json) => row.primary_stratum === 'aerial');
  assert(selected.length === 20, 'Phase D aerial count drift');
  const used = new Set(phase.records.map((row: Json) => row.component_id));
  const eligible = phase.selection_replay_inputs.gold_candidates.map((row: Json) => {
    const selection = JSON.parse(row.selection.value_json); const adjudication = JSON.parse(row.adjudication.value_json); return { row, selection, adjudication };
  }).filter(({ selection, adjudication }: Json) => adjudication.disposition === 'promoted'
    && ['aerial_vertical', 'aerial_oblique'].includes(adjudication.final_labels?.image_mode?.value)
    && !used.has(selection.component_id))
    .sort((a: Json, b: Json) => a.selection.rank - b.selection.rank || a.selection.record_id.localeCompare(b.selection.record_id));
  assert(eligible.length >= 2, 'fewer than two component-distinct reserves');
  const reserves = eligible.slice(0, 2).map(({ row, selection, adjudication }: Json) => ({
    numeric_id: Number(selection.record_id.match(/_(\d+)\.json$/)[1]), record_id: selection.record_id, component_id: selection.component_id,
    primary_stratum: 'aerial', authority_class: 'gold_reserve', selection_basis: 'phase_d_next_component_distinct_gold_rank',
    reserve_rank: selection.rank, reserve_evidence: { neutral_id: selection.neutral_id, component_size: selection.component_size, split: selection.split,
      quality_failure: adjudication.final_labels.quality_failure, needs_human_review: adjudication.final_labels.needs_human_review,
      component_exclusion: 'entire_component_excluded_from_all_other_gate_f_candidates', sibling_id_status: 'held_pending_authenticated_graph_restore' },
    review_evidence: { gold: { disposition: adjudication.disposition, neutral_id: selection.neutral_id, source_rows: row } },
  }));
  return [...selected, ...reserves];
}
function decodeMedia(raw: Buffer): Json {
  if (raw[0] === 0xff && raw[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < raw.length) { if (raw[offset] !== 0xff) { offset++; continue; } const marker = raw[offset + 1]; offset += 2; if (marker === 0xd8 || marker === 0xd9) continue; const length = raw.readUInt16BE(offset); assert(length >= 2, 'invalid JPEG segment'); if ([0xc0, 0xc1, 0xc2].includes(marker)) return { format: 'jpeg', width: raw.readUInt16BE(offset + 5), height: raw.readUInt16BE(offset + 3) }; offset += length; }
  }
  const little = raw.slice(0, 2).toString('ascii') === 'II'; assert(little || raw.slice(0, 2).toString('ascii') === 'MM', 'unsupported media format');
  const u16 = (o: number) => little ? raw.readUInt16LE(o) : raw.readUInt16BE(o); const u32 = (o: number) => little ? raw.readUInt32LE(o) : raw.readUInt32BE(o);
  assert(u16(2) === 42, 'invalid TIFF magic'); const ifd = u32(4); const count = u16(ifd); let width: number | null = null; let height: number | null = null;
  for (let index = 0; index < count; index++) { const o = ifd + 2 + index * 12; const tag = u16(o); const type = u16(o + 2); const value = type === 3 ? u16(o + 8) : u32(o + 8); if (tag === 256) width = value; if (tag === 257) height = value; }
  assert(width && height, 'TIFF dimensions missing'); return { format: 'tiff', width, height };
}
function finalHeaders(raw: string): Json {
  const blocks = raw.replace(/\r/g, '').trim().split(/\n\n+/); const block = blocks[blocks.length - 1].split('\n'); const status = Number(block[0].match(/\s(\d{3})(?:\s|$)/)?.[1]); assert(status === 200 || status === 206, 'probe status rejected');
  const allowed = new Set(['date', 'content-type', 'content-length', 'content-range', 'etag', 'last-modified', 'accept-ranges']); const headers: Json = {};
  for (const line of block.slice(1)) { const index = line.indexOf(':'); if (index < 1) continue; const key = line.slice(0, index).toLowerCase(); if (allowed.has(key)) headers[key] = line.slice(index + 1).trim(); }
  return { status, headers };
}
function transport(root: string, id: number): Json {
  const meta = fs.readFileSync(containedFile(root, `${id}.meta`, 'transport metadata'), 'utf8').trim().split('\n'); assert(meta.length === 4, 'curl metadata shape rejected');
  const effective = new URL(meta[0]); assert(effective.protocol === 'https:' && !effective.username && !effective.password && !effective.search && !effective.hash, 'effective URL must be credential-free HTTPS');
  const parsed = finalHeaders(fs.readFileSync(containedFile(root, `${id}.headers`, 'transport headers'), 'utf8'));
  assert(Number(meta[1]) === parsed.status && ['image/tiff', 'image/jpeg'].includes(meta[2]), 'transport metadata mismatch');
  return { effective_url: effective.toString(), status: parsed.status, content_type: meta[2], probe_bytes: Number(meta[3]), retained_headers: parsed.headers };
}
function sourceBodies(): Json[] {
  const ledger = readJson(SOURCE_LEDGER); return ['aerial_page', 'license_page', 'cc_by'].map(key => {
    const row = ledger.sources.find((source: Json) => source.key === key); assert(row?.verified, `source body ${key} missing`);
    return { source_id: key, predecessor_path: `docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/${row.snapshot_path}`, body_sha256: row.sha256, body_bytes: row.bytes,
      requested_url: row.requested_url, effective_url: row.final_url, rights_mode: 'tracked_public_snapshot', gate_e_review_status: 'held_pending_independent_bounded_proposition_review',
      allowed_support: key === 'aerial_page' ? ['collection_format_and_georeference_limitation_only'] : ['license_and_attribution_only'] };
  });
}
function artifacts(mediaRoot: string): Record<string, Json> {
  const manifest = parseManifest(); const candidates = selectedCandidates(); const components = new Set<string>();
  const records = candidates.map((candidate, index) => {
    const metadata = manifest.get(candidate.numeric_id); assert(metadata, `manifest row ${candidate.numeric_id} missing`); assert(!components.has(candidate.component_id), `duplicate component ${candidate.component_id}`); components.add(candidate.component_id);
    const mediaPath = containedFile(mediaRoot, `${candidate.numeric_id}.media`, 'media'); const raw = fs.readFileSync(mediaPath); const decode = decodeMedia(raw);
    const node = candidate.canonical_evidence ? JSON.parse(candidate.canonical_evidence.node.value_json) : null; const sourceUrl = node?.source_urls?.[0] ?? metadata.external_url; assert(sourceUrl === metadata.external_url, `official URL mismatch ${candidate.numeric_id}`);
    const receipt = transport(mediaRoot, candidate.numeric_id); const expectedEffective = new URL(sourceUrl); expectedEffective.protocol = 'https:'; assert(receipt.effective_url === expectedEffective.toString(), `effective URL substitution ${candidate.numeric_id}`);
    const predecessor = candidate.review_evidence.gold.disposition; const proposal = null;
    return { candidate_index: index + 1, numeric_id: candidate.numeric_id, record_id: candidate.record_id, component_id: candidate.component_id,
      cohort_role: index < 20 ? 'phase_d_selected' : 'component_distinct_reserve', phase_d_rank: candidate.reserve_rank ?? null,
      reserve_evidence: candidate.reserve_evidence ?? null,
      predecessor_disposition: predecessor, gate_f_disposition: 'held', disposition_preservation: predecessor === 'held' ? 'held_preserved' : 'acquisition_does_not_promote',
      official_metadata: { source_record_ids: node?.source_record_ids ?? [], collection_ids: metadata.aerial_datasets, flight_or_index_identifier: metadata.name, date: metadata.date_value, source_url: sourceUrl },
      mode_evidence: { value: candidate.selection_derivation?.image_mode_value ?? JSON.parse(candidate.review_evidence.gold.source_rows?.adjudication?.value_json ?? '{}').final_labels?.image_mode?.value ?? null, authority: 'phase_d_bound_visual_adjudication' },
      media: { private_member: `media/${candidate.numeric_id}.${decode.format === 'jpeg' ? 'jpg' : 'tif'}`, sha256: sha256(raw), bytes: raw.length, ...decode, transport: receipt },
      rights: { license_id: 'cc-by-4.0', attribution: 'Ville de Montreal; Archives de la Ville de Montreal', commercial_use_allowed: true, evidence_source_ids: ['license_page', 'cc_by'], limitation: 'Rights evidence does not establish pictured identity, location, scale, land use, or measurement.' },
      attribution: { required_text: metadata.credits || 'Archives de la Ville de Montreal', source_record_title: metadata.name },
      georeference_proposal: proposal, sequence_context: { status: 'proposal_not_authored', reason: 'No independently reviewed authoritative index/map body was available for a bounded sequence proposition.' },
      abstentions: Object.fromEntries(ABSTENTIONS.map(key => [key, { disposition: 'abstained', reason: key === 'measurement' ? 'No accepted georeference and scale evidence.' : 'No independently reviewed authoritative evidence supports this proposition.' }])),
      claim_boundary: { accepted_claims: 0, verified_dossier: false, accepted_tasks: 0 } };
  });
  const ledger = { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: 'candidate_held_external_review_required', predecessor_pins: [pin(PHASE_D), pin(PHASE_D_DESCRIPTOR), pin(GATE_E_DESCRIPTOR), pin(GATE_E_CANDIDATE), pin(GATE_E_RECEIPT), pin(SOURCE_DESCRIPTOR), pin(SOURCE_LEDGER), pin(MANIFEST)],
    selection_policy: { selected: 'all_20_phase_d_aerial_records', reserves: 'next_two_gold_ranked_promoted_aerial_records_after_excluding_all_phase_d_components' }, source_bodies: sourceBodies(),
    records, counts: { candidates: 22, components: components.size, phase_d_selected: 20, reserves: 2, predecessor_held_preserved: records.filter(r => r.disposition_preservation === 'held_preserved').length,
      media_bytes: records.reduce((sum, row) => sum + row.media.bytes, 0), exact_media_hashes: 22, decoded_media: 22, georeference_proposals: 0, accepted_coordinates: 0, accepted_measurements: 0, accepted_claims: 0, verified_dossiers: 0, tasks: 0 } };
  const archiveMembers = records.flatMap(row => { const receipt = json({ schema_version: 'aerial_acquisition_transport_receipt_v1.0.0', numeric_id: row.numeric_id, requested_url: row.official_metadata.source_url, media: { path: row.media.private_member, bytes: row.media.bytes, sha256: row.media.sha256 }, transport: row.media.transport }); return [{ path: row.media.private_member, bytes: row.media.bytes, sha256: row.media.sha256 }, { path: `receipts/${row.numeric_id}.json`, bytes: receipt.length, sha256: sha256(receipt) }]; });
  const archive = { schema_version: VERSION, artifact_id: ARTIFACT_ID, status: 'local_exact_bodies_verified_durable_archive_pending_coordinator', local_locator_template: '/private/path/aerial-source-evidence-v1-private-snapshot', durable_locator: null, archive_sha256: null, archive_bytes: null,
    media_tree_sha256: sha256(`${records.map(row => `${row.media.private_member}\t${row.media.sha256}\t${row.media.bytes}`).sort().join('\n')}\n`), media_bytes: ledger.counts.media_bytes, members: archiveMembers,
    archive_plan: { format: 'deterministic_tar_gzip', required_members: '22 exact official media bodies plus 22 sanitized transport receipts', upload_target_class: 'private_durable_object_store', coordinator_actions: ['package exact hash-bound members', 'upload without signed locator retention', 'read back and verify bytes/hash', 'author independent Gate E bounded source review receipt'] },
    security_boundary: { raw_headers_archived: false, cookies_archived: false, signed_urls_archived: false, query_values_archived: false } };
  const review = { schema_version: VERSION, artifact_id: ARTIFACT_ID, stage: 'independent_gate_e_source_review', status: 'not_started', candidate_descriptor_sha256: null, reviewer: null, reviewed_at: null,
    required_attestations: ['reviewer_is_independent_of_implementation', 'exact_hash_bound_bodies_reviewed', 'availability_and_metadata_are_not_location_support', 'no_georeference_without_three_distinct_control_points_and_authoritative_basis', 'no_measurement_without_accepted_georeference_and_scale'],
    dispositions: records.map(row => ({ numeric_id: row.numeric_id, source_body_disposition: 'held', location: 'abstained', scale: 'abstained', land_use: 'abstained', measurement: 'abstained', georeference_proposal: null, notes: '' })) };
  const status = { schema_version: VERSION, artifact_id: ARTIFACT_ID, issue: 90, issue_complete: false, authority_status: ledger.authority_status, production_mutation: false, paid_gpu_launched: false, counts: ledger.counts,
    externally_blocked: [{ subset: '22_candidate_source_body_dispositions', reason: 'Independent Gate E bounded review receipt has not been authored.' }, { subset: '946387779_bytes_private_snapshot', reason: 'Durable private upload and readback receipt require coordinator handling; cloud writes were prohibited.' }],
    limitations: ['Acquisition does not increase verified dossier count.', 'Official media URLs and metadata do not establish pictured location.', 'No georeference proposal, coordinate, scale, land-use proposition, or measurement is accepted.'] };
  return { 'evidence-ledger-v1.json': ledger, 'external-archive-descriptor-v1.json': archive, 'independent-source-review-receipt.template-v1.json': review, 'status-report-v1.json': status };
}
function validators(): Map<string, any> { const ajv = new Ajv2020({ allErrors: true, strict: false }); return new Map(fs.readdirSync(SCHEMAS).filter(x => x.endsWith('.json')).map(file => [file.replace('.schema', ''), ajv.compile(readJson(path.join(SCHEMAS, file)))])); }
function validate(name: string, value: Json, all = validators()): void { const check = all.get(name); assert(check && check(value), `${name} schema validation failed: ${JSON.stringify(check?.errors)}`); }
function memberRows(root: string): Json[] { return MEMBERS.map(name => { const raw = fs.readFileSync(path.join(root, name)); return { path: name, bytes: raw.length, sha256: sha256(raw) }; }); }
function descriptorFor(root: string): Json { const members = memberRows(root); return { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: 'candidate_held_external_review_required', created_at: CREATED_AT, production_mutation: false, authority_member: null, members, tree_sha256: sha256(`${members.map(row => `${row.path}\t${row.sha256}\t${row.bytes}`).join('\n')}\n`), registry_authority: 'candidate_only_not_published' }; }
function registryRow(descriptor: Json, root = FIXTURE): Json { const descriptorRaw = fs.readFileSync(path.join(root, 'descriptor-v1.json')); const allMembers = [...descriptor.members, { path: 'descriptor-v1.json', bytes: descriptorRaw.length, sha256: sha256(descriptorRaw) }].sort((a: Json, b: Json) => a.path.localeCompare(b.path)); const fileCount = allMembers.length; const byteCount = allMembers.reduce((sum: number, row: Json) => sum + row.bytes, 0); const registryDigest = sha256(`${allMembers.map((row: Json) => `${row.path}\t${row.sha256}\t${row.bytes}`).join('\n')}\n`); return { stable_id: REGISTRY_ID, schema_version: 'dataset_factory_artifact_registry_v0', artifact_schema_version: VERSION, artifact_kind: 'directory', content_digest: { algorithm: 'sha256', value: registryDigest, scope: 'sorted_tree_manifest' }, counts: { file_count: fileCount, byte_count: byteCount },
    source_lineage: { description: 'Issue #90 Gate F candidate-only aerial source evidence; 22 exact media bindings are held pending independent Gate E review and durable private archive receipt.', source_artifact_ids: ['dfv0_issue69_phase_d_scale_v1_20260713', 'dfv0_reviewed_source_evidence_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1'], source_urls: ['https://github.com/zouantchaw/mtl-archives-search/issues/90'] }, storage: { storage_class: 'tracked_repository', path_class: 'tracked_fixture', locator: FIXTURE_REL },
    generation: { method: 'external_snapshot', command: 'npm run dataset-factory:aerial-source-evidence-build-v1 -- --media-root /private/acquisition/root', code_ref: 'codex/90-aerial-source-evidence', human_input_ids: [], acquisition_boundary: 'Full public GET of 22 exact official media URLs. Large bodies and sanitized receipts remain private; tracked data contains hashes, sizes, decode facts, safe transport fields, and explicit abstentions only.' },
    dependency_ids: ['dfv0_issue69_phase_d_scale_v1_20260713', 'dfv0_reviewed_source_evidence_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1'], required_by: ['issue #90 independent source review and private archive publication'], rights_boundary: { license_id: 'cc-by-4.0', attribution: 'Ville de Montreal; Archives de la Ville de Montreal', commercial_use_allowed: true, notes: 'Exact large media are not tracked. Rights evidence supports reuse and attribution only; all location, scale, land-use, and measurement propositions abstain.' }, created_at: CREATED_AT, creation_time_basis: 'report_metadata' }; }
function writeBuild(root: string, mediaRoot: string): void { fs.mkdirSync(root, { recursive: true }); const values = artifacts(mediaRoot); const all = validators(); for (const [name, value] of Object.entries(values)) { validate(name, value, all); fs.writeFileSync(path.join(root, name), json(value)); } const descriptor = descriptorFor(root); validate('descriptor-v1.json', descriptor, all); fs.writeFileSync(path.join(root, 'descriptor-v1.json'), json(descriptor)); }
function verify(root = FIXTURE, mediaRoot?: string, registry = REGISTRY): Json {
  const allowed = [...MEMBERS, 'descriptor-v1.json'].sort(); assert(fs.readdirSync(root).sort().join('\n') === allowed.join('\n'), 'fixture member substitution rejected'); const all = validators(); for (const name of MEMBERS) validate(name, readJson(path.join(root, name)), all); const descriptor = readJson(path.join(root, 'descriptor-v1.json')); validate('descriptor-v1.json', descriptor, all); assert(JSON.stringify(descriptor) === JSON.stringify(descriptorFor(root)), 'descriptor/tree mismatch');
  const ledger = readJson(path.join(root, 'evidence-ledger-v1.json')); assert(ledger.records.length === 22 && new Set(ledger.records.map((r: Json) => r.component_id)).size === 22, 'candidate/component count mismatch'); assert(ledger.records.filter((r: Json) => r.disposition_preservation === 'held_preserved').length === 4, 'predecessor held decisions drift');
  for (const predecessor of ledger.predecessor_pins) assert(JSON.stringify(predecessor) === JSON.stringify(pin(containedFile(ROOT, predecessor.path, 'predecessor pin'))), `predecessor pin drift ${predecessor.path}`);
  assert(JSON.stringify(ledger.source_bodies) === JSON.stringify(sourceBodies()), 'source-body predecessor drift');
  const expectedCandidates = selectedCandidates(); assert(ledger.records.every((row: Json, index: number) => row.numeric_id === expectedCandidates[index].numeric_id && row.component_id === expectedCandidates[index].component_id), 'selection replay drift');
  for (const row of ledger.records) { assert(row.gate_f_disposition === 'held' && row.georeference_proposal === null, 'unsupported promotion/georeference rejected'); assert(ABSTENTIONS.every(key => row.abstentions[key]?.disposition === 'abstained'), 'required abstention missing'); if (mediaRoot) { const raw = fs.readFileSync(containedFile(mediaRoot, `${row.numeric_id}.media`, 'verification media')); assert(raw.length === row.media.bytes && sha256(raw) === row.media.sha256, `media substitution ${row.numeric_id}`); assert(JSON.stringify(decodeMedia(raw)) === JSON.stringify({ format: row.media.format, width: row.media.width, height: row.media.height }), `decode mismatch ${row.numeric_id}`); } }
  const registryRows = fs.readFileSync(registry, 'utf8').trim().split('\n').map(line => JSON.parse(line)); const rows = registryRows.filter(row => row.stable_id === REGISTRY_ID); assert(rows.length === 1 && JSON.stringify(rows[0]) === JSON.stringify(registryRow(descriptor, root)), 'candidate registry authority mismatch'); return ledger.counts;
}
function mutate(root: string, registry: string, label: string, edit: () => void, pattern: RegExp): void { edit(); let message = ''; try { verify(root, undefined, registry); } catch (error) { message = String(error); } assert(pattern.test(message), `${label} expected rejection, got ${message}`); }
function selfTest(): Json { const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-f-self-')); fs.cpSync(FIXTURE, path.join(temp, 'fixture'), { recursive: true }); fs.copyFileSync(REGISTRY, path.join(temp, 'registry.jsonl')); const root = path.join(temp, 'fixture'); const registry = path.join(temp, 'registry.jsonl');
  mutate(root, registry, 'component substitution', () => { const p = path.join(root, 'evidence-ledger-v1.json'); const v = readJson(p); v.records[1].component_id = v.records[0].component_id; fs.writeFileSync(p, json(v)); }, /descriptor\/tree mismatch|candidate\/component/);
  fs.rmSync(root, { recursive: true }); fs.cpSync(FIXTURE, root, { recursive: true }); mutate(root, registry, 'abstention tamper', () => { const p = path.join(root, 'evidence-ledger-v1.json'); const v = readJson(p); v.records[0].abstentions.scale.disposition = 'accepted'; fs.writeFileSync(p, json(v)); }, /schema validation|descriptor\/tree mismatch|required abstention/);
  fs.rmSync(root, { recursive: true }); fs.cpSync(FIXTURE, root, { recursive: true }); mutate(root, registry, 'registry authority substitution', () => { const lines = fs.readFileSync(registry, 'utf8').trim().split('\n').map(x => JSON.parse(x)); lines.find(x => x.stable_id === REGISTRY_ID).content_digest.value = '0'.repeat(64); fs.writeFileSync(registry, `${lines.map(x => JSON.stringify(x)).join('\n')}\n`); }, /registry authority mismatch/);
  const containment = path.join(temp, 'containment'); fs.mkdirSync(containment); fs.writeFileSync(path.join(temp, 'outside'), 'private'); fs.symlinkSync(path.join(temp, 'outside'), path.join(containment, 'linked')); let containmentError = ''; try { containedFile(containment, 'linked', 'self-test'); } catch (error) { containmentError = String(error); } assert(/symlink rejected/.test(containmentError), 'symlink containment test failed');
  fs.rmSync(temp, { recursive: true }); return { tests: 4, status: 'passed' }; }
function integration(mediaRoot: string): Json { const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-f-integration-')); const fixture = path.join(temp, 'fixture'); writeBuild(fixture, mediaRoot); for (const name of [...MEMBERS, 'descriptor-v1.json']) assert(fs.readFileSync(path.join(fixture, name)).equals(fs.readFileSync(path.join(FIXTURE, name))), `integration drift ${name}`); fs.rmSync(temp, { recursive: true }); return { files: 5, status: 'byte_identical' }; }

const parsed = parseArgs({ allowPositionals: true, options: { 'media-root': { type: 'string' } } }); const command = parsed.positionals[0] ?? 'verify'; const mediaRoot = parsed.values['media-root'];
if (command === 'build') { assert(mediaRoot, '--media-root is required'); assert(!fs.existsSync(path.join(FIXTURE, 'descriptor-v1.json')), 'published candidate fixture exists; refusing overwrite'); writeBuild(FIXTURE, mediaRoot); console.log(JSON.stringify({ status: 'built_candidate', root: FIXTURE_REL })); }
else if (command === 'refresh-candidate') { assert(mediaRoot, '--media-root is required'); assert(readJson(path.join(FIXTURE, 'descriptor-v1.json')).authority_status === 'candidate_held_external_review_required', 'only candidate authority may be refreshed'); writeBuild(FIXTURE, mediaRoot); console.log(JSON.stringify({ status: 'refreshed_candidate', root: FIXTURE_REL })); }
else if (command === 'verify') console.log(JSON.stringify({ status: 'verified', counts: verify(FIXTURE, mediaRoot) }));
else if (command === 'seal-registry') { const descriptor = readJson(path.join(FIXTURE, 'descriptor-v1.json')); const rows = fs.readFileSync(REGISTRY, 'utf8').trim().split('\n').map(line => JSON.parse(line)); const filtered = rows.filter(row => row.stable_id !== REGISTRY_ID); filtered.push(registryRow(descriptor)); fs.writeFileSync(REGISTRY, `${filtered.map(row => JSON.stringify(row)).join('\n')}\n`); console.log(JSON.stringify({ status: 'candidate_registry_row_sealed', stable_id: REGISTRY_ID })); }
else if (command === 'self-test') console.log(JSON.stringify(selfTest()));
else if (command === 'integration-test') { assert(mediaRoot, '--media-root is required'); console.log(JSON.stringify(integration(mediaRoot))); }
else throw new Error(`unknown command: ${command}`);
