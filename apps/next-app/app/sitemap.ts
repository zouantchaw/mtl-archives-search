import { MetadataRoute } from 'next';
import { API_BASE } from '@/lib/runtime-config';
import { getAllStories } from '@/lib/story-pages';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';
const API_URL = API_BASE;
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

  // Static pages with language alternates
  const staticRoutes = [
    { path: '/', changeFrequency: 'daily' as const, priority: 1.0 },
    { path: '/search', changeFrequency: 'daily' as const, priority: 0.9 },
    { path: '/game', changeFrequency: 'daily' as const, priority: 0.8 },
    { path: '/print', changeFrequency: 'weekly' as const, priority: 0.7 },
    { path: '/stories', changeFrequency: 'weekly' as const, priority: 0.7 },
  ];

  const staticPages: MetadataRoute.Sitemap = staticRoutes.flatMap((route) => [
    {
      url: `${SITE_URL}${route.path}`,
      lastModified: new Date(),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: {
          'fr-CA': `${SITE_URL}${route.path}${route.path === '/' ? '?' : '?'}lang=fr`,
          'en-CA': `${SITE_URL}${route.path}${route.path === '/' ? '?' : '?'}lang=en`,
        },
      },
    },
  ]);

  // Dynamic photo pages with image metadata for Google Image Search
  const photoPages: MetadataRoute.Sitemap = photos.map((photo) => ({
    url: `${SITE_URL}/photo/${encodeURIComponent(photo.id)}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
    images: photo.imageUrl ? [photo.imageUrl] : undefined,
    alternates: {
      languages: {
        'fr-CA': `${SITE_URL}/photo/${encodeURIComponent(photo.id)}?lang=fr`,
        'en-CA': `${SITE_URL}/photo/${encodeURIComponent(photo.id)}?lang=en`,
      },
    },
  }));

  const storyPages: MetadataRoute.Sitemap = getAllStories().map((story) => ({
    url: `${SITE_URL}/stories/${encodeURIComponent(story.slug)}`,
    lastModified: story.generated_at ? new Date(story.generated_at) : new Date(story.date),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
    images: story.hero_image ? [`${SITE_URL}${story.hero_image}`] : undefined,
  }));

  return [...staticPages, ...photoPages, ...storyPages];
}
