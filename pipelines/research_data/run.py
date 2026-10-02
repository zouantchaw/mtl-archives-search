#!/usr/bin/env python3
"""Isolated, content-addressed research release builder. No app mutation commands.

cf authenticates outside this program. subprocess calls use argv, never a shell.
Only a fixed SELECT can address production D1; all write targets are allowlisted.
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import warnings

from PIL import Image, ImageOps, __version__ as PIL_VERSION

HERE = Path(__file__).resolve().parent
PRODUCTION_DB = '5c847f8e-5f2a-4d5e-8a7d-fae70025c398'
PRODUCTION_DOMAIN = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev'
PRODUCTION_INDEXES = ('mtl-archives-text-canonical-20260912', 'mtl-archives-clip-canonical-20260912')
SCHEMA = 'mtl-research-data-v1'
DEFAULT_IDS = [0,94,12728,12651,3436,3647,4630,8703,9248,15442,17211,16765,16818,
               9247,2124,2066,2232,2178,2176,2230,15046,15047,2231,2177,2067,2125,2065,2123,2126,2068]
SOURCE_HOSTS = {'depot.ville.montreal.qc.ca', 'archivesdemontreal.com',
                'donnees.montreal.ca', 'www.archivesdemontreal.com'}

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else encoded(value)).hexdigest()

def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()

def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(data); f.flush(); os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True); raise
    os.replace(tmp, path)

def save(path, value):
    atomic(path, encoded(value))

def load(path):
    return json.loads(Path(path).read_text())

def cf(*args):
    p = subprocess.run(['cf', *map(str,args)], capture_output=True, timeout=180)
    if p.returncode:
        raise RuntimeError(f'cf {" ".join(map(str,args[:4]))}: {p.stderr.decode(errors="replace")[-1000:]}')
    result = json.loads(p.stdout)
    if isinstance(result, list) and any(isinstance(x,dict) and x.get('success') is False for x in result):
        raise RuntimeError('Cloudflare returned unsuccessful query')
    return result

def production_metadata():
    out = cf('d1','query',PRODUCTION_DB,'--sql','SELECT * FROM manifest ORDER BY metadata_filename;')
    if not all(r.get('success') and not r.get('meta',{}).get('changed_db') and not r.get('meta',{}).get('rows_written') for r in out):
        raise RuntimeError('Read-only production query invariant failed')
    return out[0]['results']

def validate_config(c):
    expected = {'schema':SCHEMA,'catalog_name':'mtl-archives-research-catalog',
                'sources_bucket':'mtl-archives-research-sources','derived_bucket':'mtl-archives-research-derived'}
    for key, value in expected.items():
        if c.get(key) != value:
            raise ValueError(f'Unsafe research target/config: {key}')
    if c.get('catalog_id') in (PRODUCTION_DB,'56fc7eab-9931-42b6-8a36-41292e00373a'):
        raise ValueError('Production D1 cannot be a write target')
    if not 0 < c['max_download_bytes'] <= 128*1024*1024 or not 0 < c['max_pixels'] <= 100_000_000:
        raise ValueError('Resource limits are outside the supported bounded range')
    if not 128 <= c['thumbnail_size'] <= 2048 or not 1 <= c['thumbnail_quality'] <= 95:
        raise ValueError('Invalid rendition limits')
    return c

def identity(url):
    # Exact source URL, deliberately NOT the local sequential filename or a byte hash.
    # Redirects/URL migrations require an explicit reviewed alias mapping in a later adapter.
    if not url:
        raise ValueError('Cannot invent a source identity without a source URL')
    return 'mtl:url-v1:' + digest(url)

def code_hash():
    return digest({p.name:file_hash(p) for p in (HERE/'run.py',HERE/'schema.sql',HERE/'requirements.txt')})

def environment():
    return {'python':platform.python_version(),'pillow':PIL_VERSION,'platform':platform.platform()}

class Store:
    def __init__(self, root):
        self.root = Path(root); self.root.mkdir(parents=True,exist_ok=True)
        self.db = sqlite3.connect(self.root/'checkpoint.sqlite')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS checkpoint (key TEXT PRIMARY KEY, input_hash TEXT NOT NULL, output_json TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS attempt (id TEXT PRIMARY KEY, data_json TEXT NOT NULL)')

    def blob(self, path, area, media_type):
        sha = file_hash(path); dest = self.root/'blobs'/sha
        if dest.exists():
            if file_hash(dest) != sha:
                raise ValueError('Local content-addressed object was corrupted')
        else:
            # Stream copy; source downloads can be large.
            with Path(path).open('rb') as src, tempfile.NamedTemporaryFile(dir=self.root,delete=False) as out:
                tmp=Path(out.name)
                for block in iter(lambda:src.read(1024*1024),b''): out.write(block)
                out.flush();os.fsync(out.fileno())
            dest.parent.mkdir(exist_ok=True);os.replace(tmp,dest)
        return {'sha256':sha,'area':area,'object_key':f'sha256/{sha[:2]}/{sha}',
                'size_bytes':dest.stat().st_size,'media_type':media_type}

    def json_blob(self, obj, area='sources'):
        with tempfile.NamedTemporaryFile(dir=self.root,delete=False) as f:
            path=Path(f.name); f.write(encoded(obj))
        try: return self.blob(path,area,'application/json')
        finally: path.unlink(missing_ok=True)

    def check_blob(self, b):
        path=self.root/'blobs'/b['sha256']
        if not path.exists() or path.stat().st_size != b['size_bytes'] or file_hash(path)!=b['sha256']:
            raise ValueError(f'Missing/corrupt blob: {b["sha256"]}')
        return path

    def cached(self, key, input_hash):
        row=self.db.execute('SELECT input_hash,output_json FROM checkpoint WHERE key=?',(key,)).fetchone()
        if not row or row[0]!=input_hash: return None
        return json.loads(row[1])

    def checkpoint(self,key,input_hash,value):
        with self.db:
            self.db.execute('INSERT INTO checkpoint VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET input_hash=excluded.input_hash,output_json=excluded.output_json',
                            (key,input_hash,encoded(value).decode()))

    def attempt(self, value):
        value={'id':str(uuid.uuid4()),'requested_at':now(),**value}
        with self.db: self.db.execute('INSERT INTO attempt VALUES (?,?)',(value['id'],encoded(value).decode()))

class SourceRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def check_url(url, delivery=False):
    u=urllib.parse.urlsplit(url)
    hosts=SOURCE_HOSTS | ({urllib.parse.urlsplit(PRODUCTION_DOMAIN).hostname} if delivery else set())
    if u.scheme not in ('http','https') or u.hostname not in hosts or u.username or u.password or u.port not in (None,80,443):
        raise ValueError('URL outside source/delivery allowlist')

def download(url,path,limit,delivery=False):
    check_url(url,delivery)
    # Delivery redirects are not expected; source redirects are allowlisted individually.
    request=urllib.request.Request(url,headers={'User-Agent':'mtl-archives-research-data/1.0','Accept-Encoding':'identity'})
    opener=urllib.request.build_opener(SourceRedirects())
    with opener.open(request,timeout=30) as response, Path(path).open('wb') as out:
        length=response.headers.get('Content-Length')
        if length and int(length)>limit: raise ValueError('Download exceeds byte limit')
        total=0
        for chunk in iter(lambda:response.read(256*1024),b''):
            total+=len(chunk)
            if total>limit: raise ValueError('Download exceeds byte limit')
            out.write(chunk)
        if not total or (length and total!=int(length)): raise ValueError('Empty/truncated HTTP response')
        return {'http_status':response.status,'final_url':response.url,'content_type':response.headers.get('Content-Type'),
                'etag':response.headers.get('ETag'),'last_modified':response.headers.get('Last-Modified')}

def decode(path,c):
    Image.MAX_IMAGE_PIXELS=c['max_pixels']
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(path) as im:
            if im.width*im.height>c['max_pixels']: raise ValueError('Image exceeds pixel budget')
            info={'width':im.width,'height':im.height,'format':im.format,'frames':getattr(im,'n_frames',1),
                  'orientation':im.getexif().get(274),'mode':im.mode}
            if info['frames']>32:raise ValueError('Image exceeds frame budget')
            # All frames must decode; transforms below intentionally use frame zero.
            for i in range(info['frames']): im.seek(i); im.load()
        return info

def fetch(store,row,role,c,run_id,offline=False):
    url=PRODUCTION_DOMAIN+'/'+urllib.parse.quote(row['resolved_image_filename'],safe='') if role=='legacy_delivery' else row['external_url']
    inputs=digest({'url':url,'role':role,'config':c})
    key=role+':'+identity(row['external_url'])
    prior=store.cached(key,inputs)
    if prior:
        path=store.check_blob(prior['blob'])
        if prior.get('image'): decode(path,c)
        return prior
    if offline:raise ValueError('Offline rebuild requires preserved acquisition checkpoint and bytes')
    with tempfile.NamedTemporaryFile(dir=store.root,delete=False) as f: temp=Path(f.name)
    try:
        http=download(url,temp,c['max_download_bytes'],delivery=role=='legacy_delivery')
        with temp.open('rb') as header:signature=header.read(5)
        if role=='source_original' and signature==b'%PDF-':
            # Preserve bytes, don't claim page-render verification without a PDF renderer.
            info=None;mime='application/pdf'
        else:
            info=decode(temp,c);mime=Image.MIME.get(info['format'],'application/octet-stream')
        b=store.blob(temp,'sources',mime)
        result={'blob':b,'image':info,'request':http,'source_url':url}
        store.attempt({'run_id':run_id,'record_id':identity(row['external_url']),'role':role,'outcome':'success','output_sha256':b['sha256'],**http})
        store.checkpoint(key,inputs,result)
        return result
    except Exception as e:
        store.attempt({'run_id':run_id,'record_id':identity(row['external_url']),'role':role,'outcome':'failed',
                       'http_status':getattr(e,'code',None),'error':str(e),'url':url})
        raise
    finally: temp.unlink(missing_ok=True)

def transform(store,parent,c,run_id):
    settings={k:c[k] for k in ('thumbnail_size','thumbnail_quality','max_pixels')}
    input_hash=digest({'parent':parent['blob']['sha256'],'config':settings,'code':code_hash(),'pillow':PIL_VERSION})
    prior=store.cached('thumbnail:'+input_hash,input_hash)
    if prior: store.check_blob(prior['blob']);decode(store.check_blob(prior['blob']),c);return prior
    path=store.check_blob(parent['blob'])
    decode(path,c)
    with Image.open(path) as im:
        im=ImageOps.exif_transpose(im); im.thumbnail((c['thumbnail_size'],c['thumbnail_size']),Image.Resampling.LANCZOS)
        im=im.convert('RGB')
        with tempfile.NamedTemporaryFile(dir=store.root,suffix='.jpg',delete=False) as f: tmp=Path(f.name)
        try:
            im.save(tmp,'JPEG',quality=c['thumbnail_quality'],optimize=False,progressive=False)
            result={'blob':store.blob(tmp,'derived','image/jpeg'),'image':decode(tmp,c),'processing_run_id':run_id,
                    'transform':{'name':'exif_transpose-thumbnail-rgb-jpeg-v1','config':settings,'pillow':PIL_VERSION,'frame':0}}
        finally: tmp.unlink(missing_ok=True)
    store.checkpoint('thumbnail:'+input_hash,input_hash,result)
    return result

def freeze(args,c):
    store=Store(args.out)
    if (store.root/'plan.json').exists(): raise ValueError('Use a new output directory for a new snapshot; this one is frozen')
    rows=production_metadata()
    ids=set(args.ids or DEFAULT_IDS)
    aliases={f'mtl_archives_metadata_{i}.json' for i in ids}
    selected=[r for r in rows if r['metadata_filename'] in aliases]
    if len(selected)!=len(ids): raise ValueError('Requested aliases are missing or duplicated')
    local={};rawhash=file_hash(args.enriched)
    with Path(args.enriched).open() as f:
        for line in f:
            row=json.loads(line)
            if row['metadata_filename'] in aliases: local[row['metadata_filename']]=row
    if any(local.get(r['metadata_filename'],{}).get('external_url')!=r['external_url'] for r in selected):
        raise ValueError('Legacy enrichment association failed exact alias/source URL check')
    local_rows={json.loads(line)['metadata_filename']:json.loads(line) for line in Path(args.local_canonical).open()}
    drift=collections.Counter()
    repaired=[]
    for row in rows:
        previous=local_rows.get(row['metadata_filename'],{})
        for k,v in row.items():
            if k not in previous or previous[k]!=v: drift[k]+=1
        # Reconciliation is an export in RESEARCH storage, never a live DB or existing file edit.
        repaired.append({**previous,**row})
    conditions=load(args.conditions)
    captures=now()
    full=store.json_blob({'schema':SCHEMA,'captured_at':captures,'source':'production-D1-manifest',
                         'production_db':PRODUCTION_DB,'rows':rows})
    conditions_blob=store.json_blob({'observed_at':args.conditions_observed_at,'evidence':conditions,
                                    'scope':'package evidence; per-record associations retained separately, no blanket license inference'})
    reconciled=store.json_blob({'rows':repaired,'origin':'local export reconciled with frozen live fields','differences':dict(drift)})
    raw=store.json_blob({'rows':[local[r['metadata_filename']] for r in selected],
                         'source_file_sha256':rawhash,'association':'exact metadata alias and external_url; historical image hashes absent'})
    plan={'schema':SCHEMA,'captured_at':captures,'snapshot':full,'metadata_sha256':digest(rows),
          'record_count':len(rows),'conditions':conditions_blob,'local_evidence':raw,'reconciled_export':reconciled,
          'drift':dict(drift),'selection_policy':'engineering verification slice; size-aware convenience strata plus all known duplicate candidates; not a statistical sample',
          'original_ids':sorted(set(args.original_ids)), 'records':sorted(selected,key=lambda r:identity(r['external_url'])),
          'frozen_config':c,'builder_code_sha256':code_hash(),'environment':environment()}
    save(store.root/'plan.json',plan)
    print(json.dumps({'frozen_records':len(rows),'selected':len(selected),'metadata_sha256':plan['metadata_sha256'],'local_drift':dict(drift)},indent=2))

def assertions(row,local,version):
    result=[]
    evidence={'portal_record':local.get('portal_record'), 'aerial_matches':local.get('aerial_matches'),
              'attributes':local.get('attributes'),'title_raw':local.get('title_raw'),'description_raw':local.get('description_raw'),
              'date_raw':local.get('date_raw'),'date_raw_source':local.get('date_raw_source')}
    groups=[('source_payload',evidence,'source_transcription_unreviewed','not_an_image_assertion'),
            ('legacy_serving',{k:row.get(k) for k in ('name','description','date_value','credits','cote')},'inherited_unreviewed','not_an_image_assertion'),
            ('legacy_derived',{'field':'vlm_caption','value':row.get('vlm_caption'),'source':row.get('vlm_caption_source'),
                               'model':row.get('vlm_caption_model'),'review':row.get('vlm_caption_status'),
                               'prompt':None},row.get('vlm_caption_status') or 'unknown','historical_input_hash_unknown'),
            ('legacy_derived',{k:v for k,v in local.items() if k.startswith(('ocr_','vlm_tags','metadata_quality'))},'unreviewed','historical_input_hash_unknown'),
            ('legacy_derived',{k:row.get(k) for k in ('latitude','longitude','geocode_source','geocode_confidence','trust_score','rotation_degrees',
                                                     'taxonomy_primary_category','taxonomy_themes','taxonomy_search_facets','image_quality_labels','image_quality_severity')},
             'unreviewed','historical_input_hash_unknown')]
    for origin,payload,review,status in groups:
        item={'record_version_id':version,'origin':origin,'review_status':review,'input_identity_status':status,'payload':payload}
        result.append({'id':digest(item),**item})
    return result

def asset(version,role,data,parent=None,run_id=None):
    item={'record_version_id':version,'role':role,**data,'parent_asset_id':parent,'processing_run_id':run_id,
          'lineage_status':('verified_transform' if parent else 'acquired_source_bytes' if role=='source_original' else 'legacy_parent_unknown')}
    return {'id':digest(item),**item}

def build(args,c):
    store=Store(args.out);plan=load(store.root/'plan.json')
    if plan['frozen_config']!=c or plan['builder_code_sha256']!=code_hash() or plan['environment']!=environment():
        raise ValueError('Frozen config/code/environment changed. Create a new run; never reuse mismatched checkpoints')
    local={r['metadata_filename']:r for r in load(store.check_blob(plan['local_evidence']))['rows']}
    run_id=digest({'plan':plan,'code':code_hash(),'config':c})
    records=[];excluded=[];warnings_out=[]
    for index,row in enumerate(plan['records']):
        if args.stop_after is not None and index>=args.stop_after:
            print(json.dumps({'interrupted_after':index,'run_id':run_id}));return
        record_id=identity(row['external_url'])
        print(f'{index+1}/{len(plan["records"])} {row["metadata_filename"]}',flush=True)
        payload={'record_id':record_id,'snapshot_id':plan['snapshot']['sha256'],'serving_fields':row,
                 'legacy_evidence':local[row['metadata_filename']]}
        version=store.json_blob(payload)
        try:
            delivery=fetch(store,row,'legacy_delivery',c,run_id,getattr(args,'offline',False))
            legacy=asset(version['sha256'],'legacy_delivery',delivery)
            thumbnail=asset(version['sha256'],'research_thumbnail',transform(store,delivery,c,run_id),legacy['id'],run_id)
        except Exception as e:
            excluded.append({'record_id':record_id,'alias':row['metadata_filename'],'stage':'delivery_decode_transform','error':str(e)})
            continue
        assets=[legacy,thumbnail]
        original_status={'status':'not_attempted','reason':'bounded acquisition subset'}
        number=int(row['metadata_filename'].removeprefix('mtl_archives_metadata_').removesuffix('.json'))
        if number in plan['original_ids']:
            original_key='original-outcome:'+run_id+':'+record_id
            original_result=store.cached(original_key,run_id)
            try:
                if original_result and original_result.get('error'):
                    original_status=original_result
                else:
                    original=fetch(store,row,'source_original',c,run_id,getattr(args,'offline',False))
                    assets.append(asset(version['sha256'],'source_original',original))
                    original_status={'status':'preserved','comparison_to_legacy':('byte_identical' if original['blob']['sha256']==delivery['blob']['sha256'] else 'different_bytes_no_historical_transform_claim'),
                                     'validation':'image_decode' if original['image'] else 'pdf_signature_only_not_render_verified'}
            except Exception as e:
                original_status={'status':'failed','error':str(e)}
                # Preserve a failed original acquisition as frozen evidence. Retry it in
                # a new snapshot/run; rebuilding an existing release does not refetch it.
                store.checkpoint(original_key,run_id,original_status)
        if delivery['blob']['size_bytes']!=row['image_size_bytes']:
            warnings_out.append({'alias':row['metadata_filename'],'issue':'legacy_metadata_size_mismatch',
                                 'declared':row['image_size_bytes'],'observed':delivery['blob']['size_bytes'],'action':'preserve_both_no_serving_mutation'})
        records.append({'id':record_id,'identity_strategy':'exact_source_url_v1','source_url':row['external_url'],
                        'aliases':[row['metadata_filename']], 'record_version':version,'assets':assets,
                        'assertions':assertions(row,local[row['metadata_filename']],version['sha256']),
                        'original_acquisition':original_status,
                        'source_conditions':'see source_payload dataset/portal associations and frozen package evidence; unmatched datasets unknown'})
    byhash=collections.defaultdict(list)
    for r in records:
        byhash[r['assets'][0]['blob']['sha256']].append(r['id'])
    duplicates=[{'id':'exact-sha256:'+sha,'byte_sha256':sha,'members':sorted(set(members)),
                 'evidence':'sha256_equal_verified_bytes'} for sha,members in sorted(byhash.items()) if len(set(members))>1]
    # No inferred series grouping: retain raw cote/reportage as evidence for future reviewed grouping.
    report={'run_id':run_id,'input_sha256':digest(plan),'code_sha256':code_hash(),'config':c,'environment':environment(),
            'selected':len(plan['records']),'included':len(records),'excluded':excluded,'warnings':warnings_out}
    report_blob=store.json_blob(report,'derived')
    recovery=store.json_blob({'plan':plan,
                              'checkpoints':[{'key':k,'input_hash':h,'output':json.loads(out)} for k,h,out in store.db.execute(
                                  "SELECT key,input_hash,output_json FROM checkpoint WHERE key NOT LIKE 'thumbnail:%' ORDER BY key")],
                              'attempts':[json.loads(row[0]) for row in store.db.execute('SELECT data_json FROM attempt ORDER BY id')]},'derived')
    manifest={'schema':SCHEMA,'snapshot':plan['snapshot'],'conditions':plan['conditions'],'local_evidence':plan['local_evidence'],
              'reconciled_export':plan['reconciled_export'],'processing_run':report,'report':report_blob,'recovery':recovery,
              'selection_policy':plan['selection_policy'],'records':sorted(records,key=lambda r:r['id']),
              'duplicate_groups':duplicates,'exclusions':sorted(excluded,key=lambda r:r['record_id']),
              'limitations':['Legacy parent transforms unknown; source reacquisition does not recover historical lineage.',
                            'Legacy OCR/captions lack input hashes; remain inherited unreviewed assertions.',
                            'Source conditions attached at package level; unmatched source datasets unknown.',
                            'Photographic series not assigned; no train/test split declared.',
                            'Private engineering slice, not a representative research benchmark.']}
    if len(records)+len(excluded)!=len(plan['records']):raise ValueError('Release selection accounting failed')
    ids=[r['id'] for r in records]
    if len(set(ids))!=len(ids):raise ValueError('Same source URL has multiple records; explicit source identity adapter required')
    if getattr(args,'offline',False) and excluded:raise ValueError('Offline rebuild is incomplete; release creation refused')
    release=store.json_blob(manifest,'derived')
    save(store.root/'release.json',{'id':release['sha256'],'manifest':release})
    verify_local(store,c)
    print(json.dumps({'release_id':release['sha256'],'included':len(records),'excluded':len(excluded),
                      'duplicate_groups':len(duplicates),'source_originals':sum(r['original_acquisition']['status']=='preserved' for r in records)},indent=2))

def artifacts(store):
    pointer=load(store.root/'release.json'); manifest=load(store.check_blob(pointer['manifest']))
    blobs=[pointer['manifest']]+[manifest[k] for k in ('snapshot','conditions','local_evidence','reconciled_export','report','recovery')]
    for r in manifest['records']:
        blobs.append(r['record_version']);blobs.extend(a['blob'] for a in r['assets'])
    unique={}
    for b in blobs:
        previous=unique.get(b['sha256'])
        if previous and previous['size_bytes']!=b['size_bytes']:raise ValueError('Contradictory artifact metadata')
        # Byte-identical sources/derivatives can share one canonical object.
        unique.setdefault(b['sha256'],b)
    return pointer,manifest,unique

def verify_local(store,c):
    pointer,m,blobs=artifacts(store)
    if digest(m)!=pointer['id']:raise ValueError('Release manifest identity mismatch')
    for b in blobs.values():store.check_blob(b)
    for r in m['records']:
        if identity(r['source_url'])!=r['id']:raise ValueError('Invalid source identity')
        if digest(load(store.check_blob(r['record_version'])))!=r['record_version']['sha256']:raise ValueError('Record hash mismatch')
        byid={a['id']:a for a in r['assets']}
        for a in r['assets']:
            if a['image']: 
                if decode(store.check_blob(a['blob']),c)!=a['image']:raise ValueError('Image metadata changed')
            if a['role']=='research_thumbnail' and a['parent_asset_id'] not in byid:raise ValueError('Missing rendition parent')
            if a['role']=='legacy_delivery' and a['parent_asset_id']:raise ValueError('Invented legacy parent')
    for g in m['duplicate_groups']:
        matched=[r for r in m['records'] if r['id'] in g['members']]
        if len(matched)!=len(g['members']) or any(r['assets'][0]['blob']['sha256']!=g['byte_sha256'] for r in matched):raise ValueError('Invalid duplicate group')
    return pointer,m,blobs

def cloud_guard(c):
    validate_config(c)
    if not c['catalog_id']:raise ValueError('Provision research D1 and set catalog_id first')
    db=cf('d1','get',c['catalog_id'])
    if db.get('name')!=c['catalog_name']:raise ValueError('D1 ID/name mismatch; writes refused')
    for bucket in (c['sources_bucket'],c['derived_bucket']):
        managed=cf('r2','buckets','domains','managed','list','--bucket-name',bucket)
        custom=cf('r2','buckets','domains','custom','list','--bucket-name',bucket)
        if managed.get('enabled') or custom.get('domains',[]):raise ValueError('Research bucket must remain private')

def query_research(c,batch):
    # Guarded by each public cloud entry point, never accepts arbitrary database IDs.
    with tempfile.NamedTemporaryFile(mode='w',suffix='.json',delete=False) as f:
        json.dump(batch,f,ensure_ascii=False);path=Path(f.name)
    try:return cf('d1','query',c['catalog_id'],'--batch','@'+str(path))
    finally:path.unlink(missing_ok=True)

def schema_sql():
    sql=(HERE/'schema.sql').read_text()
    tables=['artifact','source_snapshot','source_record','record_version','asset','assertion','duplicate_group','processing_run','fetch_attempt','dataset_release','release_record']
    for table in tables:
        for op in ('UPDATE','DELETE'):
            sql+=f"\nCREATE TRIGGER IF NOT EXISTS immutable_{table}_{op.lower()} BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT,'immutable research catalog row'); END;"
    return sql

def catalog_rows(pointer,m,blobs,c,attempts,verified_at,snapshot):
    # Stable values for conflict checking exclude acquisition verification timestamps.
    result=[]
    def add(table,values):result.append((table,values))
    for sha,b in sorted(blobs.items()):
        add('artifact',{'sha256':sha,'bucket':c[b['area']+'_bucket'],'object_key':b['object_key'],
                        'size_bytes':b['size_bytes'],'media_type':b['media_type'],'verified_at':verified_at})
    add('source_snapshot',{'id':m['snapshot']['sha256'],'captured_at':snapshot['captured_at'],
                           'record_count':len(snapshot['rows']),'production_metadata_sha256':digest(snapshot['rows']),
                           'conditions_sha256':m['conditions']['sha256']})
    # Caller fills source snapshot facts from its exact blob rather than trusting CLI params.
    for r in m['records']:
        add('source_record',{'id':r['id'],'identity_strategy':r['identity_strategy'],'source_url':r['source_url']})
        add('record_version',{'id':r['record_version']['sha256'],'record_id':r['id'],'snapshot_id':m['snapshot']['sha256'],'aliases_json':encoded(r['aliases']).decode()})
        for a in r['assets']:
            add('asset',{'id':a['id'],'record_version_id':a['record_version_id'],'artifact_sha256':a['blob']['sha256'],
                         'role':a['role'],'parent_asset_id':a['parent_asset_id'],'processing_run_id':a['processing_run_id'],
                         'lineage_status':a['lineage_status'],'details_json':encoded(a).decode()})
        for a in r['assertions']:
            add('assertion',{'id':a['id'],'record_version_id':a['record_version_id'],'origin':a['origin'],
                             'review_status':a['review_status'],'input_identity_status':a['input_identity_status'],'payload_json':encoded(a['payload']).decode()})
    for g in m['duplicate_groups']: add('duplicate_group',{**{k:g[k] for k in ('id','byte_sha256','evidence')},'members_json':encoded(g['members']).decode()})
    run=m['processing_run']
    add('processing_run',{'id':run['run_id'],'input_sha256':run['input_sha256'],'code_sha256':run['code_sha256'],
                          'config_json':encoded(run['config']).decode(),'environment_json':encoded(run['environment']).decode(),'report_sha256':m['report']['sha256']})
    for a in attempts:
        add('fetch_attempt',{k:a[k] for k in ('id','run_id','record_id','role','requested_at','outcome')}|{'details_json':encoded(a).decode()})
    add('dataset_release',{'id':pointer['id'],'snapshot_id':m['snapshot']['sha256'],'processing_run_id':run['run_id'],
                           'record_count':len(m['records']),'exclusion_count':len(m['exclusions']),'verified_at':verified_at})
    for r in m['records']:add('release_record',{'release_id':pointer['id'],'record_version_id':r['record_version']['sha256']})
    return result

def remote_file(bucket,key,path):
    with Path(path).open('wb') as out:
        p=subprocess.run(['cf','r2','objects','get',key,'--bucket-name',bucket],stdout=out,stderr=subprocess.PIPE,timeout=180)
    if p.returncode:raise RuntimeError(f'Remote object read failed: {p.stderr.decode(errors="replace")[:300]}')

def verify_remote_blob(store,b,c):
    with tempfile.NamedTemporaryFile(dir=store.root,delete=False) as f: tmp=Path(f.name)
    try:
        remote_file(c[b['area']+'_bucket'],b['object_key'],tmp)
        if tmp.stat().st_size!=b['size_bytes'] or file_hash(tmp)!=b['sha256']:raise ValueError('Remote artifact hash/size mismatch')
    finally:tmp.unlink(missing_ok=True)

def existing_keys(bucket):
    keys={};cursor=None
    for _ in range(1000):
        args=['r2','objects','list','--bucket-name',bucket,'--per-page','1000']
        if cursor:args+=['--start-after',cursor]
        page=cf(*args)
        if not page:return keys
        for obj in page:keys[obj['key']]=obj
        nxt=page[-1]['key']
        if nxt==cursor:raise ValueError('R2 pagination stalled')
        cursor=nxt
    raise ValueError('R2 inventory exceeds bounded pagination limit')

def publish(args,c):
    cloud_guard(c);store=Store(args.out);pointer,m,blobs=verify_local(store,c)
    if not m['records']:raise ValueError('An empty release cannot be published')
    keys={area:existing_keys(c[area+'_bucket']) for area in ('sources','derived')}
    for i,b in enumerate(blobs.values()):
        path=store.check_blob(b);bucket=c[b['area']+'_bucket']
        if b['object_key'] not in keys[b['area']]:
            # cf currently lacks If-None-Match. Only computed hash keys are accepted;
            # bytes are checked before/after put. Concurrent writers of a key have identical bytes.
            cf('r2','objects','put',b['object_key'],'--bucket-name',bucket,'--file',path,'--content-type',b['media_type'])
        verify_remote_blob(store,b,c)
        print(f'verified R2 {i+1}/{len(blobs)} {b["sha256"][:12]}',flush=True)
    cf('d1','query',c['catalog_id'],'--body',encoded({'sql':schema_sql()}).decode())
    verified_at=now();attempts=[json.loads(r[0]) for r in store.db.execute('SELECT data_json FROM attempt ORDER BY id')]
    snap=load(store.check_blob(m['snapshot']))
    rows=catalog_rows(pointer,m,blobs,c,attempts,verified_at,snap)
    # Insert all release/catalog rows atomically; no complete release marker exists on failure.
    # For a large backfill, publish multiple bounded releases, not a giant SQL request.
    batch=[]
    for table,values in rows:
        columns=list(values)
        keys_for_table=['release_id','record_version_id'] if table=='release_record' else ['sha256'] if table=='artifact' else ['id']
        compared=[k for k in columns if k not in ('verified_at',)]
        # SQLite triggers reject mutations; INSERT OR IGNORE permits an exact replay only.
        # Explicit conflict guard in the same D1 transaction prevents silently ignored contradictions.
        where=' AND '.join(f'{k} IS ?' for k in compared)
        key_where=' AND '.join(f'{k} IS ?' for k in keys_for_table)
        # A deliberately failing NOT NULL insert protects against a mismatched existing row.
        guard=f'INSERT INTO artifact(sha256,bucket,object_key,size_bytes,media_type,verified_at) SELECT NULL,NULL,NULL,NULL,NULL,NULL WHERE EXISTS(SELECT 1 FROM {table} WHERE {key_where}) AND NOT EXISTS(SELECT 1 FROM {table} WHERE {where})'
        batch.append({'sql':guard,'params':[values[k] for k in keys_for_table]+[values[k] for k in compared]})
        batch.append({'sql':f'INSERT OR IGNORE INTO {table}({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})','params':list(values.values())})
    query_research(c,batch)
    verify_catalog(c,pointer,m,blobs)
    save(store.root/'publication.json',{'release_id':pointer['id'],'verified_at':verified_at,'artifacts':len(blobs),
                                       'catalog_id':c['catalog_id'],'rows':len(rows)})
    print(json.dumps(load(store.root/'publication.json'),indent=2))

def verify_catalog(c,pointer,m,blobs):
    batch=[{'sql':'SELECT * FROM dataset_release WHERE id=?','params':[pointer['id']]},
           {'sql':'SELECT record_version_id FROM release_record WHERE release_id=? ORDER BY record_version_id','params':[pointer['id']]}]
    result=query_research(c,batch)
    if len(result[0]['results'])!=1:raise ValueError('Release catalog marker missing')
    release=result[0]['results'][0]
    versions=[r['record_version']['sha256'] for r in m['records']]
    if sorted(versions)!=[r['record_version_id'] for r in result[1]['results']] or release['record_count']!=len(versions):
        raise ValueError('Catalog membership mismatch')

def verify_cloud(args,c):
    cloud_guard(c);store=Store(args.out);p,m,blobs=verify_local(store,c)
    for b in blobs.values():verify_remote_blob(store,b,c)
    verify_catalog(c,p,m,blobs)
    print(json.dumps({'release_id':p['id'],'verified_cloud_artifacts':len(blobs),'records':len(m['records'])},indent=2))

def restore(args,c):
    cloud_guard(c);store=Store(args.out)
    if (store.root/'plan.json').exists():raise ValueError('Restore needs a fresh output directory')
    sha=args.release_id
    if len(sha)!=64 or any(ch not in '0123456789abcdef' for ch in sha):raise ValueError('Invalid release hash')
    def retrieve(b):
        with tempfile.NamedTemporaryFile(dir=store.root,delete=False) as f:tmp=Path(f.name)
        try:
            remote_file(c[b['area']+'_bucket'],b['object_key'],tmp)
            if file_hash(tmp)!=b['sha256'] or (b.get('size_bytes') and tmp.stat().st_size!=b['size_bytes']):
                raise ValueError('Cloud recovery artifact hash mismatch')
            return store.blob(tmp,b['area'],b['media_type'])
        finally:tmp.unlink(missing_ok=True)
    manifest_blob=retrieve({'sha256':sha,'area':'derived','object_key':f'sha256/{sha[:2]}/{sha}','media_type':'application/json'})
    manifest=load(store.check_blob(manifest_blob))
    if manifest['schema']!=SCHEMA:raise ValueError('Unknown release schema')
    save(store.root/'release.json',{'id':sha,'manifest':manifest_blob})
    _,_,blobs=artifacts(store)
    # artifacts() reads only the release bytes; it does not require other local bytes yet.
    for i,b in enumerate(blobs.values()):
        if b['sha256']!=sha:retrieve(b)
        print(f'restored {i+1}/{len(blobs)}',flush=True)
    recovery=load(store.check_blob(manifest['recovery']))
    for checkpoint in recovery['checkpoints']:store.checkpoint(checkpoint['key'],checkpoint['input_hash'],checkpoint['output'])
    with store.db:
        for attempt in recovery['attempts']:
            store.db.execute('INSERT OR IGNORE INTO attempt VALUES (?,?)',(attempt['id'],encoded(attempt).decode()))
    save(store.root/'plan.json',recovery['plan'])
    verify_local(store,c);verify_catalog(c,{'id':sha},manifest,blobs)
    print(json.dumps({'restored_release':sha,'artifacts':len(blobs),'catalog_verified':True},indent=2))

def guard_production(args,c):
    state={'metadata_sha256':digest(production_metadata()),
           'worker_deployments':cf('workers','deployments','list','--worker','mtl-archives-worker','--per-page','1'),
           'indexes':{index:cf('vectorize','info',index) for index in PRODUCTION_INDEXES}}
    path=Path(args.out)/'production-before.json'
    if not path.exists():save(path,state);print('Saved production read-only baseline')
    else:
        before=load(path)
        if before!=state:
            save(Path(args.out)/'production-after.json',state)
            raise ValueError('Production changed during execution; compare evidence (could be concurrent service activity)')
        save(Path(args.out)/'production-after.json',state);print('Production metadata, deployment, and Vectorize info unchanged')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,default=HERE/'config.json')
    p.add_argument('--out',type=Path,required=True)
    commands=p.add_subparsers(dest='command',required=True)
    f=commands.add_parser('freeze');f.add_argument('--enriched',type=Path,required=True);f.add_argument('--local-canonical',type=Path,required=True)
    f.add_argument('--conditions',type=Path,required=True);f.add_argument('--conditions-observed-at',required=True)
    f.add_argument('--ids',type=lambda s:list(map(int,s.split(','))))
    f.add_argument('--original-ids',type=lambda s:list(map(int,s.split(','))),default=[0,94,3436,15046,9247])
    b=commands.add_parser('build');b.add_argument('--stop-after',type=int);b.add_argument('--offline',action='store_true')
    r=commands.add_parser('restore');r.add_argument('--release-id',required=True)
    for name in ('verify','publish','verify-cloud','guard-production','status'):commands.add_parser(name)
    args=p.parse_args();c=validate_config(load(args.config))
    if args.command=='freeze':freeze(args,c)
    elif args.command=='build':build(args,c)
    elif args.command=='publish':publish(args,c)
    elif args.command=='verify-cloud':verify_cloud(args,c)
    elif args.command=='guard-production':guard_production(args,c)
    elif args.command=='restore':restore(args,c)
    elif args.command=='verify':
        pointer,m,blobs=verify_local(Store(args.out),c)
        print(json.dumps({'release_id':pointer['id'],'verified_artifacts':len(blobs),'records':len(m['records'])},indent=2))
    else:
        store=Store(args.out)
        print(json.dumps({'checkpoints':store.db.execute('SELECT count(*) FROM checkpoint').fetchone()[0],
                          'attempts':store.db.execute('SELECT count(*) FROM attempt').fetchone()[0],
                          'release':load(store.root/'release.json') if (store.root/'release.json').exists() else None},indent=2))

if __name__=='__main__':main()
