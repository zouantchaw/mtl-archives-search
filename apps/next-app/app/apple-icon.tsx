import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

// Dot-based M icon representing the point cloud - Apple Touch Icon version
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          borderRadius: 32,
          position: 'relative',
        }}
      >
        {/* Left vertical */}
        <div style={{ position: 'absolute', left: 30, top: 25, width: 24, height: 24, borderRadius: '50%', background: '#ff9500' }} />
        <div style={{ position: 'absolute', left: 30, top: 55, width: 20, height: 20, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', left: 30, top: 82, width: 24, height: 24, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', left: 30, top: 112, width: 20, height: 20, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', left: 30, top: 138, width: 24, height: 24, borderRadius: '50%', background: '#0a84ff' }} />

        {/* Left diagonal */}
        <div style={{ position: 'absolute', left: 55, top: 45, width: 18, height: 18, borderRadius: '50%', background: '#ff9500' }} />
        <div style={{ position: 'absolute', left: 75, top: 65, width: 20, height: 20, borderRadius: '50%', background: '#ffd60a' }} />

        {/* Center */}
        <div style={{ position: 'absolute', left: 80, top: 90, width: 26, height: 26, borderRadius: '50%', background: '#fafafa' }} />

        {/* Right diagonal */}
        <div style={{ position: 'absolute', right: 75, top: 65, width: 20, height: 20, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', right: 55, top: 45, width: 18, height: 18, borderRadius: '50%', background: '#ff9500' }} />

        {/* Right vertical */}
        <div style={{ position: 'absolute', right: 30, top: 25, width: 24, height: 24, borderRadius: '50%', background: '#ff9500' }} />
        <div style={{ position: 'absolute', right: 30, top: 55, width: 20, height: 20, borderRadius: '50%', background: '#ffd60a' }} />
        <div style={{ position: 'absolute', right: 30, top: 82, width: 24, height: 24, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', right: 30, top: 112, width: 20, height: 20, borderRadius: '50%', background: '#34c759' }} />
        <div style={{ position: 'absolute', right: 30, top: 138, width: 24, height: 24, borderRadius: '50%', background: '#0a84ff' }} />

        {/* Scatter dots */}
        <div style={{ position: 'absolute', left: 55, top: 130, width: 10, height: 10, borderRadius: '50%', background: '#8e8e93', opacity: 0.6 }} />
        <div style={{ position: 'absolute', left: 90, top: 140, width: 12, height: 12, borderRadius: '50%', background: '#8e8e93', opacity: 0.5 }} />
        <div style={{ position: 'absolute', right: 55, top: 130, width: 10, height: 10, borderRadius: '50%', background: '#8e8e93', opacity: 0.6 }} />
      </div>
    ),
    {
      ...size,
    }
  );
}
