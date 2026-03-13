import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

// V4 brand mark — 2x2 colored dot cluster, Apple Touch Icon version
export default function AppleIcon() {
  const d = 44; // dot diameter
  const gap = 14; // gap between dots
  const block = d * 2 + gap; // total cluster size
  const ox = (180 - block) / 2;
  const oy = (180 - block) / 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F5F2EA',
          borderRadius: 36,
          position: 'relative',
        }}
      >
        <div style={{ position: 'absolute', left: ox, top: oy, width: d, height: d, borderRadius: '50%', background: '#0F5EA8' }} />
        <div style={{ position: 'absolute', left: ox + d + gap, top: oy, width: d, height: d, borderRadius: '50%', background: '#F0A11A' }} />
        <div style={{ position: 'absolute', left: ox, top: oy + d + gap, width: d, height: d, borderRadius: '50%', background: '#34C759' }} />
        <div style={{ position: 'absolute', left: ox + d + gap, top: oy + d + gap, width: d, height: d, borderRadius: '50%', background: '#F5CF4D' }} />
      </div>
    ),
    {
      ...size,
    }
  );
}
