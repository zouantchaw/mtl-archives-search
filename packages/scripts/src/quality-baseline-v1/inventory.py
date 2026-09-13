"""Read-only inventory of recovered evidence and a separately acquired production snapshot."""
import pathlib,json,hashlib,collections,sys
from urllib.parse import unquote
p=pathlib.Path(sys.argv[1]);repo=pathlib.Path(__file__).resolve().parents[4]
def read(f):return json.loads((p/f).read_text())
def lines(f):return [json.loads(s) for s in (p/f).read_text().splitlines() if s]
def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
r=read('production-records.json');ids={x['metadata_filename'] for x in r};family='recovered-family/data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/';gold='recovered-gold/data/mtl_archives/reports/gold_label_batch_002/'
f=lines(family+'record-leakage-map-v1.jsonl');nodes={x['record_id']:x for x in lines(family+'nodes-v1.jsonl')};g=lines(gold+'adjudication/adjudications-v1.jsonl');t=lines(gold+'inputs/taxonomy-v0-14822.jsonl');d=lines(gold+'search/search-silver-dispositions-v1.jsonl')
changes=[]
for x in r:
 n=nodes.get(x['metadata_filename'])
 if n and x['external_url'] and unquote(x['external_url']) not in [unquote(u) for u in n['source_urls']]:changes.append(x['metadata_filename'])
summary={'version':'issue136-inventory-v1','production':{'records':len(r),'unique_ids':len(ids),'unique_image_keys':len({x['image_filename'] for x in r}),'field_coverage':{k:sum(x.get(k) not in [None,'','[]','{}','null'] for x in r) for k in r[0]},'caption_status':dict(collections.Counter(x['vlm_caption_status'] for x in r)),'caption_model':dict(collections.Counter(x['vlm_caption_model'] or 'not_recorded' for x in r))},'indexes':{},'historical':{'family_rows':len(f),'production_family_coverage':len(ids&{x['record_id'] for x in f}),'unmapped_production':sorted(ids-{x['record_id'] for x in f}),'url_decoded_source_difference_count':len(changes),'source_differences_note':'Two raw string differences were URL escaping only; decoded URLs compared. This verifies metadata lineage, not original image bytes.','gold_rows':len(g),'gold_dispositions':dict(collections.Counter(x['disposition'] for x in g)),'gold_production_overlap':len(ids&{x['record_id'] for x in g}),'gold_review_authority':'agent reviewer/adjudicator identities; not independently human-labelled gold','taxonomy_rows':len(t),'taxonomy_production_overlap':len(ids&{x['id'] for x in t}),'taxonomy_vantage':dict(collections.Counter(x['vantage'] for x in t)),'taxonomy_authority':'unverified historical generated features; no production backfill authorized','search_dispositions':dict(collections.Counter(x['disposition'] for x in d))},'artifacts':[]}
for kind in ['text','clip']:
 a=read(kind+'-ids.json');aset=set(a);summary['indexes'][kind]={'vectors':len(a),'unique_ids':len(aset),'missing':sorted(ids-aset),'orphan':sorted(aset-ids),'scope':'membership only; vector values and semantic correctness not revalidated by membership'}
for root in ['recovered-gold','recovered-family']:
 descriptor=repo/('docs/dataset-factory/fixtures/gold-label-batch-002/final-bundle-v1.json' if root=='recovered-gold' else 'docs/dataset-factory/fixtures/canonical-image-recovery-v1/reproducibility-bundle-v1.json');desc=json.loads(descriptor.read_text());bad=[]
 for m in desc['members']:
  file=p/root/m['path']
  if not file.exists() or digest(file)!=m['sha256'] or file.stat().st_size!=m['bytes']:bad.append(m['path'])
 summary['artifacts'].append({'name':root,'descriptor_sha256':digest(descriptor),'members':len(desc['members']),'bad_members':bad,'status':'hash_verified' if not bad else 'invalid'})
summary['production_snapshot_sha256']=digest(p/'production-records.json');summary['protocol_sha256']=digest(repo/'docs/quality-baseline-v1/protocol.json')
(p/'inventory.json').write_text(json.dumps(summary,indent=2));(p/'source-url-differences.json').write_text(json.dumps(changes));print(json.dumps({k:v for k,v in summary.items() if k not in ['production','artifacts']},indent=2))
