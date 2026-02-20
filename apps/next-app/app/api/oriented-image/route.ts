import { NextRequest } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const ALLOWED_ROTATIONS = new Set([0, 90, 180, 270]);

function isAllowedImageHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  const configuredPublicDomain = process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN?.toLowerCase();
  const configuredPrivateDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN?.toLowerCase();
  if (configuredPublicDomain && lower === configuredPublicDomain) return true;
  if (configuredPrivateDomain && lower === configuredPrivateDomain) return true;
  return lower.endsWith('.r2.dev') || lower.endsWith('.r2.cloudflarestorage.com');
}

export async function GET(request: NextRequest): Promise<Response> {
  const src = request.nextUrl.searchParams.get('src');
  const rawRotation = request.nextUrl.searchParams.get('rot');
  if (!src) {
    return Response.json({ error: 'Missing src query parameter' }, { status: 400 });
  }

  const rotation = rawRotation == null
    ? 0
    : Number.parseInt(rawRotation, 10);
  if (!Number.isFinite(rotation) || !ALLOWED_ROTATIONS.has(rotation)) {
    return Response.json({ error: 'Invalid rot query parameter' }, { status: 400 });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(src);
  } catch {
    return Response.json({ error: 'Invalid src URL' }, { status: 400 });
  }

  if (sourceUrl.protocol !== 'https:' || !isAllowedImageHost(sourceUrl.hostname)) {
    return Response.json({ error: 'Forbidden src host' }, { status: 403 });
  }

  const upstream = await fetch(sourceUrl.toString(), {
    headers: {
      accept: 'image/*',
    },
    cache: 'force-cache',
  });

  if (!upstream.ok) {
    return Response.json({ error: 'Failed to fetch source image' }, { status: 502 });
  }

  const contentLengthHeader = upstream.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
      return Response.json({ error: 'Source image too large' }, { status: 413 });
    }
  }

  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());
  if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) {
    return Response.json({ error: 'Source image too large' }, { status: 413 });
  }

  let body: Blob;
  if (rotation === 0) {
    // No transform needed: preserve original bytes + metadata.
    body = new Blob([Uint8Array.from(sourceBuffer)], {
      type: upstream.headers.get('content-type') || 'image/jpeg',
    });
  } else {
    const normalizedBuffer = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate(rotation)
      .toBuffer();
    body = new Blob([Uint8Array.from(normalizedBuffer)], {
      type: upstream.headers.get('content-type') || 'image/jpeg',
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'image/jpeg',
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      'x-image-orientation-normalized': 'true',
    },
  });
}
