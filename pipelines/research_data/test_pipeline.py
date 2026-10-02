import argparse
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import run as pipeline


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.config=pipeline.load(pipeline.HERE/'config.json')
        self.store=pipeline.Store(self.root)
        self.image=self.root/'fixture.jpg'
        Image.new('RGB',(64,48),(120,20,40)).save(self.image)

    def tearDown(self):
        self.store.db.close();self.tmp.cleanup()

    def frozen_plan(self,rows=None):
        rows=rows or [{'metadata_filename':'mtl_archives_metadata_0.json','resolved_image_filename':'mtl_archives_image_0.jpg',
                      'external_url':'http://depot.ville.montreal.qc.ca/photo.jpg','image_size_bytes':self.image.stat().st_size,
                      'vlm_caption':'proposal','vlm_caption_status':'unreviewed'}]
        evidence=self.store.json_blob({'rows':[{**r,'ocr_text':'legacy OCR'} for r in rows]})
        snapshot=self.store.json_blob({'captured_at':'2026-10-02T00:00:00Z','rows':rows})
        conditions=self.store.json_blob({'scope':'fixture'})
        plan={'schema':pipeline.SCHEMA,'snapshot':snapshot,'conditions':conditions,'local_evidence':evidence,
              'reconciled_export':snapshot,'selection_policy':'fixture','records':rows,'original_ids':[],
              'frozen_config':self.config,'builder_code_sha256':pipeline.code_hash(),'environment':pipeline.environment()}
        pipeline.save(self.root/'plan.json',plan)
        return plan

    def fake_download(self,url,path,limit,delivery=False):
        Path(path).write_bytes(self.image.read_bytes())
        return {'http_status':200,'final_url':url,'content_type':'image/jpeg','etag':'fixture','last_modified':None}

    def test_identity_independent_of_alias_order_and_byte_hash(self):
        url='http://depot.ville.montreal.qc.ca/photo.jpg'
        self.assertEqual(pipeline.identity(url),pipeline.identity(url))
        self.assertNotEqual(pipeline.identity(url),pipeline.identity(url+'?version=2'))
        self.assertNotIn('metadata_',pipeline.identity(url))

    def test_production_targets_rejected(self):
        for key,value in [('catalog_id',pipeline.PRODUCTION_DB),('sources_bucket','mtl-archives'),('derived_bucket','mtl-archives')]:
            config={**self.config,key:value}
            with self.assertRaises(ValueError):pipeline.validate_config(config)

    def test_cloud_database_name_mismatch_refuses_mutation(self):
        with patch.object(pipeline,'cf',return_value={'name':'mtl-archives'}) as cf:
            with self.assertRaises(ValueError):pipeline.cloud_guard(self.config)
            self.assertEqual(cf.call_count,1)

    def test_public_research_bucket_refused(self):
        with patch.object(pipeline,'cf',side_effect=[{'name':self.config['catalog_name']},{'enabled':True},{'domains':[]}]) as cf:
            with self.assertRaises(ValueError):pipeline.cloud_guard(self.config)
            self.assertEqual(cf.call_count,3)

    def test_corrupted_blob_is_not_trusted_on_resume(self):
        b=self.store.blob(self.image,'sources','image/jpeg')
        (self.root/'blobs'/b['sha256']).write_bytes(b'wrong')
        with self.assertRaises(ValueError):self.store.check_blob(b)

    def test_missing_blob_rejects_release(self):
        self.frozen_plan()
        with patch.object(pipeline,'download',side_effect=self.fake_download):
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
        _,_,blobs=pipeline.artifacts(self.store)
        (self.root/'blobs'/next(iter(blobs))).unlink()
        with self.assertRaises(ValueError):pipeline.verify_local(self.store,self.config)

    def test_checkpoint_invalidated_on_metadata_change(self):
        self.store.checkpoint('canonical',pipeline.digest({'title':'old'}),{'title':'old'})
        self.assertIsNone(self.store.cached('canonical',pipeline.digest({'title':'new'})))

    def test_reconciliation_counts_missing_provenance_fields(self):
        row={'metadata_filename':'mtl_archives_metadata_0.json','external_url':'http://depot.ville.montreal.qc.ca/photo.jpg',
             'vlm_caption_source':'unknown_legacy','vlm_caption_status':'unreviewed','vlm_caption_model':None}
        enriched=self.root/'enriched.jsonl';enriched.write_text(json.dumps(row)+'\n')
        canonical=self.root/'canonical.jsonl'
        old={k:v for k,v in row.items() if not k.startswith('vlm_caption_')}
        canonical.write_text(json.dumps(old)+'\n')
        conditions=self.root/'conditions.json';conditions.write_text('[]')
        args=argparse.Namespace(out=self.root,ids=[0],enriched=enriched,local_canonical=canonical,conditions=conditions,
                                conditions_observed_at='fixture',original_ids=[])
        with patch.object(pipeline,'production_metadata',return_value=[row]):pipeline.freeze(args,self.config)
        plan=pipeline.load(self.root/'plan.json')
        self.assertEqual(plan['drift'],{'vlm_caption_source':1,'vlm_caption_status':1,'vlm_caption_model':1})
        self.assertEqual(json.loads(canonical.read_text()),old)

    def test_interruption_resume_and_rebuild_same_release(self):
        row={'metadata_filename':'mtl_archives_metadata_0.json','resolved_image_filename':'mtl_archives_image_0.jpg',
             'external_url':'http://depot.ville.montreal.qc.ca/one.jpg','image_size_bytes':self.image.stat().st_size}
        second={**row,'metadata_filename':'mtl_archives_metadata_1.json','external_url':'http://depot.ville.montreal.qc.ca/two.jpg'}
        self.frozen_plan([row,second])
        with patch.object(pipeline,'download',side_effect=self.fake_download) as download:
            pipeline.build(argparse.Namespace(out=self.root,stop_after=1),self.config)
            self.assertFalse((self.root/'release.json').exists())
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
            first=pipeline.load(self.root/'release.json')['id']
            self.assertEqual(download.call_count,2)
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
            self.assertEqual(download.call_count,2)
            self.assertEqual(first,pipeline.load(self.root/'release.json')['id'])
        _,m,_=pipeline.artifacts(self.store)
        self.assertEqual(len(m['duplicate_groups']),1)
        self.assertEqual(len(m['records']),2)

    def test_failed_original_is_frozen_and_not_invented(self):
        plan=self.frozen_plan();plan['original_ids']=[0];pipeline.save(self.root/'plan.json',plan)
        def download(url,path,limit,delivery=False):
            if not delivery:raise OSError('fixture original unavailable')
            return self.fake_download(url,path,limit,delivery)
        with patch.object(pipeline,'download',side_effect=download) as mocked:
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
            first=pipeline.load(self.root/'release.json')['id']
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
            self.assertEqual(mocked.call_count,2)
            self.assertEqual(first,pipeline.load(self.root/'release.json')['id'])
        _,m,_=pipeline.artifacts(self.store)
        self.assertEqual(m['records'][0]['original_acquisition']['status'],'failed')
        self.assertEqual(len(m['records'][0]['assets']),2)

    def test_failures_are_excluded_with_durable_attempts(self):
        self.frozen_plan()
        with patch.object(pipeline,'download',side_effect=OSError('fixture outage')):
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
        _,m,_=pipeline.artifacts(self.store)
        self.assertEqual(len(m['exclusions']),1)
        self.assertEqual(len(m['records']),0)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM attempt').fetchone()[0],1)

    def test_derived_assertions_do_not_become_facts(self):
        values=pipeline.assertions({'vlm_caption':'a theory'}, {'ocr_text':'some text'}, 'version')
        for a in values:
            if a['origin']=='legacy_derived':
                self.assertEqual(a['input_identity_status'],'historical_input_hash_unknown')
                self.assertNotEqual(a['review_status'],'reviewed')

    def test_decode_limits_and_transform_parent(self):
        with self.assertRaises((ValueError,Image.DecompressionBombError,Image.DecompressionBombWarning)):
            pipeline.decode(self.image,{**self.config,'max_pixels':100})
        parent={'blob':self.store.blob(self.image,'sources','image/jpeg')}
        derivative=pipeline.transform(self.store,parent,self.config,'run')
        record=pipeline.asset('version','research_thumbnail',derivative,'parent','run')
        self.assertEqual(record['parent_asset_id'],'parent')
        self.assertEqual(record['lineage_status'],'verified_transform')

    def test_remote_corruption_fails_readback(self):
        blob=self.store.blob(self.image,'sources','image/jpeg')
        def remote(bucket,key,path):Path(path).write_bytes(b'wrong bytes')
        with patch.object(pipeline,'remote_file',side_effect=remote):
            with self.assertRaises(ValueError):pipeline.verify_remote_blob(self.store,blob,self.config)

    def test_catalog_rows_immutable_and_count_guard(self):
        db=sqlite3.connect(':memory:');db.executescript(pipeline.schema_sql())
        h='a'*64
        db.execute('INSERT INTO artifact VALUES (?,?,?,?,?,?)',(h,'bucket','key',3,'image/jpeg','date'))
        with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE artifact SET size_bytes=4')
        with self.assertRaises(sqlite3.IntegrityError):db.execute('DELETE FROM artifact')

    def test_full_catalog_foreign_keys_and_replay(self):
        self.frozen_plan()
        with patch.object(pipeline,'download',side_effect=self.fake_download):
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
        pointer,m,blobs=pipeline.artifacts(self.store)
        snap=pipeline.load(self.store.check_blob(m['snapshot']))
        rows=pipeline.catalog_rows(pointer,m,blobs,self.config,[],'verified',snap)
        db=sqlite3.connect(':memory:');db.executescript(pipeline.schema_sql())
        for _ in range(2):
            for table,values in rows:
                sql=f'INSERT OR IGNORE INTO {table}({",".join(values)}) VALUES ({",".join("?" for _ in values)})'
                db.execute(sql,list(values.values()))
        self.assertEqual(db.execute('SELECT count(*) FROM dataset_release').fetchone()[0],1)
        self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchall())

    def test_offline_recomputes_renditions_and_same_release(self):
        self.frozen_plan()
        with patch.object(pipeline,'download',side_effect=self.fake_download):
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None),self.config)
        before=pipeline.load(self.root/'release.json')['id']
        with self.store.db:self.store.db.execute("DELETE FROM checkpoint WHERE key LIKE 'thumbnail:%'")
        with patch.object(pipeline,'download',side_effect=AssertionError('offline must not fetch')):
            pipeline.build(argparse.Namespace(out=self.root,stop_after=None,offline=True),self.config)
        self.assertEqual(before,pipeline.load(self.root/'release.json')['id'])

    def test_disallowed_source_and_redirect_targets(self):
        for url in ('http://127.0.0.1/data','file:///etc/passwd','https://example.org/a','http://user:pass@depot.ville.montreal.qc.ca/a'):
            with self.assertRaises(ValueError):pipeline.check_url(url)

    def test_frozen_config_changes_require_new_run(self):
        plan=self.frozen_plan();plan['frozen_config']['thumbnail_quality']=84
        pipeline.save(self.root/'plan.json',plan)
        with self.assertRaises(ValueError):pipeline.build(argparse.Namespace(out=self.root,stop_after=None),pipeline.load(pipeline.HERE/'config.json'))

if __name__=='__main__':unittest.main()
