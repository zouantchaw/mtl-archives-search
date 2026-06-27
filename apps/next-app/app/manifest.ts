import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MTL Archives',
    short_name: 'MTL Archives',
    description: 'Explorez 13 000+ photos historiques de Montréal',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5F2EA',
    theme_color: '#111318',
    orientation: 'portrait-primary',
    categories: ['photography', 'history', 'education'],
    lang: 'fr-CA',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
