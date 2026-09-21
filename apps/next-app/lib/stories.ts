import { unstable_cache } from 'next/cache';
import { API_BASE } from '@/lib/runtime-config';

export type StorySection = {
  heading: string;
  body: string;
};

export type StorySponsor = {
  name: string;
  url: string;
  label: string | null;
};

export type StoryRecord = {
  slug: string;
  title: string;
  dek: string;
  sections: StorySection[];
  theme_label: string;
  date: string;
  photo_id: string;
  photo_url: string;
  photo_credit: string | null;
  cote: string | null;
  lang: 'fr' | 'en';
  email_capture_variant: string | null;
  sponsor: StorySponsor | null;
  status: 'published' | 'draft';
  published_at: string;
  created_at: string;
};

export type StoryListPage = {
  items: StoryRecord[];
  nextCursor: string | null;
};

const STORY_REVALIDATE_SECONDS = 60;

async function fetchStoryJson<T>(path: string): Promise<T | null> {
  if (!API_BASE) return null;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export const getLatestStory = unstable_cache(
  async (): Promise<StoryRecord | null> => {
    const data = await fetchStoryJson<{ story: StoryRecord | null }>('/api/stories/latest');
    return data?.story ?? null;
  },
  ['stories-latest'],
  { tags: ['stories'], revalidate: STORY_REVALIDATE_SECONDS },
);

export const getStoryBySlug = unstable_cache(
  async (slug: string): Promise<StoryRecord | null> => {
    const data = await fetchStoryJson<{ story: StoryRecord }>(`/api/stories/${encodeURIComponent(slug)}`);
    return data?.story ?? null;
  },
  ['stories-by-slug'],
  { tags: ['stories'], revalidate: STORY_REVALIDATE_SECONDS },
);

export const getStoriesPage = unstable_cache(
  async (limit: number, cursor: string | null): Promise<StoryListPage> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const data = await fetchStoryJson<StoryListPage>(`/api/stories?${params.toString()}`);
    return {
      items: data?.items ?? [],
      nextCursor: data?.nextCursor ?? null,
    };
  },
  ['stories-page'],
  { tags: ['stories'], revalidate: STORY_REVALIDATE_SECONDS },
);

export async function getAllPublishedStories(): Promise<StoryRecord[]> {
  const items: StoryRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await getStoriesPage(50, cursor);
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return items;
}

export function formatStoryDate(date: string, lang: 'fr' | 'en' = 'fr'): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
