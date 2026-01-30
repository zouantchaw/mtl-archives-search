import { ImageResponse } from 'next/og';
import { API_BASE } from '@/lib/runtime-config';

export const runtime = 'edge';

export const alt = 'MTL Archives - Photos historiques de Montréal';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

// API endpoint for fetching photos

type PhotoData = {
  imageUrl?: string;
  name?: string;
};

async function getPhotos(): Promise<PhotoData[]> {
  try {
    const res = await fetch(`${API_BASE}/api/photos?limit=6`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch {
    return [];
  }
}

export default async function OGImage() {
  const photos = await getPhotos();
  
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
        {/* Photo grid background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          {photos.slice(0, 6).map((photo, i) => (
            <div
              key={i}
              style={{
                width: '33.333%',
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
                    filter: 'brightness(0.6)',
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
        
        {/* Center overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'radial-gradient(ellipse at center, rgba(23,23,23,0.95) 0%, rgba(23,23,23,0.7) 50%, rgba(23,23,23,0.4) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
        
        {/* Content */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
          }}
        >
          {/* Logo mark */}
          <div
            style={{
              width: 100,
              height: 100,
              background: '#fafafa',
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 60,
              fontWeight: 700,
              color: '#171717',
            }}
          >
            M
          </div>
          
          {/* Title */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 600,
              color: '#fafafa',
              letterSpacing: '0.05em',
              display: 'flex',
            }}
          >
            MTL ARCHIVES
          </div>
          
          {/* Subtitle */}
          <div
            style={{
              fontSize: 24,
              color: '#a3a3a3',
              letterSpacing: '0.15em',
              display: 'flex',
            }}
          >
            14 822 PHOTOS HISTORIQUES DE MONTRÉAL
          </div>
        </div>
        
        {/* Bottom accent - Quebec flag colors */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 6,
            background: 'linear-gradient(90deg, #003DA5 0%, #003DA5 25%, #fafafa 25%, #fafafa 50%, #003DA5 50%, #003DA5 75%, #fafafa 75%, #fafafa 100%)',
            display: 'flex',
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
