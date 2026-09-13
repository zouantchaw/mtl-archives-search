/** Staged canonical search repair. No writes unless an explicit phase is selected.
 * node packages/scripts/src/vectorize/repair-search.mjs snapshot|prepare|build|verify|captions
 * Old indexes and a D1 manifest snapshot are retained for rollback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { reconcile, buildSearchText, hash, textVersion } from './repair-lib.mjs';
export const root = fileURLToPath(new URL('../../../../', import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
export const dir = path.join(root,'data/mtl_archives/reports/search-repair-20260912');
fs.mkdirSync(dir,{recursive:true});
export const database = '5c847f8e-5f2a-4d5e-8a7d-fae70025c398';
export const indexes = { text:'mtl-archives-text-canonical-20260912', clip:'mtl-archives-clip-canonical-20260912' };
const account=process.env.CLOUDFLARE_ACCOUNT_ID||process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN||process.env.CF_AI_TOKEN||process.env.CLOUDFLARE_AI_TOKEN;
export const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2));
export const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const jsonl=p=>fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse);
export async function api(route,body,method=body?'POST':'GET',raw=false) {
  if(!account||!token) throw Error('Missing Cloudflare credentials');
  for(let attempt=0;attempt<6;attempt++) {
    let response;
    try { response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${route}`,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':raw?'application/x-ndjson':'application/json'},
      ...(body?{body:raw?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
    } catch(error) {
      if(attempt===5)throw error;
      await new Promise(r=>setTimeout(r,1000*2**attempt));continue;
    }
    const result=await response.json();
    if(response.ok&&result.success) return result.result;
    if((response.status===429||response.status>=500)&&attempt<5) { await new Promise(r=>setTimeout(r,1000*2**attempt));continue; }
    throw Error(`${method} ${route}: ${response.status} ${JSON.stringify(result.errors)}`);
  }
}
export async function sql(query,params=[]) { return api(`/d1/database/${database}/query`,{sql:query,params}); }
export async function listIds(index) {
  const ids=[];let cursor;
  do {
    const result=await api(`/vectorize/v2/indexes/${index}/list?count=1000${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
    ids.push(...result.vectors.map(v=>v.id));cursor=result.isTruncated?result.nextCursor:null;
  } while(cursor);
  if(new Set(ids).size!==ids.length)throw Error('Duplicate IDs in vector enumeration');
  return ids;
}
async function snapshot() {
  if(!fs.existsSync(path.join(dir,'manifest-before.json'))) {
    const rows=[];
    for(let offset=0;;offset+=500) {
      const batch=(await sql('SELECT * FROM manifest ORDER BY metadata_filename LIMIT 500 OFFSET ?',[offset]))[0].results;
      rows.push(...batch); if(batch.length<500) break;
    }
    save('manifest-before.json',rows);console.log('D1 snapshot',rows.length);
  }
  for(const index of ['mtl-archives','mtl-archives-clip']) {
    const filename=`${index}-ids.json`;
    if(!fs.existsSync(path.join(dir,filename))) save(filename,await listIds(index));
    console.log(index,read(filename).length);
  }
}
function prepare() {
  const result=reconcile(read('manifest-before.json'),jsonl(path.join(root,'data/mtl_archives/manifest_deduped.jsonl')),jsonl(path.join(root,'data/mtl_archives/manifest_vlm_complete.jsonl')));
  save('canonical.json',result.rows);
  fs.writeFileSync(path.join(root,'data/mtl_archives/manifest_search_canonical.jsonl'),result.rows.map(r=>JSON.stringify(r)).join('\n')+'\n'); save('aliases.json',result.aliases);save('conflicts.json',result.conflicts);save('rejected.json',result.rejected);
  const ids=new Set(result.rows.map(r=>r.metadata_filename));
  const summary={records:ids.size,captions:result.rows.filter(r=>r.vlm_caption).length,conflicts:result.conflicts.length,rejected:result.rejected.length,aliases:Object.keys(result.aliases).length,indexes:{}};
  for(const old of ['mtl-archives','mtl-archives-clip']) {
    const vectors=read(`${old}-ids.json`);const covered=new Set(vectors.map(id=>result.aliases[id]).filter(Boolean));
    summary.indexes[old]={vectors:vectors.length,orphans:vectors.filter(id=>!ids.has(id)).length,unmapped:vectors.filter(id=>!result.aliases[id]).length,canonicalCoverage:covered.size,missing:[...ids].filter(id=>!covered.has(id))};
  }
  save('reconciliation.json',summary); console.log(JSON.stringify(summary));
}
async function ensureIndex(index,dimensions) {
  const existing=await api('/vectorize/v2/indexes');
  if(!existing.some(i=>i.name===index))await api('/vectorize/v2/indexes',{name:index,description:'Canonical repair 2026-09-12; old index retained',config:{dimensions,metric:'cosine'}});
}
async function upload(index,vectors) {
  for(let i=0;i<vectors.length;i+=100) {
    const payload=vectors.slice(i,i+100).map(v=>JSON.stringify(v)).join('\n')+'\n';
    const checkpoint=`uploaded-${index}-${i}-${hash(payload).slice(0,12)}.json`;
    if(!fs.existsSync(path.join(dir,checkpoint))) save(checkpoint,await api(`/vectorize/v2/indexes/${index}/upsert`,payload,'POST',true));
    if(i%1000===0)console.log('Vector upload',index,i,vectors.length);
  }
}
async function build() {
  const rows=read('canonical.json');const aliases=read('aliases.json');
  for(const [kind,dimensions] of [['clip',512],['text',1024]]) await ensureIndex(indexes[kind],dimensions);
  // Fetch every old CLIP vector; prefer exact canonical vectors, then verified aliases.
  const cache=path.join(dir,'clip-vectors.json');
  if(!fs.existsSync(cache)) {
    const ids=read('mtl-archives-clip-ids.json'),vectors=[];
    for(let i=0;i<ids.length;i+=60) {
      const batches=await Promise.all([0,20,40].filter(j=>i+j<ids.length).map(async j=>{
        const name=`clip-export-${i+j}.json`;
        if(fs.existsSync(path.join(dir,name)))return read(name);
        const batch=await api('/vectorize/v2/indexes/mtl-archives-clip/get_by_ids',{ids:ids.slice(i+j,i+j+20)});
        save(name,batch);return batch;
      }));
      vectors.push(...batches.flat());
      if(i%600===0)console.log('CLIP export',i,ids.length);
      await new Promise(r=>setTimeout(r,650));
    }
    save('clip-vectors.json',vectors);
  }
  const byId=new Map(read('clip-vectors.json').map(v=>[v.id,v]));
  const clip=[],missing=[];
  for(const row of rows) {
    const source=[row.metadata_filename,...row.verified_aliases].map(id=>byId.get(id)).find(Boolean);
    if(!source){missing.push(row.metadata_filename);continue;}
    if(source.values.length!==512||!source.values.every(Number.isFinite))throw Error('Invalid CLIP vector');
    clip.push({id:row.metadata_filename,values:source.values,metadata:{image:row.resolved_image_filename||row.image_filename,sourceId:source.id,version:textVersion}});
  }
  save('clip-missing.json',missing);save('clip-canonical.json',clip);
  await upload(indexes.clip,clip);console.log('CLIP uploaded',clip.length,'missing',missing.length);
  // Resumable embedding batches. Content hashes prevent reusing vectors after text changes.
  const text=[];
  for(let i=0;i<rows.length;i+=32) {
    const batch=rows.slice(i,i+32),texts=batch.map(buildSearchText),key=hash(JSON.stringify(texts));
    const name=`text-batch-${i}-${key.slice(0,12)}.json`;
    let data;
    if(fs.existsSync(path.join(dir,name)))data=read(name);
    else { data=(await api('/ai/run/@cf/baai/bge-m3',{text:texts})).data;save(name,data); }
    if(data.length!==batch.length||data.some(v=>v.length!==1024||!v.every(Number.isFinite)))throw Error('Invalid text embedding response');
    text.push(...batch.map((r,j)=>({id:r.metadata_filename,values:data[j],metadata:{textHash:hash(texts[j]),version:textVersion,model:'@cf/baai/bge-m3'}})));
    if(i%320===0)console.log('Text embeddings',i,rows.length);
  }
  save('text-canonical.json',text);await upload(indexes.text,text);console.log('Text uploaded',text.length);
}
async function verify() {
  const canonical=new Set(read('canonical.json').map(r=>r.metadata_filename)),report={};
  for(const [kind,index] of Object.entries(indexes)) {
    const ids=await listIds(index);const expected=read(`${kind}-canonical.json`);
    const orphans=ids.filter(id=>!canonical.has(id));const found=new Set(ids);
    const missing=expected.filter(v=>!found.has(v.id)).map(v=>v.id);
    report[kind]={count:ids.length,expected:expected.length,orphans,missing,info:await api(`/vectorize/v2/indexes/${index}/info`)};
    if(orphans.length||missing.length||ids.length!==expected.length) {save('verification.json',report);throw Error(`${kind}: index not ready or inconsistent`);}
    const sample=[...expected.slice(0,8),...expected.slice(-8)];
    const stored=await api(`/vectorize/v2/indexes/${index}/get_by_ids`,{ids:sample.map(v=>v.id)});
    for(const wanted of sample) {
      const found=stored.find(v=>v.id===wanted.id);
      if(!found||found.values.length!==wanted.values.length||found.values.some((v,j)=>Math.abs(v-wanted.values[j])>1e-5))throw Error(`${kind}: stored vector differs for ${wanted.id}`);
      if(kind==='text'&&found.metadata?.textHash!==wanted.metadata.textHash)throw Error('Text provenance mismatch');
    }
    report[kind].verifiedVectorSamples=sample.length;
  }
  save('verification.json',report);console.log(JSON.stringify(report));
}
async function captions() {
  const verified=read('verification.json');
  if(!verified.text?.verifiedVectorSamples||!verified.clip?.verifiedVectorSamples)throw Error('Verify both indexes before importing captions');
  // Additive schema; never recreate manifest or touch game/payment/newsletter tables.
  const columns=new Set((await sql('PRAGMA table_info(manifest)'))[0].results.map(r=>r.name));
  for(const column of ['vlm_caption_source','vlm_caption_model','vlm_caption_status'])if(!columns.has(column))await sql(`ALTER TABLE manifest ADD COLUMN ${column} TEXT`);
  // The three idempotent ALTERs above apply exactly migration 0012. Register it
  // when Wrangler migration history exists, so a later deploy does not repeat them.
  const history=(await sql("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'"))[0].results;
  if(history.length)await sql("INSERT INTO d1_migrations(name) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name=?)",['0012_caption_provenance.sql','0012_caption_provenance.sql']);
  const rows=read('canonical.json').filter(r=>r.vlm_caption);
  for(let i=0;i<rows.length;i+=100) {
    const batch=rows.slice(i,i+100).map(r=>[r.metadata_filename,r.vlm_caption,r.caption_source,r.caption_model,r.caption_status]);
    await sql(`WITH incoming AS (
      SELECT json_extract(value,'$[0]') AS id, json_extract(value,'$[1]') AS caption,
        json_extract(value,'$[2]') AS source, json_extract(value,'$[3]') AS model,
        json_extract(value,'$[4]') AS status FROM json_each(?)
      ) UPDATE manifest SET vlm_caption=incoming.caption, vlm_caption_source=incoming.source,
        vlm_caption_model=incoming.model, vlm_caption_status=incoming.status
      FROM incoming WHERE manifest.metadata_filename=incoming.id AND (manifest.vlm_caption IS NULL OR manifest.vlm_caption='')`,[JSON.stringify(batch)]);
    if(i%1000===0)console.log('Caption import',i,rows.length);
  }
  save('caption-import-verification.json',(await sql("SELECT COUNT(*) AS total, SUM(vlm_caption IS NOT NULL AND vlm_caption!='') AS captions FROM manifest"))[0].results);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const actions={snapshot,prepare,build,verify,captions,'upload-text':()=>upload(indexes.text,read('text-canonical.json'))};
  const action=actions[process.argv[2]];if(!action)throw Error('Choose snapshot|prepare|build|verify|captions');
  await action();
}
