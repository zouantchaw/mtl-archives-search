import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MTL Archives',
    short_name: 'MTL Archives',
    description: 'Explorez 14 822 photos historiques de Montréal',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#171717',
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
