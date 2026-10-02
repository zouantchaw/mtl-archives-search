"""Current-collection adapter and reusable study operations.

Only descriptive coverage executes here. OCR/caption recipes are contracts for
later runners; no model endpoint, production SQL or product deployment is exposed.
"""
from collections import Counter, defaultdict
import datetime as dt
import json
import platform
import re
import time
import uuid

from storage import CAPTURED_CODE, HERE, SCHEMA, all_refs, digest, encoded, load, validate_ref


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def require(value, fields):
    if not isinstance(value, dict) or any(k not in value for k in fields):
        raise ValueError('required fields: ' + ', '.join(fields))


def register_source(store, definition):
    require(definition, ['key', 'namespace', 'adapter', 'identity', 'conditions', 'scope'])
    if definition['adapter'] != 'mtl-preserved-v1' or definition['identity'] != 'exact_source_url_v1':
        raise ValueError('only the current collection adapter is implemented')
    if definition['namespace'] != 'mtl' or not definition['conditions'] or not definition['scope']:
        raise ValueError('invalid current source definition')
    return store.add('source', definition['key'], definition)


def record_identity(url):
    if not isinstance(url, str) or not url.startswith(('http://', 'https://')):
        raise ValueError('invalid archival source URL')
    # v1 hashes the canonical JSON string representation of the exact URL.
    # Keep that existing identity, including its serialization convention.
    return 'mtl:url-v1:' + digest(url)


def validate_record(record):
    require(record, ['id', 'aliases', 'version', 'assets', 'status'])
    validate_ref(record['version'])
    if not record['aliases'] or len(set(record['aliases'])) != len(record['aliases']):
        raise ValueError('missing or repeated aliases')
    if record.get('source_url') and record['id'] != record_identity(record['source_url']):
        raise ValueError('record/source identity mismatch')
    seen = set()
    for asset in record['assets']:
        require(asset, ['id', 'role', 'blob', 'record_version_id', 'lineage_status'])
        validate_ref(asset['blob'])
        if asset['record_version_id'] != record['version']['sha256'] or asset['id'] in seen:
            raise ValueError('asset/version association mismatch')
        seen.add(asset['id'])
    for asset in record['assets']:
        if asset.get('parent_asset_id') and asset['parent_asset_id'] not in seen:
            raise ValueError('missing asset parent')
    return record


def records(store, imported):
    data = store.entity(imported, 'import')['data']
    result = []
    for shard in data['record_shards']:
        result.extend(store.json(shard)['records'])
    if len(result) != data['records'] or len({r['id'] for r in result}) != len(result):
        raise ValueError('import accounting mismatch')
    for record in result:
        validate_record(record)
    return result


def shard_rows(store, key, rows):
    """Keep every metadata object within the private transfer's 4 MiB limit."""
    result, chunk, size = [], [], 0
    for row in rows:
        row_size = len(encoded(row)) + 1
        if row_size > 3*1024*1024:
            raise ValueError('single metadata row exceeds shard budget')
        if chunk and size + row_size > 3*1024*1024:
            result.append(store.put({key: chunk}))
            chunk, size = [], 0
        chunk.append(row)
        size += row_size
    if chunk:
        result.append(store.put({key: chunk}))
    return result


def selected_rows(store, snapshot):
    data = store.entity(snapshot, 'snapshot')['data']
    rows = [row for ref in data['selected_shards'] for row in store.json(ref)['selected']]
    if len(rows) != data['actual_records'] or len({r['record_id'] for r in rows}) != len(rows):
        raise ValueError('frozen selection accounting mismatch')
    return rows


def import_release(store, source_id, pointer, plan=None, previous=None, synthetic=False):
    """Import an immutable bounded release or a completed bulk phase.

    No reads of the running backfill's SQLite working state. Failed assets stay
    in the import, and selection later accounts for unavailable inputs.
    """
    source = store.entity(source_id, 'source')['data']
    manifest_ref = pointer.get('manifest', pointer)
    manifest = store.json(manifest_ref)
    normalized = []
    if manifest.get('schema') == 'mtl-research-data-v1':
        for row in manifest['records']:
            version = store.json(row['record_version'])
            if version['record_id'] != row['id'] or version['snapshot_id'] != manifest['snapshot']['sha256']:
                raise ValueError('record version/release association mismatch')
            fields = version['serving_fields']
            if fields['external_url'] != row['source_url'] or fields['metadata_filename'] not in row['aliases']:
                raise ValueError('alias/source association mismatch')
            normalized.append(validate_record(dict(id=row['id'], aliases=row['aliases'],
                source_url=row['source_url'], version=row['record_version'], assets=row['assets'],
                status='included', evidence=row['assertions'], metadata_summary={
                    'title': fields.get('name'), 'date': fields.get('date_value'),
                    'legacy_description_present': bool(fields.get('description')),
                    'legacy_caption_present': bool(fields.get('vlm_caption')),
                    'legacy_ocr_present': bool(fields.get('ocr_text'))})))
        limitations = manifest['limitations']
        accounting = dict(included=len(normalized), excluded=len(manifest['exclusions']))
    elif manifest.get('schema') == 'mtl-research-backfill-v1':
        if not manifest.get('complete_accounting') or manifest['accounted'] != manifest['selected']:
            raise ValueError('bulk phase has not completed accounting')
        if plan is None or digest(plan) != manifest['plan_sha256'] or plan['job_id'] != manifest['job_id']:
            raise ValueError('verified frozen acquisition plan required')
        for shard in manifest['item_shards']:
            content = store.json(shard)
            if content['job_id'] != manifest['job_id'] or content['role'] != manifest['role']:
                raise ValueError('bulk shard/phase association mismatch')
            for row in content['items']:
                normalized.append(validate_record(dict(id=row['record_id'], aliases=[row['alias']],
                    version=plan['versions'][row['alias']], assets=row.get('assets', []),
                    status=row['status'], source_url=None, evidence=[], metadata_summary=None,
                    error=row.get('error'), decode_status=row.get('decode_status'))))
        if len(normalized) != manifest['accounted'] or dict(Counter(r['status'] for r in normalized)) != manifest['statuses']:
            raise ValueError('bulk manifest accounting mismatch')
        limitations = ['Complete phase accounting includes failed acquisitions.',
            'Master bytes are not necessarily decode verified.',
            'Legacy delivery transforms and historical OCR/caption input hashes remain unknown.',
            'Metadata versions are resolved and hash checked when selected; metadata coverage is not inferred.',
            'Photographic family boundaries and human references are not yet reviewed.']
        accounting = manifest['statuses']
    else:
        raise ValueError('unsupported release schema')
    if not normalized:
        raise ValueError('empty release import')
    normalized.sort(key=lambda r: r['id'])
    if len({r['id'] for r in normalized}) != len(normalized):
        raise ValueError('duplicate record identities require an explicit alias reconciliation')
    old = {}
    if previous:
        previous_data = store.entity(previous, 'import')['data']
        if previous_data['source'] != source_id:
            raise ValueError('source refresh must use the same source definition version')
        old = {r['id']: digest(r) for r in records(store, previous)}
    current = {r['id']: digest(r) for r in normalized}
    delta = dict(added=sorted(current.keys()-old.keys()), removed=sorted(old.keys()-current.keys()),
                 revised=sorted(k for k in current.keys() & old.keys() if current[k] != old[k]),
                 unchanged=sorted(k for k in current.keys() & old.keys() if current[k] == old[k]))
    shards = shard_rows(store, 'records', normalized)
    code_id = register_code(store)
    data = dict(source=source_id, adapter=source['adapter'], adapter_code=code_version(), code_id=code_id,
                release=manifest_ref, upstream_snapshot=manifest.get('snapshot', plan.get('snapshot') if plan else None),
                conditions=manifest.get('conditions', plan.get('conditions') if plan else None),
                acquisition_plan=store.put(plan) if plan else None,
                record_shards=shards, records=len(normalized), accounting=accounting,
                limitations=limitations, previous=previous, delta=delta, synthetic=bool(synthetic))
    return store.add('import', source['key'] + ':' + manifest_ref['sha256'], data,
                     [source_id, code_id, *([previous] if previous else [])])


def register_study(store, definition):
    require(definition, ['key', 'question', 'hypotheses', 'stage', 'unit', 'protocol', 'budget', 'limitations'])
    if (definition['stage'] not in ('preparation', 'protocol_frozen') or
            definition['unit'] not in ('collection', 'image_family', 'query_intent') or
            not definition['question'] or not definition['limitations']):
        raise ValueError('invalid study definition')
    require(definition['budget'], ['model_calls', 'max_usd', 'max_seconds'])
    if any(type(definition['budget'][k]) not in (int, float) or definition['budget'][k] < 0 for k in definition['budget']):
        raise ValueError('budget must be explicit and nonnegative')
    require(definition['protocol'], ['analysis', 'metrics', 'success_rule', 'label_policy'])
    if definition['stage'] == 'protocol_frozen' and not definition['protocol']['success_rule']:
        raise ValueError('frozen protocol requires a declared interpretation rule')
    return store.add('study', definition['key'], definition)


def register_families(store, imported, definition):
    require(definition, ['key', 'groups', 'reviewer', 'review_status'])
    ids = {r['id'] for r in records(store, imported)}
    if definition['review_status'] not in ('unreviewed', 'human_declared'):
        raise ValueError('invalid family review provenance')
    seen = set()
    for members in definition['groups'].values():
        if not members or len(set(members)) != len(members) or any(m not in ids or m in seen for m in members):
            raise ValueError('invalid/repeated family membership')
        seen.update(members)
    if definition['review_status'] == 'human_declared' and not definition['reviewer']:
        raise ValueError('declared human reviewer required')
    return store.add('families', definition['key'], {**definition, 'import': imported, 'complete': seen == ids}, [imported])


def freeze(store, study_id, imported, policy, families=None):
    study = store.entity(study_id, 'study')['data']
    require(policy, ['key', 'purpose', 'seed', 'max_records', 'required_roles', 'partitions'])
    if (policy['purpose'] not in ('engineering', 'research') or type(policy['seed']) is not int or
            type(policy['max_records']) is not int or policy['max_records'] <= 0 or
            not policy['required_roles'] or len(set(policy['required_roles'])) != len(policy['required_roles']) or
            set(policy['required_roles']) - {'source_original', 'legacy_delivery', 'research_thumbnail'} or not policy['partitions'] or
            any(v <= 0 for v in policy['partitions'].values()) or
            abs(sum(policy['partitions'].values()) - 1) > 1e-9):
        raise ValueError('invalid frozen selection policy')
    if study['unit'] == 'query_intent' and list(policy['partitions']) != ['corpus']:
        raise ValueError('retrieval partitions belong to query intents; freeze one shared image corpus')
    items = records(store, imported)
    parent = {r['id']: r['id'] for r in items}
    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    def union(members):
        roots = sorted({find(m) for m in members})
        for root in roots:
            parent[root] = roots[0]
    byte_groups = defaultdict(list)
    for r in items:
        for asset in r['assets']:
            if asset['role'] in policy['required_roles']:
                byte_groups[asset['blob']['sha256']].append(r['id'])
    for members in byte_groups.values():
        union(members)
    family_data = None
    if families:
        family_data = store.entity(families, 'families')['data']
        if family_data['import'] != imported:
            raise ValueError('family map belongs to another import')
        for members in family_data['groups'].values():
            union(members)
    if policy['purpose'] == 'research' and len(policy['partitions']) > 1 and (
            not family_data or not family_data['complete'] or family_data['review_status'] != 'human_declared'):
        raise ValueError('research image splits require complete declared human family review')
    eligible, exclusions = [], []
    for r in items:
        roles = {a['role'] for a in r['assets']}
        missing = sorted(set(policy['required_roles']) - roles)
        if missing:
            exclusions.append(dict(record_id=r['id'], status=r['status'], missing_roles=missing, error=r.get('error')))
        else:
            eligible.append(r)
    groups = defaultdict(list)
    for r in eligible:
        groups[find(r['id'])].append(r)
    ordered = sorted(groups, key=lambda g: digest([policy['seed'], g]))
    selected = []
    for group in ordered:
        if len(selected) >= policy['max_records']:
            break
        # Whole groups can exceed the target count; never cut a duplicate family.
        number = int(digest(['partition', policy['seed'], group])[:16], 16) / 2**64
        threshold = 0
        for partition, weight in sorted(policy['partitions'].items()):
            threshold += weight
            if number < threshold:
                break
        for r in sorted(groups[group], key=lambda x: x['id']):
            selected.append(dict(record_id=r['id'], version=r['version'], aliases=r['aliases'],
                group=group, partition=partition, assets=[a for a in r['assets'] if a['role'] in policy['required_roles']]))
    if not selected:
        raise ValueError('selection has no usable inputs')
    data = dict(study=study_id, import_id=imported, policy=policy, family_map=families,
                selected_shards=shard_rows(store, 'selected', selected), exclusions=exclusions, eligible=len(eligible),
                unselected=len(eligible)-len(selected), actual_records=len(selected),
                exact_duplicate_groups=sum(len(set(v)) > 1 for v in byte_groups.values()),
                family_review='unknown' if not family_data else family_data['review_status'],
                representativeness='not_established', input_type=policy['required_roles'])
    return store.add('snapshot', policy['key'], data, [study_id, imported, *([families] if families else [])])


def verify_snapshot(store, snapshot_id, images=True):
    data = store.entity(snapshot_id, 'snapshot')['data']
    imported = {r['id']: r for r in records(store, data['import_id'])}
    checked = set()
    selected = selected_rows(store, snapshot_id)
    for row in selected:
        record = imported[row['record_id']]
        if row['version'] != record['version']:
            raise ValueError('snapshot version not in import')
        version = store.json(row['version'])
        fields = version['serving_fields']
        if (version['record_id'] != row['record_id'] or record_identity(fields['external_url']) != row['record_id'] or
                fields['metadata_filename'] not in row['aliases']):
            raise ValueError('selected metadata/identity mismatch')
        for asset in row['assets']:
            if asset not in record['assets']:
                raise ValueError('selected asset not in import')
            ref = asset['blob']
            if images and (ref['area'], ref['sha256']) not in checked:
                store.path(ref)
                checked.add((ref['area'], ref['sha256']))
    return dict(snapshot=snapshot_id, records=len(selected), image_blobs_verified=len(checked),
                verification='sha256_and_size', decode='inherited_explicit_asset_status')


def code_version():
    return {name: digest(content.encode()) for name, content in CAPTURED_CODE.items()}


def register_code(store, bundle=None):
    names = {'storage.py', 'workflow.py', 'run.py', 'schema.sql'}
    if bundle is None:
        files = dict(CAPTURED_CODE)
        bundle = dict(files=files, hashes={n: digest(v.encode()) for n, v in files.items()})
    if (set(bundle['files']) != names or bundle['hashes'] != {n: digest(v.encode()) for n, v in bundle['files'].items()}):
        raise ValueError('code bundle hash mismatch')
    return store.add('code', digest(bundle['hashes']), bundle)


def coverage(store, snapshot_id):
    data = store.entity(snapshot_id, 'snapshot')['data']
    imported = store.entity(data['import_id'], 'import')['data']
    verification = verify_snapshot(store, snapshot_id)
    roles, lineage, metadata, inherited = Counter(), Counter(), Counter(), Counter()
    bytes_by_hash, dimensions = {}, []
    selected = selected_rows(store, snapshot_id)
    for row in selected:
        version = store.json(row['version'])
        fields = version['serving_fields']
        inherited['raw_ocr_text_nonempty'] += bool(version.get('legacy_evidence', {}).get('ocr_text'))
        for key in ('description', 'vlm_caption', 'ocr_text', 'vlm_caption_model', 'date_value'):
            metadata[key + '_nonempty'] += bool(fields.get(key))
        for asset in row['assets']:
            roles[asset['role']] += 1
            lineage[asset['lineage_status']] += 1
            ref = asset['blob']
            bytes_by_hash[(ref['area'], ref['sha256'])] = ref['size_bytes']
            if asset.get('image'):
                dimensions.append({k: asset['image'].get(k) for k in ('width', 'height', 'validation', 'format')})
    return dict(schema=SCHEMA, analysis='descriptive_coverage_v1', snapshot=snapshot_id,
        records=len(selected), eligible=data['eligible'], excluded=len(data['exclusions']),
        excluded_statuses=dict(Counter(r['status'] for r in data['exclusions'])),
        roles=dict(roles), lineage=dict(lineage), metadata_presence=dict(metadata),
        metadata_scope='legacy_serving_fields', inherited_unreviewed_presence=dict(inherited),
        unique_asset_blobs=len(bytes_by_hash), unique_asset_bytes=sum(bytes_by_hash.values()),
        dimensions=dimensions, verification=verification,
        limitations=[*imported['limitations'], 'Presence counts measure neither OCR/caption accuracy nor retrieval quality.',
            'This selection is not established as representative; no hypothesis is accepted by this report.'])


def execute_coverage(store, study_id, snapshot_id):
    study = store.entity(study_id, 'study')['data']
    snapshot = store.entity(snapshot_id, 'snapshot')['data']
    if snapshot['study'] != study_id or study['stage'] != 'protocol_frozen' or study['protocol']['analysis'] != 'descriptive_coverage_v1':
        raise ValueError('coverage requires its own frozen study and snapshot')
    if study['protocol']['label_policy'] != 'not_applicable' or study['budget']['model_calls'] != 0:
        raise ValueError('coverage executes no models or reference-label evaluation')
    code_id = register_code(store)
    run = store.add('run', study['key'] + ':' + str(uuid.uuid4()), dict(study=study_id,
        snapshot=snapshot_id, labels=[], queries=None, recipe=None, code=code_version(), code_id=code_id,
        configuration=study['protocol'], environment={'python': platform.python_version(), 'platform': platform.platform()},
        budget=study['budget'], created_at=now(), attempt=str(uuid.uuid4()), product_promotion='not_requested'), [study_id, snapshot_id, code_id])
    started = time.monotonic()
    store.event(run, 'started', {'at': now()})
    try:
        report = coverage(store, snapshot_id)
        elapsed = time.monotonic()-started
        if elapsed > study['budget']['max_seconds']:
            raise ValueError('coverage exceeded declared wall time budget')
        output = store.put(report)
        store.event(run, 'succeeded', dict(at=now(), output=output, elapsed_seconds=elapsed,
            usage={'model_calls': 0, 'model_cost_usd': 0, 'storage_transport_cost_usd': None},
            interpretation='descriptive_only', promotion='not_evaluated'))
    except Exception as e:
        store.event(run, 'failed', dict(at=now(), elapsed_seconds=time.monotonic()-started,
                                      error_type=type(e).__name__, outcome='no_valid_result'))
        raise RuntimeError('coverage attempt failed; retained run ' + run) from e
    return run


def register_queries(store, study_id, definition):
    study = store.entity(study_id, 'study')['data']
    require(definition, ['key', 'author', 'author_type', 'partition', 'intents'])
    if study['unit'] != 'query_intent' or definition['partition'] not in ('development', 'heldout'):
        raise ValueError('query intentions require a retrieval study and named partition')
    if definition['author_type'] not in ('human_declared', 'synthetic') or not definition['author']:
        raise ValueError('explicit query-author provenance required')
    seen = set()
    text_keys = set()
    for intent in definition['intents']:
        require(intent, ['id', 'fr', 'en'])
        if intent['id'] in seen or not intent['fr'] or not intent['en']:
            raise ValueError('each intent requires unique identity and both languages')
        seen.add(intent['id'])
        text_keys.update(' '.join(intent[lang].casefold().split()) for lang in ('fr', 'en'))
    if not seen:
        raise ValueError('empty query set')
    for row in store.inventory():
        if row['kind'] == 'queries':
            other = store.entity(row['id'])['data']
            other_text = {' '.join(q[lang].casefold().split()) for q in other['intents'] for lang in ('fr', 'en')}
            if other['study'] == study_id and other['partition'] != definition['partition'] and (
                    seen & {q['id'] for q in other['intents']} or text_keys & other_text):
                raise ValueError('intent identity/text occurs in development and heldout')
    return store.add('queries', definition['key'], {**definition, 'study': study_id}, [study_id])


RUBRICS = {
    'ocr_transcription': 'Transcribe readable visible text, preserving spelling and line breaks. Mark no readable text or uncertain. Do not infer a place/date from context.',
    'caption_claim': 'Judge only the supplied claim: supported by visible pixels, unsupported, or uncertain. Source context and model fluency are not visual evidence.',
    'query_relevance': 'Judge the image for the displayed query: 0 irrelevant, 1 partially relevant, 2 relevant, 3 directly relevant, or uncertain. Generated captions, source titles and system identity are hidden.'
}


def packet(store, snapshot_id, definition):
    require(definition, ['key', 'task', 'purpose', 'asset_role'])
    if definition['task'] not in RUBRICS or definition['purpose'] not in ('practice', 'development', 'heldout'):
        raise ValueError('invalid annotation task')
    allowed = {'key', 'task', 'purpose', 'asset_role'}
    if definition['task'] == 'query_relevance':
        allowed.add('queries')
    if definition['task'] == 'caption_claim':
        allowed.add('claims')
    if set(definition) - allowed:
        raise ValueError('annotation packet cannot include undeclared context')
    snap = store.entity(snapshot_id, 'snapshot')['data']
    verify_snapshot(store, snapshot_id)
    deps = [snapshot_id]
    query_data = None
    if definition['task'] == 'query_relevance':
        query_id = definition.get('queries')
        query_data = store.entity(query_id, 'queries')['data']
        if query_data['study'] != snap['study'] or (definition['purpose'] != 'practice' and query_data['partition'] != definition['purpose']):
            raise ValueError('query/packet study or partition mismatch')
        deps.append(query_id)
    claims = definition.get('claims', [])
    if definition['task'] == 'caption_claim' and not claims:
        raise ValueError('caption task requires claims with their derivation versions')
    items = []
    for row in selected_rows(store, snapshot_id):
        assets = [a for a in row['assets'] if a['role'] == definition['asset_role']]
        if len(assets) != 1:
            raise ValueError('annotation asset role must resolve to one exact input')
        base = dict(record_id=row['record_id'], record_version=row['version'], image=assets[0]['blob'])
        contexts = [{}]
        if query_data:
            contexts = [{'intent_id': q['id'], 'language': lang, 'query': q[lang]} for q in query_data['intents'] for lang in ('fr', 'en')]
        elif definition['task'] == 'caption_claim':
            contexts = []
            for claim in claims:
                require(claim, ['record_id', 'input_sha256', 'claim', 'derivation'])
                validate_ref(claim['derivation'])
                if claim['record_id'] == row['record_id']:
                    if claim['input_sha256'] != base['image']['sha256']:
                        raise ValueError('caption claim belongs to another image render')
                    derivation = store.json(claim['derivation'])
                    require(derivation, ['record_id', 'input_sha256', 'claims'])
                    if (derivation['record_id'] != row['record_id'] or derivation['input_sha256'] != base['image']['sha256'] or
                            claim['claim'] not in derivation['claims']):
                        raise ValueError('caption claim not in its verified derivation')
                    contexts.append({k: claim[k] for k in ('claim', 'derivation')})
        for context in contexts:
            item = {**base, **context}
            items.append({'id': digest(item), **item})
    if not items:
        raise ValueError('empty annotation packet')
    data = dict(definition=definition, snapshot=snapshot_id, task=definition['task'],
        purpose=definition['purpose'], rubric=RUBRICS[definition['task']], items=items,
        reference_status='not_established', reviewer_instructions='Record your own judgment; use uncertain when evidence is insufficient.',
        limitations=['A completed packet is not automatically independent gold.',
            'Reviewer identity is declared, not authenticated by this CLI.',
            'Practice judgments are excluded from benchmark references.'])
    return store.add('packet', definition['key'], data, deps)


def import_labels(store, packet_id, response):
    data = store.entity(packet_id, 'packet')['data']
    require(response, ['key', 'packet', 'reviewer', 'reviewer_type', 'independence', 'decisions'])
    if response['packet'] != packet_id or not response['reviewer'] or response['reviewer_type'] not in ('human_declared', 'synthetic'):
        raise ValueError('explicit reviewer and exact packet identity required')
    if response['independence'] not in ('declared_independent', 'not_independent', 'unknown'):
        raise ValueError('invalid reviewer independence')
    allowed = {'supported', 'unsupported', 'uncertain'} if data['task'] == 'caption_claim' else {0, 1, 2, 3, 'uncertain'} if data['task'] == 'query_relevance' else {'transcribed', 'no_readable_text', 'uncertain'}
    items = {item['id'] for item in data['items']}
    seen = set()
    for decision in response['decisions']:
        require(decision, ['item', 'value', 'seconds', 'note'])
        if decision['item'] not in items or decision['item'] in seen or decision['value'] not in allowed:
            raise ValueError('invalid/repeated annotation decision')
        if type(decision['seconds']) not in (int, float) or decision['seconds'] < 0:
            raise ValueError('annotation time must be nonnegative')
        if data['task'] == 'ocr_transcription' and decision['value'] == 'transcribed' and not decision.get('text'):
            raise ValueError('transcribed text required')
        seen.add(decision['item'])
    if not seen:
        raise ValueError('no annotation decisions')
    return store.add('labels', response['key'], {**response, 'snapshot': data['snapshot'],
        'task': data['task'], 'purpose': data['purpose'], 'complete': seen == items,
        'reference_status': 'pending_quality_review', 'missing_items': sorted(items-seen)}, [packet_id, data['snapshot']])


def register_recipe(store, definition):
    require(definition, ['key', 'stage', 'task', 'input_role', 'render', 'engine', 'context',
                         'raw_output_contract', 'failure_policy', 'budget'])
    if definition['stage'] not in ('draft', 'pinned') or definition['task'] not in ('ocr', 'visual_caption', 'source_conditioned_caption'):
        raise ValueError('invalid derivation recipe')
    require(definition['render'], ['orientation', 'resolution', 'color', 'frames', 'tiles', 'implementation_sha256'])
    require(definition['engine'], ['name', 'revision', 'parameters', 'runtime'])
    if definition['task'] in ('ocr', 'visual_caption') and definition['context'] != ['pixels']:
        raise ValueError('visual evidence recipes use pixels only')
    if definition['task'] == 'source_conditioned_caption' and 'source_metadata' not in definition['context']:
        raise ValueError('source-conditioned recipe must declare its metadata channel')
    require(definition['raw_output_contract'], ['input_hash', 'render_hash', 'record_version', 'raw_response', 'timing', 'usage', 'outcome'])
    if not all(definition['raw_output_contract'].values()):
        raise ValueError('raw derivation provenance fields cannot be disabled')
    if definition['stage'] == 'pinned':
        if (not re.fullmatch('[a-f0-9]{64}', definition['render']['implementation_sha256'] or '') or
                not definition['engine']['revision'] or not definition['engine']['runtime'] or
                any(v is None for v in definition['render'].values())):
            raise ValueError('pinned recipe requires exact render code, model revision and runtime')
    require(definition['budget'], ['model_calls', 'max_usd', 'max_seconds'])
    return store.add('recipe', definition['key'], definition)
