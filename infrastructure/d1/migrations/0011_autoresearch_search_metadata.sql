-- Migration number: 0011  2026-05-27
-- Autoresearch search metadata from taxonomy and image-quality outputs.
-- These columns are intentionally nullable so the search policy can be
-- rolled out and rolled back independently of existing manifest rows.

ALTER TABLE manifest ADD COLUMN taxonomy_primary_category TEXT;
ALTER TABLE manifest ADD COLUMN taxonomy_themes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE manifest ADD COLUMN taxonomy_search_facets TEXT NOT NULL DEFAULT '[]';
ALTER TABLE manifest ADD COLUMN taxonomy_review_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manifest ADD COLUMN taxonomy_exclude_default_visual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manifest ADD COLUMN image_quality_labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE manifest ADD COLUMN image_quality_severity TEXT;
ALTER TABLE manifest ADD COLUMN image_quality_action TEXT;

CREATE INDEX IF NOT EXISTS idx_manifest_taxonomy_primary_category
  ON manifest(taxonomy_primary_category);

CREATE INDEX IF NOT EXISTS idx_manifest_taxonomy_exclude_default_visual
  ON manifest(taxonomy_exclude_default_visual);

CREATE INDEX IF NOT EXISTS idx_manifest_image_quality_action
  ON manifest(image_quality_action);
