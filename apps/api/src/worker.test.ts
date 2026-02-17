import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker';

type MockRow = Record<string, unknown>;

function createManifestRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    metadata_filename: 'mtl_archives_metadata_1.json',
    image_filename: 'mtl_archives_image_1.jpg',
    resolved_image_filename: 'mtl_archives_image_1.jpg',
    image_size_bytes: 1024,
    name: 'Test Photo',
    description: 'A sufficiently long test description for metadata quality checks.',
    vlm_caption: null,
    date_value: '1940',
    credits: 'Archives de la Ville de Montréal',
    cote: 'VM94,SY,SS1,SSS17,D1',
    external_url: null,
    portal_match: 1,
    portal_title: 'Portal Title',
    portal_description: 'Portal description present for quality validation.',
    portal_date: null,
    portal_cote: null,
    aerial_datasets: '[]',
    latitude: null,
    longitude: null,
    geocode_confidence: null,
    ...overrides,
  };
}

function createMockDb(rows: MockRow[]) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes('FROM manifest')) {
            return { results: rows };
          }
          return { results: [] as MockRow[] };
        },
        async first() {
          return { total: rows.length };
        },
      };
    },
  };
}

function setupCacheMock() {
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: CacheStorage }).caches = {
    default: {
      async match(request: Request) {
        return store.get(request.url);
      },
      async put(request: Request, response: Response) {
        store.set(request.url, response);
      },
    },
  } as unknown as CacheStorage;
}

function createSignedEnv(rows: MockRow[] = []) {
  return {
    DB: createMockDb(rows),
    CLOUDFLARE_R2_ACCESS_KEY: 'test-access-key',
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'test-secret-key',
    CLOUDFLARE_R2_ACCOUNT_ID: 'test-account-id',
    CLOUDFLARE_R2_BUCKET: 'test-bucket',
  } as const;
}

function createPublicEnv(rows: MockRow[] = []) {
  return {
    DB: createMockDb(rows),
    CLOUDFLARE_R2_PUBLIC_DOMAIN: 'example.r2.dev',
  } as const;
}

const ctx = {
  waitUntil() {
    // no-op for tests
  },
} as ExecutionContext;

test('clamps /api/map cache TTL when signed URLs are used', async () => {
  setupCacheMock();
  const env = createSignedEnv([]);

  const response = await worker.fetch(new Request('https://example.com/api/map'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache-TTL'), '3540');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3540');
});

test('keeps normal /api/map cache TTL when public R2 domain is configured', async () => {
  setupCacheMock();
  const env = createPublicEnv([]);

  const response = await worker.fetch(new Request('https://example.com/api/map'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache-TTL'), '43200');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=43200');
});

test('clamps /api/photos?id cache TTL and returns signed image URL', async () => {
  setupCacheMock();
  const env = createSignedEnv([createManifestRow()]);

  const response = await worker.fetch(
    new Request('https://example.com/api/photos?id=mtl_archives_metadata_1'),
    env,
    ctx
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache-TTL'), '3540');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3540');

  const data = (await response.json()) as { items: Array<{ imageUrl: string }> };
  assert.equal(data.items.length, 1);
  assert.match(data.items[0].imageUrl, /X-Amz-Expires=3600/);
});

