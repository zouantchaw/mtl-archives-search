import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 120,
          background: '#171717',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fafafa',
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          borderRadius: 32,
        }}
      >
        M
      </div>
    ),
    {
      width: 192,
      height: 192,
    }
  );
}
