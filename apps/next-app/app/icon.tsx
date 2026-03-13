import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
  width: 32,
  height: 32,
};

export const contentType = 'image/png';

// V4 brand mark — 2x2 colored dot cluster on cream background
export default function Icon() {
  const d = 9; // dot diameter
  const gap = 3; // gap between dots
  const block = d * 2 + gap; // total cluster size
  const ox = (32 - block) / 2; // center offset x
  const oy = (32 - block) / 2; // center offset y

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
          borderRadius: 6,
          position: 'relative',
        }}
      >
        {/* Top-left: blue */}
        <div style={{ position: 'absolute', left: ox, top: oy, width: d, height: d, borderRadius: '50%', background: '#0F5EA8' }} />
        {/* Top-right: orange */}
        <div style={{ position: 'absolute', left: ox + d + gap, top: oy, width: d, height: d, borderRadius: '50%', background: '#F0A11A' }} />
        {/* Bottom-left: green */}
        <div style={{ position: 'absolute', left: ox, top: oy + d + gap, width: d, height: d, borderRadius: '50%', background: '#34C759' }} />
        {/* Bottom-right: yellow */}
        <div style={{ position: 'absolute', left: ox + d + gap, top: oy + d + gap, width: d, height: d, borderRadius: '50%', background: '#F5CF4D' }} />
      </div>
    ),
    {
      ...size,
    }
  );
}
