import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { EXPECTED, FIXED_NOW, OUTPUT, ROOT, SCHEMA_DIR, abs, assert, digestRows, fileSha, inputPaths, readJsonl, schemaDigest, selectRows, sha, verifyInputs, writeJsonl } from './gold-label-batch-002-contract.js';

const { values } = parseArgs({ options: { 'canonical-root': { type: 'string', default: '/Users/wiel/Development/mtl-archives-search' }, output: { type: 'string', default: OUTPUT } } });
const canonicalRoot = path.resolve(values['canonical-root']!); const output = abs(values.output!);
assert(canonicalRoot !== ROOT, 'canonical input checkout must be distinct from isolated worktree');
const data = verifyInputs(canonicalRoot); const selection = selectRows(data);
fs.mkdirSync(output, { recursive: true });

const pinnedDir = path.join(output, 'inputs'); fs.mkdirSync(pinnedDir, { recursive: true });
const copies = [
  ['active-learning-v0-300.jsonl', data.p.queue, EXPECTED.legacyQueue],
  ['quality-model-review-001-gold-20.jsonl', data.p.gold, EXPECTED.predecessorGold],
  ['search-judgments-v0-75.jsonl', data.p.search, EXPECTED.searchJudgments],
] as const;
for (const [name, source, expected] of copies) { const target=path.join(pinnedDir,name); fs.copyFileSync(source,target); assert(fileSha(target)===expected,`copy hash drift: ${name}`); }
writeJsonl(path.join(pinnedDir,'search-silver-v0-49.jsonl'),data.silver); assert(fileSha(path.join(pinnedDir,'search-silver-v0-49.jsonl'))===EXPECTED.silver,'silver copy hash drift');
writeJsonl(path.join(output,'batch/selection-v1.jsonl'),selection);

const laneCounts: Record<string,number>={}; for (const row of selection) for (const lane of row.selection_lanes) laneCounts[lane]=(laneCounts[lane]??0)+1;
const inputManifest={
  schema_version:'gold_label_batch_002_input_manifest_v1.0.0', generated_at:process.env.DATASET_FACTORY_FIXED_NOW??FIXED_NOW,
  issue:68, parent_issue:64, recovery:{bundle_sha256:EXPECTED.recoveryBundle,tree_sha256:EXPECTED.recoveryTree,successor_manifest_sha256:EXPECTED.successorManifest},
  sources:[...copies.map(([name,,hash])=>({path:`inputs/${name}`,sha256:hash})),{path:'inputs/search-silver-v0-49.jsonl',sha256:EXPECTED.silver}],
  authoritative:{identity_path:path.relative(ROOT,data.p.nodes),identity_rows:data.nodes.length,identity_sha256:fileSha(data.p.nodes),metadata_overlay_path:path.relative(ROOT,data.p.corpus),metadata_overlay_rows:data.localCorpus.length,metadata_overlay_sha256:fileSha(data.p.corpus),map_path:path.relative(ROOT,data.p.map),map_rows:data.map.length,map_sha256:fileSha(data.p.map),successor_manifest_contract_sha256:EXPECTED.successorManifest,successor_artifact_manifest_file_sha256:fileSha(data.p.graphManifest)},
};
fs.writeFileSync(path.join(output,'inputs/input-manifest-v1.json'),JSON.stringify(inputManifest,null,2)+'\n');
const contract={
  schema_version:'gold_label_batch_002_selector_contract_v1.0.0', batch_id:'gold_label_batch_002', seed:'gold-label-batch-002', rows:selection.length,
  selector:'score retained v0 signals plus canonical metadata/current recovery availability; fulfill required lanes; stable hash tie-break; one authoritative V1 component per row; exclude predecessor gold',
  family_policy:{max_per_component:1,exceptions:[]}, hidden_worker_fields:['record_id','selection_lanes','selection_rationale','retained_v0_score','component_id','split','metadata','prior_labels','vlm','taxonomy'],
  selection_sha256:digestRows(selection), schema_tree_sha256:schemaDigest(), lane_counts:Object.fromEntries(Object.entries(laneCounts).sort()),
};
fs.writeFileSync(path.join(output,'batch/selector-contract-v1.json'),JSON.stringify(contract,null,2)+'\n');
writeJsonl(path.join(output,'search/search-silver-authority-v1.jsonl'),data.silver.map((r)=>{const m=data.map.find((x)=>x.record_id===r.record_id);assert(m,`silver record absent from V1 map: ${r.record_id}`);return {schema_version:'gold_label_batch_002_search_authority_v1.0.0',task_id:r.task_id,record_id:r.record_id,component_id:m.component_id,split:m.benchmark_split,source_row_sha256:sha(JSON.stringify(r))};}));
writeJsonl(path.join(output,'search/search-silver-dispositions-v1.jsonl'),[]);
console.log(JSON.stringify({status:'built',rows:selection.length,components:new Set(selection.map(r=>r.component_id)).size,selection_sha256:contract.selection_sha256,lane_counts:contract.lane_counts}));
