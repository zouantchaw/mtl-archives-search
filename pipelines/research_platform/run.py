#!/usr/bin/env python3
"""Isolated source, study, review and experiment registry. See the runbook."""
import argparse
import json
from pathlib import Path
from storage import Cloud, Store, atomic_new, encoded, load
import workflow as w


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, required=True)
    p.add_argument('--blob-root', type=Path, action='append', default=[], help='additional verified archive blob directory')
    p.add_argument('--private-read', action='store_true', help='fetch missing artifacts through authenticated private transfer')
    s = p.add_subparsers(dest='command', required=True)
    for command in ('source', 'study', 'recipe'):
        sub = s.add_parser(command)
        sub.add_argument('--definition', type=Path, required=True)
    sub = s.add_parser('code')
    sub.add_argument('--bundle', type=Path, help='archive a previously captured code revision; otherwise archive current code')
    sub = s.add_parser('import-release')
    sub.add_argument('--source', required=True)
    sub.add_argument('--release', type=Path, required=True)
    sub.add_argument('--plan', type=Path)
    sub.add_argument('--previous')
    sub.add_argument('--synthetic', action='store_true')
    sub = s.add_parser('families')
    sub.add_argument('--import-id', required=True)
    sub.add_argument('--definition', type=Path, required=True)
    sub = s.add_parser('freeze')
    sub.add_argument('--study', required=True)
    sub.add_argument('--import-id', required=True)
    sub.add_argument('--policy', type=Path, required=True)
    sub.add_argument('--families')
    for command in ('verify', 'coverage'):
        sub = s.add_parser(command)
        sub.add_argument('--snapshot', required=True)
        if command == 'coverage':
            sub.add_argument('--study', required=True)
    sub = s.add_parser('queries')
    sub.add_argument('--study', required=True)
    sub.add_argument('--definition', type=Path, required=True)
    sub = s.add_parser('packet')
    sub.add_argument('--snapshot', required=True)
    sub.add_argument('--definition', type=Path, required=True)
    sub.add_argument('--export', type=Path)
    sub = s.add_parser('labels')
    sub.add_argument('--packet', required=True)
    sub.add_argument('--response', type=Path, required=True)
    sub = s.add_parser('inspect')
    sub.add_argument('--id', required=True)
    sub.add_argument('--export', type=Path, help='write full payload privately; console displays only summary')
    s.add_parser('list')
    s.add_parser('cloud-bootstrap')
    s.add_parser('cloud-publish')
    sub = s.add_parser('cloud-restore')
    sub.add_argument('--publication', required=True)
    return p


def main():
    args = parser().parse_args()
    cloud = Cloud() if args.private_read or args.command.startswith('cloud-') else None
    store = Store(args.root, args.blob_root, cloud)
    c = args.command
    if c in ('source', 'study', 'recipe'):
        result = {'id': getattr(w, 'register_' + c)(store, load(args.definition))}
    elif c == 'code':
        result = {'id': w.register_code(store, load(args.bundle) if args.bundle else None)}
    elif c == 'import-release':
        result = {'id': w.import_release(store, args.source, load(args.release),
            load(args.plan) if args.plan else None, args.previous, args.synthetic)}
    elif c == 'families':
        result = {'id': w.register_families(store, args.import_id, load(args.definition))}
    elif c == 'freeze':
        result = {'id': w.freeze(store, args.study, args.import_id, load(args.policy), args.families)}
    elif c == 'verify':
        result = w.verify_snapshot(store, args.snapshot)
    elif c == 'coverage':
        result = {'id': w.execute_coverage(store, args.study, args.snapshot)}
    elif c == 'queries':
        result = {'id': w.register_queries(store, args.study, load(args.definition))}
    elif c == 'packet':
        entity = w.packet(store, args.snapshot, load(args.definition))
        if args.export:
            atomic_new(args.export, encoded({'id': entity, **store.entity(entity)['data']}))
        result = {'id': entity, 'items': len(store.entity(entity)['data']['items'])}
    elif c == 'labels':
        result = {'id': w.import_labels(store, args.packet, load(args.response))}
    elif c == 'inspect':
        value = store.entity(args.id)
        if args.export:
            atomic_new(args.export, encoded(value))
        result = dict(id=args.id, kind=value['kind'], key=value['key'], dependencies=value['dependencies'], fields=list(value['data']))
        if value['kind'] == 'run':
            result['events'] = store.events(args.id)
        if value['kind'] == 'import':
            result.update(records=value['data']['records'], accounting=value['data']['accounting'],
                changes={k: len(v) for k, v in value['data']['delta'].items()})
        if value['kind'] == 'snapshot':
            result.update(records=value['data']['actual_records'], exclusions=len(value['data']['exclusions']),
                          purpose=value['data']['policy']['purpose'])
    elif c == 'list':
        result = store.inventory()
    elif c == 'cloud-bootstrap':
        cloud.bootstrap()
        result = {'database': cloud.config['studies_name'], 'schema': 'applied'}
    elif c == 'cloud-publish':
        result = store.publish(cloud)
    elif c == 'cloud-restore':
        result = store.restore(cloud, args.publication)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
