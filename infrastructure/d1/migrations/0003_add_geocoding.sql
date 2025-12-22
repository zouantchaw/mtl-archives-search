-- Migration number: 0003	2025-12-21
-- Add geocoding columns for map display

ALTER TABLE manifest ADD COLUMN latitude REAL;
ALTER TABLE manifest ADD COLUMN longitude REAL;
ALTER TABLE manifest ADD COLUMN geocode_confidence REAL;
ALTER TABLE manifest ADD COLUMN geocode_source TEXT;

-- Index for spatial queries (basic - for filtering geolocated photos)
CREATE INDEX IF NOT EXISTS idx_manifest_has_coords ON manifest(latitude) WHERE latitude IS NOT NULL;
