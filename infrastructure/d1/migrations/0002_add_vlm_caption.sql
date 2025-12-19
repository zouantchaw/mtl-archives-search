-- Migration number: 0002	2025-12-18
-- Add vlm_caption column for VLM-generated image descriptions

ALTER TABLE manifest ADD COLUMN vlm_caption TEXT;
