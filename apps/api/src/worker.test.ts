import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker';

type MockRow = Record<string, unknown>;

type MockDb = {
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => { all: () => Promise<{ results: MockRow[] }>; first: () => Promise<{ total: number }> };
    all: () => Promise<{ results: MockRow[] }>;
    first: () => Promise<{ total: number }>;
  };
};

type MockVectorIndex = {
  query: (embedding: number[], options: { topK: number; returnMetadata: boolean; returnValues: boolean }) => Promise<{
    matches: Array<{ id: string; score: number }>;
  }>;
};

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
    cote: 'VM94-123',
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

function createMockDb(rows: MockRow[]): MockDb {
  return {
    prepare(sql: string) {
      const runAll = async (params: unknown[]) => {
        if (sql.includes('COUNT(*) as total')) {
          return { results: [] };
        }

        if (sql.includes('WHERE metadata_filename IN')) {
          const ids = new Set(params.map((v) => String(v)));
          return {
            results: rows.filter((row) => ids.has(String(row.metadata_filename))),
          };
        }

        if (sql.includes('WHERE (cote = ? OR portal_cote = ? OR metadata_filename = ? OR metadata_filename = ?)')) {
          const [cote, portalCote, idA, idB] = params.map((v) => String(v));
          return {
            results: rows.filter((row) => {
              const metadataId = String(row.metadata_filename);
              return (
                String(row.cote ?? '') === cote ||
                String(row.portal_cote ?? '') === portalCote ||
                metadataId === idA ||
                metadataId === idB
              );
            }),
          };
        }

        if (sql.includes('SELECT metadata_filename, resolved_image_filename, name, date_value FROM manifest')) {
          return { results: rows };
        }

        if (sql.includes('SELECT metadata_filename, name, date_value, latitude, longitude')) {
          return { results: rows.filter((row) => row.latitude != null) };
        }

        if (sql.includes('SELECT') && sql.includes('FROM manifest')) {
          return { results: rows };
        }

        return { results: [] };
      };

      return {
        bind(...params: unknown[]) {
          return {
            all: () => runAll(params),
            async first() {
              return { total: rows.length };
            },
          };
        },
        all: () => runAll([]),
        async first() {
          return { total: rows.length };
        },
      };
    },
  };
}

function createMockVector(matches: Array<{ id: string; score: number }>): MockVectorIndex {
  return {
    async query() {
      return { matches };
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

test('/api/photos id normalization accepts bare and .json IDs', async () => {
  setupCacheMock();
  const row = createManifestRow({ metadata_filename: 'mtl_archives_metadata_1.json' });
  const env = createSignedEnv([row]);

  const bare = await worker.fetch(new Request('https://example.com/api/photos?id=mtl_archives_metadata_1'), env, ctx);
  const withJson = await worker.fetch(new Request('https://example.com/api/photos?id=mtl_archives_metadata_1.json'), env, ctx);

  assert.equal(bare.status, 200);
  assert.equal(withJson.status, 200);

  const bareData = (await bare.json()) as { items: Array<{ metadataFilename: string }> };
  const jsonData = (await withJson.json()) as { items: Array<{ metadataFilename: string }> };

  assert.equal(bareData.items.length, 1);
  assert.equal(jsonData.items.length, 1);
  assert.equal(bareData.items[0].metadataFilename, 'mtl_archives_metadata_1.json');
  assert.equal(jsonData.items[0].metadataFilename, 'mtl_archives_metadata_1.json');
});

test('/api/photos?id returns 404 when no matching photo exists', async () => {
  setupCacheMock();
  const env = createPublicEnv([]);

  const response = await worker.fetch(new Request('https://example.com/api/photos?id=missing-id'), env, ctx);

  assert.equal(response.status, 404);
  const data = (await response.json()) as { error?: string };
  assert.equal(data.error, 'Photo not found');
});

test('/api/sitemap returns canonical bare IDs and public cache TTL', async () => {
  setupCacheMock();
  const env = createPublicEnv([
    createManifestRow({ metadata_filename: 'photo_alpha.json', resolved_image_filename: 'alpha.jpg' }),
  ]);

  const response = await worker.fetch(new Request('https://example.com/api/sitemap'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache-TTL'), '86400');

  const data = (await response.json()) as { items: Array<{ id: string; imageUrl: string }>; count: number };
  assert.equal(data.count, 1);
  assert.equal(data.items[0].id, 'photo_alpha');
  assert.match(data.items[0].imageUrl, /^https:\/\/example\.r2\.dev\//);
});

test('/api/photos normalizes escaped metadata control characters', async () => {
  setupCacheMock();
  const env = createPublicEnv([
    createManifestRow({
      metadata_filename: 'photo_dirty_text.json',
      name: 'Incinérateur Dickson\\n / Rhéal Benny\\n. - 31 octobre 1975',
      description: 'Line 1\\nLine 2\nLine 3\tDone',
      credits: 'Archives\\n de Montréal',
    }),
  ]);

  const response = await worker.fetch(new Request('https://example.com/api/photos?id=photo_dirty_text'), env, ctx);

  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    items: Array<{ name: string; description: string; credits: string }>;
  };
  assert.equal(data.items[0].name, 'Incinérateur Dickson / Rhéal Benny . - 31 octobre 1975');
  assert.equal(data.items[0].description, 'Line 1 Line 2 Line 3 Done');
  assert.equal(data.items[0].credits, 'Archives de Montréal');
});

test('/api/sitemap normalizes escaped metadata control characters', async () => {
  setupCacheMock();
  const env = createPublicEnv([
    createManifestRow({
      metadata_filename: 'photo_sitemap_dirty.json',
      name: 'Rue\\n Saint-Laurent',
    }),
  ]);

  const response = await worker.fetch(new Request('https://example.com/api/sitemap'), env, ctx);

  assert.equal(response.status, 200);
  const data = (await response.json()) as { items: Array<{ name: string | null }> };
  assert.equal(data.items[0].name, 'Rue Saint-Laurent');
});

test('/api/search returns 400 when q is missing', async () => {
  setupCacheMock();
  const env = createPublicEnv([]);

  const response = await worker.fetch(new Request('https://example.com/api/search?mode=semantic'), env, ctx);

  assert.equal(response.status, 400);
  const data = (await response.json()) as { error: string };
  assert.match(data.error, /Missing required query parameter/);
});

test('/api/search text fast-path returns mode=text on cote lookup', async () => {
  setupCacheMock();
  const env = createPublicEnv([
    createManifestRow({ metadata_filename: 'photo_cote_1.json', cote: 'VM94-123' }),
  ]);

  const response = await worker.fetch(new Request('https://example.com/api/search?q=VM94-123&mode=text'), env, ctx);

  assert.equal(response.status, 200);
  const data = (await response.json()) as { mode: string; items: Array<{ metadataFilename: string }> };
  assert.equal(data.mode, 'text');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].metadataFilename, 'photo_cote_1.json');
});

test('/api/search semantic mode returns 501 when Vectorize/AI is not configured', async () => {
  setupCacheMock();
  const env = createPublicEnv([]);

  const response = await worker.fetch(new Request('https://example.com/api/search?q=tramway&mode=semantic'), env, ctx);

  assert.equal(response.status, 501);
  const data = (await response.json()) as { error: string };
  assert.match(data.error, /Semantic search is not configured/);
});

test('/api/search semantic mode returns results when Vectorize and AI are configured', async () => {
  setupCacheMock();
  const row = createManifestRow({ metadata_filename: 'semantic_hit.json' });
  const env = {
    ...createPublicEnv([row]),
    AI: {
      async run() {
        return { data: [[0.1, 0.2, 0.3]] };
      },
    },
    VECTORIZE: createMockVector([{ id: 'semantic_hit.json', score: 0.91 }]),
  } as const;

  const response = await worker.fetch(new Request('https://example.com/api/search?q=tramway&mode=semantic&limit=5'), env, ctx);

  assert.equal(response.status, 200);
  const data = (await response.json()) as { mode: string; count: number; items: Array<{ metadataFilename: string; score: number }> };
  assert.equal(data.mode, 'semantic');
  assert.equal(data.count, 1);
  assert.equal(data.items[0].metadataFilename, 'semantic_hit.json');
  assert.equal(data.items[0].score, 0.91);
});

test('/api/search visual mode accepts precomputed POST embedding', async () => {
  setupCacheMock();
  const row = createManifestRow({ metadata_filename: 'visual_hit.json' });
  const env = {
    ...createPublicEnv([row]),
    VECTORIZE_CLIP: createMockVector([{ id: 'visual_hit.json', score: 0.88 }]),
  } as const;

  const embedding = new Array(512).fill(0).map((_, idx) => (idx === 0 ? 1 : 0));
  const request = new Request('https://example.com/api/search?q=river&mode=visual&limit=3', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embedding }),
  });

  const response = await worker.fetch(request, env, ctx);

  assert.equal(response.status, 200);
  const data = (await response.json()) as { mode: string; count: number; items: Array<{ metadataFilename: string; score: number }> };
  assert.equal(data.mode, 'visual');
  assert.equal(data.count, 1);
  assert.equal(data.items[0].metadataFilename, 'visual_hit.json');
  assert.equal(data.items[0].score, 0.88);
});
