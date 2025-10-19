import type { VectorizeIndex } from '@cloudflare/workers-types';

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
};

type Env = {
  DB: D1Database;
  VECTORIZE?: VectorizeIndex;
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

function toRecord(row: Record<string, unknown>): PhotoRecord {
  return {
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
  };
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

  const items = results.slice(0, limit).map(toRecord);
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
  return jsonResponse({ items: results.map(toRecord), mode: 'text' });
}

function escapeForLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

async function handleSemanticSearch(_query: string, _limit: number, env: Env): Promise<Response> {
  if (!env.VECTORIZE) {
    return jsonResponse(
      { error: 'Semantic search is not configured. Bind a Cloudflare Vectorize index to enable this feature.' },
      501
    );
  }

  return jsonResponse(
    {
      error: 'Semantic search placeholder. Integrate embedding generation and vector queries before enabling this endpoint.',
    },
    501
  );
}
