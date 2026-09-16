-- Provenance packages. Collection ids only; source photos/captions are never rewritten.
CREATE TABLE IF NOT EXISTS provenance_package (
  id TEXT PRIMARY KEY,
  title TEXT,
  intended_use TEXT NOT NULL,
  query TEXT,
  photo_ids_json TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'draft',
  reviewer_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provenance_package_updated
  ON provenance_package(updated_at);
