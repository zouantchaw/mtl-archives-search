import { ImageResponse } from 'next/og';

export const runtime = 'edge';

// V4 brand mark — 2x2 colored dot cluster (192x192 PWA icon)
export async function GET() {
  const s = 192;
  const d = 48; // dot diameter
  const gap = 16;
  const block = d * 2 + gap;
  const ox = (s - block) / 2;
  const oy = (s - block) / 2;

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
          borderRadius: 38,
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
      width: s,
      height: s,
    }
  );
}
