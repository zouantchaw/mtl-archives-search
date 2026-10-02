#!/usr/bin/env python3
"""Resumable full canonical byte backfill, with a bounded disk working set.

The transfer Worker has only research bindings. Original acquisition preserves
bytes independently of JPEG lineage. Raw originals are not claimed decode-verified.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import tempfile
import threading
import time
import urllib.parse

import pyvips
import requests
import run as core

HERE=Path(__file__).resolve().parent
ENDPOINT='https://mtl-archives-research-transfer.wiel.workers.dev'
TOKEN_FILE=Path('/Users/wiel/.config/mtl-research-transfer/secrets.json')
MAX_PIXELS=1_000_000_000
SCHEMA='mtl-research-backfill-v1'
pyvips.cache_set_max(0)
LOCAL=threading.local()

def builder_hash():
    return core.digest({name:core.file_hash(HERE/name) for name in ['bulk.py','bulk_worker.mjs','bulk_build.mjs','run.py','schema.sql']})

def session():
    if not hasattr(LOCAL,'session'):
        s=requests.Session();s.headers['Authorization']='Bearer '+core.load(TOKEN_FILE)['BULK_TOKEN']
        s.headers['User-Agent']='mtl-archives-research-backfill/1.0';LOCAL.session=s
    return LOCAL.session

def api(route,method='POST',body=None,data=None,params=None,headers=None):
    for attempt in range(3):
        try:
            r=session().request(method,ENDPOINT+route,json=body,data=data,params=params,headers=headers,timeout=(30,600))
            if r.status_code in (429,502,503,504):
                if attempt<2:time.sleep(2**attempt);continue
            r.raise_for_status();result=r.json()
            if isinstance(result,dict) and result.get('error'):raise ValueError(result['error'])
            return result
        except (requests.ConnectionError,requests.Timeout):
            if attempt==2:raise
            time.sleep(2**attempt)

def db(root):
    connection=sqlite3.connect(Path(root)/'backfill.sqlite',timeout=60)
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('CREATE TABLE IF NOT EXISTS item (alias TEXT, role TEXT, data_json TEXT NOT NULL, cataloged INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(alias,role))')
    return connection

def sql_rows(rows):
    statements=[]
    for table,values in rows:
        columns=list(values)
        primary=['job_id','alias','role'] if table=='backfill_item' else ['release_id','record_version_id'] if table=='release_record' else ['sha256'] if table=='artifact' else ['id']
        compared=[k for k in columns if k!='verified_at']
        where=' AND '.join(f'{k} IS ?' for k in compared);keys=' AND '.join(f'{k} IS ?' for k in primary)
        statements.append({'sql':f'INSERT INTO artifact(sha256,bucket,object_key,size_bytes,media_type,verified_at) SELECT NULL,NULL,NULL,NULL,NULL,NULL WHERE EXISTS(SELECT 1 FROM {table} WHERE {keys}) AND NOT EXISTS(SELECT 1 FROM {table} WHERE {where})',
                           'params':[values[k] for k in primary]+[values[k] for k in compared]})
        statements.append({'sql':f'INSERT OR IGNORE INTO {table}({",".join(columns)}) VALUES ({",".join("?" for _ in columns)})','params':list(values.values())})
    return statements

def upload_json(value,area='derived'):
    data=core.encoded(value);sha=core.digest(data)
    api('/artifact',method='PUT',params={'sha':sha,'area':area},data=data,headers={'Content-Type':'application/json','Content-Length':str(len(data))})
    return {'sha256':sha,'area':area,'object_key':f'sha256/{sha[:2]}/{sha}','size_bytes':len(data),'media_type':'application/json'}

def upload_thumbnail(path):
    data=Path(path).read_bytes();sha=core.digest(data)
    api('/artifact',method='PUT',params={'sha':sha,'area':'derived'},data=data,headers={'Content-Type':'image/jpeg','Content-Length':str(len(data))})
    return {'sha256':sha,'area':'derived','object_key':f'sha256/{sha[:2]}/{sha}','size_bytes':len(data),'media_type':'image/jpeg'}

def download_private(blob,dest):
    h=hashlib.sha256();total=0
    with session().get(ENDPOINT+'/blob',params={'sha':blob['sha256'],'area':blob['area']},stream=True,timeout=(30,180)) as response:
        response.raise_for_status()
        with Path(dest).open('wb') as f:
            for chunk in response.iter_content(256*1024):
                total+=len(chunk)
                if total>blob['size_bytes']:raise ValueError('private_download_exceeds_expected_size')
                h.update(chunk);f.write(chunk)
    if total!=blob['size_bytes'] or h.hexdigest()!=blob['sha256']:raise ValueError('private_download_hash_or_size_mismatch')

def decode_and_thumbnail(source,thumbnail):
    # libvips uses sequential tiles, rather than holding huge RGB scans in memory.
    image=pyvips.Image.new_from_file(str(source),access='sequential',fail_on='error')
    width,height,bands=image.width,image.height,image.bands
    if width*height>MAX_PIXELS:raise ValueError('image_exceeds_one_billion_pixel_decode_limit')
    # avg forces consumption of every decoded sample, including the end of file.
    average=image.avg()
    del image
    thumb=pyvips.Image.thumbnail(str(source),1024,height=1024,size='down',fail_on='error')
    thumb.jpegsave(str(thumbnail),Q=85,strip=True,optimize_coding=False)
    return {'width':width,'height':height,'bands':bands,'decoded_mean':average,'frames':1,
            'validation':'libvips_full_sequential_decode','decoder_version':'.'.join(str(pyvips.version(i)) for i in range(3))}

def process(root,role,row,raw,plan,config):
    alias=row['metadata_filename'];connection=db(root)
    previous=connection.execute('SELECT data_json FROM item WHERE alias=? AND role=?',(alias,role)).fetchone()
    if previous:connection.close();return alias,json.loads(previous[0])
    outcome={'alias':alias,'role':role,'record_id':core.identity(row['external_url']),'run_id':plan['job_id']}
    try:
        receipt=api('/acquire',body={'alias':alias,'role':role})
        outcome['acquisition']=receipt
        if receipt['status']!='preserved':
            outcome.update(status='fetch_failed',error=receipt['error'])
        elif role=='source_original':
            # Bytes are independently hash-verified in R2. Decoding is a separate
            # stage; PDFs and very large TIFF masters remain usable source evidence.
            acceptable=receipt['blob']['media_type'] in ('image/jpeg','image/tiff','image/png','application/pdf')
            outcome.update(status='byte_preserved' if acceptable else 'unexpected_source_payload',decode_status='not_attempted_source_master',
                           assets=[core.asset(plan['versions'][alias]['sha256'],role,{'blob':receipt['blob'],'image':None,'source_url':receipt['source_url'],'request':receipt['request']})])
            if not acceptable:outcome['error']='source_response_is_not_a_recognized_image_or_pdf'
        else:
            with tempfile.TemporaryDirectory(dir=Path(root)/'work') as tmp:
                source=Path(tmp)/'image.jpg';thumbnail=Path(tmp)/'thumbnail.jpg'
                download_private(receipt['blob'],source)
                image=decode_and_thumbnail(source,thumbnail)
                derivative=upload_thumbnail(thumbnail)
                parent=core.asset(plan['versions'][alias]['sha256'],role,{'blob':receipt['blob'],'image':image,'source_url':receipt['source_url'],'request':receipt['request']})
                thumb=core.asset(plan['versions'][alias]['sha256'],'research_thumbnail',{'blob':derivative,'image':None,'transform':{'name':'libvips-thumbnail-jpeg-v1','size':1024,'quality':85,'strip':True,'libvips':image['decoder_version']}},parent['id'],plan['job_id'])
                outcome.update(status='decoded_verified',decode_status='full_image_decode',assets=[parent,thumb])
                if receipt['blob']['size_bytes']!=row['image_size_bytes']:
                    outcome['size_discrepancy']={'declared':row['image_size_bytes'],'actual':receipt['blob']['size_bytes']}
    except Exception as e:
        outcome.update(status='validation_or_transport_failed',error=type(e).__name__+': '+str(e)[:500])
    with connection:
        connection.execute('INSERT OR IGNORE INTO item(alias,role,data_json) VALUES (?,?,?)',(alias,role,core.encoded(outcome).decode()))
    connection.close();return alias,outcome

def artifact_row(b,c,verified):
    return ('artifact',{'sha256':b['sha256'],'bucket':c[b['area']+'_bucket'],'object_key':b['object_key'],
                        'size_bytes':b['size_bytes'],'media_type':b['media_type'],'verified_at':verified})

def catalog(root,items,raw,rows,plan,c):
    tables=[];verified=core.now()
    artifacts=[]
    for alias,outcome in items:
        row=rows[alias];version=plan['versions'][alias]
        # Immutable metadata versions and assertions are uploaded regardless of fetch outcome.
        payload={'record_id':core.identity(row['external_url']),'snapshot_id':plan['snapshot']['sha256'],'serving_fields':row,'legacy_evidence':raw[alias]}
        data=core.encoded(payload)
        if core.digest(data)!=version['sha256'] or len(data)!=version['size_bytes']:raise ValueError('frozen_record_version_changed')
        artifacts.append({**version,'base64':base64.b64encode(data).decode()})
        tables.extend([artifact_row(version,c,verified),('source_record',{'id':outcome['record_id'],'identity_strategy':'exact_source_url_v1','source_url':row['external_url']}),
                      ('record_version',{'id':version['sha256'],'record_id':outcome['record_id'],'snapshot_id':plan['snapshot']['sha256'],'aliases_json':core.encoded([alias]).decode()})])
        for assertion in core.assertions(row,raw[alias],version['sha256']):
            tables.append(('assertion',{'id':assertion['id'],'record_version_id':version['sha256'],'origin':assertion['origin'],'review_status':assertion['review_status'],
                                       'input_identity_status':assertion['input_identity_status'],'payload_json':core.encoded(assertion['payload']).decode()}))
        for a in outcome.get('assets',[]):
            tables.append(artifact_row(a['blob'],c,verified))
            tables.append(('asset',{'id':a['id'],'record_version_id':a['record_version_id'],'artifact_sha256':a['blob']['sha256'],'role':a['role'],'parent_asset_id':a['parent_asset_id'],
                                    'processing_run_id':a['processing_run_id'],'lineage_status':a['lineage_status'],'details_json':core.encoded(a).decode()}))
        blob=outcome.get('acquisition',{}).get('blob')
        if blob and not outcome.get('assets'):tables.append(artifact_row(blob,c,verified))
        tables.append(('backfill_item',{'job_id':plan['job_id'],'alias':alias,'role':outcome['role'],'status':outcome['status'],'data_json':core.encoded(outcome).decode()}))
    api('/artifacts',body={'artifacts':artifacts})
    api('/catalog',body={'batch':sql_rows(tables)})
    connection=db(root)
    with connection:
        for alias,outcome in items:connection.execute('UPDATE item SET cataloged=1 WHERE alias=? AND role=?',(alias,outcome['role']))
    connection.close()

def prepare(root):
    root=Path(root);c=core.validate_config(core.load(HERE/'config.json'));core.cloud_guard(c)
    if (root/'plan.json').exists():return
    rows=core.load(root/'metadata.json');allowed=core.load(root/'allowed.json')
    first=Path('/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-data-v1-2026-10-02/release-run')
    old=core.load(first/'plan.json')
    if core.digest(rows)!=old['metadata_sha256']:raise ValueError('metadata_changed_create_new_snapshot_adapter')
    raw={}
    source=Path('/Users/wiel/Development/mtl-archives-search/data/mtl_archives/manifest_enriched_v3.jsonl')
    enriched=root/'legacy-enrichment.jsonl'
    if not enriched.exists():
        before=core.file_hash(source);shutil.copyfile(source,enriched)
        if before!=core.file_hash(source) or before!=core.file_hash(enriched):raise ValueError('enrichment_changed_while_freezing')
    for line in enriched.open():
        r=json.loads(line);raw[r['metadata_filename']]=r
    if any(raw.get(r['metadata_filename'],{}).get('external_url')!=r['external_url'] for r in rows):raise ValueError('raw_alias_source_url_association_failed')
    versions={}
    for r in rows:
        payload={'record_id':core.identity(r['external_url']),'snapshot_id':old['snapshot']['sha256'],'serving_fields':r,'legacy_evidence':raw[r['metadata_filename']]}
        data=core.encoded(payload);sha=core.digest(data)
        versions[r['metadata_filename']]={'sha256':sha,'area':'sources','object_key':f'sha256/{sha[:2]}/{sha}','size_bytes':len(data),'media_type':'application/json'}
    plan={'schema':SCHEMA,'job_id':allowed['job_id'],'snapshot':old['snapshot'],'conditions':old['conditions'],
          'raw_file_sha256':core.file_hash(enriched),'raw_file':str(enriched),'versions':versions,'record_count':len(rows),
          'builder_hash':builder_hash(),'captured_at':core.now(),'environment':{'python':platform.python_version(),'pyvips':pyvips.__version__,'libvips':'.'.join(str(pyvips.version(i)) for i in range(3))},
          'limits':{'legacy_concurrency':24,'original_concurrency':4,'source_max_bytes':512*1024*1024,'decode_max_pixels':MAX_PIXELS,'disk':'working files deleted after cloud verification'},
          'original_decode_policy':'byte preservation and independent R2 SHA-256 verification; master image/PDF decode is a subsequent stage'}
    planblob=upload_json(plan)
    sql='''CREATE TABLE IF NOT EXISTS backfill_item(job_id TEXT NOT NULL,alias TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(job_id,alias,role));
CREATE TRIGGER IF NOT EXISTS immutable_backfill_item_update BEFORE UPDATE ON backfill_item BEGIN SELECT RAISE(ABORT,'immutable backfill row'); END;
CREATE TRIGGER IF NOT EXISTS immutable_backfill_item_delete BEFORE DELETE ON backfill_item BEGIN SELECT RAISE(ABORT,'immutable backfill row'); END;
CREATE TABLE IF NOT EXISTS backfill_release(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,role TEXT NOT NULL,record_count INTEGER NOT NULL,manifest_sha256 TEXT NOT NULL REFERENCES artifact(sha256),verified_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_backfill_release_update BEFORE UPDATE ON backfill_release BEGIN SELECT RAISE(ABORT,'immutable backfill release'); END;
CREATE TRIGGER IF NOT EXISTS immutable_backfill_release_delete BEFORE DELETE ON backfill_release BEGIN SELECT RAISE(ABORT,'immutable backfill release'); END;'''
    core.cf('d1','query',c['catalog_id'],'--body',core.encoded({'sql':sql}).decode())
    api('/catalog',body={'batch':sql_rows([artifact_row(planblob,c,core.now())])})
    core.save(root/'plan.json',plan);(root/'work').mkdir(exist_ok=True)
    print('Prepared full frozen backfill',plan['job_id'],flush=True)

def execute(root,role,limit=None,workers=None):
    root=Path(root);plan=core.load(root/'plan.json');c=core.load(HERE/'config.json')
    if plan['builder_hash']!=builder_hash():raise ValueError('frozen_bulk_builder_changed')
    if api('/health',method='GET')['job_id']!=plan['job_id']:raise ValueError('transfer_worker_frozen_job_mismatch')
    if core.file_hash(plan['raw_file'])!=plan['raw_file_sha256']:raise ValueError('raw_enrichment_file_changed')
    raw={json.loads(line)['metadata_filename']:json.loads(line) for line in Path(plan['raw_file']).open()}
    rows={r['metadata_filename']:r for r in core.load(root/'metadata.json')}
    connection=db(root)
    pending=[(a,json.loads(v)) for a,v in connection.execute('SELECT alias,data_json FROM item WHERE role=? AND cataloged=0',(role,))]
    for i in range(0,len(pending),20):catalog(root,pending[i:i+20],raw,rows,plan,c)
    completed={r[0] for r in connection.execute('SELECT alias FROM item WHERE role=?',(role,))};connection.close()
    todo=[r for alias,r in rows.items() if alias not in completed]
    if limit is not None:todo=todo[:limit]
    workers=workers or (24 if role=='legacy_delivery' else 4)
    batch=[];start=time.monotonic();processed=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        iterator=iter(todo);futures=set()
        def fill():
            while len(futures)<workers:
                row=next(iterator,None)
                if row is None:break
                futures.add(pool.submit(process,root,role,row,raw[row['metadata_filename']],plan,c))
        fill()
        while futures:
            done,_=concurrent.futures.wait(futures,return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                futures.remove(future);batch.append(future.result());processed+=1
                if len(batch)>=20:catalog(root,batch,raw,rows,plan,c);batch=[]
                if processed%20==0:print(json.dumps({'role':role,'completed':len(completed)+processed,'total':len(rows),'rate_per_minute':round(processed/(time.monotonic()-start)*60,1)},sort_keys=True),flush=True)
            fill()
        if batch:catalog(root,batch,raw,rows,plan,c)
    report(root,role)

def report(root,role):
    root=Path(root);plan=core.load(root/'plan.json');connection=db(root)
    items=[json.loads(x[0]) for x in connection.execute('SELECT data_json FROM item WHERE role=? ORDER BY alias',(role,))]
    from collections import Counter,defaultdict
    statuses=dict(Counter(x['status'] for x in items));hashes=defaultdict(list)
    for item in items:
        blob=item.get('acquisition',{}).get('blob')
        if blob:hashes[blob['sha256']].append(item['alias'])
    result={'schema':SCHEMA,'job_id':plan['job_id'],'role':role,'selected':plan['record_count'],'accounted':len(items),'statuses':statuses,
            'complete_accounting':len(items)==plan['record_count'],'unique_source_byte_hashes':len(hashes),
            'duplicate_groups':[{'sha256':sha,'aliases':aliases} for sha,aliases in sorted(hashes.items()) if len(aliases)>1],
            'failures':[x for x in items if x['status'] not in ('decoded_verified','byte_preserved')],
            'size_discrepancies':[{'alias':x['alias'],**x['size_discrepancy']} for x in items if x.get('size_discrepancy')],
            'items':items,'plan_sha256':core.digest(plan)}
    core.save(root/(role+'-report.json'),result)
    if result['complete_accounting']:
        shards=[upload_json({'items':items[i:i+200],'job_id':plan['job_id'],'role':role}) for i in range(0,len(items),200)]
        manifest={k:v for k,v in result.items() if k not in ('items','failures')}
        manifest['item_shards']=shards
        manifest['failure_counts']=dict(Counter(x.get('error','unknown') for x in result['failures']))
        artifact=upload_json(manifest)
        c=core.load(HERE/'config.json');verified=core.now()
        rows=[artifact_row(artifact,c,verified),('backfill_release',{'id':artifact['sha256'],'job_id':plan['job_id'],'role':role,'record_count':len(items),'manifest_sha256':artifact['sha256'],'verified_at':verified})]
        # Complete marker is inserted only after all expected aliases are in D1.
        remote=api('/catalog',body={'batch':[{'sql':'SELECT count(*) AS n FROM backfill_item WHERE job_id=? AND role=?','params':[plan['job_id'],role]}]})
        if remote[0]['results'][0]['n']!=len(items):raise ValueError('remote_accounting_mismatch')
        api('/catalog',body={'batch':sql_rows(rows)})
        core.save(root/(role+'-release.json'),artifact)
    connection.close()
    print(json.dumps({k:v for k,v in result.items() if k not in ('items','failures','duplicate_groups')},indent=2),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    sub=parser.add_subparsers(dest='command',required=True);sub.add_parser('prepare')
    sub.add_parser('status')
    run=sub.add_parser('run');run.add_argument('--role',choices=['legacy_delivery','source_original'],required=True);run.add_argument('--limit',type=int);run.add_argument('--workers',type=int)
    status=sub.add_parser('report');status.add_argument('--role',choices=['legacy_delivery','source_original'],required=True)
    args=parser.parse_args()
    if args.command=='status':
        connection=db(args.out)
        values=connection.execute("SELECT role,json_extract(data_json,'$.status'),count(*),sum(cataloged) FROM item GROUP BY 1,2").fetchall()
        print(json.dumps({'phases':[{'role':role,'status':status,'count':count,'cataloged':cataloged} for role,status,count,cataloged in values],
                          'completion':core.load(args.out/'execution-finished.json') if (args.out/'execution-finished.json').exists() else None},indent=2))
        connection.close()
    elif args.command=='prepare':prepare(args.out)
    elif args.command=='run':execute(args.out,args.role,args.limit,args.workers)
    else:report(args.out,args.role)

if __name__=='__main__':main()
