"""Contract checks in memory only: no human labels, ledger or cloud writes."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

APP = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('review_import', APP/'scripts/import-review.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
pilot = m.load(APP/'src/pilot.json')


class MemoryLedger:
    def __init__(self):
        self.writes = []

    def entity(self, entity_id, kind=None):
        if kind == 'snapshot':
            return {'data': {'study': pilot['studyId'], 'import_id': pilot['importId']}}
        return {'data': {'unit': 'query_intent'}}

    def inventory(self):
        return []

    def put(self, value):
        self.writes.append(('artifact', value))
        return {'sha256': m.digest(value)}

    def add(self, kind, key, data, deps=()):
        self.writes.append((kind, data))
        return m.digest([kind, key, data])


def response():
    row = dict(kind='image', key=pilot['items'][0]['sample_id'], revision=1,
               payload={'type': 'aerial'}, savedAt='2026-10-03T00:00:00.000Z')
    return dict(schema='mtl-research-review-export-v1', snapshot=pilot['snapshot'],
                studyId=pilot['studyId'], importId=pilot['importId'], packetSha256=pilot['packetSha256'],
                reviewerId='in-memory-declaration-fixture', reviewerType='authenticated_human_declaration',
                benchmarkEligible=False, referenceStatus='pending_quality_review', aiAssistance=False,
                items=copy.deepcopy(pilot['items']), latest=[row], history=[copy.deepcopy(row)])


class Contracts(unittest.TestCase):
    def rejected(self, value):
        ledger = MemoryLedger()
        with self.assertRaises(ValueError):
            m.retain(ledger, value)
        self.assertEqual(ledger.writes, [])

    def test_synthetic_provenance_rejected(self):
        value = response()
        value['reviewerType'] = 'synthetic_qa_actor'
        self.rejected(value)

    def test_altered_input_and_study_rejected(self):
        for key in ('studyId', 'importId', 'packetSha256'):
            value = response()
            value[key] = 'altered'
            self.rejected(value)
        value = response()
        value['items'][0]['record_id'] = 'altered'
        self.rejected(value)

    def test_missing_history_rejected(self):
        value = response()
        value['history'] = []
        self.rejected(value)
        value = response()
        value['latest'][0]['payload'] = {'type': 'changed-outside-history'}
        self.rejected(value)

    def test_partial_decisions_stay_pending(self):
        ledger = MemoryLedger()
        result = m.retain(ledger, response())
        self.assertFalse(result['benchmark_eligible'])
        self.assertEqual(result['reference_status'], 'pending_quality_review')
        self.assertIsNone(result['families'])
        self.assertIsNone(result['queries'])
        self.assertEqual([x[0] for x in ledger.writes], ['artifact', 'packet', 'labels'])

    def test_incomplete_family_and_stale_query_rejected(self):
        value = response()
        family = dict(kind='families', key='corpus', revision=1,
                      payload={'complete': True, 'singletonDeclaration': False, 'groups': []}, savedAt='test')
        value['latest'].append(family)
        value['history'].append(copy.deepcopy(family))
        self.rejected(value)
        value = response()
        query = dict(kind='query', key='dev-01', revision=1,
                     payload={'corpusReviewRevision': 1, 'authorDeclaration': True}, savedAt='test')
        value['latest'].append(query)
        value['history'].append(copy.deepcopy(query))
        self.rejected(value)

    def test_assisted_preparation_is_retained_and_false_manual_claim_rejected(self):
        value = response()
        value['schema'] = 'mtl-research-review-export-v2'
        value['aiAssistance'] = True
        render = m.load(APP/'src/inspection.json')['items'][0]
        run_id = '12345678-1234-1234-1234-123456789abc'
        run = dict(id=run_id, imageId='001', kind='text', status='complete',
                   sourceSha256=render['sourceSha256'], renderSha256=render['sha256'],
                   answer='Synthetic test output', inputSha256='a'*64, outputSha256='b'*64,
                   outputKey='runs/'+run_id+'/'+'b'*64+'.json')
        value['assistance'] = dict(schema='mtl-reviewer-assistance-v1', purpose='preparation_only',
                                   aiAssistance=True, runs=[run], events=[dict(id='delivered:'+run_id,
                                   run_id=run_id, action='output_delivered')])
        ledger = MemoryLedger()
        result = m.retain(ledger, value)
        self.assertTrue(result['ai_assistance'])
        self.assertFalse(result['benchmark_eligible'])
        self.assertTrue(ledger.writes[-1][1]['ai_assistance'])
        invalid = copy.deepcopy(value)
        invalid['aiAssistance'] = False
        self.rejected(invalid)
        invalid = copy.deepcopy(value)
        invalid['assistance']['runs'][0]['sourceSha256'] = 'c'*64
        self.rejected(invalid)

    def test_external_conversation_guidance_is_explicit_preparation(self):
        value = response()
        value['schema'] = 'mtl-research-review-export-v2'
        value['aiAssistance'] = True
        external = dict(id='synthetic-guidance', kind='assistant_conversation_guidance', sampleIds=['001'],
                        sourceReceiptSha256='a'*64, sourceReceiptKey='calibration/'+'a'*64+'.json')
        value['assistance'] = dict(schema='mtl-reviewer-assistance-v1', purpose='preparation_only',
                                   aiAssistance=True, runs=[], events=[], externalGuidance=[external])
        result = m.retain(MemoryLedger(), value)
        self.assertTrue(result['ai_assistance'])
        self.assertFalse(result['benchmark_eligible'])
        value['aiAssistance'] = False
        self.rejected(value)

    def test_completed_subset_preserves_scope_and_provenance(self):
        value = response()
        value['latest'] = [dict(kind='image', key=i['sample_id'], revision=1, payload={}, savedAt='test')
                           for i in pilot['items']]
        family = dict(kind='families', key='corpus', revision=1,
                      payload={'complete': True, 'singletonDeclaration': True, 'groups': []}, savedAt='test')
        query = dict(kind='query', key='dev-01', revision=1, savedAt='test', payload=dict(
            fr='Question visuelle de test', en='Test visual question', criterion='Only a test criterion', cluster='',
            equivalence='pending', bilingualReviewer='', corpusReviewRevision=1, authorDeclaration=True))
        value['latest'] += [family, query]
        value['history'] = copy.deepcopy(value['latest'])
        with patch.object(m.w, 'register_families', return_value='family-id') as families, \
                patch.object(m.w, 'register_queries', return_value='query-id') as queries:
            result = m.retain(MemoryLedger(), value)
        self.assertEqual(result['queries'], 'query-id')
        self.assertEqual(families.call_args.args[2]['scope_snapshot'], pilot['snapshot'])
        self.assertEqual(len(families.call_args.args[2]['groups']), 100)
        self.assertEqual(queries.call_args.args[2]['author_type'], 'human_declared')
        self.assertFalse(queries.call_args.args[2]['benchmark_eligible'])


if __name__ == '__main__':
    unittest.main()
