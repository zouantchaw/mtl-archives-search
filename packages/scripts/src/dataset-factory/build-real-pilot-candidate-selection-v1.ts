import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import Ajv2020Import from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { MONOREPO_ROOT, canonicalJson } from './verified-multimodal-batch-001-contract.js';
import { EXPECTED } from './gold-label-batch-002-contract.js';
import { assertApprovedHash, assertSuccessorContract, normalizedUrlSet, selectCandidates, sha256, verifyDerivativeBytes, verifyDescriptorMembers, type JoinedCandidate, type Split } from './real-pilot-candidate-selection-v1.js';

const REPORT = path.join(MONOREPO_ROOT, 'data/mtl_archives/reports');
const RECOVERY = path.join(REPORT, 'canonical_image_recovery_v1');
const GRAPH = path.join(RECOVERY, 'graph-after');
const VFG = path.join(REPORT, 'visual_family_graph_v1');
const OUT = path.join(REPORT, 'verified_multimodal_batch_001_real_pilot/selection');
const DESCRIPTOR = path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-selection-v1.json');
const inputs = {
  derivative_manifest: path.join(RECOVERY, 'derivatives/manifest-v1.json'),
  local_manifest: path.join(VFG, 'canonical_local/local-manifest.jsonl'),
  corpus_input: path.join(VFG, 'input/corpus-input-v1.jsonl'),
  leakage_map: path.join(GRAPH, 'record-leakage-map-v1.jsonl'),
  benchmark_splits: path.join(GRAPH, 'benchmark-splits-v1.jsonl'),
  nodes: path.join(GRAPH, 'nodes-v1.jsonl'),
  recovery_ledger: path.join(RECOVERY, 'recovery-ledger-v1.jsonl'),
  graph_artifact_manifest: path.join(GRAPH, 'artifact-manifest-v1.json'),
  recovery_descriptor: process.env.ISSUE69_RECOVERY_DESCRIPTOR ?? path.join(MONOREPO_ROOT, 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/reproducibility-bundle-v1.json'),
} as const;
const CORPUS_INPUT_SHA256 = '0f9971c70ac242c44ee80835b4c71e9f771e742d8c80603cf39bc1163cc951cc';
const RECOVERY_DESCRIPTOR_SHA256 = 'bf76a4d59b0f5dfd6b59d61539b2ada017f89d00cb74f76f4b8a0688056e3b37';
const RECOVERY_DESCRIPTOR_MEMBER_STREAM_SHA256 = '08b35620a271f0273661fb89ad4623c5ecff324b556fff32b5d431351a1fc8fb';
function requireHash(file: string, expected: string, label: string): void { assertApprovedHash(fs.readFileSync(file), expected, label); }

function readJsonl<T>(file: string): T[] {
  const value = fs.readFileSync(file, 'utf8').trim();
  return value ? value.split('\n').map((line, index) => { try { return JSON.parse(line) as T; } catch { throw new Error(`${file}:${index + 1}: invalid JSON`); } }) : [];
}
function index<T extends { record_id?: string; identity?: string }>(rows: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) { const id = row.record_id ?? row.identity; if (!id || result.has(id)) throw new Error(`${label}: missing or duplicate record identity ${id}`); result.set(id, row); }
  return result;
}
function writeJsonl(file: string, rows: unknown[]): void { fs.writeFileSync(file, rows.map(canonicalJson).join('\n') + (rows.length ? '\n' : '')); }
function evidence(file: string): { path: string; sha256: string; bytes: number; rows?: number } {
  const data = fs.readFileSync(file); const rel = path.relative(MONOREPO_ROOT, file); const out: { path: string; sha256: string; bytes: number; rows?: number } = { path: rel, sha256: sha256(data), bytes: data.length };
  if (file.endsWith('.jsonl')) out.rows = data.length ? data.toString('utf8').trim().split('\n').length : 0;
  return out;
}

type Corpus = { record_id: string; numeric_id: number; name: string; description: string | null; date: string | null; cote: string | null; corpus_state: string; rights: { complete: boolean; attribution: string }; source_identity: string; source_urls: string[] };
type Local = { identity: string; numeric_id: number; source_record_sha256: string; source_record_ids: string[]; source_urls: string[]; rights: { complete: boolean; attribution: string }; attribution: string };
type MapRow = { record_id: string; component_id: string; benchmark_split: Split; component_size: number };
type SplitRow = { record_id: string; component_id: string; split: Split };
type Node = { record_id: string; numeric_id: number; corpus_state: string; phash_status: string; source_identity_sha256: string; source_record_sha256: string; source_record_ids: string[]; source_urls: string[]; rights: { complete: boolean; attribution: string } };
type Ledger = { record_id: string; recovered: boolean; disposition: string; derivative_path: string; derivative_sha256: string; normalized_pixel_sha256: string | null; recovered_payload_sha256: string | null };
type Derivative = { record_id: string; path: string; sha256: string; bytes: number; width: number; height: number; format: string; magic: string };

async function main(): Promise<void> {
  if (process.argv.includes('--verify-output')) {
    const descriptor = JSON.parse(fs.readFileSync(DESCRIPTOR, 'utf8')) as Parameters<typeof verifyDescriptorMembers>[1];
    verifyDescriptorMembers(MONOREPO_ROOT, descriptor);
    console.log(canonicalJson({ status: 'ok', verified_descriptor: path.relative(MONOREPO_ROOT, DESCRIPTOR), files: descriptor.counts.files, tree_sha256: descriptor.tree_sha256 })); return;
  }
  const manifest = JSON.parse(fs.readFileSync(inputs.derivative_manifest, 'utf8')) as { schema_version: string; tree_sha256: string; rows: Derivative[] };
  const registeredContract = { recovery_bundle_sha256: EXPECTED.recoveryBundle, successor_contract_sha256: EXPECTED.successorContract };
  assertSuccessorContract(registeredContract.successor_contract_sha256);
  requireHash(inputs.graph_artifact_manifest, EXPECTED.manifest, 'graph manifest'); requireHash(inputs.nodes, EXPECTED.nodes, 'nodes'); requireHash(inputs.leakage_map, EXPECTED.map, 'leakage map');
  requireHash(inputs.benchmark_splits, EXPECTED.splits, 'benchmark splits'); requireHash(inputs.local_manifest, EXPECTED.localCorpus, 'local corpus'); requireHash(inputs.corpus_input, CORPUS_INPUT_SHA256, 'corpus input');
  requireHash(inputs.recovery_descriptor, RECOVERY_DESCRIPTOR_SHA256, 'recovery descriptor');
  const recoveryDescriptor = JSON.parse(fs.readFileSync(inputs.recovery_descriptor, 'utf8')) as { bundle: { sha256: string }; tree_sha256: string; members: Array<{ path: string; bytes: number; sha256: string }> };
  if (recoveryDescriptor.bundle.sha256 !== EXPECTED.recoveryBundle || recoveryDescriptor.tree_sha256 !== EXPECTED.recoveryTree) throw new Error('approved recovery descriptor drift');
  const memberStream = recoveryDescriptor.members.slice().sort((a, b) => a.path.localeCompare(b.path)).map((member) => `${member.path}\t${member.bytes}\t${member.sha256}`).join('\n') + '\n';
  if (sha256(memberStream) !== RECOVERY_DESCRIPTOR_MEMBER_STREAM_SHA256) throw new Error('recovery descriptor member stream drift');
  const descriptorMembers = new Map(recoveryDescriptor.members.map((member) => [member.path, member]));
  for (const file of Object.values(inputs).filter((value) => value !== inputs.recovery_descriptor)) { const rel = path.relative(MONOREPO_ROOT, file), declared = descriptorMembers.get(rel); if (!declared || declared.bytes !== fs.statSync(file).size || declared.sha256 !== sha256(fs.readFileSync(file))) throw new Error(`recovery descriptor member drift: ${rel}`); }
  const graphDeclared = JSON.parse(fs.readFileSync(inputs.graph_artifact_manifest, 'utf8')) as { artifacts: Array<{ path: string; byte_count: number; row_count?: number; sha256: string }>; source_snapshot: object; arithmetic: object };
  for (const member of graphDeclared.artifacts) { const file = path.join(GRAPH, member.path), data = fs.readFileSync(file); if (data.length !== member.byte_count || sha256(data) !== member.sha256) throw new Error(`graph manifest member drift: ${member.path}`); if (member.row_count !== undefined && data.toString('utf8').trim().split('\n').length !== member.row_count) throw new Error(`graph manifest row drift: ${member.path}`); }
  if (manifest.schema_version !== 'canonical_image_recovery_derivative_manifest_v1.0.0') throw new Error('unsupported derivative manifest schema');
  const corpus = index(readJsonl<Corpus>(inputs.corpus_input), 'corpus'); const local = index(readJsonl<Local>(inputs.local_manifest), 'local');
  const maps = index(readJsonl<MapRow>(inputs.leakage_map), 'map'); const splits = index(readJsonl<SplitRow>(inputs.benchmark_splits), 'splits');
  const nodes = index(readJsonl<Node>(inputs.nodes), 'nodes'); const ledger = index(readJsonl<Ledger>(inputs.recovery_ledger), 'ledger');
  const joins: JoinedCandidate[] = [];
  for (const derivative of [...manifest.rows].sort((a, b) => a.record_id.localeCompare(b.record_id))) {
    const image = path.join(RECOVERY, 'derivatives', derivative.path);
    let decode = false;
    try { await verifyDerivativeBytes(fs.readFileSync(image), derivative); decode = true; } catch { decode = false; }
    const c = corpus.get(derivative.record_id); const l = local.get(derivative.record_id); const m = maps.get(derivative.record_id); const s = splits.get(derivative.record_id); const n = nodes.get(derivative.record_id); const r = ledger.get(derivative.record_id);
    const suffix = Number(derivative.record_id.match(/^mtl_archives_metadata_(\d+)\.json$/)?.[1] ?? NaN);
    const semantic = Boolean(c && m && s && n && r && Number.isInteger(suffix) && c.numeric_id === suffix && n.numeric_id === suffix && m.component_id === s.component_id && n.source_identity_sha256 === sha256(c.source_identity)
      && r.derivative_path === `derivatives/${derivative.path}` && r.derivative_sha256 === derivative.sha256
      && (c.corpus_state !== 'canonical' || (l && l.identity === c.record_id && l.numeric_id === suffix && n.corpus_state === c.corpus_state && l.source_record_sha256 === n.source_record_sha256
        && JSON.stringify([...l.source_record_ids].sort()) === JSON.stringify([...n.source_record_ids].sort()) && JSON.stringify(normalizedUrlSet(l.source_urls)) === JSON.stringify(normalizedUrlSet(c.source_urls)) && JSON.stringify(normalizedUrlSet(n.source_urls)) === JSON.stringify(normalizedUrlSet(c.source_urls))
        && l.rights.complete === c.rights.complete && n.rights.complete === c.rights.complete && l.rights.attribution === c.rights.attribution && n.rights.attribution === c.rights.attribution && l.attribution === c.rights.attribution)));
    joins.push({ record_id: derivative.record_id, numeric_id: c?.numeric_id ?? -1, name: c?.name ?? '', description: c?.description ?? null, date: c?.date ?? null, cote: c?.cote ?? null,
      corpus_state: c?.corpus_state ?? '', corpus_rights_complete: c?.rights.complete ?? false, corpus_attribution: c?.rights.attribution ?? '', local_rights_complete: l?.rights.complete ?? false,
      local_attribution: l?.rights.attribution ?? l?.attribution ?? '', source_identity: c?.source_identity ?? '', source_identity_sha256: n?.source_identity_sha256 ?? '', source_urls: c?.source_urls ?? [],
      component_id: m?.component_id ?? '', map_split: m?.benchmark_split ?? 'train', graph_split: s?.split ?? ('' as Split), component_size: m?.component_size ?? 0,
      node_phash_status: n?.phash_status ?? '', derivative_path: path.relative(OUT, image), derivative_sha256: derivative.sha256, derivative_bytes: derivative.bytes,
      derivative_width: derivative.width, derivative_height: derivative.height, derivative_decode_ok: decode, recovery_recovered: r?.recovered ?? false,
      recovery_disposition: r?.disposition ?? '', normalized_pixel_sha256: r?.normalized_pixel_sha256 ?? null, recovered_payload_sha256: r?.recovered_payload_sha256 ?? null, semantic_join_ok: semantic });
  }
  const result = selectCandidates(joins, 8);
  const Ajv2020 = Ajv2020Import as unknown as new (options?: object) => { compile(schema: object): (value: unknown) => boolean; errors?: unknown };
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  (addFormatsImport as unknown as (instance: object) => void)(ajv);
  const schemaDir = path.join(MONOREPO_ROOT, 'docs/dataset-factory/schemas/real-pilot-candidate-selection-v1');
  const candidateValidator = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, 'candidate.schema.v1.json'), 'utf8')) as object);
  const exclusionValidator = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, 'exclusion.schema.v1.json'), 'utf8')) as object);
  for (const row of result.candidates) if (!candidateValidator(row)) throw new Error(`candidate schema rejected ${row.record_id}`);
  for (const row of result.exclusions) if (!exclusionValidator(row)) throw new Error(`exclusion schema rejected ${row.record_id}`);
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'contact-sheets'), { recursive: true });
  const candidateFile = path.join(OUT, 'eligible-candidates-v1.jsonl'); const exclusionFile = path.join(OUT, 'exclusions-v1.jsonl');
  writeJsonl(candidateFile, result.candidates); writeJsonl(exclusionFile, result.exclusions);
  const lineage = Object.fromEntries(Object.entries(inputs).map(([key, file]) => [key, evidence(file)]));
  const graphManifest = graphDeclared;
  const byLane = Object.fromEntries(['ground_ocr_entity_place', 'aerial_land_use_georeference'].map((lane) => [lane, { total: result.candidates.filter((r) => r.lane === lane).length, ranked_pool: result.candidates.filter((r) => r.lane === lane && r.selection_bucket === 'ranked_pool').length }]));
  const report = { schema_version: 'verified_multimodal_real_pilot_selection_report_v1.0.0', scope: 'candidate_pool_only_no_historical_claims_or_dossiers', deterministic: true,
    proxy_boundary: 'metadata and aerial markers rank acquisition candidates only; they are not verified labels or claims', anchor_policy: 'record 0 is a declared anchor only when all mechanical gates pass', ranked_pool_policy: 'top 8 mechanically eligible and uniqueness-safe candidates per proxy lane; all remaining eligible rows are reserves; this is not a final-12 selection',
    counts: { derivative_rows: manifest.rows.length, eligible_candidates: result.candidates.length, exclusions: result.exclusions.length, verified_claims: 0, ...byLane },
    source_pins: lineage, derivative_tree_sha256: manifest.tree_sha256, graph_source_snapshot: graphManifest.source_snapshot, graph_arithmetic: graphManifest.arithmetic,
    outputs: { eligible_candidates: evidence(candidateFile), exclusions: evidence(exclusionFile) } };
  await render(result.candidates);
  const generated = [candidateFile, exclusionFile, path.join(OUT, 'index.html'), ...fs.readdirSync(path.join(OUT, 'contact-sheets')).sort().map((name) => path.join(OUT, 'contact-sheets', name))];
  Object.assign(report, { successor_graph_contract: registeredContract, generated_artifacts: generated.map(evidence) });
  const reportSchema = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, 'selection-report.schema.v1.json'), 'utf8')) as object);
  if (!reportSchema(report)) throw new Error('selection report schema rejected generated report');
  const reportFile = path.join(OUT, 'selection-report-v1.json'); fs.writeFileSync(reportFile, canonicalJson(report) + '\n');
  const allOutputs = [...generated, reportFile].map((file) => ({ ...evidence(file), path: path.relative(OUT, file) })).sort((a, b) => a.path.localeCompare(b.path));
  const treeSha256 = sha256(allOutputs.map((item) => `${item.path}\t${item.bytes}\t${item.sha256}`).join('\n') + '\n');
  const descriptor = { schema_version: 'verified_multimodal_real_pilot_selection_descriptor_v1.0.0', successor_contract_sha256: registeredContract.successor_contract_sha256,
    scope: 'candidate_pool_only_no_historical_claims_or_final_selection', output_root: path.relative(MONOREPO_ROOT, OUT), tree_sha256: treeSha256,
    counts: { files: allOutputs.length, bytes: allOutputs.reduce((sum, item) => sum + item.bytes, 0), candidates: result.candidates.length, exclusions: result.exclusions.length, verified_claims: 0 },
    members: allOutputs, source_lineage: lineage };
  assertSuccessorContract(descriptor.successor_contract_sha256); fs.writeFileSync(DESCRIPTOR, JSON.stringify(descriptor, null, 2) + '\n');
  verifyDescriptorMembers(MONOREPO_ROOT, descriptor);
  console.log(canonicalJson({ status: 'ok', output: path.relative(MONOREPO_ROOT, OUT), counts: report.counts, candidate_ids: result.candidates.map((r) => r.candidate_id) }));
}

async function render(rows: ReturnType<typeof selectCandidates>['candidates']): Promise<void> {
  const shown = rows.filter((r) => r.selection_bucket === 'ranked_pool'); const pages: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 20) {
    const page = shown.slice(offset, offset + 20); const composites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < page.length; i++) {
      const row = page[i]; const image = path.resolve(OUT, row.derivative.path); const thumb = await sharp(image).resize(220, 170, { fit: 'contain', background: '#f4f4f1' }).jpeg().toBuffer();
      const x = (i % 4) * 250 + 15; const y = Math.floor(i / 4) * 225 + 15; composites.push({ input: thumb, left: x, top: y });
      const label = `${row.rank}. ${row.record_id.replace('mtl_archives_metadata_', '').replace('.json', '')} | ${row.lane.startsWith('aerial') ? 'AERIAL PROXY' : 'GROUND PROXY'}${row.declared_anchor ? ' | ANCHOR' : ''}`;
      composites.push({ input: Buffer.from(`<svg width="220" height="40"><rect width="220" height="40" fill="#fff"/><text x="3" y="15" font-family="Arial" font-size="11" fill="#111">${label}</text><text x="3" y="31" font-family="Arial" font-size="10" fill="#555">not verified</text></svg>`), left: x, top: y + 170 });
    }
    const name = `contact-sheet-${String(pages.length + 1).padStart(2, '0')}.jpg`; await sharp({ create: { width: 1015, height: 1140, channels: 3, background: '#e7e7e2' } }).composite(composites).jpeg({ quality: 88 }).toFile(path.join(OUT, 'contact-sheets', name)); pages.push(name);
  }
  const table = rows.map((r) => `<tr><td>${r.rank}</td><td>${r.record_id}</td><td>${r.lane}</td><td>${r.selection_bucket}</td><td>${r.proxy_score}</td><td>${r.declared_anchor ? 'declared anchor only' : ''}</td></tr>`).join('');
  const links = pages.map((name) => `<figure><a href="contact-sheets/${name}"><img src="contact-sheets/${name}" alt="Candidate contact sheet"></a><figcaption>${name}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Issue 69 real-pilot candidate pool</title><style>body{font:14px Arial;max-width:1100px;margin:24px auto;color:#171717}img{width:100%;height:auto}figure{margin:24px 0}table{border-collapse:collapse;width:100%}td,th{padding:6px;border:1px solid #bbb;text-align:left}</style></head><body><h1>Issue 69 real-pilot candidate pool</h1><p>Candidate selection only. Metadata and aerial markers are ranking proxies, not verified claims. No final 12 records are selected here.</p>${links}<h2>Complete ranked pool and reserves</h2><table><thead><tr><th>Lane rank</th><th>Record</th><th>Proxy lane</th><th>Bucket</th><th>Proxy score</th><th>Anchor</th></tr></thead><tbody>${table}</tbody></table></body></html>`);
}

await main();
