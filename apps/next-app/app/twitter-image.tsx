import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const alt = 'MTL Archives - Photos historiques de Montréal';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #171717 0%, #262626 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
        }}
      >
        {/* Background pattern */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.03,
            backgroundImage: 'radial-gradient(circle at 25px 25px, #fafafa 2px, transparent 0)',
            backgroundSize: '50px 50px',
          }}
        />
        
        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
          }}
        >
          {/* Logo mark */}
          <div
            style={{
              width: 120,
              height: 120,
              background: '#fafafa',
              borderRadius: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 72,
              fontWeight: 700,
              color: '#171717',
            }}
          >
            M
          </div>
          
          {/* Title */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              color: '#fafafa',
              letterSpacing: '0.05em',
            }}
          >
            MTL ARCHIVES
          </div>
          
          {/* Subtitle */}
          <div
            style={{
              fontSize: 28,
              color: '#a3a3a3',
              letterSpacing: '0.1em',
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
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
