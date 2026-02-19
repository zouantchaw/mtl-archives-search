import { ImageResponse } from 'next/og';
import { API_BASE } from '@/lib/runtime-config';
import { normalizePhotoId } from '@/lib/photo-id';

export const runtime = 'edge';

export const alt = 'MTL Archives';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

// API endpoint for fetching photo data

type PhotoData = {
  name?: string;
  dateValue?: string;
  imageUrl?: string;
  description?: string;
};

async function getPhoto(id: string): Promise<PhotoData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?id=${encodeURIComponent(id)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0] || null;
  } catch {
    return null;
  }
}

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await getPhoto(normalizePhotoId(decodeURIComponent(id)));
  
  const title = photo?.name || 'Photo historique';
  const date = photo?.dateValue || '';
  const imageUrl = photo?.imageUrl
    ? `${SITE_URL}/api/oriented-image?src=${encodeURIComponent(photo.imageUrl)}`
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          background: '#171717',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
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
        
        {/* Gradient overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '50%',
            background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
            display: 'flex',
          }}
        />
        
        {/* Content */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 48,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 48,
              fontWeight: 600,
              color: '#fafafa',
              lineHeight: 1.1,
              display: 'flex',
            }}
          >
            {title.length > 60 ? title.substring(0, 60) + '...' : title}
          </div>
          
          {/* Date */}
          {date ? (
            <div
              style={{
                fontSize: 24,
                color: '#a3a3a3',
                display: 'flex',
              }}
            >
              {date}
            </div>
          ) : null}
          
          {/* Branding */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 8,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                background: '#fafafa',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontWeight: 700,
                color: '#171717',
              }}
            >
              M
            </div>
            <div
              style={{
                fontSize: 20,
                color: '#a3a3a3',
                letterSpacing: '0.1em',
                display: 'flex',
              }}
            >
              MTL ARCHIVES
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
