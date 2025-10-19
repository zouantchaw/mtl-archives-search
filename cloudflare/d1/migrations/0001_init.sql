-- Migration number: 0001	2025-10-17T10:12:18.569Z

CREATE TABLE IF NOT EXISTS manifest (
  metadata_filename TEXT PRIMARY KEY,
  image_filename TEXT NOT NULL,
  resolved_image_filename TEXT,
  image_size_bytes INTEGER,
  name TEXT,
  description TEXT,
  date_value TEXT,
  credits TEXT,
  cote TEXT,
  external_url TEXT,
  portal_match INTEGER NOT NULL DEFAULT 0,
  portal_title TEXT,
  portal_description TEXT,
  portal_date TEXT,
  portal_cote TEXT,
  aerial_datasets TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_manifest_date_value ON manifest(date_value);
CREATE INDEX IF NOT EXISTS idx_manifest_portal_match ON manifest(portal_match);
CREATE INDEX IF NOT EXISTS idx_manifest_name ON manifest(name);
CREATE INDEX IF NOT EXISTS idx_manifest_external_url ON manifest(external_url);
