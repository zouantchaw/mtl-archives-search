import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker';
import { createNewsletterToken } from './newsletter-utils';

type MockRow = Record<string, unknown>;

type MockDb = {
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => {
      all: () => Promise<{ results: MockRow[] }>;
      first: <T = MockRow>() => Promise<T>;
      run: () => Promise<{ success: boolean }>;
    };
    all: () => Promise<{ results: MockRow[] }>;
    first: <T = MockRow>() => Promise<T>;
    run: () => Promise<{ success: boolean }>;
  };
};

type MockVectorIndex = {
  query: (embedding: number[], options: { topK: number; returnMetadata: boolean; returnValues: boolean }) => Promise<{
    matches: Array<{ id: string; score: number }>;
  }>;
};

type NewsletterSubscriptionState = {
  id: number;
  email: string;
  email_normalized: string;
  clerk_user_id: string | null;
  locale: string;
  status: string;
  source: string | null;
  consent_type: string | null;
  consent_version: string | null;
  consent_copy: string | null;
  subscribed_at: string | null;
  resubscribed_at: string | null;
  unsubscribed_at: string | null;
  welcome_sent_at: string | null;
  unsubscribe_confirmation_sent_at: string | null;
  last_daily_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type NewsletterEventState = {
  subscription_id: number | null;
  email_normalized: string;
  event_type: string;
  source: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details_json: string | null;
  created_at: string;
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

      const runFirst = async <T>(params: unknown[]) => {
        if (sql.includes('COUNT(*) as total')) {
          return { total: rows.length } as T;
        }

        const { results } = await runAll(params);
        return (results[0] ?? null) as T;
      };

      return {
        bind(...params: unknown[]) {
          return {
            all: () => runAll(params),
            first: <T = MockRow>() => runFirst<T>(params),
            async run() {
              return { success: true };
            }
          };
        },
        all: () => runAll([]),
        first: <T = MockRow>() => runFirst<T>([]),
        async run() {
          return { success: true };
        },
      };
    },
  };
}

function createNewsletterMockDb(state: {
  subscriptions?: NewsletterSubscriptionState[];
  events?: NewsletterEventState[];
} = {}): MockDb {
  const subscriptions = state.subscriptions ?? [];
  const events = state.events ?? [];
  let nextSubscriptionId = subscriptions.reduce((max, subscription) => Math.max(max, subscription.id), 0) + 1;

  return {
    prepare(sql: string) {
      const runAll = async (params: unknown[]) => {
        if (sql.includes('FROM newsletter_subscription') && sql.includes('WHERE email_normalized = ?')) {
          const emailNormalized = String(params[0] ?? '');
          const subscription = subscriptions.find((item) => item.email_normalized === emailNormalized);
          return { results: subscription ? [subscription as unknown as MockRow] : [] };
        }

        if (sql.includes('COUNT(*) as total') && sql.includes('FROM newsletter_subscription_event')) {
          const ipAddress = String(params[0] ?? '');
          const total = events.filter((event) =>
            event.ip_address === ipAddress && (event.event_type === 'subscribe' || event.event_type === 'resubscribe')
          ).length;
          return { results: [{ total }] };
        }

        return { results: [] };
      };

      const runFirst = async <T>(params: unknown[]) => {
        const { results } = await runAll(params);
        return (results[0] ?? null) as T;
      };

      const runMutation = async (params: unknown[]) => {
        if (sql.includes('INSERT INTO newsletter_subscription_event')) {
          events.push({
            subscription_id: params[0] == null ? null : Number(params[0]),
            email_normalized: String(params[1] ?? ''),
            event_type: String(params[2] ?? ''),
            source: params[3] == null ? null : String(params[3]),
            ip_address: params[4] == null ? null : String(params[4]),
            user_agent: params[5] == null ? null : String(params[5]),
            details_json: params[6] == null ? null : String(params[6]),
            created_at: new Date().toISOString(),
          });
          return { success: true };
        }

        if (sql.includes('INSERT INTO newsletter_subscription (')) {
          const now = new Date().toISOString();
          subscriptions.push({
            id: nextSubscriptionId,
            email: String(params[0] ?? ''),
            email_normalized: String(params[1] ?? ''),
            clerk_user_id: params[2] == null ? null : String(params[2]),
            locale: String(params[3] ?? 'fr'),
            status: 'active',
            source: params[4] == null ? null : String(params[4]),
            consent_type: 'express',
            consent_version: String(params[5] ?? ''),
            consent_copy: String(params[6] ?? ''),
            subscribed_at: now,
            resubscribed_at: null,
            unsubscribed_at: null,
            welcome_sent_at: null,
            unsubscribe_confirmation_sent_at: null,
            last_daily_sent_at: null,
            created_at: now,
            updated_at: now,
          });
          nextSubscriptionId += 1;
          return { success: true };
        }

        if (sql.includes('UPDATE newsletter_subscription') && sql.includes('SET email = ?')) {
          const subscription = subscriptions.find((item) => item.id === Number(params[6]));
          if (subscription) {
            const wasUnsubscribed = subscription.status === 'unsubscribed';
            subscription.email = String(params[0] ?? subscription.email);
            subscription.clerk_user_id = params[1] == null ? subscription.clerk_user_id : String(params[1]);
            subscription.locale = String(params[2] ?? subscription.locale);
            subscription.status = 'active';
            subscription.source = params[3] == null ? subscription.source : String(params[3]);
            subscription.consent_type = 'express';
            subscription.consent_version = String(params[4] ?? subscription.consent_version ?? '');
            subscription.consent_copy = String(params[5] ?? subscription.consent_copy ?? '');
            if (wasUnsubscribed) {
              const now = new Date().toISOString();
              subscription.subscribed_at = now;
              subscription.resubscribed_at = now;
              subscription.unsubscribed_at = null;
            }
            subscription.updated_at = new Date().toISOString();
          }
          return { success: true };
        }

        if (sql.includes('UPDATE newsletter_subscription') && sql.includes("SET status = 'unsubscribed'")) {
          const subscription = subscriptions.find((item) => item.id === Number(params[0]));
          if (subscription) {
            subscription.status = 'unsubscribed';
            subscription.unsubscribed_at = new Date().toISOString();
            subscription.updated_at = new Date().toISOString();
          }
          return { success: true };
        }

        if (sql.includes('UPDATE newsletter_subscription') && sql.includes("SET status = 'active'")) {
          const subscription = subscriptions.find((item) => item.id === Number(params[3]));
          if (subscription) {
            const now = new Date().toISOString();
            subscription.status = 'active';
            subscription.locale = String(params[0] ?? subscription.locale);
            subscription.source = 'resubscribe';
            subscription.consent_type = 'express';
            subscription.consent_version = String(params[1] ?? subscription.consent_version ?? '');
            subscription.consent_copy = String(params[2] ?? subscription.consent_copy ?? '');
            subscription.subscribed_at = now;
            subscription.resubscribed_at = now;
            subscription.unsubscribed_at = null;
            subscription.updated_at = now;
          }
          return { success: true };
        }

        return { success: true };
      };

      return {
        bind(...params: unknown[]) {
          return {
            all: () => runAll(params),
            first: <T = MockRow>() => runFirst<T>(params),
            run: () => runMutation(params),
          };
        },
        all: () => runAll([]),
        first: <T = MockRow>() => runFirst<T>([]),
        run: () => runMutation([]),
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

function createNewsletterEnv(state: {
  subscriptions?: NewsletterSubscriptionState[];
  events?: NewsletterEventState[];
} = {}) {
  return {
    DB: createNewsletterMockDb(state),
    CLOUDFLARE_R2_PUBLIC_DOMAIN: 'example.r2.dev',
    SITE_URL: 'https://www.mtlarchives.com',
    API_ORIGIN: 'https://mtl-archives-worker.wiel.workers.dev',
    NEWSLETTER_TOKEN_SECRET: 'newsletter-secret',
  } as const;
}

const pendingWaitUntil: Array<Promise<unknown>> = [];
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    pendingWaitUntil.push(Promise.resolve(promise).catch(() => undefined));
  },
} as ExecutionContext;

async function flushWaitUntil(): Promise<void> {
  while (pendingWaitUntil.length > 0) {
    const promises = pendingWaitUntil.splice(0, pendingWaitUntil.length);
    await Promise.all(promises);
  }
}

async function withMockedResend<T>(run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      return new Response(JSON.stringify({ id: 're_test_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

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
      name: 'Incinérateur Dickson\\n / Rhéal Benny\\n. - 31 octobre 1975\\\\',
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

test('/api/search suppresses autoresearch-excluded records without permanently hiding them', async () => {
  setupCacheMock();
  const excluded = createManifestRow({
    metadata_filename: 'excluded_hit.json',
    image_quality_action: 'exclude_until_fixed',
    image_quality_severity: 'high',
    image_quality_labels: '["unsafe_crop_candidate"]',
  });
  const visible = createManifestRow({ metadata_filename: 'visible_hit.json' });
  const env = {
    ...createPublicEnv([excluded, visible]),
    AI: {
      async run() {
        return { data: [[0.1, 0.2, 0.3]] };
      },
    },
    VECTORIZE: createMockVector([
      { id: 'excluded_hit.json', score: 0.99 },
      { id: 'visible_hit.json', score: 0.96 },
    ]),
  } as const;

  const defaultResponse = await worker.fetch(new Request('https://example.com/api/search?q=tramway&mode=semantic&limit=5'), env, ctx);
  assert.equal(defaultResponse.status, 200);
  const defaultData = (await defaultResponse.json()) as { count: number; items: Array<{ metadataFilename: string; score: number }> };
  assert.equal(defaultData.count, 2);
  assert.equal(defaultData.items[0].metadataFilename, 'visible_hit.json');
  assert.equal(defaultData.items[1].metadataFilename, 'excluded_hit.json');
  assert.ok(defaultData.items[1].score < 0.99);

  const reviewResponse = await worker.fetch(new Request('https://example.com/api/search?q=tramway&mode=semantic&limit=5&includeExcluded=true'), env, ctx);
  assert.equal(reviewResponse.status, 200);
  const reviewData = (await reviewResponse.json()) as { count: number; items: Array<{ metadataFilename: string }> };
  assert.equal(reviewData.count, 2);
  assert.ok(reviewData.items.some((item) => item.metadataFilename === 'excluded_hit.json'));
});

test('/api/search demotes lower-rank quality records without hiding them', async () => {
  setupCacheMock();
  const demoted = createManifestRow({
    metadata_filename: 'demoted_hit.json',
    image_quality_action: 'lower_rank',
    image_quality_severity: 'medium',
    image_quality_labels: '["border_light"]',
  });
  const clean = createManifestRow({ metadata_filename: 'clean_hit.json' });
  const env = {
    ...createPublicEnv([demoted, clean]),
    AI: {
      async run() {
        return { data: [[0.1, 0.2, 0.3]] };
      },
    },
    VECTORIZE: createMockVector([
      { id: 'demoted_hit.json', score: 0.99 },
      { id: 'clean_hit.json', score: 0.96 },
    ]),
  } as const;

  const response = await worker.fetch(new Request('https://example.com/api/search?q=tramway&mode=semantic&limit=5'), env, ctx);
  assert.equal(response.status, 200);
  const data = (await response.json()) as { count: number; items: Array<{ metadataFilename: string; score: number }> };
  assert.equal(data.count, 2);
  assert.equal(data.items[0].metadataFilename, 'clean_hit.json');
  assert.equal(data.items[1].metadataFilename, 'demoted_hit.json');
  assert.ok(data.items[1].score < 0.99);
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

test('/api/newsletter/subscribe stores an active subscription', async () => {
  setupCacheMock();
  await withMockedResend(async () => {
    const state = {
      subscriptions: [] as NewsletterSubscriptionState[],
      events: [] as NewsletterEventState[],
    };
    const env = {
      ...createNewsletterEnv(state),
      RESEND_SECRET_KEY: 'test-resend-key',
    };
    const request = new Request('https://example.com/api/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.10',
        'user-agent': 'test-agent',
      },
      body: JSON.stringify({
        email: '  Test@Example.com ',
        lang: 'en',
        source: 'landing',
      }),
    });

    const response = await worker.fetch(request, env, ctx);
    await flushWaitUntil();

    assert.equal(response.status, 200);
    const data = await response.json() as { success: boolean; status: string };
    assert.equal(data.success, true);
    assert.equal(data.status, 'subscribed');
    assert.equal(state.subscriptions.length, 1);
    assert.equal(state.subscriptions[0].email, 'Test@Example.com');
    assert.equal(state.subscriptions[0].email_normalized, 'test@example.com');
    assert.equal(state.subscriptions[0].status, 'active');
    assert.ok(state.events.some((event) => event.event_type === 'subscribe'));
    assert.ok(state.events.some((event) => event.event_type === 'welcome_send'));
  });
});

test('/api/newsletter/subscribe returns already_subscribed for an existing active subscription', async () => {
  setupCacheMock();
  await withMockedResend(async () => {
    const now = new Date().toISOString();
    const state = {
      subscriptions: [{
        id: 1,
        email: 'member@example.com',
        email_normalized: 'member@example.com',
        clerk_user_id: null,
        locale: 'en',
        status: 'active',
        source: 'landing',
        consent_type: 'express',
        consent_version: '2026-03-13-v1',
        consent_copy: 'copy',
        subscribed_at: now,
        resubscribed_at: null,
        unsubscribed_at: null,
        welcome_sent_at: now,
        unsubscribe_confirmation_sent_at: null,
        last_daily_sent_at: null,
        created_at: now,
        updated_at: now,
      }],
      events: [] as NewsletterEventState[],
    };
    const env = {
      ...createNewsletterEnv(state),
      RESEND_SECRET_KEY: 'test-resend-key',
    };
    const request = new Request('https://example.com/api/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.11',
      },
      body: JSON.stringify({
        email: 'member@example.com',
        lang: 'en',
        source: 'landing',
      }),
    });
    const response = await worker.fetch(request, env, ctx);
    await flushWaitUntil();

    assert.equal(response.status, 200);
    const data = await response.json() as { success: boolean; status: string };
    assert.equal(data.success, true);
    assert.equal(data.status, 'already_subscribed');
    assert.equal(state.subscriptions.length, 1);
    assert.ok(state.events.some((event) => event.event_type === 'already_subscribed'));
  });
});

test('/api/newsletter/unsubscribe deactivates the subscription from a signed link', async () => {
  setupCacheMock();
  await withMockedResend(async () => {
    const now = new Date().toISOString();
    const state = {
      subscriptions: [{
        id: 7,
        email: 'member@example.com',
        email_normalized: 'member@example.com',
        clerk_user_id: null,
        locale: 'en',
        status: 'active',
        source: 'landing',
        consent_type: 'express',
        consent_version: '2026-03-13-v1',
        consent_copy: 'copy',
        subscribed_at: now,
        resubscribed_at: null,
        unsubscribed_at: null,
        welcome_sent_at: now,
        unsubscribe_confirmation_sent_at: null,
        last_daily_sent_at: null,
        created_at: now,
        updated_at: now,
      }],
      events: [] as NewsletterEventState[],
    };
    const env = {
      ...createNewsletterEnv(state),
      RESEND_SECRET_KEY: 'test-resend-key',
    };
    const token = await createNewsletterToken({
      action: 'unsubscribe',
      email: 'member@example.com',
      lang: 'en',
      issuedAt: now,
    }, env.NEWSLETTER_TOKEN_SECRET);

    const response = await worker.fetch(
      new Request(`https://example.com/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}&lang=en`, {
        headers: {
          'cf-connecting-ip': '203.0.113.12',
          'user-agent': 'test-agent',
        },
      }),
      env,
      ctx,
    );
    await flushWaitUntil();

    assert.equal(response.status, 200);
    assert.equal(state.subscriptions[0].status, 'unsubscribed');
    assert.ok(state.events.some((event) => event.event_type === 'unsubscribe'));
    assert.ok(state.events.some((event) => event.event_type === 'unsubscribe_confirmation_send'));
    const html = await response.text();
    assert.match(html, /See you soon\./);
  });
});

test('/api/newsletter/resubscribe reactivates an unsubscribed subscription from a signed link', async () => {
  setupCacheMock();
  await withMockedResend(async () => {
    const now = new Date().toISOString();
    const state = {
      subscriptions: [{
        id: 8,
        email: 'member@example.com',
        email_normalized: 'member@example.com',
        clerk_user_id: null,
        locale: 'en',
        status: 'unsubscribed',
        source: 'landing',
        consent_type: 'express',
        consent_version: '2026-03-13-v1',
        consent_copy: 'copy',
        subscribed_at: now,
        resubscribed_at: null,
        unsubscribed_at: now,
        welcome_sent_at: now,
        unsubscribe_confirmation_sent_at: null,
        last_daily_sent_at: null,
        created_at: now,
        updated_at: now,
      }],
      events: [] as NewsletterEventState[],
    };
    const env = {
      ...createNewsletterEnv(state),
      RESEND_SECRET_KEY: 'test-resend-key',
    };
    const token = await createNewsletterToken({
      action: 'resubscribe',
      email: 'member@example.com',
      lang: 'en',
      issuedAt: now,
    }, env.NEWSLETTER_TOKEN_SECRET);

    const response = await worker.fetch(
      new Request(`https://example.com/api/newsletter/resubscribe?token=${encodeURIComponent(token)}&lang=en`, {
        headers: {
          'cf-connecting-ip': '203.0.113.13',
          'user-agent': 'test-agent',
        },
      }),
      env,
      ctx,
    );
    await flushWaitUntil();

    assert.equal(response.status, 200);
    assert.equal(state.subscriptions[0].status, 'active');
    assert.equal(state.subscriptions[0].source, 'resubscribe');
    assert.ok(state.events.some((event) => event.event_type === 'resubscribe'));
    assert.ok(state.events.some((event) => event.event_type === 'welcome_send'));
    const html = await response.text();
    assert.match(html, /Welcome back\./);
  });
});
