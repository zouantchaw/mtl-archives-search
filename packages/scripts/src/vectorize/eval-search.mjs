import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dir,save } from './repair-search.mjs';
const run=promisify(execFile);
const cases=JSON.parse(fs.readFileSync(new URL('./search-eval-cases.json',import.meta.url),'utf8'));
const phase=process.argv[2],base=process.argv[3]||'https://www.mtlarchives.com';
if(!/^[a-z0-9-]+$/.test(phase??''))throw Error('Supply output phase and optional API base');
const results=[];
for(const c of cases) {
  for(const mode of c.exact?['smart']:['smart','visual','semantic']) {
    const filename=path.join(dir,`${phase}-${encodeURIComponent(c.query)}-${mode}.json`);
    const start=Date.now();
    const {stdout}=await run('curl',['-sS','--max-time','60','--retry','2','--retry-delay','2','--retry-all-errors','-G',`${base}/api/search`,'--data-urlencode',`q=${c.query}`,'--data',`mode=${mode}`,'--data','limit=72','-o',filename,'-w','%{http_code}']);
    const data=JSON.parse(fs.readFileSync(filename,'utf8'));
    const ids=(data.items??[]).map(r=>r.metadataFilename.replace('mtl_archives_metadata_','').replace('.json',''));
    results.push({query:c.query,mode,http:Number(stdout),ms:Date.now()-start,count:ids.length,
      knownRelevantRanks:(c.knownRelevant??[]).map(id=>({id,rank:ids.indexOf(id)<0?null:ids.indexOf(id)+1})),
      knownIrrelevantTop5:(c.knownIrrelevant??[]).filter(id=>ids.slice(0,5).includes(id)),
      degraded:data.degraded??false,retrieval:data.retrieval??null,items:data.items??[],error:data.error??null});
  }
  console.log(phase,c.query,results.at(-1).count);
}
save(`eval-${phase}.json`,results);
if(results.some(r=>r.http!==200||r.degraded||Object.values(r.retrieval??{}).some(branch=>branch?.status==='error'||branch?.status==='unavailable')))process.exitCode=1;
