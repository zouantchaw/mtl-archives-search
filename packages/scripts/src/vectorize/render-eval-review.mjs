import fs from 'node:fs';
import path from 'node:path';
import {dir,read} from './repair-search.mjs';
const phases=process.argv.slice(2);if(!phases.length)phases.push('before','preview');
const datasets=phases.map(p=>({phase:p,rows:read(`eval-${p}.json`)}));
const queries=datasets[0].rows.filter(r=>r.mode==='smart').map(r=>r.query);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
for(let i=0;i<queries.length;i++) {
  const query=queries[i];
  const html=`<!doctype html><meta charset="utf-8"><title>${esc(query)} — search review</title>
  <style>body{font:16px system-ui;margin:16px;background:#f5f2eb}section{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}img{width:100%;height:230px;object-fit:contain;background:#ddd}figure{margin:0}figcaption{font-size:13px}h2{margin:12px 0}</style><h1>${esc(query)}</h1>`+
  datasets.map(({phase,rows})=>`<h2>${esc(phase)}</h2><section>`+(rows.find(r=>r.query===query&&r.mode==='smart')?.items??[]).slice(0,5).map((r,j)=>{
    const src = r.imageSizeBytes < 10000000 ? r.imageUrl : `https://www.mtlarchives.com/_next/image?url=${encodeURIComponent(r.imageUrl)}&w=384&q=75`;
    return `<figure><img src="${esc(src)}"><figcaption>#${j+1} ${esc(r.metadataFilename)}<br>${esc(r.source)}</figcaption></figure>`;
  }).join('')+'</section>').join('');
  fs.writeFileSync(path.join(dir,`review-${i}.html`),html);
}
console.log(`Wrote ${queries.length} review pages in ${dir}`);
