import { ImageResponse } from 'next/og';
import { API_BASE } from '@/lib/runtime-config';
import { normalizePhotoId } from '@/lib/photo-id';
import { buildOrientedImagePath } from '@/lib/oriented-image';

export const runtime = 'edge';

export const alt = 'MTL Archives';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';
const PHOTO_API_CACHE_VERSION = '2026-02-20-rotation-v2';

const CREAM = '#F5F2EA';
const CHARCOAL = '#111318';
const BLUE = '#0F5EA8';
const ORANGE = '#F0A11A';
const GREEN = '#34C759';
const YELLOW = '#F5CF4D';

type PhotoData = {
  name?: string;
  dateValue?: string;
  imageUrl?: string;
  description?: string;
  rotationDegrees?: number | null;
};

async function getPhoto(id: string): Promise<PhotoData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}&cv=${PHOTO_API_CACHE_VERSION}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

export default async function TwitterImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await getPhoto(normalizePhotoId(decodeURIComponent(id)));

  const title = photo?.name || 'Photo historique';
  const date = photo?.dateValue || '';
  const imageUrl = photo?.imageUrl
    ? `${SITE_URL}${buildOrientedImagePath(photo.imageUrl, photo.rotationDegrees ?? null)}`
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          background: CHARCOAL,
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Photo as background */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : null}

        {/* Gradient overlay — bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '55%',
            background: 'linear-gradient(to top, rgba(17,19,24,0.92) 0%, rgba(17,19,24,0.5) 60%, rgba(17,19,24,0) 100%)',
            display: 'flex',
          }}
        />

        {/* Content — bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '0 56px 48px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Date label */}
          {date ? (
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 10,
                display: 'flex',
              }}
            >
              {date}
            </div>
          ) : null}

          {/* Title — editorial serif */}
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              color: CREAM,
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              fontFamily: 'Georgia, serif',
              display: 'flex',
              maxWidth: 900,
            }}
          >
            {title.length > 70 ? title.substring(0, 70) + '\u2026' : title}
          </div>

          {/* Branding row — dot cluster + wordmark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: BLUE }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE }} />
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: YELLOW }} />
              </div>
            </div>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              mtl archives
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
