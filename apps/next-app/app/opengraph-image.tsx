import { ImageResponse } from 'next/og';
import { API_BASE } from '@/lib/runtime-config';

export const runtime = 'edge';

export const alt = 'MTL Archives — Photos historiques de Montréal';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

type PhotoData = {
  imageUrl?: string;
};

async function getPhotos(): Promise<PhotoData[]> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?limit=4&minTrust=0.65`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

// V4 brand tokens
const CREAM = '#F5F2EA';
const CHARCOAL = '#111318';
const BLUE = '#0F5EA8';
const ORANGE = '#F0A11A';
const GREEN = '#34C759';
const YELLOW = '#F5CF4D';
const MUTED = '#888888';

function DotCluster({ dotSize = 10, gap = 5 }: { dotSize?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      <div style={{ display: 'flex', gap }}>
        <div style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: BLUE }} />
        <div style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: ORANGE }} />
      </div>
      <div style={{ display: 'flex', gap }}>
        <div style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: GREEN }} />
        <div style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: YELLOW }} />
      </div>
    </div>
  );
}

export default async function OGImage() {
  const photos = await getPhotos();

  return new ImageResponse(
    (
      <div
        style={{
          background: CREAM,
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Right side — photo strip */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          {photos.slice(0, 4).map((photo, i) => (
            <div
              key={i}
              style={{
                width: '50%',
                height: '50%',
                display: 'flex',
                overflow: 'hidden',
              }}
            >
              {photo.imageUrl ? (
                <img
                  src={photo.imageUrl}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: 'sepia(0.12) brightness(0.95)',
                  }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', background: '#d7d0c5', display: 'flex' }} />
              )}
            </div>
          ))}
          {/* Fade edge into cream */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: 120,
              background: `linear-gradient(to right, ${CREAM} 0%, ${CREAM}00 100%)`,
              display: 'flex',
            }}
          />
        </div>

        {/* Left side — branding */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 760,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 72px',
          }}
        >
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 48 }}>
            <DotCluster dotSize={14} gap={6} />
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: CHARCOAL,
                letterSpacing: '-0.01em',
              }}
            >
              mtl archives
            </span>
          </div>

          {/* Headline */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: CHARCOAL,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              fontFamily: 'Georgia, serif',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Photos historiques</span>
            <span>de Montréal.</span>
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 22,
              color: MUTED,
              marginTop: 24,
              lineHeight: 1.5,
              display: 'flex',
            }}
          >
            14 822 photos d'archives  ·  jeu quotidien  ·  tirages
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
