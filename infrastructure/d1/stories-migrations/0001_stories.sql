-- Editorial stories. Separate from the archive/search database.

CREATE TABLE IF NOT EXISTS stories (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  dek TEXT NOT NULL,
  sections TEXT NOT NULL,
  theme_label TEXT NOT NULL,
  date TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  photo_credit TEXT,
  cote TEXT,
  lang TEXT NOT NULL DEFAULT 'fr',
  email_capture_variant TEXT,
  sponsor TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_published_at ON stories(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_status_date ON stories(status, date);
