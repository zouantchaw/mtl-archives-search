"""Retain a downloaded owner review in the study ledger, pending quality review.

This performs local immutable registration only. It does not publish, freeze a
research corpus, produce relevance gold, run a model or alter serving resources.
"""
import argparse
from pathlib import Path
import re
import sys

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP.parents[1]/'pipelines/research_platform'))
from storage import Store, digest, encoded, load, atomic_new
import workflow as w


def retain(store, export):
    pilot = load(APP/'src/pilot.json')
    if (export.get('schema') != 'mtl-research-review-export-v1' or
            export.get('snapshot') != pilot['snapshot'] or
            export.get('studyId') != pilot['studyId'] or
            export.get('importId') != pilot['importId'] or
            export.get('packetSha256') != pilot['packetSha256'] or
            export.get('items') != pilot['items'] or
            export.get('reviewerType') != 'authenticated_human_declaration' or
            export.get('benchmarkEligible') is not False or
            export.get('referenceStatus') != 'pending_quality_review' or
            export.get('aiAssistance') is not False):
        raise ValueError('Review export must match the exact pilot and retain human-declaration/pending-quality provenance')
    snapshot = store.entity(pilot['snapshot'], 'snapshot')['data']
    if snapshot['import_id'] != pilot['importId'] or snapshot['study'] != pilot['studyId']:
        raise ValueError('Pilot ledger association mismatch')
    if not isinstance(export.get('reviewerId'), str) or not export['reviewerId']:
        raise ValueError('Reviewer identity required')
    by_sample = {i['sample_id']: i['record_id'] for i in pilot['items']}
    latest, seen = export['latest'], set()
    history = export['history']
    if not isinstance(latest, list) or not isinstance(history, list):
        raise ValueError('Latest decisions and full history required')
    versions = {}
    for row in history:
        pair = (row['kind'], row['key'])
        if type(row['revision']) is not int or row['revision'] <= 0:
            raise ValueError('Invalid history revision')
        revisions = versions.setdefault(pair, {})
        if row['revision'] in revisions:
            raise ValueError('Repeated history revision')
        revisions[row['revision']] = row
    for row in latest:
        pair = (row['kind'], row['key'])
        if pair in seen or type(row['revision']) is not int or row['revision'] <= 0:
            raise ValueError('Repeated or invalid latest review')
        seen.add(pair)
        if (row['kind'] == 'image' and row['key'] not in by_sample or
                row['kind'] == 'families' and row['key'] != 'corpus' or
                row['kind'] == 'query' and not re.fullmatch(r'dev-(0[1-9]|1[0-2])', row['key']) or
                row['kind'] not in ('image', 'families', 'query')):
            raise ValueError('Review item outside the pilot')
        revisions = versions.get(pair, {})
        if set(revisions) != set(range(1, row['revision'] + 1)) or revisions.get(row['revision']) != row:
            raise ValueError('Latest review does not match complete immutable history')
    if set(versions) != seen:
        raise ValueError('History and latest review membership differ')
    family = next((r for r in latest if r['kind'] == 'families'), None)
    groups, intents = {}, []
    completed = bool(family and family['payload'].get('complete') is True)
    if completed:
        if (family['payload'].get('singletonDeclaration') is not True or
                {r['key'] for r in latest if r['kind'] == 'image'} != set(by_sample)):
            raise ValueError('Completed family review needs all selected image reviews and checked singletons')
        assigned = set()
        for group in family['payload']['groups']:
            members = group['members']
            if (not isinstance(members, list) or len(members) < 2 or len(set(members)) != len(members) or
                    set(members)-set(by_sample) or assigned & set(members) or
                    group['representative'] not in members or not group['id'] or group['id'] in groups or
                    group['id'].startswith('single:')):
                raise ValueError('Invalid family membership/representative')
            groups[group['id']] = [by_sample[x] for x in members]
            assigned.update(members)
        for sample in sorted(set(by_sample)-assigned):
            groups['single:'+sample] = [by_sample[sample]]
    for row in latest:
        if row['kind'] == 'query':
            value = row['payload']
            if (not completed or value.get('corpusReviewRevision') != family['revision'] or
                    value.get('authorDeclaration') is not True):
                raise ValueError('Recheck queries against the current completed corpus review before import')
            if (not value['fr'].strip() or not value['en'].strip() or not value['criterion'].strip() or
                    value['equivalence'] not in ('pending', 'equivalent', 'needs_revision') or
                    value['equivalence'] != 'pending' and not value['bilingualReviewer'].strip()):
                raise ValueError('Incomplete query or bilingual review')
            intents.append(dict(id=row['key'], fr=value['fr'], en=value['en'],
                                visible_relevance_criterion=value['criterion'], related_intent_cluster=value['cluster'],
                                bilingual_equivalence=value['equivalence'], bilingual_reviewer=value['bilingualReviewer']))
    if intents:
        if store.entity(pilot['studyId'], 'study')['data']['unit'] != 'query_intent':
            raise ValueError('Query intentions need a retrieval study')
        ids = {q['id'] for q in intents}
        texts = {' '.join(q[lang].casefold().split()) for q in intents for lang in ('fr', 'en')}
        for row in store.inventory():
            if row['kind'] == 'queries':
                other = store.entity(row['id'])['data']
                if other['study'] == pilot['studyId'] and other['partition'] != 'development':
                    if (ids & {q['id'] for q in other['intents']} or texts & {
                            ' '.join(q[lang].casefold().split()) for q in other['intents'] for lang in ('fr', 'en')}):
                        raise ValueError('Intent identity/text occurs in development and heldout')
    # Validate the whole response before registering any new artifacts/entities.
    raw = store.put(export)
    sha = digest(export)
    packet = store.add('packet', 'browser-pilot-review:'+sha,
                       dict(task='pilot_preparation_review', purpose='preparation',
                            snapshot=pilot['snapshot'], export=raw,
                            reference_status='pending_quality_review', benchmark_eligible=False),
                       [pilot['snapshot'], pilot['studyId']])
    labels = store.add('labels', 'browser-pilot-decisions:'+sha,
                       dict(task='pilot_preparation_review', packet=packet,
                            reviewer=export['reviewerId'], provenance='owner_downloaded_export; declaration not an independent signature',
                            reference_status='pending_quality_review', benchmark_eligible=False,
                            decisions=latest, history_preserved_in=raw), [packet])
    family_id, queries_id = None, None
    if completed:
        family_id = w.register_families(store, pilot['importId'], dict(
            key='pilot-browser-families:'+sha, groups=groups, reviewer=export['reviewerId'],
            review_status='human_declared', scope_snapshot=pilot['snapshot'],
            reference_status='pending_quality_review', evidence_packet=packet,
            representatives={g['id']: by_sample[g['representative']] for g in family['payload']['groups']}))
        if intents:
            queries_id = w.register_queries(store, pilot['studyId'], dict(
                key='pilot-browser-intents:'+sha, author=export['reviewerId'], author_type='human_declared',
                partition='development', intents=intents, evidence_packet=packet,
                reference_status='pending_quality_review', benchmark_eligible=False))
    return dict(export_sha256=sha, packet=packet, labels=labels, families=family_id,
                queries=queries_id, benchmark_eligible=False, reference_status='pending_quality_review')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True, help='Existing study ledger containing the pilot snapshot')
    p.add_argument('--response', type=Path, required=True, help='Owner-downloaded JSON export')
    p.add_argument('--receipt', type=Path, required=True)
    args = p.parse_args()
    result = retain(Store(args.root), load(args.response))
    atomic_new(args.receipt, encoded(result))
    print(encoded(result).decode())


if __name__ == '__main__':
    main()
