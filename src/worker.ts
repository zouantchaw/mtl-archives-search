import type { VectorizeIndex, Ai } from '@cloudflare/workers-types';

type PhotoRecord = {
  metadataFilename: string;
  imageFilename: string;
  resolvedImageFilename: string;
  imageSizeBytes: number | null;
  name: string | null;
  description: string | null;
  dateValue: string | null;
  credits: string | null;
  cote: string | null;
  externalUrl: string | null;
  portalMatch: boolean;
  portalTitle: string | null;
  portalDescription: string | null;
  portalDate: string | null;
  portalCote: string | null;
  aerialDatasets: string[];
  imageUrl: string;
};

type Env = {
  DB: D1Database;
  AI: Ai;
  VECTORIZE?: VectorizeIndex;
  CLOUDFLARE_R2_ACCESS_KEY?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_R2_PUBLIC_DOMAIN?: string;
};

const JSON_HEADERS: HeadersInit = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

const SELECT_FIELDS = `metadata_filename, image_filename, resolved_image_filename, image_size_bytes, name, description, date_value, credits, cote, external_url, portal_match, portal_title, portal_description, portal_date, portal_cote, aerial_datasets`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/photos') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handlePhotos(url, env);
      }

      if (url.pathname === '/api/search') {
        if (request.method !== 'GET') {
          return methodNotAllowed();
        }
        return handleSearch(url, env);
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
  return jsonResponse({ error: 'Method not allowed' }, 405, {
    'access-control-allow-methods': 'GET, OPTIONS',
  });
}

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

async function buildPhotoRecord(row: Record<string, unknown>, env: Env): Promise<PhotoRecord> {
  const record: PhotoRecord = {
    metadataFilename: String(row.metadata_filename),
    imageFilename: String(row.image_filename),
    resolvedImageFilename: String(row.resolved_image_filename ?? row.image_filename ?? ''),
    imageSizeBytes: row.image_size_bytes != null ? Number(row.image_size_bytes) : null,
    name: row.name != null ? String(row.name) : null,
    description: row.description != null ? String(row.description) : null,
    dateValue: row.date_value != null ? String(row.date_value) : null,
    credits: row.credits != null ? String(row.credits) : null,
    cote: row.cote != null ? String(row.cote) : null,
    externalUrl: row.external_url != null ? String(row.external_url) : null,
    portalMatch: Boolean(row.portal_match),
    portalTitle: row.portal_title != null ? String(row.portal_title) : null,
    portalDescription: row.portal_description != null ? String(row.portal_description) : null,
    portalDate: row.portal_date != null ? String(row.portal_date) : null,
    portalCote: row.portal_cote != null ? String(row.portal_cote) : null,
    aerialDatasets: parseJsonArray(row.aerial_datasets),
    imageUrl: await resolveImageUrl(String(row.resolved_image_filename ?? row.image_filename ?? ''), env),
  };

  validateMetadataQuality(record);
  return record;
}

function validateMetadataQuality(record: PhotoRecord): void {
  const description = record.description?.trim() ?? '';
  if (!description) {
    console.warn('metadata_quality_missing_description', {
      metadataFilename: record.metadataFilename,
      portalMatch: record.portalMatch,
    });
  } else if (description.length < 50) {
    console.warn('metadata_quality_short_description', {
      metadataFilename: record.metadataFilename,
      length: description.length,
      portalMatch: record.portalMatch,
    });
  }

  const portalDescription = record.portalDescription?.trim() ?? '';
  if (!portalDescription) {
    console.warn('metadata_quality_missing_portal_description', {
      metadataFilename: record.metadataFilename,
      portalMatch: record.portalMatch,
    });
  }
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

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
}

async function handlePhotos(url: URL, env: Env): Promise<Response> {
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = clamp(Number.isFinite(limitParam) ? limitParam : 50, 1, 100);
  const cursor = url.searchParams.get('cursor');

  let sql = `SELECT ${SELECT_FIELDS} FROM manifest`;
  const params: unknown[] = [];

  if (cursor) {
    sql += ' WHERE metadata_filename > ?';
    params.push(cursor);
  }

  sql += ' ORDER BY metadata_filename LIMIT ?';
  params.push(limit + 1);

  const { results = [] } = await env.DB.prepare(sql).bind(...params).all();

  const rows = results.slice(0, limit);
  const items = await Promise.all(rows.map((row) => buildPhotoRecord(row, env)));
  const nextCursor = results.length > limit ? String(results[limit].metadata_filename) : null;

  return jsonResponse({ items, nextCursor });
}

async function handleSearch(url: URL, env: Env): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return jsonResponse({ error: 'Missing required query parameter "q".' }, 400);
  }

  const mode = (url.searchParams.get('mode') ?? 'text').toLowerCase();
  const limitParam = Number(url.searchParams.get('limit') ?? '25');
  const limit = clamp(Number.isFinite(limitParam) ? limitParam : 25, 1, 100);

  if (mode === 'semantic') {
    return handleSemanticSearch(q, limit, env);
  }

  const likeParam = `%${escapeForLike(q)}%`;
  const statement = env.DB.prepare(
    `SELECT ${SELECT_FIELDS}
     FROM manifest
     WHERE name LIKE ? ESCAPE '\\'
        OR description LIKE ? ESCAPE '\\'
        OR portal_title LIKE ? ESCAPE '\\'
        OR portal_description LIKE ? ESCAPE '\\'
     ORDER BY portal_match DESC, name ASC
     LIMIT ?`
  );

  const { results = [] } = await statement.bind(likeParam, likeParam, likeParam, likeParam, limit).all();
  const items = await Promise.all(results.map((row) => buildPhotoRecord(row, env)));
  return jsonResponse({ items, mode: 'text' });
}

function escapeForLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

async function handleSemanticSearch(query: string, limit: number, env: Env): Promise<Response> {
  if (!env.VECTORIZE) {
    return jsonResponse(
      { error: 'Semantic search is not configured. Bind a Cloudflare Vectorize index to enable this feature.' },
      501
    );
  }

  try {
    // Generate embedding for the search query using Workers AI
    const embeddingResponse = await env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [query],
    });

    // Extract the embedding vector from the response
    const embedding = extractEmbedding(embeddingResponse);
    if (!embedding) {
      return jsonResponse({ error: 'Failed to generate query embedding' }, 500);
    }

    // Query Vectorize for similar vectors
    const vectorResults = await env.VECTORIZE.query(embedding, {
      topK: limit,
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
    const { results = [] } = await env.DB.prepare(
      `SELECT ${SELECT_FIELDS} FROM manifest WHERE metadata_filename IN (${placeholders})`
    )
      .bind(...metadataFilenames)
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
    const filteredItems = items.filter((item) => item !== null);

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
