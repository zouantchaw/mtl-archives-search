#!/usr/bin/env python3
"""Exercise two studies over an existing verified bounded release, with no models.

Creates a practice reviewer packet, not gold labels or a retrieval benchmark.
Cloud publication is a separate run.py command after local verification.
"""
import argparse
import json
from pathlib import Path
from storage import HERE, Store, atomic_new, encoded, load
import workflow as w


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--release-run', type=Path, required=True)
    args = p.parse_args()
    store = Store(args.root, [args.release_run/'blobs'])
    source = w.register_source(store, load(HERE/'examples/current-source.json'))
    imported = w.import_release(store, source, load(args.release_run/'release.json'))
    studies = {name: w.register_study(store, load(HERE/'examples'/f'{name}-study.json'))
               for name in ('coverage', 'retrieval')}
    snapshots = {name: w.freeze(store, study, imported, load(HERE/'examples'/f'{name}-selection.json'))
                 for name, study in studies.items()}
    recipes = {name: w.register_recipe(store, load(HERE/'examples'/f'fresh-{name}-recipe-draft.json'))
               for name in ('ocr', 'caption')}
    packet = w.packet(store, snapshots['retrieval'], load(HERE/'examples/ocr-practice-packet.json'))
    packet_path = args.root/('reviewer-packet-'+packet+'.json')
    atomic_new(packet_path, encoded({'id': packet, **store.entity(packet)['data']}))
    # No suggested labels or query judgments are fabricated.
    template_path = args.root/('response-template-'+packet+'.json')
    atomic_new(template_path, encoded(dict(key='owner-ocr-practice-v1', packet=packet,
        reviewer='', reviewer_type='human_declared', independence='unknown', decisions=[])))
    run = w.execute_coverage(store, studies['coverage'], snapshots['coverage'])
    report = store.json(store.events(run)[1]['data']['output'])
    receipt = dict(source=source, import_id=imported, studies=studies, snapshots=snapshots,
        recipes=recipes, practice_packet=packet, coverage_run=run,
        verification={k: w.verify_snapshot(store, v) for k, v in snapshots.items()},
        coverage_summary={k: report[k] for k in ('records', 'roles', 'unique_asset_blobs', 'metadata_presence', 'inherited_unreviewed_presence')},
        reviewer_packet=str(packet_path), response_template=str(template_path),
        boundary={'models_executed': 0, 'human_labels_created': 0, 'retrieval_evaluated': False,
                  'product_resources_written': False, 'engineering_slice_only': True})
    atomic_new(args.root/('smoke-'+run+'.json'), encoded(receipt))
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
