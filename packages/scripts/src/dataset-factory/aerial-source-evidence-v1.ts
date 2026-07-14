import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { parse as parseCsv } from 'csv-parse/sync';
import sharp from 'sharp';

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
const VERSION = 'aerial_source_evidence_v1.1.0';
const LEGACY_REVIEW_VERSION = 'aerial_source_evidence_v1.0.0';
const ARTIFACT_ID = 'aerial-source-evidence-v1';
const REGISTRY_ID = 'dfv0_aerial_source_evidence_v1_candidate';
const CREATED_AT = '2026-07-14T05:52:31.000Z';
const SOURCE_ROOT_DEFAULT = '/tmp/issue90-gate-f-remediation-sources-v1';
const BASE_MEMBERS = ['evidence-ledger-v1.json', 'source-body-evidence-v1.json', 'external-archive-descriptor-v1.json', 'independent-source-review-receipt.template-v1.json', 'status-report-v1.json'] as const;
const ABSTENTIONS = ['exact_location', 'scale', 'footprint', 'area', 'acreage', 'distance', 'land_use', 'measurement'] as const;
const REQUIRED_ATTESTATIONS = [
  'reviewer_is_independent_of_implementation',
  'exact_hash_bound_bodies_reviewed',
  'availability_and_metadata_are_not_location_support',
  'no_georeference_without_three_distinct_control_points_and_authoritative_basis',
  'no_measurement_without_accepted_georeference_and_scale',
] as const;

const packageSpecs = [
  { key: 'oblique-1960-1992', file: 'package-oblique-1960-1992.json', packageId: '57f56aa9-1284-42d0-8b1a-336e66cd6de9', familyId: 'archives-montreal-oblique-1960-1992', mode: 'aerial_oblique' },
  { key: 'vertical-1958-1975', file: 'package-vertical-1958-1975.json', packageId: '6555c320-77bf-4478-a3d2-c29733a7046c', familyId: 'archives-montreal-vertical-1958-1975', mode: 'aerial_vertical' },
  { key: 'vertical-1947-1949', file: 'package-vertical-1947-1949.json', packageId: '446b4220-6928-42eb-8d95-da0c67f22bc8', familyId: 'archives-montreal-vertical-1947-1949', mode: 'aerial_vertical' },
] as const;
const csvSpecs = [
  { key: 'oblique-1960-1992', file: 'rows-oblique-1960-1992.csv', resourceId: '0ef12a2f-da90-49fb-8c46-89024edece54', packageKey: 'oblique-1960-1992' },
  { key: 'vertical-1947-1949', file: 'rows-vertical-1947-1949.csv', resourceId: '09a0893e-3142-4950-8c54-1250540bde13', packageKey: 'vertical-1947-1949' },
  { key: 'vertical-1958', file: 'rows-vertical-1958.csv', resourceId: '9ab0c8c1-f4f3-4ea9-b6d5-d10018cebda2', packageKey: 'vertical-1958-1975' },
  { key: 'vertical-1962', file: 'rows-vertical-1962.csv', resourceId: 'eff33c42-bad4-4d8c-9059-28e4b425b7e2', packageKey: 'vertical-1958-1975' },
  { key: 'vertical-1964', file: 'rows-vertical-1964.csv', resourceId: 'c6e12ed5-8a9d-4559-a96c-f50689a41c44', packageKey: 'vertical-1958-1975' },
  { key: 'vertical-1966', file: 'rows-vertical-1966.csv', resourceId: '379921f4-1991-4a08-b900-0a72453ae28a', packageKey: 'vertical-1958-1975' },
  { key: 'vertical-1971', file: 'rows-vertical-1971.csv', resourceId: 'd259d85d-a7ac-4ebd-8843-2ac6fd611017', packageKey: 'vertical-1958-1975' },
] as const;
const SOURCE_BODY_SHA256: Record<string, string> = {
  'package-oblique-1960-1992.json': '08c49423cd603de776034ddced8a7204266eb3f206a84e40a7fb566f534e25f6',
  'package-vertical-1947-1949.json': '6d3cf41d58d091e38d219b938d2167ea28b0d1369f6583fbddac569c47c145d6',
  'package-vertical-1958-1975.json': '227f3cfc8d09946218566b21fee78472c5ca354f467cf5bcec0193d68ec9fb24',
  'rows-oblique-1960-1992.csv': '7e26894578eb8a8f2fd032b0e9ea752f0e2ba5e4fd4f285c6928d2c6c33d0c65',
  'rows-vertical-1947-1949.csv': '9a51bad0f5ba54ab4426bad9904ca12040705ae711370d31d0f05dc7c337b86b',
  'rows-vertical-1958.csv': 'd89f8aa79354d48c07d5ad3844decc0cb23203888d021b07417c7a1e42371822',
  'rows-vertical-1962.csv': 'f596939734917013c0484085c58d2c129272b454b351b052974067e804358f05',
  'rows-vertical-1964.csv': 'f637c1524f48aed31ece01acc97371f45ef905a61b1d0ec45ee64d7bce461ce2',
  'rows-vertical-1966.csv': 'd2b722f6461beb9dd208835ec80240188a8b58da7ec2cb647ec19d2c8ba9a248',
  'rows-vertical-1971.csv': 'd86e72ba77219f2245abaa6a711dd363cad6886707716f1dca56a899d341b8b1',
};
const SOURCE_ROW_SHA256: Record<number, string> = {
  8132: 'ed451cf7ed3ea613c5292ca04a6bf5613cec830b14ab51cb0e7043c4ca35b15d', 8134: '3f9cc82f1b9f015c4545e2095c87ed87af8b3e902be4eb670f6fe71f5cf02d3a',
  8139: 'dbccdcc9f249a4bab1fd6a0e2c5480446a39d7003707fe8593cc93c65f411749', 8143: '00e6c547b96a4dc934ff6b01f1465001286eb9e17a19a28042666ea0f0413abf',
  12115: '95dbe730f8d4e338fa9bc373c3b446ac7cbbaeec73fbc0065b52b66b2f3b40c1', 11923: 'a8934d4c842ba89674ab7c6373ce4b93551bafbbff8d772089e232a63539c779',
  4501: '6ed8db65d7710e19ee5cb0754a6b52c51d9a1e145fcb5da9f4a474594a626832', 14135: 'a7fa8a53653bbbd9fc197534417247c5ea396ce61a89458a2e50c4020a6d73d0',
  12623: '2f4f16dd6ccdd92afce42173dab997712440a3b81983cced86266dd30b66026d', 7929: 'b74306e2cb9389e635df68607ca3975c683bcbafbfd0a71c9e63650b1e64a5c1',
  9844: 'efe802741eb63a4e1d7ff05be36c6443edc7f5789bf97339a6704e340652c70b', 9092: '932a8c8c9371169ac4250b30bfdbdc96c0a14efd4df5df2c86b015152d3b37f0',
  13389: 'b994ffd2e0d267bb9a798de3bd0491a3a2964f506ba292a9af395e30b484e444', 14965: 'b8dc8aef932eac1f8d7c15df282b3b7d80a4426443bbf6a1c558f331453e33fb',
  11836: '8bdb76ea3ada051d0073f3a5b9f0e7bf04c90142cbcd282810f1967543de565e', 11993: '0816f6fbe904c80590cdf8fd90ea1c619ed84be7dc3e11aa1b692677338a77c0',
  8432: 'c218bbb8a7625f355a3d4d019f66b02a206d16cd66edeb434c1bb6e0dfba70cb', 13272: 'a0ce248e062880494d75ec34f0c1fd06e9eea46fa332303fb82628ed0ab70005',
  14813: '2c01c1a6534ef8bf7bbf5743849880d369785a08ba52bb26bd2a70dbb8978b58', 12117: '5fc9f3044b8e01c089316a056e21de34223f640a85f4787a0d3256e437edb144',
  10153: '1b47b34f82e504e801a8659e1b5b9e03534ce84b34455105e81f61cc3ed5cf66', 9504: '259131983c88e384b05eb6e086e02e2ed7592817abef906ce23b2bb1a14412c8',
};

const MEDIA_PINS: Record<number, Json> = {
  8132: { sha256: 'f2e2a4f9dafcded0e87ab91c0e5097a94a449039c3d8e1dea3a53ee34ff85551', bytes: 107535752, format: 'tiff', width: 10416, height: 10316 },
  8134: { sha256: 'de64604425fe320a1130c5fd7426b84077854bafcf3994071270b4ce1fb085fd', bytes: 108919438, format: 'tiff', width: 10482, height: 10383 },
  8139: { sha256: 'a9c3e380e032c8f5d6a9901d75b2f98f6b24bb3b357784444801b33ea0715404', bytes: 109255118, format: 'tiff', width: 10482, height: 10415 },
  8143: { sha256: '8ace22de80fcf88c1fd5cda0e0cf6c3e83be15a7009973e28d9c5d3dd76659c1', bytes: 108566342, format: 'tiff', width: 10449, height: 10382 },
  12115: { sha256: 'c514c7fc1184a32c4e2ee44367d304ca101ed4c8fa9d9fe8fe2392f0f1b468a9', bytes: 12938326, format: 'tiff', width: 2051, height: 2100 },
  11923: { sha256: '5d617a188f065466c9a42ad7a179b47c7263942246e912bb388bcd4cea5dd523', bytes: 8534950, format: 'tiff', width: 2100, height: 1353 },
  4501: { sha256: '86582e5411fddbf48272b219a7b5d6184f084c1d1acd9b0daa21c68c5997a18f', bytes: 3741223, format: 'jpeg', width: 3221, height: 3300 },
  14135: { sha256: '5b5fcbf59faab579d0afef8b664dc1cacffba8d04adb09accb80976197582541', bytes: 13152526, format: 'tiff', width: 2085, height: 2100 },
  12623: { sha256: '4f3ddefe41aa67674051ac7ac6d1e64a2c1715006e75e6ecbe0be77a77217067', bytes: 13095826, format: 'tiff', width: 2076, height: 2100 },
  7929: { sha256: '14138db47ebf2868cba449d1bdd5159db2181d33e0871d7f459b765276d77e22', bytes: 3047708, format: 'jpeg', width: 3115, height: 3300 },
  9844: { sha256: '25a75fe80890dea3aff8b6c3f8c787b76e12c23e241213a96e404e0e09127275', bytes: 78209348, format: 'tiff', width: 8503, height: 9189 },
  9092: { sha256: 'f287a29536244aca762b2c0c26d0909b510807ce3499b0f33090d26afab323ac', bytes: 72192268, format: 'tiff', width: 8492, height: 8493 },
  13389: { sha256: '1e5ec15a345ebe71ead8eeab6409b18d1dfea363e75b59065523eaf905e125c4', bytes: 12976126, format: 'tiff', width: 2057, height: 2100 },
  14965: { sha256: 'c6211182896856b4f2ed45e41bc5ae5e254bbd94c032754d033db0bb832ea25f', bytes: 13209178, format: 'tiff', width: 2100, height: 2094 },
  11836: { sha256: '6bb0e7710840b526050fee1c8585ab7c852b7ee525e04f110157d7ddc6774bd2', bytes: 10376886, format: 'tiff', width: 2100, height: 1645 },
  11993: { sha256: '852c0b95a400cd25a51df27186642de08e9cd0831fdcde1bfdcb1b64fa02549a', bytes: 13196626, format: 'tiff', width: 2092, height: 2100 },
  8432: { sha256: 'd10f46b494b3b3d5bbbe46b7a760f18805e5a08bdf3ad211c5e9926841f28754', bytes: 69615748, format: 'tiff', width: 8332, height: 8347 },
  13272: { sha256: '223044f7618dca8bada2c32c64bab88cb9f83fc9363d546f07a288c53b094518', bytes: 12755002, format: 'tiff', width: 2100, height: 2022 },
  14813: { sha256: 'a27b3e89a270f1828c30f5a75bbacf4b2985fe683d0fe2ec1b4e1e8eef1f406b', bytes: 13032826, format: 'tiff', width: 2066, height: 2100 },
  12117: { sha256: '29373b7799d4c6e45e97b611c36e7414562ad214e2638213a16ca5e6cffddddc', bytes: 13221826, format: 'tiff', width: 2096, height: 2100 },
  10153: { sha256: '5925b241ee7eb9c7ec496359300a685ef78937d150a76822f3d2f3411f0dc938', bytes: 73038728, format: 'tiff', width: 8180, height: 8920 },
  9504: { sha256: '553317df568fa46d3d78dd781b8f99634dcde2d22b36af233b24ee98e3686bf8', bytes: 75776008, format: 'tiff', width: 8328, height: 9090 },
};

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value: Buffer | string): string => crypto.createHash('sha256').update(value).digest('hex');
const readJson = (file: string): Json => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const json = (value: unknown): Buffer => Buffer.from(canonical(value));
const writeJson = (file: string, value: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, json(value)); };
const binding = (file: string, relative = path.basename(file)): Json => { const raw = fs.readFileSync(file); return { path: relative, bytes: raw.length, sha256: sha256(raw) }; };
const pin = (file: string): Json => binding(file, path.relative(ROOT, file).split(path.sep).join('/'));
const treeHash = (members: Json[]): string => sha256(`${members.map(row => `${row.path}\t${row.sha256}\t${row.bytes}`).join('\n')}\n`);

function safeRelative(value: string, label: string): string {
  assert(value.length > 0 && !path.isAbsolute(value) && !value.includes('\\'), `${label}: unsafe path`);
  assert(path.posix.normalize(value) === value && value !== '..' && !value.split('/').includes('..'), `${label}: traversal`);
  return value;
}
function containedFile(root: string, relative: string, label: string): string {
  safeRelative(relative, label); const rootReal = fs.realpathSync(root); const target = path.join(rootReal, relative); let cursor = target;
  while (cursor !== rootReal) { assert(fs.existsSync(cursor), `${label}: missing`); assert(!fs.lstatSync(cursor).isSymbolicLink(), `${label}: symlink rejected`); cursor = path.dirname(cursor); }
  assert(fs.lstatSync(target).isFile(), `${label}: regular file required`); return target;
}
function stableExternalFile(file: string): Buffer {
  const absolute = path.resolve(file); assert(absolute === file, 'external input must be normalized absolute path'); const before = fs.lstatSync(absolute);
  assert(before.isFile() && !before.isSymbolicLink(), 'external input symlink/non-file rejected'); const raw = fs.readFileSync(absolute); const after = fs.lstatSync(absolute);
  assert(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'external input changed while reading'); return raw;
}
function predecessorPins(): Json[] { return [PHASE_D, PHASE_D_DESCRIPTOR, GATE_E_DESCRIPTOR, GATE_E_CANDIDATE, GATE_E_RECEIPT, SOURCE_DESCRIPTOR, SOURCE_LEDGER, MANIFEST].map(pin); }
function parseManifest(): Map<number, Json> {
  return new Map(fs.readFileSync(MANIFEST, 'utf8').trim().split('\n').map(line => { const row = JSON.parse(line); const match = row.metadata_filename.match(/_(\d+)\.json$/); assert(match, 'manifest record id missing'); return [Number(match[1]), row]; }));
}
function selectedCandidates(): Json[] {
  const phase = readJson(PHASE_D); const selected = phase.records.filter((row: Json) => row.primary_stratum === 'aerial'); assert(selected.length === 20, 'Phase D aerial count drift');
  const used = new Set(phase.records.map((row: Json) => row.component_id));
  const eligible = phase.selection_replay_inputs.gold_candidates.map((row: Json) => ({ row, selection: JSON.parse(row.selection.value_json), adjudication: JSON.parse(row.adjudication.value_json) }))
    .filter(({ selection, adjudication }: Json) => adjudication.disposition === 'promoted' && ['aerial_vertical', 'aerial_oblique'].includes(adjudication.final_labels?.image_mode?.value) && !used.has(selection.component_id))
    .sort((a: Json, b: Json) => a.selection.rank - b.selection.rank || a.selection.record_id.localeCompare(b.selection.record_id));
  assert(eligible.length >= 2, 'fewer than two component-distinct reserves');
  const reserves = eligible.slice(0, 2).map(({ row, selection, adjudication }: Json) => ({ numeric_id: Number(selection.record_id.match(/_(\d+)\.json$/)[1]), record_id: selection.record_id, component_id: selection.component_id, primary_stratum: 'aerial', reserve_rank: selection.rank,
    reserve_evidence: { neutral_id: selection.neutral_id, component_size: selection.component_size, split: selection.split, quality_failure: adjudication.final_labels.quality_failure, needs_human_review: adjudication.final_labels.needs_human_review, component_exclusion: 'entire_component_excluded_from_all_other_gate_f_candidates', sibling_id_status: 'held_pending_authenticated_graph_restore' },
    review_evidence: { gold: { disposition: adjudication.disposition, source_rows: row } } }));
  return [...selected, ...reserves];
}
function finalHeaders(raw: Buffer): Json {
  const blocks = raw.toString('latin1').replace(/\r/g, '').trim().split(/\n\n+/); const lines = blocks.at(-1)!.split('\n'); const status = Number(lines[0].match(/\s(\d{3})(?:\s|$)/)?.[1]); assert(status === 200 || status === 206, 'response status rejected');
  const allowed = new Set(['date', 'content-type', 'content-length', 'content-range', 'etag', 'last-modified', 'accept-ranges']); const headers: Json = {};
  for (const line of lines.slice(1)) { assert(!/^[ \t]/.test(line), 'folded header rejected'); const at = line.indexOf(':'); if (at < 1) continue; const key = line.slice(0, at).toLowerCase(); if (allowed.has(key)) { assert(headers[key] === undefined, `duplicate retained header ${key}`); headers[key] = line.slice(at + 1).trim(); } }
  return { status, headers };
}
function transport(root: string, id: number, media: Buffer, format: string): Json {
  const metaRaw = stableExternalFile(containedFile(root, `${id}.meta`, 'transport metadata')); const headerRaw = stableExternalFile(containedFile(root, `${id}.headers`, 'transport headers')); const probeRaw = stableExternalFile(containedFile(root, `${id}.probe`, 'transport probe'));
  const lines = metaRaw.toString('utf8').trim().split('\n'); assert(lines.length === 4, 'curl metadata shape rejected'); const effective = new URL(lines[0]); assert(effective.protocol === 'https:' && !effective.username && !effective.password && !effective.search && !effective.hash, 'effective URL must be credential-free HTTPS');
  const parsed = finalHeaders(headerRaw), status = Number(lines[1]), contentType = lines[2].split(';')[0].trim().toLowerCase(), downloaded = Number(lines[3]);
  const isTiff = format === 'tiff'; assert(status === parsed.status && status === (isTiff ? 206 : 200) && ['image/tiff', 'image/jpeg'].includes(contentType) && downloaded === probeRaw.length, 'probe response transport mismatch');
  assert(isTiff ? probeRaw.length > 0 && probeRaw.length <= media.length && media.subarray(0, probeRaw.length).equals(probeRaw) : probeRaw.equals(media), `probe/media binding mismatch ${id}`);
  return { effective_url: effective.toString(), status, content_type: contentType, response_bytes: downloaded, retained_headers: parsed.headers,
    raw_audit_digests: { meta: { bytes: metaRaw.length, sha256: sha256(metaRaw) }, headers: { bytes: headerRaw.length, sha256: sha256(headerRaw) }, probe: { bytes: probeRaw.length, sha256: sha256(probeRaw) } },
    probe_binding: { mode: isTiff ? 'exact_media_prefix_range' : 'exact_full_media_body', media_offset: 0, bytes: probeRaw.length, sha256: sha256(probeRaw) } };
}
async function decodeMedia(file: string, expected?: Json): Promise<Json> {
  const image = sharp(file, { failOn: 'error', limitInputPixels: false, sequentialRead: true }); const metadata = await image.metadata(); await image.stats();
  const format = metadata.format === 'tiff' ? 'tiff' : metadata.format === 'jpeg' ? 'jpeg' : null; assert(format && metadata.width && metadata.height, 'unsupported media or dimensions missing');
  const result = { format, width: metadata.width, height: metadata.height, header_dimensions_verified: true, pixel_decode_verified: true, decoder: `sharp-${sharp.versions.sharp}/libvips-${sharp.versions.vips}` };
  if (expected) assert(result.format === expected.format && result.width === expected.width && result.height === expected.height, 'full pixel decode metadata mismatch'); return result;
}
function applicableCsvKey(mode: string, date: string, sourceUrl: string): string {
  if (mode === 'aerial_oblique') return 'oblique-1960-1992'; if (sourceUrl.includes('vues-aeriennes-archives')) return 'vertical-1947-1949'; const year = String(date).match(/\b(1958|1962|1964|1966|1971)\b/)?.[1]; assert(year, `unsupported vertical year ${date}`); return `vertical-${year}`;
}
function field(value: unknown, presentStatus = 'present_exact_row'): Json { const text = String(value ?? '').trim(); return text ? { status: presentStatus, value: text } : { status: 'missing_in_applicable_csv_row', value: null }; }
function proposition(id: string, text: string): Json { return { proposition_id: id, exact_text: text, text_sha256: sha256(text), review_status: 'held_pending_independent_bounded_proposition_review' }; }
function mediaCallNumber(sourceUrl: string): string { return decodeURIComponent(new URL(sourceUrl).pathname.split('/').at(-1)!).replace(/\.(?:tiff?|jpe?g)$/i, ''); }
function obliqueLogicalRow(rows: Json[], index: number, sourceUrl: string): Json {
  const row = rows[index]; let context = row;
  for (let cursor = index; cursor >= 0 && !String(context['Cote (reportage)'] ?? '').trim(); cursor--) context = rows[cursor];
  assert(String(context['Cote (reportage)'] ?? '').trim(), `oblique reportage context missing ${sourceUrl}`);
  const combined = String(context['Titre / Photographe / Dates'] ?? '').trim();
  const match = /^(.*?)\s*\/\s*(.*?)\s*\.\s*-\s*(.+)$/s.exec(combined); assert(match, `oblique title/photographer/date parse failed ${sourceUrl}`);
  return {
    cote: field(context['Cote (reportage)'], 'present_reportage_scope'),
    media_call_number: field(mediaCallNumber(sourceUrl), 'present_exact_media_url_path'),
    titre: field(match[1], 'present_reportage_scope'),
    date: field(match[3], 'present_reportage_scope'),
    photographer: field(match[2], 'present_reportage_scope'),
    description: field(context.Description, 'present_reportage_scope'),
    media_url: sourceUrl,
    csv_credit_field: field(row['Mention de crédits'], 'placeholder_not_complete_attribution'),
  };
}
function verticalLogicalRow(row: Json, sourceUrl: string): Json {
  const names = Object.keys(row), pick = (pattern: RegExp) => row[names.find(name => pattern.test(name)) ?? ''];
  return {
    cote: field(pick(/^cote\/?titre/i)), media_call_number: field(mediaCallNumber(sourceUrl), 'present_exact_media_url_path'),
    titre: field(null), date: field(pick(/^date/i)), photographer: field(null), description: field(null), media_url: sourceUrl,
    csv_credit_field: field(pick(/cr[eé]dit/i)),
  };
}
function buildSourceEvidence(sourceRoot: string, recordInputs: Json[]): Json {
  const packages = packageSpecs.map(spec => { const raw = stableExternalFile(path.join(sourceRoot, spec.file)), bodyHash = sha256(raw); assert(bodyHash === SOURCE_BODY_SHA256[spec.file], `package body pin drift ${spec.key}`); const body = JSON.parse(raw.toString('utf8')); assert(body.success === true && body.result.id === spec.packageId, `package substitution ${spec.key}`); const result = body.result;
    assert(result.license_id === 'cc-by' && result.license_title === 'Creative Commons Attribution 4.0 International' && result.author === 'Service du greffe - Section des archives' && result.notes.includes('Archives de la Ville de Montréal'), `package rights/credit drift ${spec.key}`);
    return { source_id: `ckan-package-${spec.packageId}`, source_family_id: spec.familyId, private_body: { path: spec.file, bytes: raw.length, sha256: sha256(raw) }, requested_url: `https://donnees.montreal.ca/api/3/action/package_show?id=${spec.packageId}`, rights_mode: 'private_exact_public_body_with_tracked_bounded_representation',
      collection: { package_id: spec.packageId, title: result.title, author: result.author, license_id: result.license_id, license_title: result.license_title, exact_required_credit: 'Archives de la Ville de Montréal', resource_ids: result.resources.map((resource: Json) => resource.id).sort() },
      propositions: [proposition(`${spec.key}:collection`, result.title), proposition(`${spec.key}:license`, `${result.license_id}|${result.license_title}`), proposition(`${spec.key}:credit`, 'Archives de la Ville de Montréal')] };
  });
  const packageByKey = new Map(packageSpecs.map((spec, index) => [spec.key, packages[index]])); const csvCache = new Map<string, Json>();
  for (const spec of csvSpecs) { const raw = stableExternalFile(path.join(sourceRoot, spec.file)); assert(sha256(raw) === SOURCE_BODY_SHA256[spec.file], `CSV body pin drift ${spec.key}`); const rows = parseCsv(raw, { columns: true, bom: true, relax_column_count: true, skip_empty_lines: true }); csvCache.set(spec.key, { spec, raw, rows }); }
  const rows = recordInputs.map(input => { const key = applicableCsvKey(input.mode, input.date, input.source_url), cached = csvCache.get(key); assert(cached, `CSV source missing ${key}`); const urlColumn = Object.keys(cached.rows[0]).find((name: string) => /hyper|fichier|lien/i.test(name)); assert(urlColumn, `CSV URL column missing ${key}`);
    const indexes = cached.rows.map((row: Json, index: number) => String(row[urlColumn]).trim() === input.source_url ? index : -1).filter((index: number) => index >= 0); assert(indexes.length === 1, `CSV exact media row coverage ${input.numeric_id}: ${indexes.length}`); const row = cached.rows[indexes[0]], structured = key === 'oblique-1960-1992' ? obliqueLogicalRow(cached.rows, indexes[0], input.source_url) : verticalLogicalRow(row, input.source_url); const rowCanonical = canonical(structured);
    assert(sha256(rowCanonical) === SOURCE_ROW_SHA256[input.numeric_id], `structured source row pin drift ${input.numeric_id}`); const csvSpec = cached.spec, packageBody = packageByKey.get(csvSpec.packageKey); assert(packageBody && packageBody.collection.resource_ids.includes(csvSpec.resourceId), `package resource missing ${csvSpec.resourceId}`); return { numeric_id: input.numeric_id, source_family_id: packageBody.source_family_id, package_source_id: packageBody.source_id, resource_id: csvSpec.resourceId,
      private_csv_body: { path: csvSpec.file, bytes: cached.raw.length, sha256: sha256(cached.raw) }, exact_row: structured, exact_row_sha256: sha256(rowCanonical), exact_row_bytes: Buffer.byteLength(rowCanonical),
      bounded_propositions: [proposition(`${input.numeric_id}:record-media-identity`, `${input.numeric_id}|${input.source_url}|${structured.cote.value ?? 'missing'}|${structured.date.value ?? 'missing'}`)], review_status: 'held_pending_independent_bounded_proposition_review' };
  });
  return { schema_version: VERSION, artifact_id: ARTIFACT_ID, exact_private_source_root: SOURCE_ROOT_DEFAULT, exact_bodies_tracked: false,
    oblique_published_physical_schema: ['Cote (reportage)', 'Titre / Photographe / Dates', 'Description', 'Fichiers TIFF - 300 dpi (CLIQUEZ SUR LE LIEN)', 'Mention de crédits'],
    oblique_logical_schema: ['Cote', 'Titre', 'Date', 'Nom du photographe', 'Description', 'Hyperliens', 'Mention de crédits'], packages, record_rows: rows };
}
function sourceInputs(candidates: Json[], manifest: Map<number, Json>): Json[] { return candidates.map(candidate => { const metadata = manifest.get(candidate.numeric_id); assert(metadata, `manifest row ${candidate.numeric_id} missing`); const node = candidate.canonical_evidence ? JSON.parse(candidate.canonical_evidence.node.value_json) : null; const sourceUrl = node?.source_urls?.[0] ?? metadata.external_url; const mode = candidate.selection_derivation?.image_mode_value ?? JSON.parse(candidate.review_evidence.gold.source_rows?.adjudication?.value_json ?? '{}').final_labels?.image_mode?.value; return { numeric_id: candidate.numeric_id, source_url: sourceUrl, mode, date: metadata.date_value ?? '' }; }); }
function sanitizedReceipt(row: Json): Buffer { return json({ schema_version: 'aerial_acquisition_transport_receipt_v1.1.0', numeric_id: row.numeric_id, requested_url: row.official_metadata.source_url, media: { path: row.media.private_member, bytes: row.media.bytes, sha256: row.media.sha256 }, transport: row.media.transport }); }
function archiveMembers(records: Json[]): Json[] { return records.flatMap(row => { const receipt = sanitizedReceipt(row); return [{ path: row.media.private_member, bytes: row.media.bytes, sha256: row.media.sha256, member_kind: 'exact_official_media' }, { path: `receipts/${row.numeric_id}.json`, bytes: receipt.length, sha256: sha256(receipt), member_kind: 'sanitized_transport_receipt' }]; }).sort((a, b) => a.path.localeCompare(b.path)); }
function legacyReviewTemplate(records: Json[]): Json { return { schema_version: LEGACY_REVIEW_VERSION, artifact_id: ARTIFACT_ID, stage: 'independent_gate_e_source_review', status: 'not_started', candidate_descriptor_sha256: null, reviewer: null, reviewed_at: null,
  required_attestations: [...REQUIRED_ATTESTATIONS], dispositions: records.map(row => ({ numeric_id: row.numeric_id, source_body_disposition: 'held', location: 'abstained', scale: 'abstained', land_use: 'abstained', measurement: 'abstained', georeference_proposal: null, notes: '' })) }; }
async function candidateArtifacts(mediaRoot: string, sourceRoot: string): Promise<Record<string, Json>> {
  const manifest = parseManifest(), candidates = selectedCandidates(), inputs = sourceInputs(candidates, manifest), sources = buildSourceEvidence(sourceRoot, inputs), sourceRows = new Map<number, Json>(sources.record_rows.map((row: Json) => [row.numeric_id, row])), components = new Set<string>();
  const records: Json[] = [];
  for (let index = 0; index < candidates.length; index++) { const candidate = candidates[index], metadata = manifest.get(candidate.numeric_id); assert(metadata, 'manifest row missing'); assert(!components.has(candidate.component_id), `duplicate component ${candidate.component_id}`); components.add(candidate.component_id);
    const mediaFile = containedFile(mediaRoot, `${candidate.numeric_id}.media`, 'media'), raw = stableExternalFile(mediaFile), decode = await decodeMedia(mediaFile), mediaPin = MEDIA_PINS[candidate.numeric_id]; assert(mediaPin && canonical({ sha256: sha256(raw), bytes: raw.length, format: decode.format, width: decode.width, height: decode.height }) === canonical(mediaPin), `immutable media pin drift ${candidate.numeric_id}`); const input = inputs[index], expectedEffective = new URL(input.source_url); expectedEffective.protocol = 'https:'; const receipt = transport(mediaRoot, candidate.numeric_id, raw, decode.format); assert(receipt.effective_url === expectedEffective.toString(), `effective URL substitution ${candidate.numeric_id}`);
    const node = candidate.canonical_evidence ? JSON.parse(candidate.canonical_evidence.node.value_json) : null, predecessor = candidate.review_evidence.gold.disposition, sourceRow = sourceRows.get(candidate.numeric_id); assert(sourceRow, 'source row binding missing');
    records.push({ candidate_index: index + 1, numeric_id: candidate.numeric_id, record_id: candidate.record_id, component_id: candidate.component_id, cohort_role: index < 20 ? 'phase_d_selected' : 'component_distinct_reserve', phase_d_rank: candidate.reserve_rank ?? null, reserve_evidence: candidate.reserve_evidence ?? null, predecessor_disposition: predecessor, gate_f_disposition: 'held', disposition_preservation: predecessor === 'held' ? 'held_preserved' : 'acquisition_does_not_promote',
      official_metadata: { source_record_ids: node?.source_record_ids ?? [], collection_ids: metadata.aerial_datasets ?? [], flight_or_index_identifier: sourceRow.exact_row.media_call_number, date: sourceRow.exact_row.date, source_url: input.source_url }, mode_evidence: { value: input.mode, authority: 'phase_d_bound_visual_adjudication' },
      media: { private_member: `media/${candidate.numeric_id}.${decode.format === 'jpeg' ? 'jpg' : 'tif'}`, sha256: sha256(raw), bytes: raw.length, ...decode, transport: receipt },
      rights: { status: 'held_pending_independent_bounded_proposition_review', candidate_license_id: 'cc-by-4.0', commercial_use_candidate: true, exact_required_credit: 'Archives de la Ville de Montréal', source_family_id: sourceRow.source_family_id, package_source_id: sourceRow.package_source_id, resource_id: sourceRow.resource_id, source_row_sha256: sourceRow.exact_row_sha256, limitation: 'License applicability and attribution remain held until independent review; no source establishes pictured location, scale, land use, or measurement.' },
      attribution: { required_credit: { status: 'present_package_level_exact', value: 'Archives de la Ville de Montréal' }, call_number: sourceRow.exact_row.media_call_number, photographer: sourceRow.exact_row.photographer, source_record_title: sourceRow.exact_row.titre, csv_placeholder_is_not_attribution: sourceRow.exact_row.csv_credit_field.status === 'placeholder_not_complete_attribution' },
      georeference_proposal: null, sequence_context: { status: 'proposal_not_authored', reason: 'No independently reviewed authoritative index/map body was accepted for a bounded sequence proposition.' }, abstentions: Object.fromEntries(ABSTENTIONS.map(key => [key, { disposition: 'abstained', reason: key === 'measurement' ? 'No accepted georeference and scale evidence.' : 'No independently reviewed authoritative evidence supports this proposition.' }])), claim_boundary: { accepted_claims: 0, verified_dossier: false, accepted_tasks: 0 } });
  }
  const counts = { candidates: records.length, components: components.size, phase_d_selected: records.filter(row => row.cohort_role === 'phase_d_selected').length, reserves: records.filter(row => row.cohort_role === 'component_distinct_reserve').length, predecessor_held_preserved: records.filter(row => row.disposition_preservation === 'held_preserved').length, media_bytes: records.reduce((sum, row) => sum + row.media.bytes, 0), exact_media_hashes: records.filter(row => row.media.sha256).length, header_dimensions_verified: records.filter(row => row.media.header_dimensions_verified).length, pixel_decode_verified: records.filter(row => row.media.pixel_decode_verified).length, georeference_proposals: 0, accepted_coordinates: 0, accepted_measurements: 0, accepted_claims: 0, verified_dossiers: 0, tasks: 0 };
  const ledger = { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: 'candidate_held_external_review_required', predecessor_pins: predecessorPins(), selection_policy: { selected: 'all_20_phase_d_aerial_records', reserves: 'next_two_gold_ranked_promoted_aerial_records_after_excluding_all_phase_d_components' }, records, counts };
  const members = archiveMembers(records); const archive = { schema_version: VERSION, artifact_id: ARTIFACT_ID, status: 'local_exact_bodies_verified_durable_archive_pending_coordinator', local_locator_template: '/private/path/aerial-source-evidence-v1-private-snapshot', durable_locator: null, archive_sha256: null, archive_bytes: null, media_tree_sha256: treeHash(members.filter(row => row.member_kind === 'exact_official_media')), media_bytes: counts.media_bytes, members,
    archive_plan: { format: 'pending_phase_b_deterministic_archive_contract', required_members: '22 exact official media bodies plus 22 sanitized transport receipts', upload_target_class: 'private_durable_object_store', coordinator_actions: ['await Phase B archive/publication contract'] },
    security_boundary: { raw_sidecars_archived: false, cookies_archived: false, signed_urls_archived: false, query_values_archived: false, exact_media_and_sanitized_receipts_only: true } };
  const status = { schema_version: VERSION, artifact_id: ARTIFACT_ID, issue: 90, issue_complete: false, authority_status: ledger.authority_status, production_mutation: false, paid_gpu_launched: false, counts, blockers: ['durable_archive_upload_and_byte_identical_readback_receipt_required', 'fresh_independent_external_source_review_required'], limitations: ['Acquisition does not increase verified dossier count.', 'Official media URLs and metadata do not establish pictured location.', 'No georeference proposal, coordinate, scale, land-use proposition, or measurement is accepted.'] };
  return { 'evidence-ledger-v1.json': ledger, 'source-body-evidence-v1.json': sources, 'external-archive-descriptor-v1.json': archive, 'independent-source-review-receipt.template-v1.json': legacyReviewTemplate(records), 'status-report-v1.json': status };
}
function validators(): Map<string, any> { const Ajv = Ajv2020Import as unknown as new(options: any) => any, ajv = new Ajv({ allErrors: true, strict: false }); (addFormatsImport as unknown as (value: any) => void)(ajv); return new Map(fs.readdirSync(SCHEMAS).filter(file => file.endsWith('.schema.json')).map(file => [file.replace('.schema.json', ''), ajv.compile(readJson(path.join(SCHEMAS, file)))])); }
function validate(name: string, value: Json, all = validators()): void { const check = all.get(name); assert(check && check(value), `${name} schema validation failed: ${JSON.stringify(check?.errors)}`); }
function listFiles(root: string): string[] { assert(!fs.lstatSync(root).isSymbolicLink(), 'fixture root symlink rejected'); return fs.readdirSync(root).sort().filter(file => fs.lstatSync(path.join(root, file)).isFile()); }
function descriptor(root: string): Json { const members = [...BASE_MEMBERS].sort().map(file => binding(path.join(root, file), file)); return { schema_version: VERSION, artifact_id: ARTIFACT_ID, authority_status: 'candidate_held_external_review_required', created_at: CREATED_AT, production_mutation: false, authority_member: null, members, tree_sha256: treeHash(members), registry_authority: 'candidate_only_not_published' }; }
async function writeCandidate(root: string, mediaRoot: string, sourceRoot: string): Promise<Json> { const values = await candidateArtifacts(mediaRoot, sourceRoot); fs.mkdirSync(root, { recursive: true }); for (const old of fs.readdirSync(root)) fs.rmSync(path.join(root, old), { recursive: true, force: true }); for (const [name, value] of Object.entries(values)) writeJson(path.join(root, name), value); writeJson(path.join(root, 'descriptor-v1.json'), descriptor(root)); return verify(root, { mediaRoot, sourceRoot, registryPath: null }); }

function registryRow(root = FIXTURE): Json { const files = [...BASE_MEMBERS, 'descriptor-v1.json'].sort(), members = files.map(file => binding(path.join(root, file), file)); return { stable_id: REGISTRY_ID, schema_version: 'dataset_factory_artifact_registry_v0', artifact_schema_version: VERSION, artifact_kind: 'directory', content_digest: { algorithm: 'sha256', value: treeHash(members), scope: 'sorted_tree_manifest' }, counts: { file_count: members.length, byte_count: members.reduce((sum, row) => sum + row.bytes, 0) },
  source_lineage: { description: 'Issue #90 Gate F candidate-only aerial source evidence with exact private CKAN body bindings and held rights applicability.', source_artifact_ids: ['dfv0_issue69_phase_d_scale_v1_20260713', 'dfv0_reviewed_source_evidence_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1'], source_urls: ['https://github.com/zouantchaw/mtl-archives-search/issues/90'] }, storage: { storage_class: 'tracked_repository', path_class: 'tracked_fixture', locator: FIXTURE_REL }, generation: { method: 'external_snapshot', command: 'npm run dataset-factory:aerial-source-evidence-build-v1 -- --media-root /private/media --source-root /tmp/issue90-gate-f-remediation-sources-v1', code_ref: 'codex/90-aerial-source-evidence', human_input_ids: [], acquisition_boundary: 'Exact media and exact CKAN/CSV bodies remain private; tracked representations bind exact hashes, structured rows, raw sidecar audits, full pixel decode, and abstentions.' }, dependency_ids: ['dfv0_issue69_phase_d_scale_v1_20260713', 'dfv0_reviewed_source_evidence_v1', 'dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1'], required_by: ['issue #90 Phase B archive and publication contract'], rights_boundary: { license_id: 'cc-by-4.0', attribution: 'Archives de la Ville de Montréal', commercial_use_allowed: true, notes: 'Exact CKAN bodies state CC BY and required credit; record-level applicability remains held pending fresh independent review.' }, created_at: CREATED_AT, creation_time_basis: 'report_metadata' }; }
function sealRegistry(root = FIXTURE, registryPath = REGISTRY): void { const rows = fs.readFileSync(registryPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), filtered = rows.filter(row => row.stable_id !== REGISTRY_ID); filtered.push(registryRow(root)); fs.writeFileSync(registryPath, `${filtered.map(row => JSON.stringify(row)).join('\n')}\n`); }

type VerifyOptions = { mediaRoot?: string; sourceRoot?: string; registryPath?: string | null };
async function verify(root = FIXTURE, options: VerifyOptions = {}): Promise<Json> {
  const expectedFiles = [...BASE_MEMBERS, 'descriptor-v1.json'].sort(); assert(canonical(listFiles(root)) === canonical(expectedFiles), 'fixture exact member set drift'); const all = validators(), schemaMap: Record<string, string> = { 'descriptor-v1.json': 'descriptor-v1', 'evidence-ledger-v1.json': 'evidence-ledger-v1', 'source-body-evidence-v1.json': 'source-body-evidence-v1', 'external-archive-descriptor-v1.json': 'external-archive-descriptor-v1', 'independent-source-review-receipt.template-v1.json': 'independent-source-review-receipt.template-v1', 'status-report-v1.json': 'status-report-v1' }; for (const [file, schema] of Object.entries(schemaMap)) validate(schema, readJson(path.join(root, file)), all); const descriptorValue = readJson(path.join(root, 'descriptor-v1.json')); assert(canonical(descriptorValue) === canonical(descriptor(root)), 'descriptor/tree mismatch');
  const ledger = readJson(path.join(root, 'evidence-ledger-v1.json')), sources = readJson(path.join(root, 'source-body-evidence-v1.json')), status = readJson(path.join(root, 'status-report-v1.json')), archive = readJson(path.join(root, 'external-archive-descriptor-v1.json')), candidates = selectedCandidates(), expectedArchiveMembers = archiveMembers(ledger.records); assert(ledger.records.length === 22 && new Set(ledger.records.map((row: Json) => row.component_id)).size === 22, 'record/component coverage drift'); assert(canonical(ledger.predecessor_pins) === canonical(predecessorPins()), 'predecessor pin drift'); assert(ledger.records.every((row: Json, index: number) => row.numeric_id === candidates[index].numeric_id && row.component_id === candidates[index].component_id), 'selection replay drift'); assert(canonical(archive.members) === canonical(expectedArchiveMembers) && archive.media_tree_sha256 === treeHash(expectedArchiveMembers.filter((row: Json) => row.member_kind === 'exact_official_media')) && archive.media_bytes === ledger.records.reduce((sum: number, row: Json) => sum + row.media.bytes, 0), 'archive member derivation drift'); const derivedCounts = { candidates: ledger.records.length, components: new Set(ledger.records.map((row: Json) => row.component_id)).size, phase_d_selected: ledger.records.filter((row: Json) => row.cohort_role === 'phase_d_selected').length, reserves: ledger.records.filter((row: Json) => row.cohort_role === 'component_distinct_reserve').length, predecessor_held_preserved: ledger.records.filter((row: Json) => row.disposition_preservation === 'held_preserved').length, media_bytes: ledger.records.reduce((sum: number, row: Json) => sum + row.media.bytes, 0), exact_media_hashes: ledger.records.filter((row: Json) => row.media.sha256).length, header_dimensions_verified: ledger.records.filter((row: Json) => row.media.header_dimensions_verified).length, pixel_decode_verified: ledger.records.filter((row: Json) => row.media.pixel_decode_verified).length, georeference_proposals: ledger.records.filter((row: Json) => row.georeference_proposal !== null).length, accepted_coordinates: 0, accepted_measurements: 0, accepted_claims: ledger.records.reduce((sum: number, row: Json) => sum + row.claim_boundary.accepted_claims, 0), verified_dossiers: ledger.records.filter((row: Json) => row.claim_boundary.verified_dossier).length, tasks: ledger.records.reduce((sum: number, row: Json) => sum + row.claim_boundary.accepted_tasks, 0) }; assert(canonical(ledger.counts) === canonical(derivedCounts) && canonical(status.counts) === canonical(derivedCounts), 'cross-derived status/ledger counts drift'); assert(derivedCounts.accepted_claims === 0 && derivedCounts.verified_dossiers === 0 && derivedCounts.tasks === 0, 'downstream count inflation');
  const sourceRows = new Map<number, Json>(sources.record_rows.map((row: Json) => [row.numeric_id, row])); assert(sourceRows.size === 22 && sources.packages.length === 3 && new Set(sources.packages.map((row: Json) => row.source_family_id)).size === 3, 'source family/record coverage drift'); for (const row of ledger.records) { const sourceRow = sourceRows.get(row.numeric_id), mediaPin = MEDIA_PINS[row.numeric_id]; assert(mediaPin && canonical({ sha256: row.media.sha256, bytes: row.media.bytes, format: row.media.format, width: row.media.width, height: row.media.height }) === canonical(mediaPin), `immutable media pin drift ${row.numeric_id}`); assert(sourceRow && row.rights.source_family_id === sourceRow.source_family_id && row.rights.source_row_sha256 === sourceRow.exact_row_sha256, `record/source join drift ${row.numeric_id}`); assert(row.gate_f_disposition === 'held' && row.georeference_proposal === null && row.rights.status === 'held_pending_independent_bounded_proposition_review', 'candidate promotion drift'); assert(ABSTENTIONS.every(key => row.abstentions[key].disposition === 'abstained'), 'required abstention drift');
    assert(row.attribution.required_credit.value === 'Archives de la Ville de Montréal' && canonical(row.attribution.call_number) === canonical(sourceRow.exact_row.media_call_number) && canonical(row.attribution.photographer) === canonical(sourceRow.exact_row.photographer) && canonical(row.attribution.source_record_title) === canonical(sourceRow.exact_row.titre), 'attribution/source join drift'); assert(![row.attribution.call_number.value, row.attribution.photographer.value, row.attribution.source_record_title.value].includes('Cote. Nom du photographe. Archives de la Ville de Montréal'), 'attribution placeholder rejected');
    const transportValue = row.media.transport, tiff = row.media.format === 'tiff'; assert(transportValue.response_bytes === transportValue.probe_binding.bytes && transportValue.probe_binding.bytes === transportValue.raw_audit_digests.probe.bytes && transportValue.probe_binding.sha256 === transportValue.raw_audit_digests.probe.sha256 && transportValue.status === (tiff ? 206 : 200) && transportValue.probe_binding.mode === (tiff ? 'exact_media_prefix_range' : 'exact_full_media_body') && (tiff || transportValue.response_bytes === row.media.bytes), 'transport/media audit binding drift'); if (options.mediaRoot) { const file = containedFile(options.mediaRoot, `${row.numeric_id}.media`, 'verify media'), raw = stableExternalFile(file); assert(raw.length === row.media.bytes && sha256(raw) === row.media.sha256, `media substitution ${row.numeric_id}`); await decodeMedia(file, row.media); assert(canonical(transport(options.mediaRoot, row.numeric_id, raw, row.media.format)) === canonical(row.media.transport), `raw sidecar substitution ${row.numeric_id}`); } }
  for (const pkg of sources.packages) { assert(pkg.private_body.sha256 === SOURCE_BODY_SHA256[pkg.private_body.path], `package body offline pin drift ${pkg.source_id}`); for (const prop of pkg.propositions) assert(prop.text_sha256 === sha256(prop.exact_text), 'package proposition hash drift'); } for (const row of sources.record_rows) { assert(row.private_csv_body.sha256 === SOURCE_BODY_SHA256[row.private_csv_body.path] && row.exact_row_sha256 === SOURCE_ROW_SHA256[row.numeric_id] && row.exact_row_sha256 === sha256(canonical(row.exact_row)), `source row hash drift ${row.numeric_id}`); for (const prop of row.bounded_propositions) assert(prop.text_sha256 === sha256(prop.exact_text), 'record proposition hash drift'); }
  const packagesById = new Map<string, Json>(sources.packages.map((pkg: Json) => [pkg.source_id, pkg])); for (const row of sources.record_rows) { const pkg = packagesById.get(row.package_source_id); assert(pkg && pkg.source_family_id === row.source_family_id && pkg.collection.resource_ids.includes(row.resource_id), `package/resource/source-family join drift ${row.numeric_id}`); }
  if (options.sourceRoot) { const inputs = ledger.records.map((row: Json) => ({ numeric_id: row.numeric_id, source_url: row.official_metadata.source_url, mode: row.mode_evidence.value, date: row.official_metadata.date.value ?? '' })); assert(canonical(buildSourceEvidence(options.sourceRoot, inputs)) === canonical(sources), 'private exact source body substitution'); }
  assert(canonical(readJson(path.join(root, 'independent-source-review-receipt.template-v1.json'))) === canonical(legacyReviewTemplate(ledger.records)), 'legacy review template drift');
  if (options.registryPath) { const rows = fs.readFileSync(options.registryPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.stable_id === REGISTRY_ID); assert(rows.length === 1 && canonical(rows[0]) === canonical(registryRow(root)), 'artifact registry row drift'); }
  return { state: 'candidate_held_external_review_required', records: 22, media_verified: Boolean(options.mediaRoot), source_bodies_verified: Boolean(options.sourceRoot), production_mutation: false };
}
function resealCandidateAndRegistry(root: string, registryPath: string): void { writeJson(path.join(root, 'descriptor-v1.json'), descriptor(root)); const rows = fs.readFileSync(registryPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), target = rows.findIndex(row => row.stable_id === REGISTRY_ID); if (target >= 0) rows[target] = registryRow(root); fs.writeFileSync(registryPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`); }
async function selfTest(): Promise<Json> { const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-f-self-')); let cases = 0; try { const baseRegistry = path.join(temp, 'registry.jsonl'); fs.copyFileSync(REGISTRY, baseRegistry); const run = async (label: string, edit: (root: string, registry: string) => void, expected: RegExp) => { const root = path.join(temp, label); fs.cpSync(FIXTURE, root, { recursive: true }); const registry = path.join(temp, `${label}.jsonl`); fs.copyFileSync(baseRegistry, registry); edit(root, registry); resealCandidateAndRegistry(root, registry); let message = ''; try { await verify(root, { registryPath: registry }); } catch (error) { message = String(error); } assert(expected.test(message), `${label}: expected rejection, got ${message}`); cases++; };
    await run('rights-null', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[0].rights = null; writeJson(file, value); }, /schema validation|record\/source/);
    await run('metadata-null', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[0].official_metadata = null; writeJson(file, value); }, /schema validation/);
    await run('claim-inflation', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[0].claim_boundary.accepted_claims = 1; writeJson(file, value); }, /schema validation|count inflation|counts drift/);
    await run('status-inflation', root => { const file = path.join(root, 'status-report-v1.json'), value = readJson(file); value.counts.tasks = 99; writeJson(file, value); }, /counts drift|schema validation/);
    await run('archive-traversal', root => { const file = path.join(root, 'external-archive-descriptor-v1.json'), value = readJson(file); value.members[0].path = '../same'; writeJson(file, value); }, /schema validation|archive member derivation/);
    await run('archive-duplicate', root => { const file = path.join(root, 'external-archive-descriptor-v1.json'), value = readJson(file); value.members[1] = structuredClone(value.members[0]); writeJson(file, value); }, /schema validation|archive member derivation/);
    await run('source-family', root => { const file = path.join(root, 'source-body-evidence-v1.json'), value = readJson(file); value.record_rows[0].source_family_id = 'archives-montreal-substituted'; writeJson(file, value); }, /record\/source join/);
    await run('source-body-pin', root => { const file = path.join(root, 'source-body-evidence-v1.json'), value = readJson(file); value.packages[0].private_body.sha256 = 'a'.repeat(64); writeJson(file, value); }, /package body offline pin/);
    await run('source-row-fields', root => { const sourceFile = path.join(root, 'source-body-evidence-v1.json'), source = readJson(sourceFile), ledgerFile = path.join(root, 'evidence-ledger-v1.json'), ledger = readJson(ledgerFile); source.record_rows[0].exact_row.photographer = { status: 'present_exact_row', value: 'Substituted' }; source.record_rows[0].exact_row_sha256 = sha256(canonical(source.record_rows[0].exact_row)); source.record_rows[0].exact_row_bytes = Buffer.byteLength(canonical(source.record_rows[0].exact_row)); ledger.records[0].rights.source_row_sha256 = source.record_rows[0].exact_row_sha256; ledger.records[0].attribution.photographer = source.record_rows[0].exact_row.photographer; writeJson(sourceFile, source); writeJson(ledgerFile, ledger); }, /source row hash/);
    await run('attribution-placeholder', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[0].attribution.call_number.value = 'Cote. Nom du photographe. Archives de la Ville de Montréal'; writeJson(file, value); }, /attribution\/source join|placeholder/);
    await run('proposition-hash', root => { const file = path.join(root, 'source-body-evidence-v1.json'), value = readJson(file); value.packages[0].propositions[0].text_sha256 = 'a'.repeat(64); writeJson(file, value); }, /proposition hash/);
    await run('component', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[1].component_id = value.records[0].component_id; writeJson(file, value); }, /component coverage|selection replay/);
    await run('media-hash', root => { const ledgerFile = path.join(root, 'evidence-ledger-v1.json'), ledger = readJson(ledgerFile), archiveFile = path.join(root, 'external-archive-descriptor-v1.json'), archive = readJson(archiveFile); ledger.records[0].media.sha256 = 'a'.repeat(64); archive.members = archiveMembers(ledger.records); archive.media_tree_sha256 = treeHash(archive.members.filter((member: Json) => member.member_kind === 'exact_official_media')); writeJson(ledgerFile, ledger); writeJson(archiveFile, archive); }, /immutable media pin/);
    await run('raw-probe-hash', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.records[0].media.transport.raw_audit_digests.probe.sha256 = 'a'.repeat(64); writeJson(file, value); }, /archive member derivation|transport\/media audit/);
    await run('predecessor', root => { const file = path.join(root, 'evidence-ledger-v1.json'), value = readJson(file); value.predecessor_pins[0].sha256 = 'a'.repeat(64); writeJson(file, value); }, /predecessor pin/);
    const malformed = path.join(temp, 'malformed.jpg'); fs.writeFileSync(malformed, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 16, 0, 16, 3]), Buffer.alloc(288)])); let decodeError = ''; try { await decodeMedia(malformed); } catch (error) { decodeError = String(error); } assert(decodeError, 'malformed media full pixel decode accepted'); cases++;
    return { status: 'passed', adversarial_rejections: cases, production_mutation: false };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
async function integration(mediaRoot: string, sourceRoot: string): Promise<Json> { const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-f-integration-')); try { const root = path.join(temp, 'candidate'); await writeCandidate(root, mediaRoot, sourceRoot); for (const file of [...BASE_MEMBERS, 'descriptor-v1.json']) assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(FIXTURE, file))), `integration byte drift ${file}`); return { status: 'passed', candidate_replay: 'byte_identical', files: 6, media_pixel_decode_verified: 22, source_bodies_verified: 10, production_mutation: false }; } finally { fs.rmSync(temp, { recursive: true, force: true }); } }

const parsed = parseArgs({ allowPositionals: true, options: { 'media-root': { type: 'string' }, 'source-root': { type: 'string' }, root: { type: 'string' }, registry: { type: 'string' } } });
const command = parsed.positionals[0] ?? 'verify', mediaRoot = parsed.values['media-root'] ? path.resolve(parsed.values['media-root']) : undefined, sourceRoot = path.resolve(parsed.values['source-root'] ?? SOURCE_ROOT_DEFAULT), fixtureRoot = path.resolve(parsed.values.root ?? FIXTURE), registryPath = path.resolve(parsed.values.registry ?? REGISTRY);
if (command === 'build') { assert(mediaRoot, '--media-root is required'); console.log(JSON.stringify(await writeCandidate(fixtureRoot, mediaRoot, sourceRoot))); }
else if (command === 'refresh-candidate') { assert(mediaRoot, '--media-root is required'); assert(readJson(path.join(fixtureRoot, 'descriptor-v1.json')).authority_status === 'candidate_held_external_review_required', 'only candidate authority may refresh'); console.log(JSON.stringify(await writeCandidate(fixtureRoot, mediaRoot, sourceRoot))); }
else if (command === 'verify') console.log(JSON.stringify(await verify(fixtureRoot, { mediaRoot, sourceRoot: parsed.values['source-root'] ? sourceRoot : undefined, registryPath })));
else if (command === 'seal-registry') { sealRegistry(fixtureRoot, registryPath); console.log(JSON.stringify({ status: 'registry_row_sealed', stable_id: REGISTRY_ID })); }
else if (command === 'self-test') console.log(JSON.stringify(await selfTest()));
else if (command === 'integration-test') { assert(mediaRoot, '--media-root is required'); console.log(JSON.stringify(await integration(mediaRoot, sourceRoot))); }
