"""Risk tests for versioning, leakage, failure retention and private recovery."""
import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import workflow as w
from storage import Cloud, HERE, Store, atomic_new, digest, encoded, load, reference, validate_config


class FakeCloud:
    """Real SQLite transactions, an independent byte store, no external requests."""
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript((HERE/'schema.sql').read_text())
        self.blobs = {}
        self.fail_batch = False

    def guard(self):
        pass

    def put(self, ref, path):
        data = Path(path).read_bytes()
        if digest(data) != ref['sha256']:
            raise ValueError('bad upload')
        self.blobs[(ref['area'], ref['sha256'])] = data

    def get(self, ref, dest):
        data = self.blobs[(ref['area'], ref['sha256'])]
        if len(data) != ref['size_bytes'] or digest(data) != ref['sha256']:
            raise ValueError('bad private bytes')
        atomic_new(dest, data)

    def batch(self, statements):
        if self.fail_batch:
            raise RuntimeError('injected transaction failure')
        out = []
        with self.db:
            for statement in statements:
                cur = self.db.execute(statement['sql'], statement.get('params', []))
                out.append({'success': True, 'results': [dict(row) for row in cur] if cur.description else []})
        return out


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name)/'local')
        self.addCleanup(self.store.db.close)
        self.source = w.register_source(self.store, load(HERE/'examples/current-source.json'))
        self.study = w.register_study(self.store, load(HERE/'examples/coverage-study.json'))
        self.retrieval = w.register_study(self.store, load(HERE/'examples/retrieval-study.json'))
        self.policy = load(HERE/'examples/coverage-selection.json')
        self.release = self.make_release()
        self.imported = w.import_release(self.store, self.source, self.release)
        self.snapshot = w.freeze(self.store, self.study, self.imported, self.policy)

    def binary(self, data, area='sources', mime='image/jpeg'):
        ref = reference(digest(data), len(data), area, mime)
        atomic_new(self.store.blobs/ref['sha256'], data)
        return ref

    def make_release(self, changed=False):
        # Fixtures test identities/storage, not image decoding or human quality.
        shared = self.binary(b'synthetic duplicate image bytes')
        snapshot = self.store.put({'fixture': True})
        conditions = self.store.put({'conditions': 'synthetic'})
        rows = []
        for i in range(3):
            url = f'https://archivesdemontreal.com/fixture/{i}'
            rid = w.record_identity(url)
            alias = f'fixture_{i}.json'
            fields = dict(external_url=url, metadata_filename=alias, name=f'fixture {i}', description='revised' if changed and i == 0 else None)
            version = self.store.put({'record_id': rid, 'snapshot_id': snapshot['sha256'], 'serving_fields': fields})
            image = shared if i < 2 else self.binary(b'synthetic unique image bytes')
            assets = []
            for role in ('legacy_delivery', 'research_thumbnail'):
                asset = dict(role=role, blob=image, record_version_id=version['sha256'],
                             lineage_status='legacy_parent_unknown', parent_asset_id=None)
                assets.append({'id': digest(asset), **asset})
            rows.append(dict(id=rid, aliases=[alias], source_url=url, record_version=version, assets=assets, assertions=[]))
        manifest = dict(schema='mtl-research-data-v1', records=rows, snapshot=snapshot,
                        conditions=conditions, exclusions=[], limitations=['Synthetic fixture, no research conclusions.'])
        return {'manifest': self.store.put(manifest)}

    def test_import_refresh_is_append_only(self):
        repeat = w.import_release(self.store, self.source, self.release, previous=self.imported)
        self.assertEqual(len(self.store.entity(repeat)['data']['delta']['unchanged']), 3)
        revised = w.import_release(self.store, self.source, self.make_release(True), previous=self.imported)
        delta = self.store.entity(revised)['data']['delta']
        self.assertEqual(len(delta['revised']), 1)
        self.assertEqual(len(delta['unchanged']), 2)
        self.assertIsNone(w.records(self.store, self.imported)[0]['metadata_summary'].get('new_field'))
        self.assertEqual(self.store.entity(self.snapshot)['data']['import_id'], self.imported)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute('DELETE FROM research_entity WHERE id=?', (self.imported,))

    def test_current_adapter_retains_published_v1_identity(self):
        url = 'http://archivesdemontreal.com/greffe/vues-aeriennes-archives/jpeg/VM97-3_7P26-052.jpg'
        self.assertEqual(w.record_identity(url), 'mtl:url-v1:02ee8f3ae835b0e0b86a4ab81a8d3f055fe1d64cddcbe98cd642ba6216c0abb3')

    def test_corrupted_cache_fails_not_refetched(self):
        asset = w.selected_rows(self.store, self.snapshot)[0]['assets'][0]['blob']
        (self.store.blobs/asset['sha256']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'hash/size mismatch'):
            w.verify_snapshot(self.store, self.snapshot)

    def test_exact_duplicate_group_selection_and_split(self):
        policy = {**self.policy, 'max_records': 3, 'partitions': {'dev': .5, 'test': .5}}
        snap = w.freeze(self.store, self.study, self.imported, policy)
        selected = w.selected_rows(self.store, snap)
        by_hash = {}
        for row in selected:
            sha = row['assets'][0]['blob']['sha256']
            self.assertEqual(by_hash.setdefault(sha, row['partition']), row['partition'])
        self.assertEqual(snap, w.freeze(self.store, self.study, self.imported, policy))
        with self.assertRaisesRegex(ValueError, 'family review'):
            w.freeze(self.store, self.study, self.imported, {**policy, 'purpose': 'research'})

    def test_family_map_binds_import_and_prevents_leakage(self):
        ids = [r['id'] for r in w.records(self.store, self.imported)]
        family = w.register_families(self.store, self.imported, dict(key='family', groups={'one-series': ids}, reviewer='fixture', review_status='human_declared'))
        snap = w.freeze(self.store, self.study, self.imported,
                        {**self.policy, 'purpose': 'research', 'partitions': {'dev': .5, 'test': .5}}, family)
        self.assertEqual(len({r['partition'] for r in w.selected_rows(self.store, snap)}), 1)
        refreshed = w.import_release(self.store, self.source, self.release, previous=self.imported)
        with self.assertRaisesRegex(ValueError, 'another import'):
            w.freeze(self.store, self.study, refreshed, self.policy, family)

    def test_retrieval_corpus_is_shared_query_splits_separate(self):
        with self.assertRaisesRegex(ValueError, 'query intents'):
            w.freeze(self.store, self.retrieval, self.imported, self.policy)
        q = dict(key='dev', author='fixture', author_type='synthetic', partition='development', intents=[dict(id='i1', fr='rue', en='street')])
        w.register_queries(self.store, self.retrieval, q)
        with self.assertRaisesRegex(ValueError, 'development and heldout'):
            w.register_queries(self.store, self.retrieval, {**q, 'partition': 'heldout'})

    def test_failures_are_durable_and_retry_is_new_run(self):
        with patch('workflow.coverage', side_effect=ValueError('injected corrupt input')):
            with self.assertRaisesRegex(RuntimeError, 'retained run'):
                w.execute_coverage(self.store, self.study, self.snapshot)
        failed = [x['id'] for x in self.store.inventory() if x['kind'] == 'run'][0]
        self.assertEqual([x['phase'] for x in self.store.events(failed)], ['started', 'failed'])
        success = w.execute_coverage(self.store, self.study, self.snapshot)
        self.assertNotEqual(failed, success)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.event(success, 'failed', {'at': w.now()})
        result = self.store.json(self.store.events(success)[1]['data']['output'])
        self.assertEqual(result['unique_asset_blobs'], 2)
        with self.assertRaisesRegex(ValueError, 'own frozen study'):
            w.execute_coverage(self.store, self.retrieval, self.snapshot)

    def test_annotation_snapshot_binding_and_uncertainty(self):
        packet = w.packet(self.store, self.snapshot, load(HERE/'examples/ocr-practice-packet.json'))
        item = self.store.entity(packet)['data']['items'][0]
        response = dict(key='practice', packet=packet, reviewer='fixture reviewer', reviewer_type='synthetic', independence='unknown',
                        decisions=[dict(item=item['id'], value='uncertain', seconds=1, note='unreadable')])
        labels = w.import_labels(self.store, packet, response)
        self.assertFalse(self.store.entity(labels)['data']['complete'])
        self.assertEqual(self.store.entity(labels)['data']['reference_status'], 'pending_quality_review')
        with self.assertRaisesRegex(ValueError, 'packet identity'):
            w.import_labels(self.store, packet, {**response, 'packet': 'another version'})
        with self.assertRaisesRegex(ValueError, 'annotation decision'):
            w.import_labels(self.store, packet, {**response, 'decisions': [dict(item='not-in-packet', value='uncertain', seconds=1, note='')]})

    def test_pinned_recipes_cannot_use_unknown_model_or_render(self):
        draft = load(HERE/'examples/fresh-ocr-recipe-draft.json')
        w.register_recipe(self.store, draft)
        with self.assertRaisesRegex(ValueError, 'exact render'):
            w.register_recipe(self.store, {**draft, 'stage': 'pinned'})
        with self.assertRaisesRegex(ValueError, 'pixels only'):
            w.register_recipe(self.store, {**draft, 'context': ['pixels', 'source_metadata']})

    def test_bulk_adapter_rejects_unfinished_or_wrong_shards(self):
        plan = dict(job_id='job', versions={})
        manifest = dict(schema='mtl-research-backfill-v1', complete_accounting=False, accounted=0, selected=3)
        with self.assertRaisesRegex(ValueError, 'completed accounting'):
            w.import_release(self.store, self.source, self.store.put(manifest), plan)
        shard = self.store.put({'job_id': 'wrong', 'role': 'legacy_delivery', 'items': []})
        manifest.update(complete_accounting=True, accounted=3, job_id='job', plan_sha256=digest(plan), role='legacy_delivery', item_shards=[shard])
        with self.assertRaisesRegex(ValueError, 'shard/phase'):
            w.import_release(self.store, self.source, self.store.put(manifest), plan)

    def test_completed_bulk_keeps_failures_and_resolves_selected_versions(self):
        rows = self.store.json(self.release['manifest'])['records']
        plan = dict(job_id='job', versions={r['aliases'][0]: r['record_version'] for r in rows})
        items = [dict(record_id=r['id'], alias=r['aliases'][0],
                      status='decoded_verified' if i < 2 else 'validation_or_transport_failed',
                      assets=r['assets'] if i < 2 else [], error=None if i < 2 else 'source_http_503')
                 for i, r in enumerate(rows)]
        shard = self.store.put({'job_id': 'job', 'role': 'legacy_delivery', 'items': items})
        manifest = dict(schema='mtl-research-backfill-v1', complete_accounting=True, accounted=3, selected=3,
                        job_id='job', plan_sha256=digest(plan), role='legacy_delivery', item_shards=[shard],
                        statuses={'decoded_verified': 2, 'validation_or_transport_failed': 1})
        imported = w.import_release(self.store, self.source, self.store.put(manifest), plan)
        snap = w.freeze(self.store, self.study, imported, self.policy)
        self.assertEqual(w.verify_snapshot(self.store, snap)['records'], 2)
        report = w.coverage(self.store, snap)
        self.assertEqual(report['excluded'], 1)
        self.assertEqual(report['excluded_statuses'], {'validation_or_transport_failed': 1})

    def test_private_publication_replay_and_restore(self):
        cloud = FakeCloud()
        run = w.execute_coverage(self.store, self.study, self.snapshot)
        receipt = self.store.publish(cloud)
        self.assertEqual(self.store.publish(cloud)['id'], receipt['id'])
        restored = Store(Path(self.temp.name)/'restored', cloud=cloud)
        self.addCleanup(restored.db.close)
        restored.restore(cloud, receipt['id'])
        # Upstream image bytes are fetched independently, not bundled in metadata.
        for ref in [a['blob'] for r in w.selected_rows(self.store, self.snapshot) for a in r['assets']]:
            cloud.blobs[(ref['area'], ref['sha256'])] = self.store.path(ref).read_bytes()
        self.assertEqual(w.coverage(restored, self.snapshot), w.coverage(self.store, self.snapshot))
        self.assertEqual(restored.events(run), self.store.events(run))

    def test_publish_failure_has_no_complete_marker_and_is_resumable(self):
        cloud = FakeCloud()
        cloud.fail_batch = True
        with self.assertRaises(RuntimeError):
            self.store.publish(cloud)
        self.assertEqual(cloud.db.execute('SELECT count(*) FROM research_publication').fetchone()[0], 0)
        cloud.fail_batch = False
        self.store.publish(cloud)
        self.assertEqual(cloud.db.execute('SELECT count(*) FROM research_publication').fetchone()[0], 1)

    def test_large_upstream_index_is_bounded_and_recoverable(self):
        large = Store(Path(self.temp.name)/'large')
        self.addCleanup(large.db.close)
        refs = [reference(digest(str(i).encode()), 100, 'sources', 'image/jpeg') for i in range(500)]
        for i in range(0, len(refs), 50):
            large.add('packet', f'reference-accounting-{i}', {'references': refs[i:i+50]})
        cloud = FakeCloud()
        with patch('storage.MAX_METADATA', 32*1024):
            original = large.publication()
            self.assertGreater(len(encoded(original)), 32*1024)
            receipt = large.publish(cloud)
            manifest = large.json(receipt['manifest'])
            index = manifest['upstream_index']
            self.assertEqual(index['count'], 500)
            self.assertEqual(index['sha256'], digest(original['upstream']))
            self.assertLessEqual(receipt['manifest']['size_bytes'], 32*1024)
            self.assertTrue(all(r['size_bytes'] <= 16*1024 for r in index['shards']))
            self.assertTrue(all(area == 'derived' for area, sha in cloud.blobs))
            restored = Store(Path(self.temp.name)/'large-restored')
            self.addCleanup(restored.db.close)
            restored.restore(cloud, receipt['id'])
            self.assertEqual(restored.inventory(), large.inventory())
            self.assertEqual(large.publish(cloud)['id'], receipt['id'])
            # A validly hashed root with a wrong index count still cannot install
            # its ledger. Metadata transport checks alone are not accounting.
            bad = copy.deepcopy(manifest)
            bad['upstream_index']['count'] += 1
            bad_ref = large.put(bad)
            cloud.put(bad_ref, large.path(bad_ref))
            cloud.batch([{'sql': 'INSERT INTO research_publication VALUES(?,?,?,?)',
                          'params': [bad_ref['sha256'], encoded(bad_ref).decode(), receipt['entity_count'], 0]}])
            rejected = Store(Path(self.temp.name)/'bad-index')
            self.addCleanup(rejected.db.close)
            with self.assertRaisesRegex(ValueError, 'upstream index accounting'):
                rejected.restore(cloud, bad_ref['sha256'])
            self.assertEqual(rejected.inventory(), [])

    def test_conflicting_remote_row_rolls_back(self):
        cloud = FakeCloud()
        cloud.db.execute('INSERT INTO research_entity VALUES(?,?,?,?)', (self.source, 'source', 'incorrect', '{}'))
        cloud.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.publish(cloud)
        self.assertEqual(cloud.db.execute('SELECT count(*) FROM research_publication').fetchone()[0], 0)

    def test_fixture_publish_and_production_targets_refused(self):
        synthetic = w.import_release(self.store, self.source, self.release, synthetic=True)
        self.assertTrue(self.store.entity(synthetic)['data']['synthetic'])
        with self.assertRaisesRegex(ValueError, 'synthetic fixture'):
            self.store.publication()
        config = load(HERE/'config.json')
        for target in ('5c847f8e-5f2a-4d5e-8a7d-fae70025c398', '36147ac0-44c6-43db-84bf-6a8d2bb41b8a'):
            with self.assertRaisesRegex(ValueError, 'unrecognized research'):
                validate_config({**config, 'studies_id': target})

    def test_editing_config_file_cannot_change_write_boundary(self):
        production = {**load(HERE/'config.json'), 'studies_name': 'mtl-archives',
                      'studies_id': '5c847f8e-5f2a-4d5e-8a7d-fae70025c398'}
        with patch('storage.load', return_value=production):
            with self.assertRaisesRegex(ValueError, 'unrecognized research'):
                Cloud()

    def test_relevance_packet_hides_machine_context(self):
        snap = w.freeze(self.store, self.retrieval, self.imported, load(HERE/'examples/retrieval-selection.json'))
        queries = w.register_queries(self.store, self.retrieval, dict(key='queries', author='fixture', author_type='synthetic',
            partition='development', intents=[dict(id='intent', fr='rue', en='street')]))
        definition = dict(key='relevance', task='query_relevance', purpose='development', asset_role='legacy_delivery', queries=queries)
        pkt = w.packet(self.store, snap, definition)
        items = self.store.entity(pkt)['data']['items']
        self.assertEqual(len(items), 6)
        self.assertTrue(all('caption' not in item and 'title' not in item for item in items))
        with self.assertRaisesRegex(ValueError, 'undeclared context'):
            w.packet(self.store, snap, {**definition, 'machine_caption': 'leak'})
        with self.assertRaisesRegex(ValueError, 'partition mismatch'):
            w.packet(self.store, snap, {**definition, 'purpose': 'heldout'})


if __name__ == '__main__':
    unittest.main()
