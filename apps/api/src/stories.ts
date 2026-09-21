export type StorySection = {
  heading: string;
  body: string;
};

export type StorySponsor = {
  name: string;
  url: string;
  label: string | null;
};

export type PublicStory = {
  slug: string;
  title: string;
  dek: string;
  sections: StorySection[];
  theme_label: string;
  date: string;
  photo_id: string;
  photo_url: string;
  photo_credit: string | null;
  cote: string | null;
  lang: 'fr' | 'en';
  email_capture_variant: string | null;
  sponsor: StorySponsor | null;
  status: 'published' | 'draft';
  published_at: string;
  created_at: string;
};

export type StoriesEnv = {
  STORIES_DB?: D1Database;
  SITE_URL?: string;
  STORIES_ADMIN_SECRET?: string;
  NEWSLETTER_ADMIN_SECRET?: string;
};

type StoryRow = {
  slug: string;
  title: string;
  dek: string;
  sections: string;
  theme_label: string;
  date: string;
  photo_id: string;
  photo_url: string;
  photo_credit: string | null;
  cote: string | null;
  lang: string;
  email_capture_variant: string | null;
  sponsor: string | null;
  status: string;
  published_at: string;
  created_at: string;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STORY_COLUMNS = `slug, title, dek, sections, theme_label, date, photo_id, photo_url, photo_credit, cote, lang, email_capture_variant, sponsor, status, published_at, created_at`;

export function storySiteUrl(env: StoriesEnv): string {
  return (env.SITE_URL || 'https://www.mtlarchives.com').replace(/\/$/, '');
}

export function isStoriesAdminAuthorized(request: Request, env: StoriesEnv): boolean {
  const secret = env.STORIES_ADMIN_SECRET || env.NEWSLETTER_ADMIN_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-stories-admin-secret');
  return Boolean(header && header === secret);
}

export function storyExcerpt(story: Pick<PublicStory, 'dek' | 'sections'>): string {
  const text = [story.dek, ...story.sections.map((section) => section.body)]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [text];
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).filter(Boolean).join(' ');
}

export function validateStoryPublishBody(value: unknown): { story: PublicStory } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Body must be a JSON object' };
  }
  const body = value as Record<string, unknown>;
  const slug = readString(body.slug)?.toLowerCase() ?? '';
  if (!slug || slug.length > 120 || !SLUG_PATTERN.test(slug)) {
    return { error: 'slug must be a lowercase theme-id (letters, numbers, hyphens)' };
  }
  const title = readString(body.title);
  if (!title || title.length > 180) return { error: 'title is required' };
  const dek = readString(body.dek);
  if (!dek || dek.length > 500) return { error: 'dek is required' };
  const sections = readSections(body.sections);
  if (!sections) return { error: 'sections must be a non-empty array of {heading, body}' };
  const themeLabel = readString(body.theme_label);
  if (!themeLabel || themeLabel.length > 120) return { error: 'theme_label is required' };
  const date = readString(body.date);
  if (!date || !DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { error: 'date must be YYYY-MM-DD' };
  }
  const photoId = normalizePhotoId(readString(body.photo_id));
  if (!photoId || photoId.length > 180 || /[/\s]/.test(photoId)) return { error: 'photo_id is required' };
  const photoUrl = readString(body.photo_url);
  if (!photoUrl || !isHttpUrl(photoUrl)) return { error: 'photo_url must be an http(s) URL' };
  const lang = body.lang == null || body.lang === '' ? 'fr' : body.lang;
  if (lang !== 'fr' && lang !== 'en') return { error: 'lang must be fr or en' };
  const status = body.status == null || body.status === '' ? 'published' : body.status;
  if (status !== 'published' && status !== 'draft') return { error: 'status must be published or draft' };
  const sponsor = readSponsor(body.sponsor);
  if (sponsor === undefined) return { error: 'sponsor must be {name, url, label?} or null' };
  const variant = readOptional(body.email_capture_variant, 80);
  if (variant === undefined) return { error: 'email_capture_variant must be a string or null' };
  const credit = readOptional(body.photo_credit, 240);
  if (credit === undefined) return { error: 'photo_credit must be a string or null' };
  const cote = readOptional(body.cote, 80);
  if (cote === undefined) return { error: 'cote must be a string or null' };
  const now = new Date().toISOString();
  const publishedAt = readTimestamp(body.published_at) ?? now;
  const createdAt = readTimestamp(body.created_at) ?? now;
  if (body.published_at != null && body.published_at !== '' && !readTimestamp(body.published_at)) {
    return { error: 'published_at must be an ISO timestamp' };
  }
  if (body.created_at != null && body.created_at !== '' && !readTimestamp(body.created_at)) {
    return { error: 'created_at must be an ISO timestamp' };
  }

  return {
    story: {
      slug,
      title,
      dek,
      sections,
      theme_label: themeLabel,
      date,
      photo_id: photoId,
      photo_url: photoUrl,
      photo_credit: credit,
      cote,
      lang,
      email_capture_variant: variant,
      sponsor,
      status,
      published_at: publishedAt,
      created_at: createdAt,
    },
  };
}

export async function insertStory(
  db: D1Database,
  story: PublicStory,
): Promise<{ inserted: boolean }> {
  const result = await db.prepare(
    `INSERT INTO stories (${STORY_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO NOTHING`,
  ).bind(
    story.slug,
    story.title,
    story.dek,
    JSON.stringify(story.sections),
    story.theme_label,
    story.date,
    story.photo_id,
    story.photo_url,
    story.photo_credit,
    story.cote,
    story.lang,
    story.email_capture_variant,
    story.sponsor ? JSON.stringify(story.sponsor) : null,
    story.status,
    story.published_at,
    story.created_at,
  ).run();
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
  return { inserted: changes > 0 };
}

export async function getPublishedStoryBySlug(db: D1Database, slug: string): Promise<PublicStory | null> {
  const row = await db.prepare(
    `SELECT ${STORY_COLUMNS} FROM stories WHERE slug = ? AND status = 'published' LIMIT 1`,
  ).bind(slug).first<StoryRow>();
  return row ? mapStoryRow(row) : null;
}

export async function getLatestPublishedStory(db: D1Database): Promise<PublicStory | null> {
  const row = await db.prepare(
    `SELECT ${STORY_COLUMNS} FROM stories WHERE status = 'published' ORDER BY published_at DESC, slug DESC LIMIT 1`,
  ).first<StoryRow>();
  return row ? mapStoryRow(row) : null;
}

export async function getPublishedStoryByDate(db: D1Database, date: string): Promise<PublicStory | null> {
  const row = await db.prepare(
    `SELECT ${STORY_COLUMNS} FROM stories WHERE status = 'published' AND date = ? ORDER BY published_at DESC, slug DESC LIMIT 1`,
  ).bind(date).first<StoryRow>();
  return row ? mapStoryRow(row) : null;
}

export async function listPublishedStories(
  db: D1Database,
  limit: number,
  cursor: string | null,
): Promise<{ items: PublicStory[]; nextCursor: string | null }> {
  const parsed = cursor ? decodeCursor(cursor) : null;
  const boundLimit = Math.min(Math.max(limit, 1), 50);
  const rows = parsed
    ? await db.prepare(
      `SELECT ${STORY_COLUMNS} FROM stories
       WHERE status = 'published'
         AND (published_at < ? OR (published_at = ? AND slug < ?))
       ORDER BY published_at DESC, slug DESC
       LIMIT ?`,
    ).bind(parsed.publishedAt, parsed.publishedAt, parsed.slug, boundLimit + 1).all<StoryRow>()
    : await db.prepare(
      `SELECT ${STORY_COLUMNS} FROM stories
       WHERE status = 'published'
       ORDER BY published_at DESC, slug DESC
       LIMIT ?`,
    ).bind(boundLimit + 1).all<StoryRow>();
  const results = rows.results ?? [];
  const page = results.slice(0, boundLimit).map(mapStoryRow);
  const last = page[page.length - 1];
  const nextCursor = results.length > boundLimit && last
    ? encodeCursor(last.published_at, last.slug)
    : null;
  return { items: page, nextCursor };
}

export async function hasPublishedStoryForDate(db: D1Database, date: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT slug FROM stories WHERE status = 'published' AND date = ? LIMIT 1`,
  ).bind(date).first<{ slug: string }>();
  return Boolean(row?.slug);
}

export function encodeCursor(publishedAt: string, slug: string): string {
  return btoa(`${publishedAt}\n${slug}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeCursor(cursor: string): { publishedAt: string; slug: string } | null {
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(cursor.length / 4) * 4, '=');
    const decoded = atob(padded);
    const splitAt = decoded.indexOf('\n');
    if (splitAt <= 0) return null;
    const publishedAt = decoded.slice(0, splitAt);
    const slug = decoded.slice(splitAt + 1);
    if (!publishedAt || !slug) return null;
    return { publishedAt, slug };
  } catch {
    return null;
  }
}

export function mapStoryRow(row: StoryRow): PublicStory {
  const sections = parseSections(row.sections);
  const sponsor = parseSponsor(row.sponsor);
  return {
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    sections,
    theme_label: row.theme_label,
    date: row.date,
    photo_id: row.photo_id,
    photo_url: row.photo_url,
    photo_credit: row.photo_credit,
    cote: row.cote,
    lang: row.lang === 'en' ? 'en' : 'fr',
    email_capture_variant: row.email_capture_variant,
    sponsor,
    status: row.status === 'draft' ? 'draft' : 'published',
    published_at: row.published_at,
    created_at: row.created_at,
  };
}

function parseSections(value: string): StorySection[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return readSections(parsed) ?? [];
  } catch {
    return [];
  }
}

function parseSponsor(value: string | null): StorySponsor | null {
  if (!value) return null;
  try {
    const parsed = readSponsor(JSON.parse(value));
    return parsed ?? null;
  } catch {
    return null;
  }
}

function readSections(value: unknown): StorySection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const sections: StorySection[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const heading = readString(record.heading) || readString(record.title);
    const body = readString(record.body);
    if (!heading || !body || heading.length > 180 || body.length > 8000) return null;
    sections.push({ heading, body });
  }
  return sections;
}

function readSponsor(value: unknown): StorySponsor | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const name = readString(record.name);
  const url = readString(record.url);
  if (!name || !url || !isHttpUrl(url) || name.length > 120) return undefined;
  const label = readOptional(record.label, 80);
  if (label === undefined) return undefined;
  return { name, url, label };
}

function readOptional(value: unknown, maxLength: number): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return undefined;
  return trimmed;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizePhotoId(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\.json$/i, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
