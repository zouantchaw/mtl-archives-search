import type { NextConfig } from "next";

const rawApiBase = process.env.NEXT_PUBLIC_API_URL || process.env.API_BASE_URL || '';
const defaultApiBase = rawApiBase || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8787');
const apiBase = defaultApiBase.replace(/\/$/, '');

if (!apiBase && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_API_URL is required in production.');
}

const nextConfig: NextConfig = {
  images: {
    // Limit generated srcset widths — grid tiles are small, hero maxes at 1000px
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [128, 256, 384],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.dev',
      },
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'http',
        hostname: 'depot.ville.montreal.qc.ca',
      },
    ],
  },
  async rewrites() {
    return [
      // Proxy specific API routes to Cloudflare worker
      // Local routes like /api/clip are handled by Next.js
      {
        source: '/api/photos',
        destination: `${apiBase}/api/photos`,
      },
      {
        source: '/api/search',
        destination: `${apiBase}/api/search`,
      },
      {
        source: '/api/map',
        destination: `${apiBase}/api/map`,
      },
      {
        source: '/api/sitemap',
        destination: `${apiBase}/api/sitemap`,
      },
    ];
  },
};

export default nextConfig;
