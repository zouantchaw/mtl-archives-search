import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

// Dot-based M icon representing the point cloud
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#111318',
          borderRadius: 6,
          position: 'relative',
        }}
      >
        {/* Left vertical */}
        <div style={{ position: 'absolute', left: 5, top: 4, width: 5, height: 5, borderRadius: '50%', background: '#ff9500' }} />
        <div style={{ position: 'absolute', left: 5, top: 10, width: 4, height: 4, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', left: 5, top: 15, width: 5, height: 5, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', left: 5, top: 21, width: 4, height: 4, borderRadius: '50%', background: '#0a84ff' }} />

        {/* Center V */}
        <div style={{ position: 'absolute', left: 10, top: 7, width: 4, height: 4, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', left: 14, top: 12, width: 5, height: 5, borderRadius: '50%', background: '#F5F2EA' }} />
        <div style={{ position: 'absolute', left: 18, top: 7, width: 4, height: 4, borderRadius: '50%', background: '#ffd60a' }} />

        {/* Right vertical */}
        <div style={{ position: 'absolute', right: 5, top: 4, width: 5, height: 5, borderRadius: '50%', background: '#ff9500' }} />
        <div style={{ position: 'absolute', right: 5, top: 10, width: 4, height: 4, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', right: 5, top: 15, width: 5, height: 5, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', right: 5, top: 21, width: 4, height: 4, borderRadius: '50%', background: '#0a84ff' }} />
      </div>
    ),
    {
      ...size,
    }
  );
}
