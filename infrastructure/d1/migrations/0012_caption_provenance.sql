-- Generated captions are observations, distinct from archival descriptions.
ALTER TABLE manifest ADD COLUMN vlm_caption_source TEXT;
ALTER TABLE manifest ADD COLUMN vlm_caption_model TEXT;
ALTER TABLE manifest ADD COLUMN vlm_caption_status TEXT;
