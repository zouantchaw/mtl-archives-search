import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://mtl-archives-worker.wiel.workers.dev';

type SitemapPhoto = {
  id: string;
  imageUrl: string;
  name: string | null;
  dateValue: string | null;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch all photo IDs from the API
  let photos: SitemapPhoto[] = [];

  try {
    const res = await fetch(`${API_URL}/api/sitemap`, {
      next: { revalidate: 86400 }, // Revalidate daily
    });

    if (res.ok) {
      const data = await res.json();
      photos = data.items || [];
    }
  } catch (error) {
    console.error('Failed to fetch photos for sitemap:', error);
  }

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  // Dynamic photo pages with image metadata for Google Image Search
  const photoPages: MetadataRoute.Sitemap = photos.map((photo) => ({
    url: `${SITE_URL}/photo/${photo.id}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
    images: photo.imageUrl ? [photo.imageUrl] : undefined,
  }));

  return [...staticPages, ...photoPages];
}
