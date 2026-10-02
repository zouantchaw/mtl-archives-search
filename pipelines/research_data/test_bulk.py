import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import pyvips
from PIL import Image
import bulk
import run as core
import bulk_supervisor

class BulkTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_large_sequential_decode_and_truncated_image_rejected(self):
        source=self.root/'image.jpg';thumbnail=self.root/'thumbnail.jpg'
        Image.new('RGB',(2048,2048),(17,20,40)).save(source)
        info=bulk.decode_and_thumbnail(source,thumbnail)
        self.assertEqual(info['width'],2048)
        with Image.open(thumbnail) as rendered:
            self.assertLessEqual(rendered.width,1024)
        source.write_bytes(source.read_bytes()[:80])
        with self.assertRaises(pyvips.Error):bulk.decode_and_thumbnail(source,thumbnail)
    def test_streamed_private_download_hash_mismatch(self):
        blob={'sha256':'a'*64,'size_bytes':3,'area':'sources'}
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def raise_for_status(self):pass
            def iter_content(self,n):yield b'bad'
        class Session:
            def get(self,*args,**kwargs):return Response()
        with patch.object(bulk,'session',return_value=Session()):
            with self.assertRaises(ValueError):bulk.download_private(blob,self.root/'file')
    def test_checkpoint_resume_no_network(self):
        con=bulk.db(self.root)
        data={'status':'decoded_verified'}
        con.execute('INSERT INTO item(alias,role,data_json) VALUES (?,?,?)',('alias','legacy_delivery',json.dumps(data)));con.commit();con.close()
        with patch.object(bulk,'api',side_effect=AssertionError('resume refetched')):
            self.assertEqual(bulk.process(self.root,'legacy_delivery',{'metadata_filename':'alias'},{},{},{}),('alias',data))
    def test_catalog_conflicting_existing_row_rolls_back(self):
        db=sqlite3.connect(':memory:');db.executescript(core.schema_sql())
        db.execute('CREATE TABLE backfill_item(job_id TEXT,alias TEXT,role TEXT,status TEXT,data_json TEXT,PRIMARY KEY(job_id,alias,role))')
        original={'job_id':'job','alias':'a','role':'legacy_delivery','status':'ok','data_json':'{}'}
        for q in bulk.sql_rows([('backfill_item',original)]):db.execute(q['sql'],q['params'])
        db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            with db:
                for q in bulk.sql_rows([('backfill_item',{**original,'status':'different'})]):db.execute(q['sql'],q['params'])
        self.assertEqual(db.execute('SELECT status FROM backfill_item').fetchone()[0],'ok')
    def test_source_hash_preservation_does_not_claim_decode(self):
        (self.root/'work').mkdir()
        row={'metadata_filename':'alias','external_url':'http://depot.ville.montreal.qc.ca/master.tif'}
        plan={'job_id':'job','versions':{'alias':{'sha256':'v'*64}}}
        receipt={'status':'preserved','source_url':row['external_url'],'blob':{'sha256':'a'*64,'media_type':'image/tiff'},'request':{}}
        with patch.object(bulk,'api',return_value=receipt):
            _,data=bulk.process(self.root,'source_original',row,{},plan,{})
        self.assertEqual(data['status'],'byte_preserved')
        self.assertEqual(data['decode_status'],'not_attempted_source_master')
        self.assertIsNone(data['assets'][0]['image'])
        self.assertIsNone(data['assets'][0]['parent_asset_id'])

    def test_supervisor_failed_guard_requires_attention_and_can_resume(self):
        def execute(command,**kwargs):
            return SimpleNamespace(returncode=1 if command[-1]=='guard-production' else 0)
        argv=['bulk_supervisor.py','--out',str(self.root)]
        with patch.object(bulk_supervisor.sys,'argv',argv),patch.object(bulk_supervisor.subprocess,'run',side_effect=execute),patch.object(bulk_supervisor.time,'sleep'):
            with self.assertRaises(SystemExit):bulk_supervisor.main()
        receipt=json.loads((self.root/'execution-finished.json').read_text())
        self.assertEqual(receipt['status'],'needs_attention')
        self.assertEqual(receipt['production_comparison_exit_code'],1)
        with patch.object(bulk_supervisor.sys,'argv',argv),patch.object(bulk_supervisor.subprocess,'run',return_value=SimpleNamespace(returncode=0)):
            bulk_supervisor.main()
        self.assertEqual(json.loads((self.root/'execution-finished.json').read_text())['status'],'complete_accounting')
        with patch.object(bulk_supervisor.sys,'argv',argv),patch.object(bulk_supervisor.subprocess,'run',side_effect=AssertionError('completed job reran')):
            bulk_supervisor.main()

if __name__=='__main__':unittest.main()
