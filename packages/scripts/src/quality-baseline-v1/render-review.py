"""Render the private owner packet without embedding assistant judgments."""
import json, pathlib, html, sys
root = pathlib.Path(__file__).resolve().parents[4]
out = pathlib.Path(sys.argv[1])
rubric = json.loads((root / 'docs/quality-baseline-v1/caption-rubric-v2.json').read_text())
ids = ['A01','A05','A09','A13','A16','A20','A25','A29','A32','A34','A41','A44']
rows = [r for r in json.loads((out / 'sample.json').read_text()) if r['audit_id'] in ids]
def select(name, title, choices, help_text=''):
    options = '<option value="">Choose…</option>' + ''.join(f'<option value="{html.escape(k)}">{html.escape(v)}</option>' for k,v in choices.items())
    return f'<label for="{name}">{html.escape(title)}</label><p class="help">{html.escape(help_text)}</p><select id="{name}" name="{name}">{options}</select>'
cards=[]
for row in rows:
    id=row['audit_id']
    viewpoint=select(id,'Camera viewpoint', {v:v for v in ['aerial / from above','ground level','interior','uncertain / other']},'Your previous answer is retained. A flying subject does not mean the camera is aerial.')
    questions=''.join(select(id+'-'+q['key'],q['title'],q['options'],q['help']) for q in rubric['dimensions'])
    cards.append(f'<article id="card-{id}"><h2>{id}</h2><img src="images/{id}.jpg" alt="Archive photograph for review {id}">{viewpoint}<h3>Existing caption</h3><blockquote>{html.escape(row["vlm_caption"] or "")}</blockquote>{questions}<label for="{id}-notes">Optional note</label><textarea id="{id}-notes" name="{id}-notes"></textarea><p class="legacy" id="legacy-{id}"></p></article>')
state=(root/'packages/scripts/src/quality-baseline-v1/review-state.mjs').read_text().replace('export function','function')
script=state+'\nconst ids='+json.dumps(ids)+'; const dimensions='+json.dumps([d['key'] for d in rubric['dimensions']])+''';
const form=document.querySelector('form'), status=document.querySelector('#status');
let previous={};try{previous=JSON.parse(localStorage.getItem('issue136-review')||'{}')}catch{status.textContent='Could not restore browser draft. The saved audit copy is still available.'}
for(const [key,value] of Object.entries(previous))if(form.elements[key])form.elements[key].value=value;
for(const id of ids)if(previous[id+'-caption'])document.querySelector('#legacy-'+id).textContent='Previous overall assessment (preserved): '+previous[id+'-caption'];
function current(){return reviewState(previous,Object.fromEntries(new FormData(form)),ids,dimensions)}
function persist(){const r=current();previous=r.answers;localStorage.setItem('issue136-review',JSON.stringify(previous));return r}
form.addEventListener('input',()=>{persist();status.textContent='Draft saved in this browser.'});
form.addEventListener('submit',async e=>{e.preventDefault();const r=persist();const button=form.querySelector('button');button.disabled=true;status.textContent='Saving…';
try{const response=await fetch('/save-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...r,reviewer:'repository-owner',submitted_at:new Date().toISOString()})});if(!response.ok)throw Error('HTTP '+response.status);status.textContent=r.complete?'Review saved. All questions are complete.':'Progress saved. '+r.missing_fields.length+' questions remain. Your previous answers are safe.';
for(const key of r.missing_fields)form.elements[key].classList.add('missing');
}catch(error){status.textContent='Save failed: '+error.message+'. Your answers remain in this browser. Retry Save progress.'}finally{button.disabled=false}});
'''
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Archive caption review — clear evidence, useful search</title><style>body{font:17px/1.5 system-ui;max-width:1120px;margin:36px auto;padding:20px;background:#f7f5ef;color:#222}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{background:#fff;padding:24px;border:1px solid #ddd;border-radius:8px}img{width:100%;height:340px;object-fit:contain}label{display:block;font-weight:650;margin-top:22px}select,textarea,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0}blockquote{margin:0;padding:16px;background:#f4f3ee;border-left:3px solid #738679}.help{font-size:14px;color:#555;margin:4px 0}header{max-width:900px}.save{position:sticky;bottom:0;background:#f7f5ef;padding:12px;border-top:1px solid #bbb}button{background:#254c40;color:white;cursor:pointer;border:0;border-radius:5px}.missing{border:2px solid #ac6920}#status{margin:5px 0;min-height:26px}.legacy{font-size:14px;color:#555}@media(max-width:760px){main{grid-template-columns:1fr}body{padding:12px}}</style><header><h1>What makes a useful archive caption?</h1><p>It accurately describes <strong>the viewpoint, main subjects and distinctive visible relationships</strong>, so someone can find the image and understand it.</p><p>A caption can be accurate but too vague. Review three things separately: <strong>supported details, important information, and usefulness for search.</strong> “Unsure” is a valid answer. You do not need to rewrite captions.</p><p>Your viewpoint answers and any previous assessments are retained. Every question is visible; Save progress works even when you are partway through.</p></header><form novalidate><main>'''+''.join(cards)+'''</main><div class="save"><button>Save progress / finish review</button><p id="status" role="status" aria-live="polite"></p></div></form><script>'''+script+'</script></html>'
f=out/'review.html'
if f.exists() and not (out/'review-v1-preserved.html').exists(): (out/'review-v1-preserved.html').write_text(f.read_text())
f.write_text(page)
print('Rendered caption-review-v2:',len(rows),'images; previous browser answers preserved')
