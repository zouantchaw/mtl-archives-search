import type { VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { type PhotoRecord, validateMetadataQuality } from '@mtl-archives/core';
import { getPhotoOrientationOverride } from './photo-orientation-overrides';
import {
  createNewsletterToken,
  formatNewsletterDateLabel,
  getTorontoDateKey,
  isValidEmail,
  normalizeEmail,
  normalizeNewsletterLang,
  type NewsletterLang,
  verifyNewsletterToken,
} from './newsletter-utils';
import {
  acquireNewsletterRun,
  completeNewsletterRun,
  failNewsletterRun,
  type NewsletterRunSource,
  type NewsletterRunSummary,
} from './newsletter-run-lock';
import {
  getDailyNewsletterSubject,
  getUnsubscribeConfirmationSubject,
  getWelcomeEmailSubject,
  renderDailyNewsletterEmail,
  renderNewsletterStatusPage,
  renderUnsubscribeConfirmationEmail,
  renderWelcomeEmail,
} from './newsletter-email';

type Env = {
  DB: D1Database;
  AI: Ai;
  VECTORIZE?: VectorizeIndex;
  VECTORIZE_CLIP?: VectorizeIndex;
  CLIP_EMBEDDING_URL?: string;
  CLIP_EMBEDDING_TOKEN?: string;
  HF_API_TOKEN?: string;
  CLOUDFLARE_R2_ACCESS_KEY?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_R2_PUBLIC_DOMAIN?: string;
  IMAGE_TRANSFORM_ZONE?: string;
  CLERK_JWKS_URL?: string;
  RESEND_SECRET_KEY?: string;
  NEWSLETTER_TOKEN_SECRET?: string;
  SITE_URL?: string;
  API_ORIGIN?: string;
  NEWSLETTER_REPLY_TO?: string;
  NEWSLETTER_ADMIN_SECRET?: string;
};

const CORS_HEADERS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

const JSON_HEADERS: HeadersInit = {
  'content-type': 'application/json; charset=utf-8',
  ...CORS_HEADERS,
};

const SELECT_FIELDS = `metadata_filename, image_filename, resolved_image_filename, image_size_bytes, rotation_degrees, name, description, vlm_caption, date_value, credits, cote, external_url, portal_match, portal_title, portal_description, portal_date, portal_cote, aerial_datasets, latitude, longitude, geocode_confidence, taxonomy_primary_category, taxonomy_themes, taxonomy_search_facets, taxonomy_review_required, taxonomy_exclude_default_visual, image_quality_labels, image_quality_severity, image_quality_action`;

// Lightweight fields for map pins (faster queries)
const MAP_FIELDS = `metadata_filename, name, date_value, latitude, longitude, external_url, resolved_image_filename`;

// --- Cache API helpers ---
// TTLs in seconds
const CACHE_TTL = {
  SHUFFLE: 3600,       // 1 hour — shuffle results are random, any cached set works for discovery
  PAGINATED: 300,      // 5 min — content rarely changes, cursor variants need short TTL
  PHOTO_BY_ID: 86400,  // 24 hours — single photo data is stable
  SEARCH: 600,         // 10 min — deterministic for same query
  MAP: 43200,          // 12 hours — geo data rarely changes
  SITEMAP: 86400,      // 24 hours — only changes on data reload
} as const;

const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_TTL_BUFFER_SECONDS = 60;
const COTE_PATTERN = /^[A-Z]{1,4}[\d-]+/i;
const CACHE_KEY_VERSION = '2026-02-20-orientation-v3';
const NEWSLETTER_FROM_EMAIL = 'MTL Archives <support@support.mtlarchives.com>';
const DEFAULT_SITE_URL = 'https://www.mtlarchives.com';
const DEFAULT_NEWSLETTER_REPLY_TO = 'zouantchaw74@gmail.com';
const NEWSLETTER_CONSENT_VERSION = '2026-03-13-v1';
const NEWSLETTER_DAILY_RUN_JOB = 'daily_newsletter';
const NEWSLETTER_EMAIL_TYPES = {
  DAILY: 'daily',
  WELCOME: 'welcome',
  UNSUBSCRIBE_CONFIRMATION: 'unsubscribe_confirmation',
} as const;

type SearchPolicyOptions = {
  includeExcluded: boolean;
};

type SearchMetadata = {
  primaryCategory: string | null;
  themes: string[];
  searchFacets: string[];
  reviewRequired: boolean;
  excludeFromDefaultVisualSearch: boolean;
  qualityLabels: string[];
  qualitySeverity: string | null;
  qualityAction: string | null;
};

type SearchPolicyAnnotation = {
  excludedFromDefault: boolean;
  demotion: number;
  boost: number;
  reasons: string[];
};

type SearchAwarePhotoRecord = PhotoRecord & {
  searchMetadata?: SearchMetadata;
};

type SearchPolicyAnnotated<T extends PhotoRecord> = T & {
  searchPolicy: SearchPolicyAnnotation;
};

function usesSignedR2Urls(env: Env): boolean {
  return Boolean(
    !env.CLOUDFLARE_R2_PUBLIC_DOMAIN &&
      env.CLOUDFLARE_R2_ACCESS_KEY &&
      env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
      env.CLOUDFLARE_R2_ACCOUNT_ID &&
      env.CLOUDFLARE_R2_BUCKET
  );
}

function clampCacheTtl(env: Env, ttl: number): number {
  if (!usesSignedR2Urls(env)) return ttl;
  const maxTtl = Math.max(0, SIGNED_URL_TTL_SECONDS - SIGNED_URL_TTL_BUFFER_SECONDS);
  return Math.min(ttl, maxTtl);
}

let clerkJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let clerkJwksUrl: string | null = null;

function getClerkJwks(env: Env): ReturnType<typeof createRemoteJWKSet> | null {
  if (!env.CLERK_JWKS_URL) return null;
  if (clerkJwks && clerkJwksUrl === env.CLERK_JWKS_URL) return clerkJwks;
  clerkJwksUrl = env.CLERK_JWKS_URL;
  clerkJwks = createRemoteJWKSet(new URL(env.CLERK_JWKS_URL));
  return clerkJwks;
}

async function getClerkUserId(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwks = getClerkJwks(env);
  if (!jwks) return null;

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

function buildCacheKey(url: URL): Request {
  // Sort query params for stable cache keys regardless of param order
  const sorted = new URLSearchParams([...url.searchParams.entries()].sort());
  // Bump this version when response serialization changes to avoid stale Cache API payloads.
  sorted.set('__cv', CACHE_KEY_VERSION);
  const cacheUrl = new URL(url.pathname, url.origin);
  cacheUrl.search = sorted.toString();
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

async function withCache(
  cacheKey: Request,
  ctx: ExecutionContext,
  ttl: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  // Cache API not available in local dev (wrangler dev)
  if (typeof caches === 'undefined') return handler();

  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await handler();

  // Only cache successful responses
  if (response.status === 200) {
    const toCache = new Response(response.body, response);
    toCache.headers.set('Cache-Control', `public, max-age=${ttl}`);
    toCache.headers.set('X-Cache-TTL', String(ttl));
    ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
    return toCache;
  }

  return response;
}

// Cache manifest total counts keyed by WHERE clause to avoid per-request COUNT(*) scans
const _totalCache = new Map<string, { value: number; expiry: number }>();

async function getCachedTotal(env: Env, whereClause: string): Promise<number> {
  const now = Date.now();
  const entry = _totalCache.get(whereClause);
  if (entry && entry.value > 0 && now < entry.expiry) {
    return entry.value;
  }
  const result = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM manifest WHERE ${whereClause}`
  ).first<{ total: number }>();
  const total = result?.total ?? 0;
  _totalCache.set(whereClause, { value: total, expiry: now + 24 * 60 * 60 * 1000 });
  return total;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/photos') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        const id = url.searchParams.get('id');
        const shuffle = url.searchParams.get('shuffle') === 'true';
        // Skip cache for shuffle — each click should return fresh random results.
        // Offset sampling + cached COUNT already keeps D1 cost low.
        if (shuffle) return handlePhotos(url, env);
        const ttl = clampCacheTtl(env, id ? CACHE_TTL.PHOTO_BY_ID : CACHE_TTL.PAGINATED);
        return withCache(buildCacheKey(url), ctx, ttl, () => handlePhotos(url, env));
      }

      if (url.pathname === '/api/search') {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return methodNotAllowed();
        }
        // Only cache GET search requests (POST may contain embedding body)
        if (request.method === 'GET') {
          return withCache(buildCacheKey(url), ctx, clampCacheTtl(env, CACHE_TTL.SEARCH), () => handleSearch(url, env, request));
        }
        return handleSearch(url, env, request);
      }

      if (url.pathname === '/api/thumb') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        // Thumb already uses cf.cacheEverything — no additional Cache API needed
        return handleThumbnail(url, env);
      }

      if (url.pathname === '/api/map') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return withCache(buildCacheKey(url), ctx, clampCacheTtl(env, CACHE_TTL.MAP), () => handleMapPins(env));
      }

      if (url.pathname === '/api/sitemap') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return withCache(buildCacheKey(url), ctx, clampCacheTtl(env, CACHE_TTL.SITEMAP), () => handleSitemap(env));
      }

      if (url.pathname === '/api/newsletter/subscribe') {
        if (request.method !== 'POST') {
          return methodNotAllowed();
        }
        return handleNewsletterSubscribe(request, env, ctx);
      }

      if (url.pathname === '/api/newsletter/unsubscribe') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handleNewsletterUnsubscribe(request, url, env, ctx);
      }

      if (url.pathname === '/api/newsletter/resubscribe') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handleNewsletterResubscribe(request, url, env, ctx);
      }

      if (url.pathname === '/api/newsletter/admin/run') {
        if (request.method !== 'POST') {
          return methodNotAllowed();
        }
        return handleNewsletterAdminRun(request, env, ctx);
      }

      if (url.pathname === '/api/game/daily') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handleGameDaily(request, env);
      }

      if (url.pathname === '/api/game/guess') {
        if (request.method !== 'POST') {
          return methodNotAllowed();
        }
        return handleGameGuess(request, env);
      }

      if (url.pathname === '/api/game/leaderboard') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handleGameLeaderboard(url, env);
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return jsonResponse({ status: 'ok' });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error', error);
      return jsonResponse({ error: 'Internal Server Error' }, 500);
    }
  },
};

function methodNotAllowed(): Response {
  return jsonResponse({ error: 'Method not allowed' }, 405);
}

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function htmlResponse(html: string, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...extraHeaders,
    },
  });
}

async function buildPhotoRecord(row: Record<string, unknown>, env: Env): Promise<SearchAwarePhotoRecord> {
  const metadataFilename = String(row.metadata_filename);
  const dbRotation = normalizeRotationDegrees(row.rotation_degrees);
  const overrideRotation = getPhotoOrientationOverride(metadataFilename);

  const record: SearchAwarePhotoRecord = {
    metadataFilename,
    imageFilename: String(row.image_filename),
    resolvedImageFilename: String(row.resolved_image_filename ?? row.image_filename ?? ''),
    imageSizeBytes: row.image_size_bytes != null ? Number(row.image_size_bytes) : null,
    rotationDegrees: dbRotation ?? overrideRotation,
    name: normalizeNullableText(row.name),
    description: normalizeNullableText(row.description),
    vlmCaption: normalizeNullableText(row.vlm_caption),
    dateValue: normalizeNullableText(row.date_value),
    credits: normalizeNullableText(row.credits),
    cote: normalizeNullableText(row.cote),
    externalUrl: normalizeNullableUrl(row.external_url),
    portalMatch: Boolean(row.portal_match),
    portalTitle: normalizeNullableText(row.portal_title),
    portalDescription: normalizeNullableText(row.portal_description),
    portalDate: normalizeNullableText(row.portal_date),
    portalCote: normalizeNullableText(row.portal_cote),
    aerialDatasets: parseJsonArray(row.aerial_datasets),
    imageUrl: await resolveImageUrl(String(row.resolved_image_filename ?? row.image_filename ?? ''), env),
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    geocodeConfidence: row.geocode_confidence != null ? Number(row.geocode_confidence) : null,
    searchMetadata: {
      primaryCategory: normalizeNullableText(row.taxonomy_primary_category),
      themes: parseJsonArray(row.taxonomy_themes),
      searchFacets: parseJsonArray(row.taxonomy_search_facets),
      reviewRequired: Boolean(Number(row.taxonomy_review_required ?? 0)),
      excludeFromDefaultVisualSearch: Boolean(Number(row.taxonomy_exclude_default_visual ?? 0)),
      qualityLabels: parseJsonArray(row.image_quality_labels),
      qualitySeverity: normalizeNullableText(row.image_quality_severity),
      qualityAction: normalizeNullableText(row.image_quality_action),
    },
  };

  validateMetadataQuality(record);
  return record;
}



function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch (error) {
    console.warn('Failed to parse aerial_datasets', error);
  }
  return [];
}

function queryIntent(query: string): string[] {
  const normalized = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const intents: string[] = [];
  const add = (intent: string, pattern: RegExp) => {
    if (pattern.test(normalized)) intents.push(intent);
  };
  add('park_green_space', /\b(park|parc|trees?|garden|fountain|fontaine)\b/);
  add('winter', /\b(winter|snow|neige|hiver)\b/);
  add('waterfront', /\b(waterfront|river|fleuve|port|harbou?r|ships?|shore|canal)\b/);
  add('residential', /\b(residential|neighbou?rhood|houses?|homes?|quartier)\b/);
  add('industrial', /\b(industrial|factory|factories|usine|port)\b/);
  add('transit', /\b(transit|tramway|streetcar|metro|station|rail|train)\b/);
  add('construction', /\b(construction|demolition|chantier)\b/);
  add('crowd_event', /\b(children|school|people|playing|event|crowd|enfants?|ecole)\b/);
  return intents;
}

function searchPolicyFor(item: SearchAwarePhotoRecord, query = ''): SearchPolicyAnnotation {
  const metadata = item.searchMetadata;
  const reasons: string[] = [];
  let demotion = 1;
  let boost = 1;

  if (!metadata) {
    return { excludedFromDefault: false, demotion, boost, reasons };
  }

  const qualityAction = metadata.qualityAction ?? '';
  const qualitySeverity = metadata.qualitySeverity ?? '';
  const excludedFromDefault = false;

  if (qualityAction === 'exclude_until_fixed') {
    demotion *= 0.94;
    reasons.push('quality:exclude_until_fixed');
  }
  if (metadata.excludeFromDefaultVisualSearch) reasons.push('taxonomy:exclude_from_default_visual');

  if (qualityAction === 'lower_rank') {
    demotion *= 0.94;
    reasons.push('quality:lower_rank');
  } else if (['review', 'rotate', 'crop_or_mask'].includes(qualityAction)) {
    demotion *= 0.97;
    reasons.push(`quality:${qualityAction}`);
  }

  if (qualitySeverity === 'high') {
    demotion *= 0.97;
    reasons.push('quality:high_severity');
  } else if (qualitySeverity === 'medium') {
    demotion *= 0.99;
    reasons.push('quality:medium_severity');
  }

  if (metadata.reviewRequired && !excludedFromDefault) reasons.push('taxonomy:review_required');

  const intents = queryIntent(query);
  const taxonomyTokens = new Set([
    metadata.primaryCategory ?? '',
    ...metadata.themes,
    ...metadata.searchFacets,
  ]);
  for (const intent of intents) {
    if (
      taxonomyTokens.has(intent) ||
      taxonomyTokens.has(`theme:${intent}`) ||
      taxonomyTokens.has(`primary:aerial_${intent}`) ||
      taxonomyTokens.has(`primary:${intent}`)
    ) {
      boost *= 1.22;
      reasons.push(`taxonomy:intent:${intent}`);
    }
  }

  return { excludedFromDefault, demotion, boost, reasons };
}

function applySearchPolicy<T extends SearchAwarePhotoRecord & { score?: number }>(
  items: T[],
  options: SearchPolicyOptions,
  query = '',
): Array<SearchPolicyAnnotated<T> & { score?: number }> {
  return items
    .map((item) => {
      const policy = searchPolicyFor(item, query);
      return {
        ...item,
        score: item.score != null ? item.score * policy.demotion * policy.boost : item.score,
        searchPolicy: policy,
      };
    })
    .filter((item) => options.includeExcluded || !item.searchPolicy.excludedFromDefault)
    .sort((a, b) => {
      if (a.score == null || b.score == null) return 0;
      return b.score - a.score;
    });
}

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(Math.trunc(parsed), min, max);
}

function parseAllowedValue<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

function normalizeMetadataId(id: string): string {
  return id.replace(/\.json$/i, '');
}

function normalizeMetadataText(value: string): string {
  return value
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNullableText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = normalizeMetadataText(String(value));
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableUrl(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRotationDegrees(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = ((Math.round(parsed / 90) * 90) % 360 + 360) % 360;
  return normalized === 0 ? 0 : normalized;
}

function resolveGameImageUrl(photo: PhotoRecord): string {
  const external = photo.externalUrl ? String(photo.externalUrl).trim() : '';
  if (!external) return photo.imageUrl;

  try {
    const parsed = new URL(external);
    const isDepotHost = parsed.hostname.toLowerCase() === 'depot.ville.montreal.qc.ca';
    const isJpegAsset = /\/phototheque-archives\/jpeg\/[^/?]+\.(jpe?g)$/i.test(parsed.pathname);
    if (isDepotHost && isJpegAsset) {
      parsed.protocol = 'https:';
      return parsed.toString();
    }
  } catch {
    // Ignore malformed external URLs and keep primary image URL.
  }

  return photo.imageUrl;
}

type NewsletterSubscriptionStatus = 'active' | 'unsubscribed';
type NewsletterDeliveryType = typeof NEWSLETTER_EMAIL_TYPES[keyof typeof NEWSLETTER_EMAIL_TYPES];

type NewsletterSubscriptionRow = {
  id: number;
  email: string;
  email_normalized: string;
  clerk_user_id: string | null;
  locale: NewsletterLang;
  status: NewsletterSubscriptionStatus;
  source: string;
  consent_type: string;
  consent_version: string;
  consent_copy: string;
  subscribed_at: string;
  resubscribed_at: string | null;
  unsubscribed_at: string | null;
  welcome_sent_at: string | null;
  unsubscribe_confirmation_sent_at: string | null;
  last_daily_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type NewsletterIssueRow = {
  date_key: string;
  daily_photo_id: string;
  surprise_photo_id: string;
};

type NewsletterIssueContent = {
  dateKey: string;
  runDate: Date;
  dailyPhoto: PhotoRecord;
  surprisePhoto: PhotoRecord;
};

function getNewsletterSiteUrl(env: Env): string {
  const base = (env.SITE_URL || DEFAULT_SITE_URL).trim();
  return base.replace(/\/+$/g, '');
}

function getNewsletterApiOrigin(env: Env): string {
  const base = (env.API_ORIGIN || 'https://mtl-archives-worker.wiel.workers.dev').trim();
  return base.replace(/\/+$/g, '');
}

function getNewsletterReplyTo(env: Env): string {
  return (env.NEWSLETTER_REPLY_TO || DEFAULT_NEWSLETTER_REPLY_TO).trim();
}

function normalizeNewsletterSource(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (normalized) {
    case 'landing':
    case 'game':
    case 'resubscribe':
    case 'admin':
      return normalized;
    default:
      return 'landing';
  }
}

function getNewsletterConsentCopy(lang: NewsletterLang): string {
  return lang === 'fr'
    ? 'Je consens à recevoir chaque jour par courriel le jeu du jour et une photo surprise de MTL Archives. Désabonnement en tout temps.'
    : 'I agree to receive the daily game and a surprise photo from MTL Archives by email every day. Unsubscribe anytime.';
}

function getClientIp(request: Request): string | null {
  const direct = request.headers.get('CF-Connecting-IP');
  if (direct) return direct.trim() || null;

  const forwarded = request.headers.get('X-Forwarded-For');
  if (!forwarded) return null;
  const first = forwarded.split(',')[0]?.trim();
  return first || null;
}

function serializeNewsletterDetails(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isNewsletterAdminAuthorized(request: Request, env: Env): boolean {
  if (!env.NEWSLETTER_ADMIN_SECRET) return false;
  const header = request.headers.get('x-newsletter-admin-secret');
  return Boolean(header && header === env.NEWSLETTER_ADMIN_SECRET);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildNewsletterSiteUrl(
  env: Env,
  pathname: string,
  lang: NewsletterLang,
  params: Record<string, string> = {},
): string {
  const url = new URL(pathname, getNewsletterSiteUrl(env));
  if (lang === 'en') {
    url.searchParams.set('lang', 'en');
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildNewsletterApiUrl(
  env: Env,
  pathname: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(pathname, getNewsletterApiOrigin(env));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function createNewsletterActionUrl(
  env: Env,
  action: 'unsubscribe' | 'resubscribe',
  email: string,
  lang: NewsletterLang,
): Promise<string> {
  if (!env.NEWSLETTER_TOKEN_SECRET) {
    throw new Error('NEWSLETTER_TOKEN_SECRET is not configured');
  }

  const token = await createNewsletterToken({
    action,
    email: normalizeEmail(email),
    lang,
    issuedAt: new Date().toISOString(),
  }, env.NEWSLETTER_TOKEN_SECRET);

  return buildNewsletterApiUrl(env, `/api/newsletter/${action}`, { token });
}

async function getNewsletterSubscriptionByEmail(
  env: Env,
  emailNormalized: string,
): Promise<NewsletterSubscriptionRow | null> {
  return env.DB.prepare(
    `SELECT id, email, email_normalized, clerk_user_id, locale, status, source, consent_type, consent_version,
            consent_copy, subscribed_at, resubscribed_at, unsubscribed_at, welcome_sent_at,
            unsubscribe_confirmation_sent_at, last_daily_sent_at, created_at, updated_at
     FROM newsletter_subscription
     WHERE email_normalized = ?
     LIMIT 1`
  ).bind(emailNormalized).first<NewsletterSubscriptionRow>();
}

async function insertNewsletterEvent(
  env: Env,
  subscriptionId: number | null,
  emailNormalized: string,
  eventType: string,
  source: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  details: unknown,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO newsletter_subscription_event (
      subscription_id, email_normalized, event_type, source, ip_address, user_agent, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    subscriptionId,
    emailNormalized,
    eventType,
    source,
    ipAddress,
    userAgent,
    serializeNewsletterDetails(details),
  ).run();
}

async function isNewsletterRateLimited(env: Env, ipAddress: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as total
     FROM newsletter_subscription_event
     WHERE ip_address = ?
       AND event_type IN ('subscribe', 'resubscribe')
       AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`
  ).bind(ipAddress).first<{ total: number }>();
  return Number(row?.total ?? 0) >= 8;
}

async function fetchManifestRowById(env: Env, photoId: string): Promise<Record<string, unknown> | null> {
  const { results = [] } = await env.DB.prepare(
    `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename = ? LIMIT 1`
  ).bind(photoId).all();
  return results[0] ?? null;
}

function getNewsletterPhotoTitle(photo: PhotoRecord, lang: NewsletterLang): string {
  const name = photo.name?.trim();
  const date = photo.dateValue?.trim();
  if (name && date) return `${name}, ${date}`;
  if (name) return name;
  if (date) return lang === 'fr' ? `Photo surprise, ${date}` : `Surprise photo, ${date}`;
  return lang === 'fr' ? 'Photo surprise' : 'Surprise photo';
}

function getNewsletterPhotoBody(photo: PhotoRecord, lang: NewsletterLang): string {
  const body = photo.description || photo.vlmCaption;
  if (body) return truncateText(body, 120);
  return lang === 'fr'
    ? 'Une image des archives de Montréal choisie pour vous.'
    : 'A Montreal archive image selected for you.';
}

async function getOrCreateNewsletterIssue(
  env: Env,
  dateKey: string,
  runDate: Date,
): Promise<NewsletterIssueContent> {
  const dailyChallenge = await getDailyChallenge(env, dateKey);
  let issue = await env.DB.prepare(
    'SELECT date_key, daily_photo_id, surprise_photo_id FROM newsletter_issue WHERE date_key = ? LIMIT 1'
  ).bind(dateKey).first<NewsletterIssueRow>();

  if (!issue) {
    const surpriseRow = await getRandomGeotaggedPhoto(env, [dailyChallenge.photoId]);
    if (!surpriseRow) {
      throw new Error('No surprise photo available for newsletter issue');
    }

    await env.DB.prepare(
      'INSERT OR IGNORE INTO newsletter_issue (date_key, daily_photo_id, surprise_photo_id) VALUES (?, ?, ?)'
    ).bind(dateKey, dailyChallenge.photoId, String(surpriseRow.metadata_filename)).run();

    issue = await env.DB.prepare(
      'SELECT date_key, daily_photo_id, surprise_photo_id FROM newsletter_issue WHERE date_key = ? LIMIT 1'
    ).bind(dateKey).first<NewsletterIssueRow>();
  }

  if (!issue) {
    throw new Error(`Failed to resolve newsletter issue for ${dateKey}`);
  }

  const dailyRow = await fetchManifestRowById(env, issue.daily_photo_id);
  const surpriseRow = await fetchManifestRowById(env, issue.surprise_photo_id);
  if (!dailyRow || !surpriseRow) {
    throw new Error(`Missing manifest row for newsletter issue ${dateKey}`);
  }

  const dailyPhoto = await buildPhotoRecord(dailyRow, env);
  dailyPhoto.imageUrl = resolveGameImageUrl(dailyPhoto);
  const surprisePhoto = await buildPhotoRecord(surpriseRow, env);

  return {
    dateKey,
    runDate,
    dailyPhoto,
    surprisePhoto,
  };
}

async function hasSuccessfulNewsletterDelivery(
  env: Env,
  subscriptionId: number,
  issueDateKey: string,
  emailType: NewsletterDeliveryType,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id
     FROM newsletter_delivery
     WHERE subscription_id = ? AND issue_date_key = ? AND email_type = ? AND status = 'sent'
     LIMIT 1`
  ).bind(subscriptionId, issueDateKey, emailType).first<{ id: number }>();
  return Boolean(row?.id);
}

async function recordNewsletterDelivery(
  env: Env,
  subscriptionId: number,
  issueDateKey: string | null,
  emailType: NewsletterDeliveryType,
  status: 'sent' | 'failed',
  resendEmailId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO newsletter_delivery (
      subscription_id, issue_date_key, email_type, resend_email_id, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(subscriptionId, issueDateKey, emailType, resendEmailId, status, errorMessage).run();
}

async function sendResendEmail(
  env: Env,
  payload: {
    to: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<string> {
  if (!env.RESEND_SECRET_KEY) {
    throw new Error('RESEND_SECRET_KEY is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NEWSLETTER_FROM_EMAIL,
      reply_to: getNewsletterReplyTo(env),
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });

  const json = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message || `Resend send failed with ${response.status}`);
  }
  return json.id;
}

async function sendWelcomeNewsletterEmail(
  env: Env,
  subscription: NewsletterSubscriptionRow,
  source: string,
): Promise<void> {
  const lang = normalizeNewsletterLang(subscription.locale);
  const unsubscribeUrl = await createNewsletterActionUrl(env, 'unsubscribe', subscription.email_normalized, lang);
  const playUrl = buildNewsletterSiteUrl(env, '/game', lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'newsletter_welcome',
  });
  const archiveUrl = buildNewsletterSiteUrl(env, '/', lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'newsletter_welcome',
  });
  const { html, text } = renderWelcomeEmail({
    lang,
    archiveUrl,
    playUrl,
    unsubscribeUrl,
  });

  try {
    const resendId = await sendResendEmail(env, {
      to: subscription.email,
      subject: getWelcomeEmailSubject(lang),
      html,
      text,
    });

    await recordNewsletterDelivery(env, subscription.id, null, NEWSLETTER_EMAIL_TYPES.WELCOME, 'sent', resendId, null);
    await env.DB.prepare(
      'UPDATE newsletter_subscription SET welcome_sent_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'), updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?'
    ).bind(subscription.id).run();
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'welcome_send', source, null, null, { resendId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Welcome email failed';
    await recordNewsletterDelivery(env, subscription.id, null, NEWSLETTER_EMAIL_TYPES.WELCOME, 'failed', null, message);
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'welcome_send_failed', source, null, null, { error: message });
    throw error;
  }
}

async function sendUnsubscribeConfirmationEmail(
  env: Env,
  subscription: NewsletterSubscriptionRow,
  lang: NewsletterLang,
  source: string,
): Promise<void> {
  const archiveUrl = buildNewsletterSiteUrl(env, '/', lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'newsletter_unsubscribed',
  });
  const resubscribeUrl = await createNewsletterActionUrl(env, 'resubscribe', subscription.email_normalized, lang);
  const { html, text } = renderUnsubscribeConfirmationEmail({
    lang,
    archiveUrl,
    resubscribeUrl,
  });

  try {
    const resendId = await sendResendEmail(env, {
      to: subscription.email,
      subject: getUnsubscribeConfirmationSubject(lang),
      html,
      text,
    });
    await recordNewsletterDelivery(env, subscription.id, null, NEWSLETTER_EMAIL_TYPES.UNSUBSCRIBE_CONFIRMATION, 'sent', resendId, null);
    await env.DB.prepare(
      'UPDATE newsletter_subscription SET unsubscribe_confirmation_sent_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'), updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?'
    ).bind(subscription.id).run();
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'unsubscribe_confirmation_send', source, null, null, { resendId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unsubscribe confirmation email failed';
    await recordNewsletterDelivery(env, subscription.id, null, NEWSLETTER_EMAIL_TYPES.UNSUBSCRIBE_CONFIRMATION, 'failed', null, message);
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'unsubscribe_confirmation_send_failed', source, null, null, { error: message });
    throw error;
  }
}

async function sendDailyNewsletterIssue(
  env: Env,
  issue: NewsletterIssueContent,
  subscription: NewsletterSubscriptionRow,
  source: NewsletterRunSource,
): Promise<void> {
  const lang = normalizeNewsletterLang(subscription.locale);
  const unsubscribeUrl = await createNewsletterActionUrl(env, 'unsubscribe', subscription.email_normalized, lang);
  const archiveUrl = buildNewsletterSiteUrl(env, '/', lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'daily_newsletter',
  });
  const playUrl = buildNewsletterSiteUrl(env, '/game', lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'daily_newsletter',
  });
  const surpriseUrl = buildNewsletterSiteUrl(
    env,
    `/photo/${encodeURIComponent(normalizeMetadataId(issue.surprisePhoto.metadataFilename))}`,
    lang,
    {
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'daily_newsletter',
    },
  );
  const subjectDate = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Toronto',
  }).format(issue.runDate);
  const { html, text } = renderDailyNewsletterEmail({
    lang,
    archiveUrl,
    dateLabel: formatNewsletterDateLabel(lang, issue.runDate),
    dailyBody: lang === 'fr'
      ? 'Placez votre repère sur la carte. Plus vous êtes près, plus vous marquez de points.'
      : 'Place your pin on the map. The closer you are, the more points you score.',
    dailyImageUrl: issue.dailyPhoto.imageUrl,
    playUrl,
    surpriseBody: getNewsletterPhotoBody(issue.surprisePhoto, lang),
    surpriseImageUrl: issue.surprisePhoto.imageUrl,
    surpriseTitle: getNewsletterPhotoTitle(issue.surprisePhoto, lang),
    surpriseUrl,
    unsubscribeUrl,
  });

  try {
    const resendId = await sendResendEmail(env, {
      to: subscription.email,
      subject: getDailyNewsletterSubject(lang, subjectDate),
      html,
      text,
    });
    await recordNewsletterDelivery(env, subscription.id, issue.dateKey, NEWSLETTER_EMAIL_TYPES.DAILY, 'sent', resendId, null);
    await env.DB.prepare(
      'UPDATE newsletter_subscription SET last_daily_sent_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\'), updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?'
    ).bind(subscription.id).run();
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'daily_send', source, null, null, {
      dateKey: issue.dateKey,
      resendId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Daily newsletter send failed';
    await recordNewsletterDelivery(env, subscription.id, issue.dateKey, NEWSLETTER_EMAIL_TYPES.DAILY, 'failed', null, message);
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'daily_send_failed', source, null, null, {
      dateKey: issue.dateKey,
      error: message,
    });
    throw error;
  }
}

async function runDailyNewsletter(
  env: Env,
  _ctx: ExecutionContext,
  {
    dateKey,
    runDate,
    source,
  }: {
    dateKey: string;
    runDate: Date;
    source: NewsletterRunSource;
  },
): Promise<NewsletterRunSummary> {
  if (!env.RESEND_SECRET_KEY) {
    throw new Error('RESEND_SECRET_KEY is not configured');
  }
  if (!env.NEWSLETTER_TOKEN_SECRET) {
    throw new Error('NEWSLETTER_TOKEN_SECRET is not configured');
  }

  const lock = await acquireNewsletterRun(env.DB, {
    jobName: NEWSLETTER_DAILY_RUN_JOB,
    dateKey,
    source,
  });
  if (!lock.acquired) {
    return {
      ...lock.summary,
      source,
    };
  }

  try {
    const issue = await getOrCreateNewsletterIssue(env, dateKey, runDate);
    const { results = [] } = await env.DB.prepare(
      `SELECT id, email, email_normalized, clerk_user_id, locale, status, source, consent_type, consent_version,
              consent_copy, subscribed_at, resubscribed_at, unsubscribed_at, welcome_sent_at,
              unsubscribe_confirmation_sent_at, last_daily_sent_at, created_at, updated_at
       FROM newsletter_subscription
       WHERE status = 'active'
       ORDER BY id ASC`
    ).all<NewsletterSubscriptionRow>();
    const subscriptions = results as NewsletterSubscriptionRow[];
    const summary: NewsletterRunSummary = {
      dateKey,
      source,
      runState: 'completed',
      totalActive: subscriptions.length,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    const concurrency = 4;
    for (let index = 0; index < subscriptions.length; index += concurrency) {
      const chunk = subscriptions.slice(index, index + concurrency);
      const settled = await Promise.allSettled(chunk.map(async (subscription) => {
        const alreadySent = await hasSuccessfulNewsletterDelivery(env, subscription.id, issue.dateKey, NEWSLETTER_EMAIL_TYPES.DAILY);
        if (alreadySent) {
          summary.skipped += 1;
          return;
        }

        await sendDailyNewsletterIssue(env, issue, subscription, source);
        summary.sent += 1;
      }));

      for (const result of settled) {
        if (result.status === 'rejected') {
          summary.failed += 1;
          console.error('Newsletter send failed', result.reason);
        }
      }
    }

    await completeNewsletterRun(env.DB, {
      jobName: NEWSLETTER_DAILY_RUN_JOB,
      summary,
    });

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Daily newsletter run failed';
    await failNewsletterRun(env.DB, {
      jobName: NEWSLETTER_DAILY_RUN_JOB,
      dateKey,
      source,
      message,
    });
    throw error;
  }
}

function renderNewsletterErrorPage(lang: NewsletterLang, archiveUrl: string): Response {
  const title = lang === 'fr' ? 'Lien invalide.' : 'Invalid link.';
  const body = lang === 'fr'
    ? 'Ce lien n’est plus valide. Retournez aux archives pour gérer votre inscription.'
    : 'This link is no longer valid. Return to the archive to manage your subscription.';
  const cta = lang === 'fr' ? 'Retour aux archives' : 'Back to the archive';
  return htmlResponse(renderNewsletterStatusPage({
    lang,
    archiveUrl,
    ctaStyle: 'outline',
    ctaLabel: cta,
    ctaUrl: archiveUrl,
    body,
    title,
  }), 400);
}

async function handleNewsletterSubscribe(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const honeypot = typeof payload.company === 'string'
    ? payload.company
    : typeof payload.website === 'string'
      ? payload.website
      : '';
  if (honeypot.trim()) {
    return jsonResponse({ success: true, status: 'accepted' }, 202);
  }

  const rawEmail = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!isValidEmail(rawEmail)) {
    return jsonResponse({ success: false, error: 'Invalid email address' }, 400);
  }

  const lang = normalizeNewsletterLang(payload.lang);
  const source = normalizeNewsletterSource(payload.source);
  const email = rawEmail;
  const emailNormalized = normalizeEmail(rawEmail);
  const ipAddress = getClientIp(request);
  const userAgent = request.headers.get('user-agent');
  const clerkUserId = await getClerkUserId(request, env);

  if (ipAddress && await isNewsletterRateLimited(env, ipAddress)) {
    await insertNewsletterEvent(env, null, emailNormalized, 'rate_limited', source, ipAddress, userAgent, {
      lang,
      reason: 'too_many_recent_subscribe_events',
    });
    return jsonResponse({ success: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  const consentCopy = getNewsletterConsentCopy(lang);
  const existing = await getNewsletterSubscriptionByEmail(env, emailNormalized);
  let status: 'subscribed' | 'already_subscribed' | 'resubscribed' = 'subscribed';

  if (existing) {
    status = existing.status === 'active' ? 'already_subscribed' : 'resubscribed';
    await env.DB.prepare(
      `UPDATE newsletter_subscription
       SET email = ?,
           clerk_user_id = COALESCE(?, clerk_user_id),
           locale = ?,
           status = 'active',
           source = ?,
           consent_type = 'express',
           consent_version = ?,
           consent_copy = ?,
           subscribed_at = CASE WHEN status = 'unsubscribed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE subscribed_at END,
           resubscribed_at = CASE WHEN status = 'unsubscribed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE resubscribed_at END,
           unsubscribed_at = CASE WHEN status = 'unsubscribed' THEN NULL ELSE unsubscribed_at END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).bind(
      email,
      clerkUserId,
      lang,
      source,
      NEWSLETTER_CONSENT_VERSION,
      consentCopy,
      existing.id,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO newsletter_subscription (
        email, email_normalized, clerk_user_id, locale, status, source, consent_type, consent_version, consent_copy
      ) VALUES (?, ?, ?, ?, 'active', ?, 'express', ?, ?)`
    ).bind(
      email,
      emailNormalized,
      clerkUserId,
      lang,
      source,
      NEWSLETTER_CONSENT_VERSION,
      consentCopy,
    ).run();
  }

  const subscription = await getNewsletterSubscriptionByEmail(env, emailNormalized);
  if (!subscription) {
    return jsonResponse({ success: false, error: 'Failed to save subscription' }, 500);
  }

  await insertNewsletterEvent(
    env,
    subscription.id,
    emailNormalized,
    status === 'resubscribed' ? 'resubscribe' : status === 'already_subscribed' ? 'already_subscribed' : 'subscribe',
    source,
    ipAddress,
    userAgent,
    {
      lang,
      clerkUserId,
      referer: request.headers.get('referer'),
    },
  );

  if (status !== 'already_subscribed' || !subscription.welcome_sent_at) {
    ctx.waitUntil(sendWelcomeNewsletterEmail(env, subscription, source).catch((error) => {
      console.error('Failed to send welcome email', error);
    }));
  }

  return jsonResponse({
    success: true,
    status,
    message: status === 'already_subscribed'
      ? (lang === 'fr' ? 'Vous êtes déjà inscrit.' : 'You are already subscribed.')
      : (lang === 'fr' ? 'Inscription confirmée.' : 'Subscription confirmed.'),
  });
}

async function handleNewsletterUnsubscribe(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const lang = normalizeNewsletterLang(url.searchParams.get('lang'));
  const archiveUrl = buildNewsletterSiteUrl(env, '/', lang);
  const token = url.searchParams.get('token');
  if (!token || !env.NEWSLETTER_TOKEN_SECRET) {
    return renderNewsletterErrorPage(lang, archiveUrl);
  }

  const payload = await verifyNewsletterToken(token, env.NEWSLETTER_TOKEN_SECRET);
  if (!payload || payload.action !== 'unsubscribe') {
    return renderNewsletterErrorPage(lang, archiveUrl);
  }

  const subscription = await getNewsletterSubscriptionByEmail(env, payload.email);
  if (subscription && subscription.status !== 'unsubscribed') {
    await env.DB.prepare(
      `UPDATE newsletter_subscription
       SET status = 'unsubscribed',
           unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).bind(subscription.id).run();
    await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'unsubscribe', 'email_link', getClientIp(request), request.headers.get('user-agent'), {
      lang: payload.lang,
    });

    ctx.waitUntil(sendUnsubscribeConfirmationEmail(env, subscription, payload.lang, 'email_link').catch((error) => {
      console.error('Failed to send unsubscribe confirmation email', error);
    }));
  }

  const resubscribeUrl = await createNewsletterActionUrl(env, 'resubscribe', payload.email, payload.lang);
  const title = payload.lang === 'fr' ? 'À bientôt.' : 'See you soon.';
  const body = payload.lang === 'fr'
    ? 'Vous ne recevrez plus nos courriels quotidiens. Les archives de Montréal restent accessibles quand vous le souhaitez.'
    : 'You will no longer receive our daily emails. The Montreal archives remain here whenever you want to explore them.';
  const cta = payload.lang === 'fr' ? 'Se réabonner' : 'Subscribe again';

  return htmlResponse(renderNewsletterStatusPage({
    lang: payload.lang,
    archiveUrl,
    ctaStyle: 'outline',
    ctaLabel: cta,
    ctaUrl: resubscribeUrl,
    body,
    title,
  }));
}

async function handleNewsletterResubscribe(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const lang = normalizeNewsletterLang(url.searchParams.get('lang'));
  const archiveUrl = buildNewsletterSiteUrl(env, '/', lang);
  const token = url.searchParams.get('token');
  if (!token || !env.NEWSLETTER_TOKEN_SECRET) {
    return renderNewsletterErrorPage(lang, archiveUrl);
  }

  const payload = await verifyNewsletterToken(token, env.NEWSLETTER_TOKEN_SECRET);
  if (!payload || payload.action !== 'resubscribe') {
    return renderNewsletterErrorPage(lang, archiveUrl);
  }

  const consentCopy = getNewsletterConsentCopy(payload.lang);
  const existing = await getNewsletterSubscriptionByEmail(env, payload.email);
  if (existing) {
    await env.DB.prepare(
      `UPDATE newsletter_subscription
       SET status = 'active',
           locale = ?,
           source = 'resubscribe',
           consent_type = 'express',
           consent_version = ?,
           consent_copy = ?,
           subscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           resubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           unsubscribed_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).bind(payload.lang, NEWSLETTER_CONSENT_VERSION, consentCopy, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO newsletter_subscription (
        email, email_normalized, locale, status, source, consent_type, consent_version, consent_copy
      ) VALUES (?, ?, ?, 'active', 'resubscribe', 'express', ?, ?)`
    ).bind(payload.email, normalizeEmail(payload.email), payload.lang, NEWSLETTER_CONSENT_VERSION, consentCopy).run();
  }

  const subscription = await getNewsletterSubscriptionByEmail(env, payload.email);
  if (!subscription) {
    return renderNewsletterErrorPage(payload.lang, archiveUrl);
  }

  await insertNewsletterEvent(env, subscription.id, subscription.email_normalized, 'resubscribe', 'email_link', getClientIp(request), request.headers.get('user-agent'), {
    lang: payload.lang,
  });

  ctx.waitUntil(sendWelcomeNewsletterEmail(env, subscription, 'resubscribe').catch((error) => {
    console.error('Failed to send welcome email after resubscribe', error);
  }));

  const title = payload.lang === 'fr' ? 'Bienvenue de nouveau.' : 'Welcome back.';
  const body = payload.lang === 'fr'
    ? 'Vous recevrez de nouveau le jeu du jour et une photo surprise chaque matin.'
    : 'You will once again receive the daily game and a surprise photo every morning.';
  const ctaLabel = payload.lang === 'fr' ? "Jouer au jeu d'aujourd'hui" : "Play today's game";
  const playUrl = buildNewsletterSiteUrl(env, '/game', payload.lang, {
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: 'newsletter_resubscribe',
  });

  return htmlResponse(renderNewsletterStatusPage({
    lang: payload.lang,
    archiveUrl,
    ctaStyle: 'filled',
    ctaLabel,
    ctaUrl: playUrl,
    body,
    title,
  }));
}

async function handleNewsletterAdminRun(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isNewsletterAdminAuthorized(request, env)) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  const requestedDateKey = typeof payload.dateKey === 'string' && payload.dateKey.trim()
    ? payload.dateKey.trim()
    : getTorontoDateKey();
  const requestedSource: NewsletterRunSource = payload.source === 'vercel_cron' ? 'vercel_cron' : 'admin';
  const summary = await runDailyNewsletter(env, ctx, {
    dateKey: requestedDateKey,
    runDate: new Date(),
    source: requestedSource,
  });

  return jsonResponse({ success: true, summary });
}

async function handlePhotos(url: URL, env: Env): Promise<Response> {
  // Support fetching a single photo by ID
  const id = url.searchParams.get('id');
  if (id) {
    const normalizedId = normalizeMetadataId(id);
    const candidates = Array.from(new Set([normalizedId, `${normalizedId}.json`]));
    const placeholders = candidates.map(() => '?').join(',');
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})`
    ).bind(...candidates).all();

    if (results.length === 0) {
      return jsonResponse({ items: [], error: 'Photo not found' }, 404);
    }

    const items = await Promise.all(results.map((row) => buildPhotoRecord(row, env)));
    return jsonResponse({ items });
  }

  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = clamp(Number.isFinite(limitParam) ? limitParam : 50, 1, 100);
  const cursor = url.searchParams.get('cursor');
  const shuffle = url.searchParams.get('shuffle') === 'true';
  const sort = (url.searchParams.get('sort') ?? '').trim().toLowerCase();
  // maxSize in bytes - default 1.5MB for mobile-friendly images
  const maxSizeParam = Number(url.searchParams.get('maxSize') ?? '0');
  const maxSize = Number.isFinite(maxSizeParam) && maxSizeParam > 0 ? maxSizeParam : 0;
  // minTrust: filter for records with trust_score >= threshold (0–1)
  const minTrustParam = Number(url.searchParams.get('minTrust') ?? '0');
  const minTrust = Number.isFinite(minTrustParam) && minTrustParam > 0 ? minTrustParam : 0;

  // Base query: filter out records without valid images
  // Cap at 20MB — larger aerials exceed Vercel Image Optimization source limit
  const baseWhere = `resolved_image_filename IS NOT NULL
    AND resolved_image_filename != ''
    AND (name IS NOT NULL OR portal_title IS NOT NULL)
    AND (image_size_bytes IS NULL OR image_size_bytes <= 20000000)`;

  // Shuffle mode: return random photos for discovery
  // Uses random OFFSET instead of ORDER BY RANDOM() to avoid full table scan.
  // COUNT(*) is cached separately (24h TTL) to avoid per-request scans.
  if (shuffle) {
    const sizeFilter = maxSize > 0 ? `AND image_size_bytes <= ${maxSize}` : '';
    const trustFilter = minTrust > 0 ? `AND trust_score >= ${minTrust}` : '';
    const whereClause = `${baseWhere} ${sizeFilter} ${trustFilter}`;

    // Cached count for offset calculation (avoids per-request COUNT(*) scan)
    const filteredTotal = await getCachedTotal(env, whereClause);

    // Random offset sampling — pick a random starting point within filtered set
    const maxOffset = Math.max(0, filteredTotal - limit);
    const offset = maxOffset > 0 ? Math.floor(Math.random() * maxOffset) : 0;

    const sql = `SELECT ${SELECT_FIELDS} FROM manifest
      WHERE ${whereClause}
      ORDER BY metadata_filename
      LIMIT ? OFFSET ?`;
    const { results = [] } = await env.DB.prepare(sql).bind(limit, offset).all();
    const items = await Promise.all(results.map((row) => buildPhotoRecord(row, env)));

    return jsonResponse({ items, shuffle: true });
  }

  // Regular paginated mode
  const sizeFilter = maxSize > 0 ? ` AND image_size_bytes <= ${maxSize}` : '';
  const trustFilter = minTrust > 0 ? ` AND trust_score >= ${minTrust}` : '';
  let sql = `SELECT ${SELECT_FIELDS} FROM manifest WHERE ${baseWhere}${sizeFilter}${trustFilter}`;
  const params: unknown[] = [];

  if (cursor && sort !== 'print_best') {
    sql += ' AND metadata_filename > ?';
    params.push(cursor);
  }

  if (sort === 'print_best') {
    sql += ` ORDER BY
      portal_match DESC,
      COALESCE(trust_score, 0) DESC,
      CASE
        WHEN description IS NOT NULL AND LENGTH(TRIM(description)) >= 120 THEN 3
        WHEN portal_description IS NOT NULL AND LENGTH(TRIM(portal_description)) >= 120 THEN 2
        WHEN vlm_caption IS NOT NULL AND LENGTH(TRIM(vlm_caption)) >= 120 THEN 1
        ELSE 0
      END DESC,
      CASE WHEN date_value IS NOT NULL OR portal_date IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN credits IS NOT NULL AND TRIM(credits) != '' THEN 1 ELSE 0 END DESC,
      COALESCE(name, portal_title),
      metadata_filename
      LIMIT ?`;
    params.push(limit);
  } else {
    // Order by portal_match DESC (verified photos first), then name for variety
    sql += ' ORDER BY portal_match DESC, COALESCE(name, portal_title), metadata_filename LIMIT ?';
    params.push(limit + 1);
  }

  const { results = [] } = await env.DB.prepare(sql).bind(...params).all();

  const rows = sort === 'print_best' ? results : results.slice(0, limit);
  const items = await Promise.all(rows.map((row) => buildPhotoRecord(row, env)));
  const nextCursor =
    sort === 'print_best'
      ? null
      : results.length > limit
        ? String(results[limit].metadata_filename)
        : null;

  return jsonResponse({ items, nextCursor });
}

async function handleSearch(url: URL, env: Env, request: Request): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return jsonResponse({ error: 'Missing required query parameter "q".' }, 400);
  }

  const mode = (url.searchParams.get('mode') ?? 'smart').toLowerCase();
  const limitParam = Number(url.searchParams.get('limit') ?? '25');
  const limit = clamp(Number.isFinite(limitParam) ? limitParam : 25, 1, 100);
  const maxSizeParam = Number(url.searchParams.get('maxSize') ?? '0');
  const maxSize = Number.isFinite(maxSizeParam) && maxSizeParam > 0 ? maxSizeParam : 0;
  const searchPolicy: SearchPolicyOptions = {
    includeExcluded: url.searchParams.get('includeExcluded') === 'true',
  };

  // Smart mode: combine visual + semantic for best results
  if (mode === 'smart') {
    return handleSmartSearch(q, limit, env, maxSize, searchPolicy);
  }

  if (mode === 'semantic') {
    return handleSemanticSearch(q, limit, env, maxSize, searchPolicy);
  }

  if (mode === 'visual' || mode === 'clip') {
    // For visual search, check if embedding is provided in POST body
    let embedding: number[] | undefined;
    if (request.method === 'POST') {
      try {
        const body = await request.json() as { embedding?: number[] };
        if (body.embedding && Array.isArray(body.embedding)) {
          embedding = body.embedding;
        }
      } catch {
        // Ignore JSON parse errors, will try to generate embedding
      }
    }
    return handleVisualSearch(q, limit, env, embedding, maxSize, searchPolicy);
  }

  // Text mode: redirect to semantic search to avoid full table scans (LIKE on 4 columns).
  // Fast-path: if query looks like a cote/reference (e.g. "VM94-A0123-045"), do exact PK lookup.
  if (COTE_PATTERN.test(q)) {
    const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
    const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest
       WHERE (cote = ? OR portal_cote = ? OR metadata_filename = ? OR metadata_filename = ?)
       ${maxSizeSqlFilter}
       LIMIT ?`
    ).bind(q, q, q, `${q}.json`, ...maxSizeSqlParams, limit).all();
    if (results.length > 0) {
      const items = await Promise.all(results.map((row) => buildPhotoRecord(row, env)));
      return jsonResponse({ items, mode: 'text' });
    }
  }
  // Fall through to semantic search for all other text queries
  return handleSemanticSearch(q, limit, env, maxSize, searchPolicy);
}

async function handleThumbnail(url: URL, env: Env): Promise<Response> {
  const src = (url.searchParams.get('src') ?? '').trim();
  if (!src) {
    return jsonResponse({ error: 'Missing required query parameter "src".' }, 400);
  }

  let srcUrl: URL;
  try {
    srcUrl = new URL(src);
  } catch {
    return jsonResponse({ error: 'Invalid "src" URL.' }, 400);
  }

  if (srcUrl.protocol !== 'https:' && srcUrl.protocol !== 'http:') {
    return jsonResponse({ error: 'Invalid "src" protocol.' }, 400);
  }

  const isR2DevHost = srcUrl.hostname.endsWith('.r2.dev');
  const isPublicHost = (env.CLOUDFLARE_R2_PUBLIC_DOMAIN && srcUrl.host === env.CLOUDFLARE_R2_PUBLIC_DOMAIN) || isR2DevHost;
  const isSignedHost = Boolean(
    env.CLOUDFLARE_R2_ACCOUNT_ID && srcUrl.host === `${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  );

  if (!isPublicHost && !isSignedHost) {
    return jsonResponse({ error: 'Forbidden "src" host.' }, 403);
  }

  if (isPublicHost) {
    srcUrl.search = '';
  }
  srcUrl.hash = '';

  const width = clampInt(url.searchParams.get('w') ?? url.searchParams.get('width'), 320, 1, 1024);
  const height = clampInt(url.searchParams.get('h') ?? url.searchParams.get('height'), 160, 1, 1024);
  const quality = clampInt(url.searchParams.get('q') ?? url.searchParams.get('quality'), 70, 1, 100);
  const fit = parseAllowedValue(url.searchParams.get('fit'), ['cover', 'contain', 'scale-down'] as const, 'cover');
  const requestedFormat = parseAllowedValue(
    url.searchParams.get('format'),
    ['auto', 'webp', 'avif', 'jpeg', 'png'] as const,
    'auto'
  );

  let originResponse: Response;

  // Use /cdn-cgi/image/ transform URL if IMAGE_TRANSFORM_ZONE is configured
  if (env.IMAGE_TRANSFORM_ZONE) {
    const formatOption = requestedFormat === 'auto' ? 'format=auto' : `format=${requestedFormat}`;
    const transformOptions = `width=${width},height=${height},quality=${quality},fit=${fit},${formatOption}`;
    const transformUrl = `https://${env.IMAGE_TRANSFORM_ZONE}/cdn-cgi/image/${transformOptions}/${srcUrl.toString()}`;

    originResponse = await fetch(transformUrl, {
      cf: {
        cacheEverything: true,
        cacheTtl: 60 * 60 * 24,
      },
    });
  } else {
    // Fallback to cf.image (only works on zones with Image Resizing enabled)
    const format = requestedFormat === 'auto' ? undefined : requestedFormat;
    originResponse = await fetch(srcUrl.toString(), {
      cf: {
        cacheEverything: true,
        cacheTtl: 60 * 60 * 24,
        image: {
          width,
          height,
          fit,
          quality,
          format,
        },
      },
    });
  }

  if (!originResponse.ok) {
    return jsonResponse({ error: 'Failed to fetch thumbnail source.' }, 502);
  }

  const headers = new Headers(originResponse.headers);
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('timing-allow-origin', '*');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type');
  headers.delete('set-cookie');

  return new Response(originResponse.body, {
    status: originResponse.status,
    headers,
  });
}

function escapeForLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

// Smart search: combines visual (CLIP) + semantic (BGE) for best results
async function handleSmartSearch(query: string, limit: number, env: Env, maxSize = 0, searchPolicy: SearchPolicyOptions = { includeExcluded: false }): Promise<Response> {
  const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
  const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
  if (COTE_PATTERN.test(query)) {
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest
       WHERE (cote = ? OR portal_cote = ? OR metadata_filename = ? OR metadata_filename = ?)
       ${maxSizeSqlFilter}
       LIMIT ?`
    ).bind(query, query, query, `${query}.json`, ...maxSizeSqlParams, limit).all();
    if (results.length > 0) {
      const items = await Promise.all(results.map((row) => buildPhotoRecord(row, env)));
      return jsonResponse({ items, mode: 'smart', count: items.length });
    }
  }

  // Run visual and semantic searches in parallel
  const [visualResult, semanticResult] = await Promise.allSettled([
    getVisualResults(query, limit, env, maxSize, searchPolicy),
    getSemanticResults(query, limit, env, maxSize, searchPolicy),
  ]);

  type ScoredPhoto = SearchAwarePhotoRecord & { score?: number; source?: string; searchPolicy?: SearchPolicyAnnotation };
  const visualItems = visualResult.status === 'fulfilled' ? visualResult.value : null;
  const semanticItems = semanticResult.status === 'fulfilled' ? semanticResult.value : null;

  if (!visualItems && !semanticItems) {
    return jsonResponse({ items: [], mode: 'smart', count: 0 });
  }

  if (visualItems && !semanticItems) {
    const items = visualItems.slice(0, limit).map((item) => ({ ...item, source: 'visual' }));
    return jsonResponse({ items, mode: 'smart', count: items.length });
  }

  if (semanticItems && !visualItems) {
    const items = semanticItems.slice(0, limit).map((item) => ({ ...item, source: 'semantic' }));
    return jsonResponse({ items, mode: 'smart', count: items.length });
  }

  const k = 60;
  const scored = new Map<string, { item: ScoredPhoto; score: number; sources: Set<string>; ranks: { visual?: number; semantic?: number } }>();

  const applyRrf = (items: (SearchAwarePhotoRecord & { score?: number })[], source: 'visual' | 'semantic') => {
    items.forEach((item, index) => {
      const id = item.metadataFilename;
      const rank = index + 1;
      const policy = searchPolicyFor(item, query);
      if (!searchPolicy.includeExcluded && policy.excludedFromDefault) return;
      const increment = (1 / (k + rank)) * policy.demotion * policy.boost;
      const existing = scored.get(id);
      if (existing) {
        existing.score += increment;
        existing.sources.add(source);
        existing.ranks[source] = rank;
        return;
      }
      scored.set(id, {
        item: { ...item, searchPolicy: policy },
        score: increment,
        sources: new Set([source]),
        ranks: { [source]: rank },
      });
    });
  };

  applyRrf(visualItems!, 'visual');
  applyRrf(semanticItems!, 'semantic');

  const merged = Array.from(scored.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aSemantic = a.ranks.semantic ?? Number.POSITIVE_INFINITY;
      const bSemantic = b.ranks.semantic ?? Number.POSITIVE_INFINITY;
      if (aSemantic !== bSemantic) return aSemantic - bSemantic;
      const aVisual = a.ranks.visual ?? Number.POSITIVE_INFINITY;
      const bVisual = b.ranks.visual ?? Number.POSITIVE_INFINITY;
      return aVisual - bVisual;
    })
    .map((entry) => ({
      ...entry.item,
      source: entry.sources.size > 1 ? 'both' : entry.sources.has('visual') ? 'visual' : 'semantic',
    }));

  return jsonResponse({
    items: merged.slice(0, limit),
    mode: 'smart',
    count: Math.min(merged.length, limit),
  });
}

// Helper: get visual search results without Response wrapper
// Note: Vectorize topK is capped at 50
async function getVisualResults(query: string, limit: number, env: Env, maxSize = 0, searchPolicy: SearchPolicyOptions = { includeExcluded: false }): Promise<(PhotoRecord & { score?: number })[] | null> {
  if (!env.VECTORIZE_CLIP || !env.CLIP_EMBEDDING_URL) return null;

  try {
    const embedding = await generateClipTextEmbedding(query, env);
    if (!embedding || embedding.length !== 512) return null;

    const vectorResults = await env.VECTORIZE_CLIP.query(embedding, {
      topK: Math.min(limit, 50),
      returnMetadata: true,
      returnValues: false,
    });

    if (!vectorResults.matches?.length) return null;

    const metadataFilenames = vectorResults.matches.map((m) => m.id);
    const placeholders = metadataFilenames.map(() => '?').join(',');
    const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
    const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})${maxSizeSqlFilter}`
    ).bind(...metadataFilenames, ...maxSizeSqlParams).all();

    const recordMap = new Map<string, Record<string, unknown>>();
    for (const row of results) recordMap.set(String(row.metadata_filename), row);

    const items = await Promise.all(
      vectorResults.matches.map(async (match) => {
        const row = recordMap.get(match.id);
        if (!row) return null;
        const photo = await buildPhotoRecord(row, env);
        return { ...photo, score: match.score };
      })
    );

    return applySearchPolicy(items.filter((i): i is PhotoRecord & { score: number } => i !== null), searchPolicy, query);
  } catch (e) {
    console.error('Smart search visual error:', e);
    return null;
  }
}

// Helper: get semantic search results without Response wrapper
// Note: Vectorize topK is capped at 50
async function getSemanticResults(query: string, limit: number, env: Env, maxSize = 0, searchPolicy: SearchPolicyOptions = { includeExcluded: false }): Promise<(PhotoRecord & { score?: number })[] | null> {
  if (!env.VECTORIZE || !env.AI) return null;

  try {
    const embeddingResponse = await env.AI.run('@cf/baai/bge-m3', { text: [query] });
    const embedding = extractEmbedding(embeddingResponse);
    if (!embedding) return null;

    const vectorResults = await env.VECTORIZE.query(embedding, {
      topK: Math.min(limit, 50),
      returnMetadata: true,
      returnValues: false,
    });

    if (!vectorResults.matches?.length) return null;

    const metadataFilenames = vectorResults.matches.map((m) => m.id);
    const placeholders = metadataFilenames.map(() => '?').join(',');
    const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
    const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})${maxSizeSqlFilter}`
    ).bind(...metadataFilenames, ...maxSizeSqlParams).all();

    const recordMap = new Map<string, Record<string, unknown>>();
    for (const row of results) recordMap.set(String(row.metadata_filename), row);

    const items = await Promise.all(
      vectorResults.matches.map(async (match) => {
        const row = recordMap.get(match.id);
        if (!row) return null;
        const photo = await buildPhotoRecord(row, env);
        return { ...photo, score: match.score };
      })
    );

    return applySearchPolicy(items.filter((i): i is PhotoRecord & { score: number } => i !== null), searchPolicy, query);
  } catch (e) {
    console.error('Smart search semantic error:', e);
    return null;
  }
}

async function handleSemanticSearch(query: string, limit: number, env: Env, maxSize = 0, searchPolicy: SearchPolicyOptions = { includeExcluded: false }): Promise<Response> {
  if (!env.VECTORIZE || !env.AI) {
    return jsonResponse(
      { error: 'Semantic search is not configured. Bind Vectorize + Workers AI to enable this feature.' },
      501
    );
  }

  try {
    // Generate embedding for the search query using Workers AI
    // Using bge-m3 for multilingual support (French/English for Quebec users)
    const embeddingResponse = await env.AI.run('@cf/baai/bge-m3', {
      text: [query],
    });

    // Extract the embedding vector from the response
    const embedding = extractEmbedding(embeddingResponse);
    if (!embedding) {
      return jsonResponse({ error: 'Failed to generate query embedding' }, 500);
    }

    // Query Vectorize for similar vectors (topK capped at 50)
    const vectorResults = await env.VECTORIZE.query(embedding, {
      topK: Math.min(limit, 50),
      returnMetadata: true,
      returnValues: false,
    });

    if (!vectorResults.matches || vectorResults.matches.length === 0) {
      return jsonResponse({ items: [], mode: 'semantic', count: 0 });
    }

    // Extract metadata_filenames (IDs) from vector matches
    const metadataFilenames = vectorResults.matches.map((match) => match.id);

    // Fetch full records from D1 using the IDs
    const placeholders = metadataFilenames.map(() => '?').join(',');
    const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
    const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})${maxSizeSqlFilter}`
    )
      .bind(...metadataFilenames, ...maxSizeSqlParams)
      .all();

    // Build a map for quick lookup
    const recordMap = new Map<string, Record<string, unknown>>();
    for (const row of results) {
      recordMap.set(String(row.metadata_filename), row);
    }

    // Build photo records in the same order as vector results, preserving scores
    const items = await Promise.all(
      vectorResults.matches.map(async (match) => {
        const row = recordMap.get(match.id);
        if (!row) {
          return null;
        }
        const photo = await buildPhotoRecord(row, env);
        return {
          ...photo,
          score: match.score,
        };
      })
    );

    // Filter out any null results
    const filteredItems = applySearchPolicy(items.filter((item): item is PhotoRecord & { score: number } => item !== null), searchPolicy, query).slice(0, limit);

    return jsonResponse({
      items: filteredItems,
      mode: 'semantic',
      count: filteredItems.length,
    });
  } catch (error) {
    console.error('Semantic search error:', error);
    return jsonResponse(
      {
        error: 'Semantic search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

async function handleVisualSearch(query: string, limit: number, env: Env, precomputedEmbedding?: number[], maxSize = 0, searchPolicy: SearchPolicyOptions = { includeExcluded: false }): Promise<Response> {
  if (!env.VECTORIZE_CLIP) {
    return jsonResponse(
      { error: 'Visual search is not configured. Bind VECTORIZE_CLIP index to enable this feature.' },
      501
    );
  }

  try {
    // Use pre-computed embedding if provided, otherwise try to generate one
    let embedding = precomputedEmbedding;

    if (!embedding) {
      if (!env.CLIP_EMBEDDING_URL) {
        return jsonResponse(
          { error: 'Visual search requires either a pre-computed embedding or CLIP_EMBEDDING_URL secret' },
          501
        );
      }
      const generatedEmbedding = await generateClipTextEmbedding(query, env);
      if (!generatedEmbedding) {
        return jsonResponse({ error: 'Failed to generate CLIP text embedding' }, 500);
      }
      embedding = generatedEmbedding;
    }

    // Validate embedding dimension
    if (embedding.length !== 512) {
      return jsonResponse({ error: `Invalid embedding dimension: expected 512, got ${embedding.length}` }, 400);
    }

    // Query CLIP Vectorize for similar image vectors (topK capped at 50)
    const vectorResults = await env.VECTORIZE_CLIP.query(embedding, {
      topK: Math.min(limit, 50),
      returnMetadata: true,
      returnValues: false,
    });

    if (!vectorResults.matches || vectorResults.matches.length === 0) {
      return jsonResponse({ items: [], mode: 'visual', count: 0 });
    }

    // Extract metadata_filenames (IDs) from vector matches
    const metadataFilenames = vectorResults.matches.map((match) => match.id);

    // Fetch full records from D1
    const placeholders = metadataFilenames.map(() => '?').join(',');
    const maxSizeSqlFilter = maxSize > 0 ? ' AND image_size_bytes <= ?' : '';
    const maxSizeSqlParams = maxSize > 0 ? [maxSize] : [];
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})${maxSizeSqlFilter}`
    )
      .bind(...metadataFilenames, ...maxSizeSqlParams)
      .all();

    // Build a map for quick lookup
    const recordMap = new Map<string, Record<string, unknown>>();
    for (const row of results) {
      recordMap.set(String(row.metadata_filename), row);
    }

    // Build photo records in the same order as vector results, preserving scores
    const items = await Promise.all(
      vectorResults.matches.map(async (match) => {
        const row = recordMap.get(match.id);
        if (!row) {
          return null;
        }
        const photo = await buildPhotoRecord(row, env);
        return {
          ...photo,
          score: match.score,
        };
      })
    );

    const filteredItems = applySearchPolicy(items.filter((item): item is PhotoRecord & { score: number } => item !== null), searchPolicy, query).slice(0, limit);

    return jsonResponse({
      items: filteredItems,
      mode: 'visual',
      count: filteredItems.length,
    });
  } catch (error) {
    console.error('Visual search error:', error);
    return jsonResponse(
      {
        error: 'Visual search failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

async function generateClipTextEmbedding(text: string, env: Env): Promise<number[] | null> {
  // CLIP text embedding - supports multiple providers:
  //
  // Option 1: HuggingFace Inference API (512-dim ViT-B/32, multilingual)
  //   CLIP_EMBEDDING_URL = https://router.huggingface.co/hf-inference/models/sentence-transformers/clip-ViT-B-32-multilingual-v1
  //   CLIP_EMBEDDING_TOKEN = your HuggingFace API token
  //
  // Option 2: DeepInfra (OpenAI-compatible format)
  //   CLIP_EMBEDDING_URL = https://api.deepinfra.com/v1/openai/embeddings
  //   CLIP_EMBEDDING_TOKEN = your DeepInfra API token

  const CLIP_URL = env.CLIP_EMBEDDING_URL;

  if (!CLIP_URL) {
    console.error('CLIP_EMBEDDING_URL not configured - visual search requires a CLIP text embedding service');
    return null;
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Use CLIP_EMBEDDING_TOKEN or fall back to HF_API_TOKEN
  const token = env.CLIP_EMBEDDING_TOKEN || env.HF_API_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    let body: string;
    const isDeepInfra = CLIP_URL.includes('deepinfra.com');

    if (isDeepInfra) {
      // OpenAI-compatible format for DeepInfra
      body = JSON.stringify({
        input: text,
        model: 'sentence-transformers/clip-ViT-B-32-multilingual-v1',
        encoding_format: 'float'
      });
    } else {
      // HuggingFace Inference API format
      body = JSON.stringify({ inputs: text });
    }

    const response = await fetch(CLIP_URL, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      console.error('CLIP embedding service error:', response.status);
      return null;
    }

    const result = await response.json();

    // HuggingFace returns flat array: [0.1, 0.2, ...]
    if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'number') {
      return result.length === 512 ? result : null;
    }

    // HuggingFace may return nested array: [[0.1, 0.2, ...]]
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      const embedding = result[0];
      return embedding.length === 512 ? embedding : null;
    }

    // OpenAI-compatible format: { data: [{ embedding: [...] }] }
    const typedResult = result as { data?: Array<{ embedding?: number[] }>; embedding?: number[] };
    if (typedResult.data && Array.isArray(typedResult.data) && typedResult.data.length > 0) {
      const embedding = typedResult.data[0].embedding;
      if (embedding && Array.isArray(embedding)) {
        return embedding.length === 512 ? embedding : null;
      }
    }

    console.error('Unexpected CLIP response format');
    return null;
  } catch (error) {
    console.error('CLIP embedding request failed:', error);
    return null;
  }
}

function extractEmbedding(response: unknown): number[] | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const result = (response as { data?: unknown[] }).data;
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }

  const firstEntry = result[0];
  if (Array.isArray(firstEntry)) {
    return firstEntry;
  }

  if (firstEntry && typeof firstEntry === 'object' && 'embedding' in firstEntry) {
    const embedding = (firstEntry as { embedding: unknown }).embedding;
    if (Array.isArray(embedding)) {
      return embedding;
    }
  }

  return null;
}

async function resolveImageUrl(key: string, env: Env): Promise<string> {
  if (!key) return '';

  const sanitizedKey = key.replace(/^\/+/, '');

  if (env.CLOUDFLARE_R2_PUBLIC_DOMAIN) {
    return `https://${env.CLOUDFLARE_R2_PUBLIC_DOMAIN}/${encodePathComponent(sanitizedKey)}`;
  }

  if (
    env.CLOUDFLARE_R2_ACCESS_KEY &&
    env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
    env.CLOUDFLARE_R2_ACCOUNT_ID &&
    env.CLOUDFLARE_R2_BUCKET
  ) {
    return signR2Url(sanitizedKey, env);
  }

  console.warn('R2 credentials missing; returning unsigned path');
  return sanitizedKey;
}

async function signR2Url(key: string, env: Env, expiresInSeconds = 3600): Promise<string> {
  const accessKey = env.CLOUDFLARE_R2_ACCESS_KEY as string;
  const secretKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY as string;
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID as string;
  const bucket = env.CLOUDFLARE_R2_BUCKET as string;

  const method = 'GET';
  const service = 's3';
  const region = 'auto';
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodePathComponent(bucket)}/${encodePathComponent(key)}`;

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKey}/${credentialScope}`;

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];

  const canonicalQueryString = queryParams
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const signedQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  return `https://${host}${canonicalUri}?${signedQuery}`;
}

const encoder = new TextEncoder();

async function sha256Hex(message: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  return toHex(new Uint8Array(hash));
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

async function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, 'aws4_request');
}

async function hmacRaw(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodePathComponent(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(date: Date): string {
  const iso = date.toISOString().replace(/[-:]/g, '');
  return `${iso.slice(0, 15)}Z`;
}

async function handleMapPins(env: Env): Promise<Response> {
  // Return all geolocated photos as lightweight map pins
  const { results = [] } = await env.DB.prepare(
    `SELECT ${MAP_FIELDS} FROM manifest WHERE latitude IS NOT NULL ORDER BY name`
  ).all();

  const pins = await Promise.all(
    results.map(async (row) => ({
      id: String(row.metadata_filename),
      name: normalizeNullableText(row.name),
      dateValue: normalizeNullableText(row.date_value),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      externalUrl: normalizeNullableUrl(row.external_url),
      imageUrl: await resolveImageUrl(String(row.resolved_image_filename ?? ''), env),
    }))
  );

  return jsonResponse({
    pins,
    count: pins.length,
  });
}

// Lightweight endpoint for sitemap generation - returns all photo IDs and basic metadata
async function handleSitemap(env: Env): Promise<Response> {
  const { results = [] } = await env.DB.prepare(
    `SELECT metadata_filename, resolved_image_filename, name, date_value FROM manifest ORDER BY name`
  ).all();

  const items = await Promise.all(
    results.map(async (row) => ({
      id: normalizeMetadataId(String(row.metadata_filename)),
      imageUrl: await resolveImageUrl(String(row.resolved_image_filename ?? ''), env),
      name: normalizeNullableText(row.name),
      dateValue: normalizeNullableText(row.date_value),
    }))
  );

  return jsonResponse({
    items,
    count: items.length,
  });
}

function getTodayKey(): string {
  return getTorontoDateKey();
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function scoreDistance(meters: number): number {
  const score = Math.round(1000 * Math.exp(-meters / 2000));
  return Math.max(0, Math.min(1000, score));
}

async function getRandomGeotaggedPhoto(env: Env, excludeIds: string[] = []): Promise<Record<string, unknown> | null> {
  let sql = `SELECT ${SELECT_FIELDS} FROM manifest WHERE latitude IS NOT NULL AND longitude IS NOT NULL`;
  const params: unknown[] = [];
  if (excludeIds.length) {
    const placeholders = excludeIds.map(() => '?').join(',');
    sql += ` AND metadata_filename NOT IN (${placeholders})`;
    params.push(...excludeIds);
  }
  sql += ' ORDER BY RANDOM() LIMIT 1';

  const { results = [] } = await env.DB.prepare(sql).bind(...params).all();
  return results[0] ?? null;
}

async function getDailyChallenge(env: Env, dateKey: string): Promise<{ photoId: string; latitude: number; longitude: number }> {
  const existing = await env.DB.prepare(
    'SELECT photo_id, latitude, longitude FROM daily_challenge WHERE date_key = ?'
  ).bind(dateKey).first<{ photo_id: string; latitude: number; longitude: number }>();

  if (existing) {
    return {
      photoId: existing.photo_id,
      latitude: Number(existing.latitude),
      longitude: Number(existing.longitude),
    };
  }

  const row = await getRandomGeotaggedPhoto(env);
  if (!row) {
    throw new Error('No geotagged photos available');
  }

  const photoId = String(row.metadata_filename);
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);

  await env.DB.prepare(
    'INSERT INTO daily_challenge (date_key, photo_id, latitude, longitude) VALUES (?, ?, ?, ?)'
  ).bind(dateKey, photoId, latitude, longitude).run();

  return { photoId, latitude, longitude };
}

async function handleGameDaily(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const dateKey = getTodayKey();
  const anonId = url.searchParams.get('anonId');
  const userId = await getClerkUserId(request, env);

  const dailyChallenge = await getDailyChallenge(env, dateKey);
  const { results: dailyRows = [] } = await env.DB.prepare(
    `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename = ?`
  ).bind(dailyChallenge.photoId).all();
  const dailyRow = dailyRows[0];
  if (!dailyRow) {
    return jsonResponse({ error: 'Daily challenge photo not found' }, 500);
  }

  const dailyPhoto = await buildPhotoRecord(dailyRow, env);
  dailyPhoto.imageUrl = resolveGameImageUrl(dailyPhoto);

  let dailyPlayed = false;
  let dailyResult: { score: number; distanceMeters: number; guessedLat?: number; guessedLng?: number } | null = null;
  let practiceAvailable = true;
  let practiceResult: { score: number; distanceMeters: number; guessedLat?: number; guessedLng?: number } | null = null;

  if (userId) {
    const existingDaily = await env.DB.prepare(
      'SELECT score, distance_meters, guessed_lat, guessed_lng FROM daily_guess WHERE date_key = ? AND user_id = ? LIMIT 1'
    ).bind(dateKey, userId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
    if (existingDaily) {
      dailyPlayed = true;
      dailyResult = {
        score: Number(existingDaily.score),
        distanceMeters: Number(existingDaily.distance_meters),
        guessedLat: Number(existingDaily.guessed_lat),
        guessedLng: Number(existingDaily.guessed_lng),
      };
    } else if (anonId) {
      const anonDaily = await env.DB.prepare(
        'SELECT score, distance_meters, guessed_lat, guessed_lng FROM daily_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
      ).bind(dateKey, anonId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
      if (anonDaily) {
        await env.DB.prepare(
          'UPDATE daily_guess SET user_id = ? WHERE date_key = ? AND anon_id = ? AND user_id IS NULL'
        ).bind(userId, dateKey, anonId).run();
        dailyPlayed = true;
        dailyResult = {
          score: Number(anonDaily.score),
          distanceMeters: Number(anonDaily.distance_meters),
          guessedLat: Number(anonDaily.guessed_lat),
          guessedLng: Number(anonDaily.guessed_lng),
        };
      }
    }

    const existingPractice = await env.DB.prepare(
      'SELECT score, distance_meters, guessed_lat, guessed_lng FROM practice_guess WHERE date_key = ? AND user_id = ? LIMIT 1'
    ).bind(dateKey, userId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
    if (existingPractice) {
      practiceAvailable = false;
      practiceResult = {
        score: Number(existingPractice.score),
        distanceMeters: Number(existingPractice.distance_meters),
        guessedLat: Number(existingPractice.guessed_lat),
        guessedLng: Number(existingPractice.guessed_lng),
      };
    } else if (anonId) {
      const anonPractice = await env.DB.prepare(
        'SELECT score, distance_meters, guessed_lat, guessed_lng FROM practice_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
      ).bind(dateKey, anonId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
      if (anonPractice) {
        await env.DB.prepare(
          'UPDATE practice_guess SET user_id = ? WHERE date_key = ? AND anon_id = ? AND user_id IS NULL'
        ).bind(userId, dateKey, anonId).run();
        practiceAvailable = false;
        practiceResult = {
          score: Number(anonPractice.score),
          distanceMeters: Number(anonPractice.distance_meters),
          guessedLat: Number(anonPractice.guessed_lat),
          guessedLng: Number(anonPractice.guessed_lng),
        };
      }
    }
  } else if (anonId) {
    const existingDaily = await env.DB.prepare(
      'SELECT score, distance_meters, guessed_lat, guessed_lng FROM daily_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
    ).bind(dateKey, anonId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
    if (existingDaily) {
      dailyPlayed = true;
      dailyResult = {
        score: Number(existingDaily.score),
        distanceMeters: Number(existingDaily.distance_meters),
        guessedLat: Number(existingDaily.guessed_lat),
        guessedLng: Number(existingDaily.guessed_lng),
      };
    }

    const existingPractice = await env.DB.prepare(
      'SELECT score, distance_meters, guessed_lat, guessed_lng FROM practice_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
    ).bind(dateKey, anonId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
    if (existingPractice) {
      practiceAvailable = false;
      practiceResult = {
        score: Number(existingPractice.score),
        distanceMeters: Number(existingPractice.distance_meters),
        guessedLat: Number(existingPractice.guessed_lat),
        guessedLng: Number(existingPractice.guessed_lng),
      };
    }
  }

  let practicePhoto: PhotoRecord | null = null;
  if (practiceAvailable) {
    const practiceRow = await getRandomGeotaggedPhoto(env, [dailyChallenge.photoId]);
    if (practiceRow) {
      practicePhoto = await buildPhotoRecord(practiceRow, env);
      practicePhoto.imageUrl = resolveGameImageUrl(practicePhoto);
    }
  }

  return jsonResponse({
    date: dateKey,
    daily: {
      photo: dailyPhoto,
      played: dailyPlayed,
      result: dailyResult,
    },
    practice: {
      available: practiceAvailable && Boolean(practicePhoto),
      photo: practicePhoto,
      result: practiceResult,
    },
  });
}

type GameGuessPayload = {
  mode: 'daily' | 'practice';
  photoId: string;
  lat: number;
  lng: number;
  anonId?: string | null;
};

async function handleGameGuess(request: Request, env: Env): Promise<Response> {
  let payload: GameGuessPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { mode, photoId, lat, lng, anonId } = payload;
  const userId = await getClerkUserId(request, env);
  if (!mode || !photoId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ error: 'Missing required fields' }, 400);
  }
  if (!userId && !anonId) {
    return jsonResponse({ error: 'Missing anonId for anonymous guess' }, 400);
  }

  const dateKey = getTodayKey();

  if (mode === 'daily') {
    const existing = userId
      ? await env.DB.prepare(
        'SELECT score, distance_meters FROM daily_guess WHERE date_key = ? AND user_id = ? LIMIT 1'
      ).bind(dateKey, userId).first<{ score: number; distance_meters: number }>()
      : await env.DB.prepare(
        'SELECT score, distance_meters FROM daily_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
      ).bind(dateKey, anonId).first<{ score: number; distance_meters: number }>();
    if (existing) {
      return jsonResponse({
        mode,
        played: true,
        score: Number(existing.score),
        distanceMeters: Number(existing.distance_meters),
      });
    }

    const challenge = await getDailyChallenge(env, dateKey);
    if (challenge.photoId !== photoId) {
      return jsonResponse({ error: 'Invalid daily challenge photo' }, 400);
    }

    const distance = distanceMeters(lat, lng, challenge.latitude, challenge.longitude);
    const score = scoreDistance(distance);

    await env.DB.prepare(
      'INSERT INTO daily_guess (date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(dateKey, photoId, anonId ?? null, userId ?? null, lat, lng, distance, score).run();

    return jsonResponse({
      mode,
      played: false,
      score,
      distanceMeters: distance,
    });
  }

  const existingPractice = userId
    ? await env.DB.prepare(
      'SELECT score, distance_meters FROM practice_guess WHERE date_key = ? AND user_id = ? LIMIT 1'
    ).bind(dateKey, userId).first<{ score: number; distance_meters: number }>()
    : await env.DB.prepare(
      'SELECT score, distance_meters, guessed_lat, guessed_lng FROM practice_guess WHERE date_key = ? AND anon_id = ? LIMIT 1'
    ).bind(dateKey, anonId).first<{ score: number; distance_meters: number; guessed_lat: number; guessed_lng: number }>();
  if (existingPractice) {
    return jsonResponse({
      mode,
      played: true,
      score: Number(existingPractice.score),
      distanceMeters: Number(existingPractice.distance_meters),
    });
  }

  const { results = [] } = await env.DB.prepare(
    `SELECT latitude, longitude FROM manifest WHERE metadata_filename = ? AND latitude IS NOT NULL AND longitude IS NOT NULL`
  ).bind(photoId).all();
  const row = results[0];
  if (!row) {
    return jsonResponse({ error: 'Photo not eligible for practice' }, 400);
  }

  const targetLat = Number(row.latitude);
  const targetLng = Number(row.longitude);
  const distance = distanceMeters(lat, lng, targetLat, targetLng);
  const score = scoreDistance(distance);

  await env.DB.prepare(
    'INSERT INTO practice_guess (date_key, photo_id, anon_id, user_id, guessed_lat, guessed_lng, distance_meters, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(dateKey, photoId, anonId ?? null, userId ?? null, lat, lng, distance, score).run();

  return jsonResponse({
    mode,
    played: false,
    score,
    distanceMeters: distance,
  });
}

async function handleGameLeaderboard(url: URL, env: Env): Promise<Response> {
  const dateKey = url.searchParams.get('date') || getTodayKey();
  const limit = clampInt(url.searchParams.get('limit'), 10, 1, 50);

  const { results = [] } = await env.DB.prepare(
    `SELECT anon_id, user_id, score, distance_meters
     FROM daily_guess
     WHERE date_key = ?
     ORDER BY score DESC, distance_meters ASC, created_at ASC
     LIMIT ?`
  ).bind(dateKey, limit).all();

  const leaderboard = results.map((row, index) => {
    const tagSource = String(row.user_id || row.anon_id || '');
    const anonTag = tagSource ? tagSource.slice(-4).toUpperCase() : '????';
    return {
      rank: index + 1,
      anonTag,
      score: Number(row.score),
      distanceMeters: Number(row.distance_meters),
    };
  });

  return jsonResponse({
    date: dateKey,
    leaderboard,
    count: leaderboard.length,
  });
}
