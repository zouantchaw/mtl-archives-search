import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker';
import {
  decodeCursor,
  encodeCursor,
  storyExcerpt,
  validateStoryPublishBody,
} from './stories';

const validBody = {
  slug: 'tramway-1937',
  title: 'Le tramway de la rue Sainte-Catherine',
  dek: 'Une photo, un coin de rue, et ce qui a disparu.',
  sections: [
    { heading: 'Ce que vous voyez', body: 'Un tramway tourne au coin. La chaussée est encore pavée.' },
    { heading: 'Pourquoi ça compte', body: 'Cette ligne a structuré le centre-ville pendant des décennies.' },
  ],
  theme_label: 'Transport',
  date: '2026-09-21',
  photo_id: 'mtl_archives_metadata_15035.json',
  photo_url: 'https://example.r2.dev/mtl_archives_image_15035.jpg',
  photo_credit: 'Archives de Montréal',
  cote: 'VM94-Z-123',
};

test('story publish body validates and normalizes the photo id', () => {
  const result = validateStoryPublishBody(validBody);
  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.story.photo_id, 'mtl_archives_metadata_15035');
  assert.equal(result.story.lang, 'fr');
  assert.equal(result.story.status, 'published');
  assert.equal(result.story.sections[0]?.heading, 'Ce que vous voyez');
});

test('story publish body accepts a title alias and rejects a bad slug', () => {
  const aliased = validateStoryPublishBody({
    ...validBody,
    sections: [{ title: 'Ce que vous voyez', body: 'Un tramway.' }],
  });
  assert.equal('error' in aliased, false);
  if (!('error' in aliased)) {
    assert.equal(aliased.story.sections[0]?.heading, 'Ce que vous voyez');
  }

  const invalid = validateStoryPublishBody({ ...validBody, slug: '../etc' });
  assert.equal('error' in invalid, true);
});

test('story excerpt keeps two sentences', () => {
  const result = validateStoryPublishBody(validBody);
  if ('error' in result) throw new Error(result.error);
  const excerpt = storyExcerpt(result.story);
  assert.match(excerpt, /Une photo/);
  assert.match(excerpt, /Un tramway/);
  assert.equal(excerpt.split('.').filter(Boolean).length >= 2, true);
});

test('story cursor round-trips', () => {
  const cursor = encodeCursor('2026-09-21T11:00:00.000Z', 'tramway-1937');
  assert.deepEqual(decodeCursor(cursor), {
    publishedAt: '2026-09-21T11:00:00.000Z',
    slug: 'tramway-1937',
  });
  assert.equal(decodeCursor('not-a-cursor'), null);
});

test('story publish is unauthorized without the admin secret', async () => {
  const response = await worker.fetch(
    new Request('https://mtl-archives-worker.example/api/stories/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    }),
    { DB: {} as D1Database },
    { waitUntil() {}, passThroughOnException() {} } as ExecutionContext,
  );
  assert.equal(response.status, 401);
});

test('story publish inserts once and public read returns the story', async () => {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (sql.includes('INSERT') && rows.some((row) => row.slug === params[0])) {
                return { success: true, meta: { changes: 0 } };
              }
              if (sql.includes('INSERT')) {
                const [slug, title, dek, sections, theme_label, date, photo_id, photo_url, photo_credit, cote, lang, email_capture_variant, sponsor, status, published_at, created_at] = params;
                rows.push({ slug, title, dek, sections, theme_label, date, photo_id, photo_url, photo_credit, cote, lang, email_capture_variant, sponsor, status, published_at, created_at });
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
            async first() {
              return rows.find((row) => row.slug === params[0] && row.status === 'published') ?? null;
            },
            async all() {
              return { results: rows.filter((row) => row.status === 'published') };
            },
          };
        },
        async first() {
          return rows.find((row) => row.status === 'published') ?? null;
        },
        async all() {
          return { results: rows.filter((row) => row.status === 'published') };
        },
      };
    },
  };

  const env = {
    DB: {} as D1Database,
    STORIES_DB: db as unknown as D1Database,
    STORIES_ADMIN_SECRET: 'stories-secret',
    SITE_URL: 'https://www.mtlarchives.com',
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
  const publish = await worker.fetch(
    new Request('https://mtl-archives-worker.example/api/stories/publish', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stories-admin-secret': 'stories-secret',
      },
      body: JSON.stringify(validBody),
    }),
    env,
    ctx,
  );
  assert.equal(publish.status, 200);
  const created = await publish.json() as { ok: boolean; slug: string; url: string; inserted: boolean };
  assert.equal(created.ok, true);
  assert.equal(created.inserted, true);
  assert.equal(created.url, 'https://www.mtlarchives.com/stories/tramway-1937');

  const again = await worker.fetch(
    new Request('https://mtl-archives-worker.example/api/stories/publish', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-stories-admin-secret': 'stories-secret',
      },
      body: JSON.stringify(validBody),
    }),
    env,
    ctx,
  );
  const duplicate = await again.json() as { ok: boolean; inserted: boolean };
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.inserted, false);

  const read = await worker.fetch(
    new Request('https://mtl-archives-worker.example/api/stories/tramway-1937'),
    env,
    ctx,
  );
  assert.equal(read.status, 200);
  const payload = await read.json() as { story: { photo_id: string; sections: Array<{ heading: string }> } };
  assert.equal(payload.story.photo_id, 'mtl_archives_metadata_15035');
  assert.equal(payload.story.sections[0]?.heading, 'Ce que vous voyez');
  assert.match(read.headers.get('cache-control') ?? '', /max-age=/);
});
