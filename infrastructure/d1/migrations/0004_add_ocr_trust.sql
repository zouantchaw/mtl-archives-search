-- Migration number: 0004	2026-01-10
-- Add OCR text and trust score columns from vision enrichment pipeline

ALTER TABLE manifest ADD COLUMN ocr_text TEXT;
ALTER TABLE manifest ADD COLUMN trust_score REAL;

-- Index for filtering by trust score
CREATE INDEX IF NOT EXISTS idx_manifest_trust_score ON manifest(trust_score);
