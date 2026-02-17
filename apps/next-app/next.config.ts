import type { NextConfig } from "next";
import { resolveRuntimeConfig } from "./lib/runtime-env";

const { apiBase } = resolveRuntimeConfig(process.env, process.env.NODE_ENV);

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
