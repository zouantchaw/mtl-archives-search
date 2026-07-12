import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MONOREPO_ROOT } from './verified-multimodal-batch-001-contract.js';
import { sha256 } from './real-pilot-candidate-selection-v1.js';
const builder=path.join(MONOREPO_ROOT,'packages/scripts/src/dataset-factory/build-real-pilot-visual-promotion-v1.ts'),out=path.join(MONOREPO_ROOT,'data/mtl_archives/reports/verified_multimodal_batch_001_real_pilot/promotion');
function run(args:string[]=[],ok=true,env=process.env){const r=spawnSync(process.execPath,[path.join(MONOREPO_ROOT,'node_modules/tsx/dist/cli.mjs'),builder,...args],{cwd:MONOREPO_ROOT,env,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr||r.stdout);else assert.notEqual(r.status,0);return r.stderr+r.stdout;}
function digest(){const files:string[]=[];const walk=(d:string)=>fs.readdirSync(d).sort().forEach(n=>{const f=path.join(d,n);fs.statSync(f).isDirectory()?walk(f):files.push(f)});walk(out);return sha256(files.map(f=>`${path.relative(out,f)}\t${sha256(fs.readFileSync(f))}`).join('\n'));}
run();const first=digest();run();const second=digest();assert.equal(first,second);run(['--verify-output']);
const extra=path.join(out,'unlisted.txt');fs.writeFileSync(extra,'tamper\n');assert.match(run(['--verify-output'],false),/exact output membership mismatch/);fs.rmSync(extra);run(['--verify-output']);
const descriptor=path.join(MONOREPO_ROOT,'docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-selection-v1.json'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'issue69-promotion-descriptor-')),bad=path.join(tmp,'candidate.json');fs.copyFileSync(descriptor,bad);fs.appendFileSync(bad,' ');assert.match(run([],false,{...process.env,ISSUE69_INPUT_DESCRIPTOR:bad}),/approved hash drift/);fs.rmSync(tmp,{recursive:true,force:true});
const promotions=fs.readFileSync(path.join(out,'promotions-v1.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.equal(promotions.length,16);assert.equal(promotions.filter(x=>x.disposition==='selected').length,12);assert.equal(promotions.filter(x=>x.disposition==='reserve').length,4);
console.log(JSON.stringify({status:'ok',deterministic_tree_sha256:second,builder_runs:3,descriptor_verifications:2,tamper_rejected:true,stale_input_rejected:true,full_visual_output_membership:true}));
