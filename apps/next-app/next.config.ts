import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
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
        destination: 'https://mtl-archives-worker.wiel.workers.dev/api/photos',
      },
      {
        source: '/api/search',
        destination: 'https://mtl-archives-worker.wiel.workers.dev/api/search',
      },
      {
        source: '/api/thumb',
        destination: 'https://mtl-archives-worker.wiel.workers.dev/api/thumb',
      },
      {
        source: '/api/map',
        destination: 'https://mtl-archives-worker.wiel.workers.dev/api/map',
      },
    ];
  },
};

export default nextConfig;
