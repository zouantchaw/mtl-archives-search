# ETL Schema (Trust-First)

This document defines the target schema for the redesigned ETL pipeline. It is additive and non-destructive: raw fields are retained, normalized fields are added, and provenance is explicit.

## Stages and Outputs

- **Raw ingest** -> `manifest_raw.jsonl` (current: `manifest.jsonl`)
- **Missing ingest** -> `manifest_missing.jsonl` + `manifest_extended.jsonl`
- **Canonical normalize** -> `manifest_canonical.jsonl`
- **Date normalize** -> `manifest_dated.jsonl`
- **Record linkage** -> `manifest_linked.jsonl`
- **Enrichment** -> `manifest_enriched.jsonl` (current: `manifest_enriched_v3.jsonl`)
- **Deduplication (optional)** -> `manifest_deduped.jsonl`
- **Trust scoring** -> `manifest_scored.jsonl`
- **Localization** -> `manifest_bilingual.jsonl`

Each stage must write a new file; no stage should overwrite a prior output.

## Core Identifier Fields (Required)

- `metadata_filename` (string)
  - Original metadata filename (stable primary ID).
- `image_filename` (string)
  - Source image filename from ingestion.
- `resolved_image_filename` (string)
  - Final filename used for storage and access.

## Asset Fields

- `external_url` (string)
  - Source image URL (Montreal archive).
- `image_exists` (bool)
  - Whether the image was found at ingest time.
- `image_size_bytes` (int)
  - Size of the stored image.

## Raw Text Fields

- `title_raw` (string)
  - Raw title/name field from source.
- `description_raw` (string)
  - Raw description from source.
- `portal_title_raw` (string)
- `portal_description_raw` (string)
- `portal_date_raw` (string)
- `portal_cote_raw` (string)
- `portal_credits_raw` (string)
- `portal_title_normalized` (string)
- `portal_description_normalized` (string)

## Normalized Text Fields

- `title_normalized` (string)
  - Cleaned, human-readable title (no codes).
- `title_is_code_like` (bool)
  - True when `title_raw` looks like a code/filename.
- `description_normalized` (string)
  - Cleaned description. No synthetic padding here.
- `description_source` (enum)
  - `original` | `portal` | `aerial` | `synthetic` | `vlm` | `ocr` | `missing`
- `description_language` (string)
  - `fr` | `en` | `unknown`

## Attribute Fields

- `attributes` (array)
  - Raw attributes array from source metadata.
- `attributes_map` (object)
  - Normalized key/value map for attribute lookup.

## Date Fields

- `date_raw` (string)
  - Raw date string as provided by source.
- `date_raw_source` (string)
  - `attributes` | `portal` | `missing`
- `date_value` (string)
  - Normalized date (year or year range).
- `date_confidence` (float)
  - Confidence in normalized date (0-1).

## Credits / Cote Fields

- `credits` (string)
- `cote` (string)

## Portal Linkage Fields

- `portal_match` (bool)
  - Whether a portal record is linked.
- `portal_record` (object)
  - Raw portal record payload (if available).
- `record_link_id` (string)
  - Linked portal or external record ID.
- `record_link_confidence` (float)
  - Confidence score for linkage.
- `record_link_evidence` (object)
  - Evidence used (filename match, cote match, embedding similarity).
  - `record_link_evidence.portal.bge_similarity` stores cosine similarity when BGE matching is used.

## Aerial Match Fields

- `aerial_matches` (array)
  - Matches to aerial datasets with evidence.
- `aerial_title` (string)
- `aerial_description` (string)
- `aerial_date_raw` (string)
- `aerial_date_value` (string)
- `aerial_date_confidence` (float)
- `aerial_credits` (string)
- `aerial_cote` (string)
- `aerial_source_dataset` (string)

## VLM Fields

- `vlm_caption` (string)
  - AI-generated caption (English by default).
- `vlm_caption_source` (string)
  - Model or run identifier.
- `vlm_captioned_at` (string)
  - ISO timestamp of generation.
- `vlm_caption_confidence` (float)
  - Overall confidence (0-1).
- `vlm_tags` (object)
  - Structured tags: `objects`, `setting`, `actions`, `landmarks`.
- `vlm_tags_source` (string)
- `vlm_tags_generated_at` (string)
- `vlm_tags_confidence` (float)
- `vlm_tags_error` (string)
- `vlm_error` (string)
  - Error message, if any.

## OCR Fields

- `ocr_text` (string)
- `ocr_confidence` (float)
- `ocr_word_count` (int)
- `ocr_language` (string)
- `ocr_source` (string)
- `ocr_generated_at` (string)
- `ocr_error` (string)
- `ocr_original_width` (int)
- `ocr_original_height` (int)
- `ocr_processed_width` (int)
- `ocr_processed_height` (int)
- `ocr_downscaled` (bool)

## Geocoding Fields

- `geo_lat` (float)
- `geo_lng` (float)
- `geo_source` (string)
  - `name` | `description` | `portal`
- `geo_confidence` (float)
- `geo_place_name` (string)

## Trust Scoring Fields

- `trust_score` (float)
  - Overall trust of the record (0-1).
- `field_confidence` (object)
  - Confidence per field (title, description, date, location).
- `display_policy` (object)
  - `show_description`, `show_vlm_caption`, `show_location`.

## Quality Flags

- `metadata_quality` (object)
  - `quality_flags` (array)
  - Examples: `code-like-title`, `missing-description`, `short-description`

## Deduplication Fields

- `dedupe_key` (string)
  - Normalized `external_url` used for dedupe grouping.
- `dedupe_count` (int)
  - Number of records collapsed into this record.
- `dedupe_metadata_filenames` (array)
  - All `metadata_filename` values in the group.
- `dedupe_image_filenames` (array)
  - All `image_filename` values in the group.

## Localization Fields

- `description_fr`, `description_en`
- `vlm_caption_fr`, `vlm_caption_en`
- `lang_primary`, `lang_secondary`

## Schema Invariants

- Never overwrite raw fields; add normalized versions.
- Synthetic text must never replace an original description.
- Any AI-generated field must carry a confidence + source.
- UI should be gated on `display_policy`, not raw fields.
