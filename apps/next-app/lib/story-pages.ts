import fs from 'node:fs';
import path from 'node:path';

export type StorySection = {
  id: string;
  title: string;
  body: string;
};

export type StoryPageRecord = {
  slug: string;
  story_url?: string | null;
  theme_key: string;
  theme_label: string;
  date: string;
  status: string;
  promotable: boolean;
  title: string;
  dek: string;
  metadata_filename?: string | null;
  image_filename?: string | null;
  photo_id?: string | null;
  photo_url?: string | null;
  hero_image?: string | null;
  selected_photo?: {
    name?: string | null;
    description?: string | null;
    cote?: string | null;
    date_value?: string | null;
  };
  cta?: string | null;
  sections: StorySection[];
  related_queries?: string[];
  generated_at?: string | null;
};

const STORIES_ROOT = path.join(process.cwd(), 'content', 'stories');

export function getAllStories(): StoryPageRecord[] {
  if (!fs.existsSync(STORIES_ROOT)) {
    return [];
  }

  return fs
    .readdirSync(STORIES_ROOT)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const raw = fs.readFileSync(path.join(STORIES_ROOT, entry), 'utf-8');
      return JSON.parse(raw) as StoryPageRecord;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function getStoryBySlug(slug: string): StoryPageRecord | null {
  const candidate = path.join(STORIES_ROOT, `${slug}.json`);
  if (!fs.existsSync(candidate)) {
    return null;
  }

  const raw = fs.readFileSync(candidate, 'utf-8');
  return JSON.parse(raw) as StoryPageRecord;
}

export function getStoryByPhotoId(photoId: string): StoryPageRecord | null {
  return getAllStories().find((story) => story.photo_id === photoId) ?? null;
}
