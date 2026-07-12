import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import { CSV_RESOURCE_ID,SAMPLE_BYTES,SIGNED_QUERY_NAMES,SOURCES,captureDocument,captureImage,imageMagic,parseGroundRows,safeUrl,sanitizeSignedCsvRedirect,sha256,verifyAerialPageText } from './real-pilot-source-acquisition-v1.js';

async function rejects(fn:()=>unknown|Promise<unknown>,pattern:RegExp){await assert.rejects(async()=>fn(),pattern);}
async function main(){
  assert.throws(()=>safeUrl('http://depot.ville.montreal.qc.ca/a.jpg'),/unsafe protocol/);
  assert.throws(()=>safeUrl('https://evil.test/a.jpg'),/unsafe host/);
  assert.throws(()=>safeUrl('https://depot.ville.montreal.qc.ca/a.jpg?token=secret'),/query strings/);
  const signed=`https://montreal-prod.storage.googleapis.com/resources/${CSV_RESOURCE_ID}/photothequearchives.csv?X-Goog-Algorithm=a&X-Goog-Credential=redacted-test&X-Goog-Date=d&X-Goog-Expires=e&X-Goog-SignedHeaders=h&X-Goog-Signature=redacted-test`;
  assert.deepEqual(sanitizeSignedCsvRedirect(signed),{redirect_host:'montreal-prod.storage.googleapis.com',redirect_path:`/resources/${CSV_RESOURCE_ID}/photothequearchives.csv`,query_parameter_names:['X-Goog-Algorithm','X-Goog-Credential','X-Goog-Date','X-Goog-Expires','X-Goog-Signature','X-Goog-SignedHeaders'],signed_transport_redacted:true});
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('montreal-prod.storage.googleapis.com','evil.test')),/exact origin mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('montreal-prod.storage.googleapis.com','montreal-prod.storage.googleapis.com:444')),/exact origin mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace(CSV_RESOURCE_ID,'wrong')),/exact path mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('/resources/','/prefix/resources/')),/exact path mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('/resources/','/%72esources/')),/exact path mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('/photothequearchives.csv','/photothequearchives.csv/extra')),/exact path mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(`${signed}&X-Goog-Extra=x`),/query-name mismatch/);
  const mixed=signed.replace('X-Goog-Signature=','x-goog-signature=').replace('X-Goog-Date=','x-GoOg-DaTe=');
  assert.deepEqual(sanitizeSignedCsvRedirect(mixed).query_parameter_names,[...SIGNED_QUERY_NAMES].sort());
  assert.throws(()=>sanitizeSignedCsvRedirect(`${signed}&x-goog-signature=collision`),/case-insensitive duplicate/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('X-Goog-Date=d&','')),/query-name mismatch/);
  assert.throws(()=>sanitizeSignedCsvRedirect(signed.replace('X-Goog-Date=d','X-Goog-Date=')),/blank value/);
  assert(verifyAerialPageText(Buffer.from('Collection de photographies aeriennes; fichiers TIFF; carte index; limites approximatives et images non georeferencees.')));
  assert(!verifyAerialPageText(Buffer.from('Photographs only.')));
  assert.equal(imageMagic(Buffer.from([0xff,0xd8,0xff,0xe0])),'jpeg');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-acq-'));let server:http.Server;
  server=http.createServer((req,res)=>{const base=`http://127.0.0.1:${(server.address() as any).port}`,validators={etag:'"fixture-etag"','last-modified':'Wed, 01 Jan 2025 00:00:00 GMT'};if(req.url==='/redirect'){res.writeHead(302,{location:`${base}/image`}).end();return;}if(req.url==='/unsafe-redirect'){res.writeHead(302,{location:'https://evil.test/x'}).end();return;}if(req.url==='/image'){const b=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(20)]);res.writeHead(req.method==='HEAD'?200:206,{'content-type':'image/jpeg','content-length':String(b.length),'content-range':`bytes 0-${b.length-1}/${b.length}`,...validators});res.end(req.method==='HEAD'?undefined:b);return;}if(req.url==='/ignored'){const b=Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(SAMPLE_BYTES+1)]);res.writeHead(200,{'content-type':'image/jpeg','content-length':String(b.length),...validators}).end(req.method==='HEAD'?undefined:b);return;}if(req.url==='/html'){const b=Buffer.from('<html>no</html>');res.writeHead(req.method==='HEAD'?200:206,{'content-type':'text/html','content-length':String(b.length),...validators}).end(req.method==='HEAD'?undefined:b);return;}if(req.url==='/big'){res.writeHead(200,{'content-type':'text/html','content-length':String(9*1024*1024)}).end();return;}res.writeHead(404).end();});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try{const ok=await captureImage(0,`${base}/redirect`,root,true);assert.equal(ok.status,206);assert.equal(ok.redirects.length,1);await rejects(()=>captureImage(0,`${base}/unsafe-redirect`,root,true),/unsafe host/);await rejects(()=>captureImage(0,`${base}/ignored`,root,true),/range ignored|oversized body/);await rejects(()=>captureImage(0,`${base}/html`,root,true),/total mismatch|masquerading/);await rejects(()=>captureDocument('x',`${base}/big`,root,true),/oversized body/);}finally{server.close();fs.rmSync(root,{recursive:true,force:true});}
  const header='Cote,URL\n';const rows=['VM94,SY,SS1,SSS17,D1','VM94,SY,SS1,SSS17,D12','VM94,SY,SS1,SSS17,D180,P3','VM94,SY,SS1,SSS17,D180,P4','VM94,SY,SS1,SSS17,D180,P5','VM94,SY,SS1,SSS17,D183,P14'].map(()=>',').join('\n');await rejects(async()=>parseGroundRows(Buffer.from(header+rows)),/CSV row mismatch/);
  const officialShape=['Cote,Fichier jpg - 200 dpi',...SOURCES.slice(0,6).map(([,cote,url])=>`"${cote}","${url.replace('https:','http:')}"`)].join('\n')+'\n';
  assert.deepEqual(parseGroundRows(Buffer.from(officialShape)).map(row=>row.numeric_id),[0,10,100,101,102,105]);
  const descriptor=Buffer.from('bound');assert.notEqual(sha256(Buffer.from('tampered')),sha256(descriptor));
  console.log('real-pilot source acquisition: adversarial tests passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
