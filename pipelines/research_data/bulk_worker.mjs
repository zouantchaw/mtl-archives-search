// Isolated transfer service. Bindings are research-only; production is HTTP GET only.
import allowed from './allowed.mjs';
const MAX_BYTES=512*1024*1024, PART=8*1024*1024;
const hosts=new Set(['depot.ville.montreal.qc.ca','archivesdemontreal.com','www.archivesdemontreal.com']);
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const key=sha=>`sha256/${sha.slice(0,2)}/${sha}`;
export function sniff(bytes,fallback){
 if(bytes[0]===255&&bytes[1]===216)return 'image/jpeg';
 if((bytes[0]===73&&bytes[1]===73)||(bytes[0]===77&&bytes[1]===77))return 'image/tiff';
 if(bytes[0]===37&&bytes[1]===80&&bytes[2]===68&&bytes[3]===70)return 'application/pdf';
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';
 return fallback;
}
export function checkSource(url,delivery=false){
 const u=new URL(url);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||
    !(hosts.has(u.hostname)||(delivery&&u.hostname==='pub-6a29793ea7664738880d1cc5afb21b87.r2.dev')))throw Error('source_url_not_allowed');
}
async function fetchSource(url,delivery){
 for(let i=0;i<6;i++){
  checkSource(url,delivery);
  const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'mtl-archives-research-backfill/1.0','Accept-Encoding':'identity'},signal:AbortSignal.timeout(180000)});
  if(r.status>=300&&r.status<400){const next=r.headers.get('Location');await r.body?.cancel();if(!next)throw Error('redirect_without_location');url=new URL(next,url).href;continue;}
  if(!r.ok){await r.body?.cancel();throw Error(`source_http_${r.status}`);}
  if(!r.body)throw Error('source_empty_body');
  if(Number(r.headers.get('Content-Length'))>MAX_BYTES){await r.body.cancel();throw Error('source_exceeds_512_mib_limit');}
  return {r,url};
 }
 throw Error('too_many_source_redirects');
}
async function hashBody(body){const hash=new crypto.DigestStream('SHA-256');await body.pipeTo(hash);return hex(await hash.digest);}
async function readback(bucket,sha,size){
 const object=await bucket.get(key(sha));
 if(!object||object.size!==size||await hashBody(object.body)!==sha)throw Error('r2_readback_integrity_failed');
}
async function persistFixed(bucket,body,mime,length){
 if(!Number.isSafeInteger(length)||length<=0||length>MAX_BYTES)throw Error('source_size_outside_limit');
 const scratch=`staging/${crypto.randomUUID()}`,stream=new FixedLengthStream(length);
 const hash=new crypto.DigestStream('SHA-256'),hashWriter=hash.getWriter(),fileWriter=stream.writable.getWriter(),reader=body.getReader();
 // An explicit pump keeps both writes under backpressure. No tee can accumulate
 // an entire slow branch, and no image-sized buffer is allocated in the Worker.
 const pump=(async()=>{let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(!total)mime=sniff(value,mime);total+=value.length;
   if(total>length)throw Error('source_exceeds_declared_size');await hashWriter.write(value);await fileWriter.write(value);}
   if(total!==length)throw Error('source_truncated');await hashWriter.close();await fileWriter.close();
  }catch(e){await reader.cancel().catch(()=>{});await hashWriter.abort().catch(()=>{});await fileWriter.abort(e).catch(()=>{});throw e;}
 })();
 try{
  await Promise.all([pump,bucket.put(scratch,stream.readable,{httpMetadata:{contentType:mime}})]);
  const sha=hex(await hash.digest);
  if(!await bucket.head(key(sha))){const tmp=await bucket.get(scratch);await bucket.put(key(sha),tmp.body,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:mime},customMetadata:{sha256:sha}});}
  await readback(bucket,sha,length);
  return {sha256:sha,area:'sources',object_key:key(sha),size_bytes:length,media_type:mime};
 }finally{await bucket.delete(scratch);}
}
async function persist(bucket,body,mime,length){
 if(length)return persistFixed(bucket,body,mime,length);
 // Multipart scratch upload bounds memory and supports unknown Content-Length.
 const scratch=`staging/${crypto.randomUUID()}`;
 const upload=await bucket.createMultipartUpload(scratch,{httpMetadata:{contentType:mime}});
 const hash=new crypto.DigestStream('SHA-256'), writer=hash.getWriter(), reader=body.getReader();
 const parts=[];let buffer=new Uint8Array(PART),used=0,total=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   if(!total)mime=sniff(value,mime);
   total+=value.length;if(total>MAX_BYTES)throw Error('source_exceeds_512_mib_limit');
   await writer.write(value);
   let offset=0;while(offset<value.length){const n=Math.min(PART-used,value.length-offset);buffer.set(value.subarray(offset,offset+n),used);used+=n;offset+=n;
    if(used===PART){parts.push(await upload.uploadPart(parts.length+1,buffer));buffer=new Uint8Array(PART);used=0;}}
  }
  if(!total)throw Error('empty_source');
  if(used)parts.push(await upload.uploadPart(parts.length+1,buffer.subarray(0,used)));
  await writer.close();const sha=hex(await hash.digest);await upload.complete(parts);
  const existing=await bucket.head(key(sha));
  if(!existing){const tmp=await bucket.get(scratch);
   await bucket.put(key(sha),tmp.body,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:mime},customMetadata:{sha256:sha}});
  }
  await readback(bucket,sha,total);
  return {sha256:sha,area:'sources',object_key:key(sha),size_bytes:total,media_type:mime};
 }catch(e){await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});await upload.abort().catch(()=>{});throw e;}
 finally{await bucket.delete(scratch);}
}
async function acquire(env,request){
 const {alias,role}=await request.json(),row=allowed.records[alias];
 if(!row||!['legacy_delivery','source_original'].includes(role))return json({error:'unknown_selection'},400);
 const receiptKey=`receipts/${allowed.job_id}/${alias}/${role}.json`;
 const prior=await env.SOURCES.get(receiptKey);
 if(prior)return json(await prior.json());
 const requested_at=new Date().toISOString();let outcome;
 try{
  const source=role==='legacy_delivery'?`https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/${row.image_key}`:row.url;
  const {r,url}=await fetchSource(source,role==='legacy_delivery');
  if(role==='legacy_delivery'&&r.headers.get('ETag')?.replaceAll('"','')!==row.etag){await r.body.cancel();throw Error('production_etag_changed_since_frozen_inventory');}
  const mime=role==='legacy_delivery'?'image/jpeg':(r.headers.get('Content-Type')?.split(';')[0]||'application/octet-stream');
  const metadata={http_status:r.status,final_url:url,content_type:mime,etag:r.headers.get('ETag'),last_modified:r.headers.get('Last-Modified')};
  const declared=Number(r.headers.get('Content-Length'));
  const length=role==='legacy_delivery'?row.expected_size:(declared||undefined);
  const blob=await persist(env.SOURCES,r.body,mime,length);
  outcome={status:'preserved',requested_at,source_url:source,blob,request:metadata};
 }catch(e){outcome={status:'failed',requested_at,error:String(e.message||e)};}
 await env.SOURCES.put(receiptKey,JSON.stringify(outcome),{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});
 const saved=await env.SOURCES.get(receiptKey);return json(await saved.json());
}
export default {async fetch(request,env){
 if(!env.BULK_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.BULK_TOKEN}`)return json({error:'unauthorized'},401);
 const u=new URL(request.url);
 try{
  if(request.method==='GET'&&u.pathname==='/health')return json({job_id:allowed.job_id,records:Object.keys(allowed.records).length});
  if(request.method==='POST'&&u.pathname==='/acquire')return await acquire(env,request);
  if(request.method==='POST'&&u.pathname==='/artifacts'){
   const {artifacts}=await request.json();if(!Array.isArray(artifacts)||artifacts.length>25)return json({error:'artifact_batch_limit'},400);
   const results=[];
   for(let offset=0;offset<artifacts.length;offset+=4){
    results.push(...await Promise.all(artifacts.slice(offset,offset+4).map(async a=>{
     if(!/^[a-f0-9]{64}$/.test(a.sha256)||!['sources','derived'].includes(a.area))throw Error('invalid_artifact_batch');
     const bytes=Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0));if(bytes.length>4*1024*1024||hex(await crypto.subtle.digest('SHA-256',bytes))!==a.sha256)throw Error('artifact_batch_hash_mismatch');
     const bucket=a.area==='sources'?env.SOURCES:env.DERIVED;
     await bucket.put(key(a.sha256),bytes,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:a.media_type}});
     await readback(bucket,a.sha256,bytes.length);return {sha256:a.sha256,verified:true};
    })));
   }
   return json(results);
  }
  if(request.method==='GET'&&u.pathname==='/blob'){
   const sha=u.searchParams.get('sha'),area=u.searchParams.get('area');if(!/^[a-f0-9]{64}$/.test(sha)||!['sources','derived'].includes(area))return json({error:'invalid_blob'},400);
   const obj=await (area==='sources'?env.SOURCES:env.DERIVED).get(key(sha));
   return obj?new Response(obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'application/octet-stream','Content-Length':String(obj.size),'Cache-Control':'no-store'}}):json({error:'missing_blob'},404);
  }
  if(request.method==='PUT'&&u.pathname==='/artifact'){
   const sha=u.searchParams.get('sha'),area=u.searchParams.get('area');if(!/^[a-f0-9]{64}$/.test(sha)||!['sources','derived'].includes(area))return json({error:'invalid_blob'},400);
   const length=Number(request.headers.get('Content-Length'));if(!length||length>4*1024*1024)return json({error:'metadata_upload_limit'},400);
   const bytes=await request.arrayBuffer();if(hex(await crypto.subtle.digest('SHA-256',bytes))!==sha)return json({error:'hash_mismatch'},409);
   const bucket=area==='sources'?env.SOURCES:env.DERIVED;
   await bucket.put(key(sha),bytes,{onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:request.headers.get('Content-Type')||'application/json'},customMetadata:{sha256:sha}});
   await readback(bucket,sha,bytes.byteLength);return json({sha256:sha,verified:true});
  }
  if(request.method==='POST'&&u.pathname==='/catalog'){
   const {batch}=await request.json();if(!Array.isArray(batch)||batch.length>1000)return json({error:'batch_limit'},400);
   if(batch.some(q=>typeof q.sql!=='string'||!/^(SELECT|INSERT)\b/i.test(q.sql)||q.sql.includes(';')))return json({error:'query_not_allowed'},400);
   const results=await env.CATALOG.batch(batch.map(q=>env.CATALOG.prepare(q.sql).bind(...(q.params||[]))));return json(results);
  }
  return json({error:'unknown_operation'},404);
 }catch(e){return json({error:String(e.message||e)},500);}
}};
