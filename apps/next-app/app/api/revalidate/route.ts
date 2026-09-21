import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function secretsMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-revalidate-secret');
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : null;
  const provided = header || bearer;
  if (!provided) return false;
  return secretsMatch(provided, secret);
}

function isSafePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\');
}

export async function POST(request: Request) {
  if (!process.env.REVALIDATE_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'Revalidation is not configured' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  let body: { tags?: unknown; paths?: unknown } = {};
  try {
    body = await request.json() as { tags?: unknown; paths?: unknown };
  } catch {
    body = {};
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length < 80)
    : [];
  const paths = Array.isArray(body.paths)
    ? body.paths.filter((path): path is string => typeof path === 'string' && isSafePath(path))
    : [];

  const revalidatedTags = Array.from(new Set(['stories', ...tags]));
  const revalidatedPaths = Array.from(new Set(['/stories', '/links', '/sitemap.xml', ...paths]));

  for (const tag of revalidatedTags) revalidateTag(tag, 'max');
  for (const path of revalidatedPaths) revalidatePath(path);

  return NextResponse.json(
    { ok: true, tags: revalidatedTags, paths: revalidatedPaths },
    { headers: { 'cache-control': 'no-store' } },
  );
}
