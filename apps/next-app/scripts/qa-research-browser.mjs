import {execFileSync} from 'node:child_process';import fs from 'node:fs';
const session=process.env.QA_SESSION||'mtl-quality';const root=process.env.QA_OUTPUT||'/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-reading-room-quality-2026-09-13/baseline';fs.mkdirSync(root,{recursive:true});
const run=(args,input)=>execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',input,timeout:130000,env:{...process.env,AGENT_BROWSER_DEFAULT_TIMEOUT:'120000'}});
function evaluate(code){const result=JSON.parse(run(['eval','--stdin','--json'],code));if(!result.success)throw new Error(JSON.stringify(result));return result.data.result;}
function capture(name){
 const data=evaluate('JSON.parse(localStorage.getItem("mtl-reading-room-v1"))');fs.writeFileSync(`${root}/${name}.json`,JSON.stringify(data,null,2));
 evaluate(`(()=>{const s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}[class*="photoGrid"]{grid-template-columns:repeat(4,minmax(0,1fr))!important}[class*="photoOpen"]{aspect-ratio:1!important}[class*="canvasScroll"]{overflow:visible!important}[class*="room"]{height:auto!important}[class*="workspace"]{min-height:950px!important}';document.head.append(s);document.querySelectorAll('article').forEach(a=>{const img=a.querySelector('img');a.querySelector('p').textContent=new URL(img.src).searchParams.get('id');});return true})()`);
 run(['wait','--fn','Array.from(document.querySelectorAll("article img")).every(i=>i.complete)']);run(['screenshot',`${root}/${name}.png`,'--full']);
 const c=data.messages.flatMap(m=>m.parts.filter(p=>p.type==='tool-searchArchive'&&p.state==='output-available')).at(-1);
 console.log(name,JSON.stringify(c?{input:c.input,checked:c.output.checked,photos:c.output.photos.map(p=>({id:p.id,status:p.visualCheck.status}))}:data.messages.at(-1)));
 run(['open',process.env.QA_URL||'https://www.mtlarchives.com/research?lang=en']);run(['snapshot','-i']);
}
run(['open',process.env.QA_URL||'https://www.mtlarchives.com/research?lang=en']);run(['snapshot','-i']);
const cases=process.env.QA_CASES?JSON.parse(fs.readFileSync(process.env.QA_CASES)):[
 {name:'street-exact',fresh:true,prompt:'street view images with businesses and brands'},
 {name:'street-correction',prompt:'thats not really street view, i mean like first person street view on from the ground yanno'},
 {name:'street-french',fresh:true,prompt:'Des photographies prises depuis le trottoir, au niveau du sol, avec des commerces et des enseignes. Pas de vues aériennes.'},
 {name:'aerial-positive',fresh:true,prompt:'Aerial photographs looking straight down on city streets and buildings.'},
 {name:'church-interior',fresh:true,prompt:'Inside a church, looking toward the altar. No exterior facades.'},
 {name:'trees-water',fresh:true,prompt:'Trees beside water, photographed from the ground, not aerial views.'},
 {name:'impossible',fresh:true,prompt:'A purple elephant standing beside a helicopter.'}
];
for(const c of cases){const start=Date.now();if(!c.captureOnly){if(c.fresh)run(['find','role','button','click','--name','New conversation']);run(['find','label','Ask the archive…','fill',c.prompt]);run(['find','role','button','click','--name','Send question']);run(['wait','--fn','!document.querySelector("button[aria-label=\\"Stop response\\"]")']);}capture(c.name);console.log('Elapsed',((Date.now()-start)/1000).toFixed(1));}
