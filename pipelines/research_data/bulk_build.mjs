// Uses the installed cf Build Output API, avoiding a second deployment toolchain.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=process.cwd(),[allowedPath]=process.argv.slice(2);
const executable=execFileSync('which',['cf'],{encoding:'utf8'}).trim();
const cfRoot=path.dirname(path.dirname(await fs.realpath(executable)));
const utils=await import(path.join(cfRoot,'node_modules/@cloudflare/build-output-utils/dist/index.mjs'));
const configuration=await import(path.join(cfRoot,'node_modules/@cloudflare/config/dist/index.mjs'));
const config=configuration.InputWorkerSchema.parse({name:'mtl-archives-research-transfer',compatibilityDate:'2026-10-02',workersDev:true,previewUrls:false,
 env:{SOURCES:{type:'r2',name:'mtl-archives-research-sources'},DERIVED:{type:'r2',name:'mtl-archives-research-derived'},CATALOG:{type:'d1',name:'mtl-archives-research-catalog',id:'36147ac0-44c6-43db-84bf-6a8d2bb41b8a'}},
 limits:{cpuMs:300000},observability:{enabled:false}});
await utils.writeRootConfig(root,undefined,{isPreview:false});
await utils.writeWorkerConfig({root,config,manifest:{type:'complete',mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm'},'allowed.mjs':{type:'esm'}}}});
const bundle=utils.getWorkerBundleDir(root);await fs.mkdir(bundle,{recursive:true});
await fs.copyFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'bulk_worker.mjs'),path.join(bundle,'worker.mjs'));
await fs.writeFile(path.join(bundle,'allowed.mjs'),'export default '+await fs.readFile(allowedPath,'utf8')+';');
console.log('Built isolated research transfer Worker');
