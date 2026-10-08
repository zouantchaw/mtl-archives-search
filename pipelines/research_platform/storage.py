"""Immutable local ledger and private Cloudflare transport. No serving commands."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import re

HERE = Path(__file__).resolve().parent
SCHEMA = 'mtl-research-platform-v1'
MAX_METADATA = 4 * 1024 * 1024
KINDS = {'source', 'import', 'study', 'snapshot', 'families', 'queries', 'recipe',
         'packet', 'labels', 'run', 'code'}
# Capture executable sources when the process loads, rather than hashing mutable
# working files after a long download. Later edits belong to another process/run.
CAPTURED_CODE = {name: (HERE/name).read_text() for name in ('storage.py', 'workflow.py', 'run.py', 'schema.sql')}
RESOURCE_BOUNDARY = {
    'schema': SCHEMA,
    'studies_name': 'mtl-archives-research-studies',
    'studies_id': '37d7c2de-2178-4050-902f-4b456e59916a',
    'sources_bucket': 'mtl-archives-research-sources',
    'derived_bucket': 'mtl-archives-research-derived',
    'transfer_endpoint': 'https://transfer.mtlarchives.com',
    'token_file': '/Users/wiel/.config/mtl-research-transfer/secrets.json'
}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else encoded(value)).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def reference(sha, size, area='derived', media_type='application/json'):
    return dict(sha256=sha, size_bytes=size, area=area, media_type=media_type,
                object_key=f'sha256/{sha[:2]}/{sha}')


def validate_ref(ref):
    if not isinstance(ref, dict) or not re.fullmatch('[a-f0-9]{64}', ref.get('sha256', '')):
        raise ValueError('invalid artifact hash')
    sha = ref['sha256']
    if (ref.get('area') not in ('sources', 'derived') or
            type(ref.get('size_bytes')) is not int or not 0 < ref['size_bytes'] <= 512*1024*1024 or
            ref.get('object_key') != f'sha256/{sha[:2]}/{sha}' or not ref.get('media_type')):
        raise ValueError('invalid artifact reference')
    return ref


def all_refs(value):
    if isinstance(value, dict):
        if {'sha256', 'area', 'object_key', 'size_bytes', 'media_type'} <= value.keys():
            yield validate_ref(value)
        else:
            for v in value.values():
                yield from all_refs(v)
    elif isinstance(value, list):
        for v in value:
            yield from all_refs(v)


def atomic_new(path, data):
    """Install complete bytes with an exclusive link; existing bytes must agree."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temp = Path(f.name)
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    try:
        try:
            os.link(temp, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ValueError('immutable file conflict')
    finally:
        temp.unlink(missing_ok=True)


def cf(*args):
    p = subprocess.run(['cf', *map(str, args)], capture_output=True, timeout=180)
    # Never return command arguments or raw stderr (which can contain credentials).
    if p.returncode:
        raise RuntimeError('Cloudflare CLI operation failed; inspect authenticated CLI separately')
    value = json.loads(p.stdout)
    if isinstance(value, list) and any(x.get('success') is False for x in value):
        raise RuntimeError('Cloudflare query failed')
    return value


def validate_config(config):
    # An exact resource boundary is intentional. Adding sources changes adapters,
    # not the registry's write target. Provision another environment explicitly.
    for key, value in RESOURCE_BOUNDARY.items():
        if config.get(key) != value:
            raise ValueError('unrecognized research resource configuration: ' + key)
    return config


class Cloud:
    def __init__(self, config=None):
        self.config = validate_config(config or load(HERE / 'config.json'))
        self._session = None

    def guard(self):
        c = self.config
        if cf('d1', 'get', c['studies_id']).get('name') != c['studies_name']:
            raise ValueError('research studies D1 identity mismatch')
        for bucket in (c['sources_bucket'], c['derived_bucket']):
            managed = cf('r2', 'buckets', 'domains', 'managed', 'list', '--bucket-name', bucket)
            custom = cf('r2', 'buckets', 'domains', 'custom', 'list', '--bucket-name', bucket)
            if managed.get('enabled') or custom.get('domains'):
                raise ValueError('research bucket must remain private')

    def request(self, method, route, **kwargs):
        import requests
        if self._session is None:
            self._session = requests.Session()
            self._session.headers['Authorization'] = 'Bearer ' + load(self.config['token_file'])['BULK_TOKEN']
        for attempt in range(3):
            try:
                result = self._session.request(method, self.config['transfer_endpoint'] + route,
                                               timeout=(30, 180), allow_redirects=False, **kwargs)
                if result.status_code in (429, 502, 503, 504) and attempt < 2:
                    result.close()
                    time.sleep(2**attempt)
                    continue
                if result.status_code != 200:
                    status = result.status_code
                    result.close()
                    raise RuntimeError(f'private research transport HTTP {status}')
                return result
            except (requests.ConnectionError, requests.Timeout):
                if attempt == 2:
                    raise RuntimeError('private research transport unavailable') from None
                time.sleep(2**attempt)

    def get(self, ref, dest):
        validate_ref(ref)
        h, total = hashlib.sha256(), 0
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as f:
            temp = Path(f.name)
            try:
                with self.request('GET', '/blob', params={'sha': ref['sha256'], 'area': ref['area']}, stream=True) as r:
                    for block in r.iter_content(256*1024):
                        total += len(block)
                        if total > ref['size_bytes']:
                            raise ValueError('private artifact exceeds declared size')
                        h.update(block)
                        f.write(block)
                f.flush()
                os.fsync(f.fileno())
                if total != ref['size_bytes'] or h.hexdigest() != ref['sha256']:
                    raise ValueError('private artifact hash/size mismatch')
                try:
                    os.link(temp, dest)
                except FileExistsError:
                    verify_file(dest, ref)
            finally:
                temp.unlink(missing_ok=True)

    def put(self, ref, path):
        verify_file(path, ref)
        if ref['area'] != 'derived' or ref['size_bytes'] > MAX_METADATA:
            raise ValueError('platform publication uploads bounded derived metadata only')
        with self.request('PUT', '/artifact', params={'sha': ref['sha256'], 'area': 'derived'},
                          data=Path(path).read_bytes(), headers={'Content-Type': ref['media_type'],
                          'Content-Length': str(ref['size_bytes'])}) as response:
            receipt = response.json()
        if receipt != {'sha256': ref['sha256'], 'verified': True}:
            raise ValueError('invalid private write receipt')

    def batch(self, queries):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(queries, f)
            temp = Path(f.name)
        try:
            return cf('d1', 'query', self.config['studies_id'], '--batch', '@' + str(temp))
        finally:
            temp.unlink(missing_ok=True)

    def bootstrap(self):
        self.guard()
        cf('d1', 'query', self.config['studies_id'], '--body',
           encoded({'sql': (HERE / 'schema.sql').read_text()}).decode())


def verify_file(path, ref):
    validate_ref(ref)
    h, size = hashlib.sha256(), 0
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            size += len(block)
            h.update(block)
    if size != ref['size_bytes'] or h.hexdigest() != ref['sha256']:
        raise ValueError('local artifact hash/size mismatch')
    return Path(path)


class Store:
    def __init__(self, root, blob_roots=(), cloud=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.blobs = self.root / 'blobs'
        self.blobs.mkdir(exist_ok=True)
        self.blob_roots = [Path(p) for p in blob_roots]
        self.cloud = cloud
        self.db = sqlite3.connect(self.root / 'studies.sqlite', timeout=60)
        self.db.executescript((HERE / 'schema.sql').read_text())

    def put(self, value):
        data = encoded(value)
        if len(data) > MAX_METADATA:
            raise ValueError('metadata must be sharded below 4 MiB')
        ref = reference(digest(data), len(data))
        atomic_new(self.blobs / ref['sha256'], data)
        return ref

    def path(self, ref):
        validate_ref(ref)
        for root in [self.blobs, *self.blob_roots]:
            path = root / ref['sha256']
            if path.exists():
                return verify_file(path, ref)
        if self.cloud:
            path = self.blobs / ref['sha256']
            self.cloud.get(ref, path)
            return verify_file(path, ref)
        raise FileNotFoundError('artifact unavailable: ' + ref['sha256'])

    def json(self, ref):
        if ref['media_type'] != 'application/json' or ref['size_bytes'] > MAX_METADATA:
            raise ValueError('expected bounded JSON artifact')
        return load(self.path(ref))

    def add(self, kind, key, data, deps=()):
        if kind not in KINDS or not key:
            raise ValueError('invalid entity kind/key')
        for dep in deps:
            self.entity(dep)
        value = dict(schema=SCHEMA, kind=kind, key=key, dependencies=sorted(set(deps)), data=data)
        ref = self.put(value)
        row = (ref['sha256'], kind, key, encoded(ref).decode())
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO research_entity VALUES(?,?,?,?)', row)
        if tuple(self.db.execute('SELECT * FROM research_entity WHERE id=?', (ref['sha256'],)).fetchone()) != row:
            raise ValueError('immutable entity conflict')
        return ref['sha256']

    def entity(self, entity_id, kind=None):
        row = self.db.execute('SELECT kind,logical_key,payload_json FROM research_entity WHERE id=?', (entity_id,)).fetchone()
        if row is None or (kind and row[0] != kind):
            raise ValueError('missing entity or wrong kind')
        ref = json.loads(row[2])
        value = self.json(ref)
        if (ref['sha256'] != entity_id or value.get('schema') != SCHEMA or value.get('kind') != row[0] or
                value.get('key') != row[1] or value.get('dependencies') != sorted(set(value.get('dependencies', [])))):
            raise ValueError('entity ledger/manifest mismatch')
        return value

    def event(self, run, phase, data):
        self.entity(run, 'run')
        if phase not in ('started', 'succeeded', 'failed'):
            raise ValueError('invalid run phase')
        if phase != 'started' and not self.db.execute("SELECT 1 FROM research_event WHERE run_id=? AND phase='started'", (run,)).fetchone():
            raise ValueError('run must start before finishing')
        value = dict(schema=SCHEMA, run_id=run, phase=phase, data=data)
        ref = self.put(value)
        row = (ref['sha256'], run, phase, encoded(ref).decode())
        with self.db:
            self.db.execute('INSERT INTO research_event VALUES(?,?,?,?)', row)
        return ref['sha256']

    def events(self, run):
        return [self.json(json.loads(row[0])) for row in self.db.execute(
            "SELECT payload_json FROM research_event WHERE run_id=? ORDER BY CASE phase WHEN 'started' THEN 0 ELSE 1 END", (run,))]

    def inventory(self):
        return [dict(id=r[0], kind=r[1], key=r[2]) for r in self.db.execute('SELECT id,kind,logical_key FROM research_entity ORDER BY kind,logical_key,id')]

    def publication(self):
        rows = {}
        for table in ('research_entity', 'research_event'):
            rows[table] = [dict(zip([d[0] for d in cursor.description], row))
                           for cursor in [self.db.execute(f'SELECT * FROM {table} ORDER BY id')]
                           for row in cursor]
        # Entities and nested metadata live in the registry; upstream images stay
        # in the shared archive and are referenced, never cloned per study.
        owned, upstream = {}, {}
        def visit(ref):
            key = (ref['area'], ref['sha256'])
            if key in owned:
                return
            path = self.blobs / ref['sha256']
            if path.exists() and ref['area'] == 'derived' and ref['media_type'] == 'application/json':
                value = self.json(ref)
                owned[key] = ref
                for nested in all_refs(value):
                    visit(nested)
            else:
                upstream[key] = ref
        for table, records in rows.items():
            for row in records:
                visit(json.loads(row['payload_json']))
        for row in rows['research_entity']:
            value = self.entity(row['id'])
            if value['kind'] == 'import' and value['data']['synthetic']:
                raise ValueError('synthetic fixture imports cannot be published')
            for dep in value['dependencies']:
                self.entity(dep)
        return dict(schema=SCHEMA, rows=rows, artifacts=list(owned.values()), upstream=list(upstream.values()))

    def publish(self, cloud):
        cloud.guard()
        manifest = self.publication()
        if len(encoded(manifest)) > MAX_METADATA:
            # Full imports reference tens of thousands of existing archive blobs.
            # Keep the root bounded without re-uploading those upstream bytes.
            upstream, shards, batch = manifest['upstream'], [], []
            empty_size = len(encoded(dict(schema=SCHEMA, kind='publication-upstream', references=[])))
            batch_size = empty_size
            def flush():
                shards.append(self.put(dict(schema=SCHEMA, kind='publication-upstream', references=batch.copy())))
                batch.clear()
            for ref in upstream:
                added_size = len(encoded(ref)) + (1 if batch else 0)
                if batch_size + added_size > MAX_METADATA // 2:
                    if not batch:
                        raise ValueError('upstream reference exceeds shard bound')
                    flush()
                    batch_size = empty_size
                    added_size = len(encoded(ref))
                batch.append(ref)
                batch_size += added_size
            if batch:
                flush()
            manifest = {**manifest, 'upstream': [],
                        'upstream_index': dict(schema='mtl-research-upstream-index-v1',
                                               count=len(upstream), sha256=digest(upstream), shards=shards),
                        'artifacts': [*manifest['artifacts'], *shards]}
        root = self.put(manifest)
        for ref in [*manifest['artifacts'], root]:
            cloud.put(ref, self.path(ref))
        # Guard conflicting replays rather than silently ignoring a differing row.
        # Each batch is atomic. Only the final transaction inserts the complete marker.
        statements = []
        for table, rows in manifest['rows'].items():
            for row in rows:
                columns = list(row)
                comparison = ' AND '.join(f'{k} IS ?' for k in columns)
                statements += [
                    {'sql': f'INSERT INTO research_entity(id,kind,logical_key,payload_json) SELECT NULL,NULL,NULL,NULL WHERE EXISTS(SELECT 1 FROM {table} WHERE id=?) AND NOT EXISTS(SELECT 1 FROM {table} WHERE {comparison})',
                     'params': [row['id'], *row.values()]},
                    {'sql': f'INSERT OR IGNORE INTO {table}({",".join(columns)}) VALUES({",".join("?" for _ in columns)})', 'params': list(row.values())}]
        for i in range(0, len(statements), 200):
            cloud.batch(statements[i:i+200])
        checks = []
        for table, rows in manifest['rows'].items():
            for row in rows:
                checks.append({'sql': f'SELECT * FROM {table} WHERE id=?', 'params': [row['id']]})
        actual = []
        for i in range(0, len(checks), 100):
            actual.extend(cloud.batch(checks[i:i+100]))
        expected = [r for rows in manifest['rows'].values() for r in rows]
        if len(actual) != len(expected) or any(result.get('results') != [row] for result, row in zip(actual, expected)):
            raise ValueError('publication D1 readback mismatch')
        counts = [len(manifest['rows'][t]) for t in ('research_entity', 'research_event')]
        cloud.batch([{'sql': 'INSERT OR IGNORE INTO research_publication VALUES(?,?,?,?)',
                      'params': [root['sha256'], encoded(root).decode(), *counts]}])
        receipt = dict(id=root['sha256'], manifest=root, entity_count=counts[0], event_count=counts[1])
        atomic_new(self.root / ('publication-' + root['sha256'] + '.json'), encoded(receipt))
        return receipt

    def restore(self, cloud, publication_id):
        cloud.guard()
        if self.inventory():
            raise ValueError('restore requires an empty ledger')
        result = cloud.batch([{'sql': 'SELECT * FROM research_publication WHERE id=?', 'params': [publication_id]}])
        if len(result[0]['results']) != 1:
            raise ValueError('complete publication not found')
        marker = result[0]['results'][0]
        ref = json.loads(marker['manifest_json'])
        if ref['sha256'] != publication_id:
            raise ValueError('publication identity mismatch')
        cloud.get(ref, self.blobs / ref['sha256'])
        manifest = self.json(ref)
        if manifest.get('schema') != SCHEMA:
            raise ValueError('unsupported publication schema')
        for artifact in manifest['artifacts']:
            cloud.get(artifact, self.blobs / artifact['sha256'])
        if 'upstream_index' in manifest:
            index = manifest['upstream_index']
            if index.get('schema') != 'mtl-research-upstream-index-v1' or manifest['upstream']:
                raise ValueError('unsupported upstream index')
            upstream = []
            for shard in index['shards']:
                if shard not in manifest['artifacts']:
                    raise ValueError('upstream shard absent from publication artifacts')
                value = self.json(shard)
                if value.get('schema') != SCHEMA or value.get('kind') != 'publication-upstream':
                    raise ValueError('unsupported upstream shard')
                upstream.extend(validate_ref(r) for r in value['references'])
            keys = [(r['area'], r['sha256']) for r in upstream]
            if (len(upstream) != index['count'] or digest(upstream) != index['sha256'] or
                    len(keys) != len(set(keys))):
                raise ValueError('upstream index accounting mismatch')
        if [len(manifest['rows'][t]) for t in ('research_entity', 'research_event')] != [marker['entity_count'], marker['event_count']]:
            raise ValueError('publication accounting mismatch')
        with self.db:
            for table in ('research_entity', 'research_event'):
                for row in manifest['rows'][table]:
                    expected_columns = {'id', 'kind', 'logical_key', 'payload_json'} if table == 'research_entity' else {'id', 'run_id', 'phase', 'payload_json'}
                    if set(row) != expected_columns:
                        raise ValueError('unsupported publication row schema')
                    self.db.execute(f'INSERT INTO {table}({",".join(row)}) VALUES({",".join("?" for _ in row)})', list(row.values()))
            for row in manifest['rows']['research_entity']:
                value = self.entity(row['id'])
                for dep in value['dependencies']:
                    self.entity(dep)
            for row in manifest['rows']['research_event']:
                value = self.json(json.loads(row['payload_json']))
                if value['run_id'] != row['run_id'] or value['phase'] != row['phase'] or row['id'] != digest(value):
                    raise ValueError('event ledger/manifest mismatch')
        return dict(id=publication_id, entities=marker['entity_count'], events=marker['event_count'])
