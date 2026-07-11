import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ValidateFunction } from 'ajv';
import AjvImport from 'ajv';
import addFormatsImport from 'ajv-formats';

export const ROOT = path.resolve(import.meta.dirname, '../../../../');
export const OUTPUT = 'data/mtl_archives/reports/gold_label_batch_002';
export const SCHEMA_DIR = 'docs/dataset-factory/schemas/gold-label-batch-002';
export const FIXED_NOW = '2026-07-11T16:00:00.000Z';
export const PACKETS = 12;
export const PACKET_SIZE = 25;
export const ROWS = PACKETS * PACKET_SIZE;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_EDGE = 1024;
type AjvLike={compile(schema:Record<string,unknown>):ValidateFunction;errorsText(errors:unknown):string};
const Ajv=AjvImport as unknown as new(options:Record<string,unknown>)=>AjvLike;
const addFormats=addFormatsImport as unknown as (instance:AjvLike)=>void;
export const EXPECTED = {
  legacyQueue: '0d36b420e460a011cb5cf96f631d9fa7f33fed2b7c847541ffeb63aa39a8483b',
  predecessorGold: 'a3afbb5347890e1470bb49acb44e32be032c1e10ff31d256628c9d2b1065cea7',
  searchJudgments: 'fc2e12e27918b73d5ed5b466e84a3a40381d36ec60ed59ea2c913f8d84ddbf7e',
  silver: '9862fb8fe82c4bdb63580a4a13553ddc997b23001b193ddfbf579f0ae29bdd51',
  recoveryBundle: 'dab076491097ac1fa4c9b1295317d067e29442b12831ede65731941894a859a6',
  recoveryTree: '38927e0e1fc4c205b2e7ae12f0522f64bcaec21dad31c27e045536515eebb47b',
  successorManifest: 'b3b26b45e9508c5838f5045f6565b77201d19d14fba99c98f20c5ea147e113bf',
} as const;

export type Json = Record<string, any>;
export type SelectionRow = {
  schema_version: 'gold_label_batch_002_selection_v1.0.0'; batch_id: 'gold_label_batch_002';
  neutral_id: string; record_id: string; image_filename: string; component_id: string; split: string;
  component_size: number; rank: number; selection_lanes: string[]; selection_rationale: string[];
  source_signal: 'active_learning_v0' | 'canonical_production_backfill'; retained_v0_score: number | null;
};

export const abs = (p: string) => path.resolve(ROOT, p);
export const sha = (v: Buffer | string) => crypto.createHash('sha256').update(v).digest('hex');
export const fileSha = (p: string) => sha(fs.readFileSync(p));
export const stable = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());
export const readJsonl = <T = Json>(p: string): T[] => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((line, i) => {
  try { return JSON.parse(line) as T; } catch (e) { throw new Error(`${p}:${i + 1}: ${String(e)}`); }
});
export const writeJsonl = (p: string, rows: unknown[]) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
};
export function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
export const digestRows = (rows: unknown[]) => sha(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

export function inputPaths(canonicalRoot: string) {
  return {
    queue: path.join(canonicalRoot, 'data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl'),
    gold: path.join(canonicalRoot, 'data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl'),
    search: path.join(canonicalRoot, 'data/mtl_archives/reports/search_judgments_v0/search-judgments-v0.jsonl'),
    corpus: abs('data/mtl_archives/reports/visual_family_graph_v1/canonical_local/local-manifest.jsonl'),
    map: abs('data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/record-leakage-map-v1.jsonl'),
    nodes: abs('data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/nodes-v1.jsonl'),
    recovery: abs('data/mtl_archives/reports/canonical_image_recovery_v1/recovery-ledger-v1.jsonl'),
    graphManifest: abs('data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/artifact-manifest-v1.json'),
  };
}

export function verifyInputs(canonicalRoot: string) {
  const p = inputPaths(canonicalRoot);
  for (const file of Object.values(p)) assert(fs.existsSync(file), `missing required input: ${file}`);
  assert(fileSha(p.queue) === EXPECTED.legacyQueue, 'active-learning v0 hash drift');
  assert(fileSha(p.gold) === EXPECTED.predecessorGold, 'predecessor gold hash drift');
  assert(fileSha(p.search) === EXPECTED.searchJudgments, 'search judgments hash drift');
  const queue = readJsonl(p.queue); const gold = readJsonl(p.gold); const search = readJsonl(p.search);
  const silver = search.filter((r) => r.adjudication_status === 'silver_needs_review');
  assert(queue.length === 300 && gold.length === 20 && search.length === 75 && silver.length === 49, 'legacy input count drift');
  assert(digestRows(silver) === EXPECTED.silver, 'silver stream hash drift');
  const localCorpus = readJsonl(p.corpus); const map = readJsonl(p.map); const nodes = readJsonl(p.nodes);
  assert(localCorpus.length === 14822 && nodes.length === 18462 && map.length === 18462, 'successor identity/map or local metadata overlay count drift');
  const localById = new Map(localCorpus.map((r) => [r.identity, r]));
  const corpus = nodes.map((node) => ({ ...node, ...localById.get(node.record_id), identity: node.record_id,
    image_filename: localById.get(node.record_id)?.image_filename ?? node.image_key,
    resolved_image_filename: localById.get(node.record_id)?.resolved_image_filename ?? node.image_key,
    primary_source_url: localById.get(node.record_id)?.primary_source_url ?? node.source_urls?.[0] ?? null }));
  return { p, queue, gold, search, silver, corpus, localCorpus, map, nodes, recovery: readJsonl(p.recovery) };
}

const laneFrom = (record: Json, prior?: Json): string[] => {
  const text = `${record.name ?? ''} ${record.description ?? ''} ${record.cote ?? ''}`.toLowerCase();
  const signal = prior?.current_signals ?? {};
  const lanes = new Set<string>();
  const mode = signal.image_mode;
  if (mode) lanes.add(`image_mode:${mode}`);
  if (/aerial|vue aérienne|carte index/.test(text) || String(record.source_datasets).includes('aerial')) lanes.add('aerial_land_use_georeference');
  else lanes.add('ground_scene');
  if (/rue|avenue|boulevard|street/.test(text)) lanes.add('ground_street');
  if (/intérieur|interior|bain|salle|bureau|atelier|usine/.test(text)) lanes.add('ground_interior_candidate');
  if (/carte|map|plan|document/.test(text)) lanes.add('document_map');
  if (/enseigne|panneau|billboard|company|compagnie|store|magasin|gazette|brand|marque/.test(text)) lanes.add('scene_text_brand_storefront');
  if (/pont|parc|église|eglise|gare|landmark|monument/.test(text)) lanes.add('landmark');
  for (const s of prior?.acquisition?.strata ?? []) lanes.add(`signal:${s}`);
  for (const q of signal.quality_labels ?? []) lanes.add(`quality:${q}`);
  for (const q of signal.search_failure_matches ?? []) lanes.add(`search_failure:${q}`);
  if (prior?.acquisition?.primary_stratum === 'hard_negative' || (signal.search_failure_matches ?? []).length) lanes.add('search_hard_negative');
  lanes.add('human_legibility_balance'); lanes.add('review_routing_balance'); lanes.add('value_class_balance'); lanes.add('partner_fit_balance');
  return [...lanes].sort();
};

const hashRank = (id: string) => parseInt(sha(`gold-label-batch-002:${id}`).slice(0, 12), 16);

export function selectRows(data: ReturnType<typeof verifyInputs>): SelectionRow[] {
  const mapById = new Map(data.map.map((r) => [r.record_id, r]));
  const priorById = new Map(data.queue.map((r) => [r.record.id, r]));
  const gold = new Set(data.gold.map((r) => r.record_id));
  const candidates = data.corpus.map((record) => {
    const id = record.identity; const prior = priorById.get(id); const family = mapById.get(id);
    assert(family, `missing authoritative component for ${id}`);
    const lanes = laneFrom(record, prior);
    const diversity = Math.min(lanes.length, 12) * 8;
    const priorScore = Number(prior?.acquisition?.score ?? 0);
    const productionScore = /aerial/.test(lanes.join(' ')) ? 12 : 8;
    return { record, prior, family, lanes, score: priorScore * 10 + diversity + productionScore, tie: hashRank(id) };
  }).filter((x) => !gold.has(x.record.identity));
  candidates.sort((a, b) => b.score - a.score || a.tie - b.tie || a.record.identity.localeCompare(b.record.identity));
  const chosen: typeof candidates = []; const components = new Set<string>();
  const required = ['ground_street','ground_interior_candidate','image_mode:ground_object','document_map','image_mode:low_information','scene_text_brand_storefront','landmark','aerial_land_use_georeference','search_hard_negative'];
  for (const lane of required) {
    for (const row of candidates) {
      if (chosen.length >= ROWS || !row.lanes.includes(lane) || components.has(row.family.component_id)) continue;
      chosen.push(row); components.add(row.family.component_id);
      if (chosen.filter((r) => r.lanes.includes(lane)).length >= 20) break;
    }
  }
  for (const row of candidates) {
    if (chosen.length >= ROWS) break;
    if (!components.has(row.family.component_id)) { chosen.push(row); components.add(row.family.component_id); }
  }
  assert(chosen.length === ROWS, `selector produced ${chosen.length}, expected ${ROWS}`);
  return chosen.sort((a,b) => b.score-a.score || a.tie-b.tie).map((x, i) => ({
    schema_version: 'gold_label_batch_002_selection_v1.0.0', batch_id: 'gold_label_batch_002', neutral_id: `glb002-${String(i+1).padStart(4,'0')}`,
    record_id: x.record.identity, image_filename: x.record.resolved_image_filename ?? x.record.image_filename,
    component_id: x.family.component_id, split: x.family.benchmark_split, component_size: x.family.component_size,
    rank: i + 1, selection_lanes: x.lanes, selection_rationale: x.prior?.acquisition?.reasons?.slice(0,8) ?? ['deterministic canonical-corpus coverage backfill'],
    source_signal: x.prior ? 'active_learning_v0' : 'canonical_production_backfill', retained_v0_score: x.prior?.acquisition?.score ?? null,
  }));
}

export const visualInstructions = {
  schema: 'dataset_factory_label_v0', boundary: 'Label only directly observed visual facts. Keep metadata, inference, and externally verified claims in separate evidence buckets. Abstain when pixels do not support a value. Never infer exact identity, date, or location from the image alone.',
  required_visual_fields: ['human_legible','story_value','print_value','partner_fit','search_value','quality_action','image_mode','scene_text','entities','aerial_land_use','commercial_surface'],
  reviewer_rules: ['Use the direct local image path only.','Do not inspect batch manifests, metadata, scores, prior labels, components, splits, or another reviewer output.','Return one dataset_factory_label_v0 row per neutral ID and preserve neutral_id in the sidecar.'],
};

export async function imageInfo(buffer: Buffer) {
  assert(buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES, `image bytes outside bound: ${buffer.length}`);
  const meta = await sharp(buffer, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata();
  assert(['jpeg','png','webp','tiff'].includes(meta.format ?? ''), `unsupported image magic: ${meta.format}`);
  assert(meta.width && meta.height, 'image has no dimensions');
  return { width: meta.width, height: meta.height, format: meta.format! };
}

export async function boundedDerivative(source: Buffer): Promise<Buffer> {
  const out = await sharp(source, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  await imageInfo(out); return out;
}

export async function fetchBounded(url: string, attempts = 3): Promise<Buffer> {
  const parsed = new URL(url); assert(parsed.protocol === 'https:', 'only HTTPS image acquisition is allowed');
  assert(['pub-6a29793ea7664738880d1cc5afb21b87.r2.dev','depot.ville.montreal.qc.ca'].includes(parsed.hostname), `host is not allowlisted: ${parsed.hostname}`);
  let last = 'unknown';
  for (let attempt=1; attempt<=attempts; attempt++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: ctl.signal, redirect: 'error' });
      if (!response.ok || !String(response.headers.get('content-type')).toLowerCase().startsWith('image/')) throw new Error(`HTTP/content ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? 0); assert(!declared || declared <= 128*1024*1024, 'source content-length exceeds bound');
      const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length <= 128*1024*1024, 'source response exceeds bound');
      return bytes;
    } catch (e) { last = String(e); if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 300)); }
    finally { clearTimeout(timer); }
  }
  throw new Error(`bounded image fetch failed after ${attempts} attempts: ${last}`);
}

export function auditBlindRow(row: Json) {
  const allowed = ['schema_version','packet_id','neutral_id','image'];
  const extras = Object.keys(row).filter((k) => !allowed.includes(k));
  assert(extras.length === 0, `blind row hidden-field leak: ${extras.join(',')}`);
  const imageKeys=['local_path','sha256','bytes','width','height','format'];assert(Object.keys(row.image??{}).every((k)=>imageKeys.includes(k))&&Object.keys(row.image??{}).length===imageKeys.length,'blind row image field leak or omission');
  const serialized = JSON.stringify(row).toLowerCase();
  for (const word of ['record_id','score','prior','label','metadata','component','split','vlm','taxonomy','rationale','title','description','cote']) assert(!serialized.includes(`\"${word}\"`), `blind row leaks ${word}`);
}

export function schemaDigest() {
  const files = fs.readdirSync(abs(SCHEMA_DIR)).filter((f) => f.endsWith('.json')).sort();
  return sha(files.map((f) => `${f}\t${fileSha(abs(`${SCHEMA_DIR}/${f}`))}`).join('\n')+'\n');
}

export function assertUnique<T>(rows: T[], key: (r:T)=>string, name: string) {
  const values=rows.map(key); assert(new Set(values).size===values.length, `duplicate ${name}`);
}

export function validateCompletion(outputRoot = abs(OUTPUT)) {
  const selection=readJsonl<SelectionRow>(path.join(outputRoot,'batch/selection-v1.jsonl'));
  assert(selection.length===ROWS,'selection must have 300 rows'); assertUnique(selection,r=>r.record_id,'record ID'); assertUnique(selection,r=>r.component_id,'component');
  const packetManifest=JSON.parse(fs.readFileSync(path.join(outputRoot,'packets/sealed-packet-manifest-v1.json'),'utf8'));
  assert(packetManifest.counts.packets===PACKETS && packetManifest.counts.rows===ROWS && packetManifest.counts.image_failures===0,'packet manifest count/failure drift');
  for (const p of packetManifest.packets) {
    const rows=readJsonl(path.join(outputRoot,p.rows_path)); assert(rows.length===PACKET_SIZE,`packet ${p.packet_id} size drift`); rows.forEach(auditBlindRow);
    assert(fileSha(path.join(outputRoot,p.rows_path))===p.rows_sha256,`packet ${p.packet_id} rows drift`);
    for (const row of rows) assert(fileSha(path.join(outputRoot,row.image.local_path))===row.image.sha256,`image drift ${row.neutral_id}`);
  }
  const primary=readJsonl(path.join(outputRoot,'reviews/primary/labels.jsonl')); const blind=readJsonl(path.join(outputRoot,'reviews/blind/labels.jsonl'));
  const primarySide=JSON.parse(fs.readFileSync(path.join(outputRoot,'reviews/primary/reviewer.json'),'utf8'));
  const blindSide=JSON.parse(fs.readFileSync(path.join(outputRoot,'reviews/blind/reviewer.json'),'utf8'));
  assert(primarySide.reviewer_id && blindSide.reviewer_id && primarySide.reviewer_id!==blindSide.reviewer_id,'reviewer identities must be nonempty and disjoint');
  assert(primary.length===ROWS && blind.length===ROWS,'completion requires 300 primary and 300 blind rows');
  const ajv=new Ajv({allErrors:true,strict:false});addFormats(ajv);const validateLabel=ajv.compile(JSON.parse(fs.readFileSync(abs('docs/dataset-factory/label-schema.v0.json'),'utf8')));
  for(const row of [...primary,...blind]) assert(validateLabel(row.label),`label schema error for ${row.record_id}: ${ajv.errorsText(validateLabel.errors)}`);
  assertUnique(primary,r=>r.record_id,'primary ID'); assertUnique(blind,r=>r.record_id,'blind ID');
  const expected=new Set(selection.map(r=>r.record_id)); assert(primary.every(r=>expected.has(r.record_id))&&blind.every(r=>expected.has(r.record_id)),'review IDs do not match selection');
  const dispositions=readJsonl(path.join(outputRoot,'search/search-silver-dispositions-v1.jsonl'));
  assert(dispositions.length===49,'completion requires 49 silver dispositions'); assertUnique(dispositions,r=>r.task_id,'silver task ID');
  const allowed=new Set(['reviewed_gold','revised_and_reviewed','stress_only','rejected_with_reason']);
  assert(dispositions.every(r=>allowed.has(r.disposition) && r.component_id && r.split),'invalid search disposition or missing V1 authority');
  const adjudications=readJsonl(path.join(outputRoot,'adjudication/adjudications-v1.jsonl'));
  assert(adjudications.length===ROWS,'completion requires 300 adjudications');
  assert(adjudications.every(r=>['promoted','held','rejected','unresolved'].includes(r.disposition)),'invalid adjudication disposition');
  const promoted=adjudications.filter(r=>r.disposition==='promoted');
  assert(promoted.every(r=>r.primary_supported&&r.blind_supported&&!r.blocking_issue),'unsupported promotion');
  assert(promoted.length>=200 || fs.existsSync(path.join(outputRoot,'adjudication/approved-continuation-shortfall.json')),'fewer than 200 promoted without approved continuation');
  const report=JSON.parse(fs.readFileSync(path.join(outputRoot,'adjudication/completion-report-v1.json'),'utf8'));
  assert(report.schema_version==='gold_label_batch_002_completion_report_v1.0.0','completion report schema drift');
  assert(report.blocking_issues===0&&report.schema_issues===0,'completion report has blocking/schema issues');
  assert(report.agreement_metrics&&report.adjudication_change_metrics,'agreement/change metrics required');
  assert(report.class_support&&report.trainability,'class support/trainability report required');
  assert(Object.values(report.trainability).every((r:any)=>r.trainable===false||r.reviewed>=100&&r.minority>=30),'trainable binary target lacks 100 reviewed/30 minority support');
  return { selection: selection.length, primary: primary.length, blind: blind.length, silver: dispositions.length, promoted: promoted.length };
}
