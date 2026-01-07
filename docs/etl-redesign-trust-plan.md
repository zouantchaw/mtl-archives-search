# ETL Redesign: Trust-First Metadata Pipeline

Goal: rebuild the ETL pipeline so metadata is accurate, traceable, bilingual-ready, and safe to display to Quebec customers.

## Why a Redesign (Current Gaps)
- Descriptions are mostly synthetic (97.6%), so text is not trustworthy.
- Names are mostly codes/filenames (97.2%), so titles are not trustworthy.
- VLM captions are useful for coarse search, but often generic and English-only.
- Portal metadata coverage is tiny (0.7%); authoritative sources are under-linked.
- Geocoding coverage is tiny (1.1%); map UX must handle missing coords.

Reference reports:
- `data/mtl_archives/reports/metadata_deep_analysis.md`
- `docs/data-quality-audit.md`

## Design Principles
- Source-of-truth first: favor official/portal metadata over AI-generated content.
- Evidence-based enrichment: store AI outputs with confidence and provenance.
- Non-destructive transforms: keep raw fields, add normalized fields.
- Deterministic runs: inputs + code versions yield reproducible output.
- Bilingual safety: never show English AI text when UI is French unless labeled.

## Proposed Pipeline (High-Level)
1) **Ingest & Normalize (Raw -> Canonical)**
2) **Record Linkage (Canonical -> Linked)**
3) **Enrichment (Linked -> Enriched)**
4) **Trust Scoring (Enriched -> Scored)**
5) **Localization (Scored -> Bilingual)**
6) **Evaluation + QA (Continuous)**

Each step writes a new JSONL manifest to avoid overwriting prior outputs.

## Data Contract (Fields We Need)
Minimum fields (additive, not destructive):
- `title_raw`, `description_raw`
- `title_normalized`, `description_normalized`
- `description_source` (portal/original/synthetic/vlm/ocr)
- `description_confidence` (0-1)
- `vlm_caption`, `vlm_caption_source`, `vlm_caption_confidence`
- `vlm_tags` (structured JSON)
- `ocr_text`, `ocr_confidence`
- `record_link_id`, `record_link_confidence`, `record_link_evidence`
- `geo_lat`, `geo_lng`, `geo_source`, `geo_confidence`
- `lang_primary`, `lang_secondary`
- `trust_score` (overall, derived)

## Phase 0: Inventory + Schema
Tasks:
- Inventory all raw sources in `data/mtl_archives/` (CSV/JSON/JSONL).
- Document authoritative sources (portal vs derived vs AI).
- Define canonical schema + field mapping doc.
Deliverables:
- `docs/etl-schema.md` (field definitions + provenance rules).
- `data/mtl_archives/reports/source_inventory.md`.

## Phase 1: Normalize & Canonicalize
Tasks:
- Rewrite `packages/scripts/src/etl/clean-metadata.ts` into a strict normalizer:
  - Keep raw text fields intact.
  - Output normalized fields alongside raw.
  - Normalize dates via `pipelines/etl/normalize_dates.py` into `date_value`.
- Normalize name/title fields (remove codes, keep original elsewhere).
Deliverables:
- `manifest_canonical.jsonl`
- `manifest_canonical_summary.json`
Acceptance:
- No synthetic text in normalized fields.

## Phase 2: Record Linkage (Portal + External)
Tasks:
- Build deterministic matching rules:
  - Exact filename match
  - Cote match
  - Date + title similarity (BGE-M3)
- Store link evidence and confidence.
Deliverables:
- `manifest_linked.jsonl`
- `reports/record_linkage_report.md`
Acceptance:
- Link accuracy measured on a manual sample (>=95% precision).

## Phase 3: Evidence-Based Enrichment
Tasks:
- VLM in structured JSON mode:
  - `objects`, `setting`, `actions`, `landmarks`, `time_period_guess`
  - Require "unknown" for uncertain fields.
- OCR pass for visible text (street names, storefronts, addresses).
- Only generate free-form `vlm_caption` from structured tags + OCR text.
Deliverables:
- `manifest_enriched.jsonl`
- `reports/vlm_structured_samples.md`
Acceptance:
- Manual review of 50 records: <10% factual errors.

## Phase 4: Trust Scoring + Gating
Tasks:
- Compute `trust_score` per field based on provenance:
  - portal/original = high
  - OCR = medium
  - VLM tags = medium-low
  - Synthetic = low
- Store `display_policy` fields:
  - `show_description`, `show_vlm_caption`, `show_location`
Deliverables:
- `manifest_scored.jsonl`
- `reports/trust_score_distribution.md`
Acceptance:
- Clear, deterministic display rules for UI.

## Phase 5: Localization
Tasks:
- Add bilingual fields:
  - `description_fr`, `description_en`
  - `vlm_caption_fr`, `vlm_caption_en`
- Translation only when a reliable source exists (avoid translating low-trust text).
- Always label AI-generated + AI-translated text in UI.
Deliverables:
- `manifest_bilingual.jsonl`
- `reports/translation_coverage.md`

## Phase 6: Evaluation + QA Loop
Tasks:
- Create a gold set of 300 records with human-verified metadata.
- Run automatic checks:
  - semantic similarity (BGE-M3)
  - hallucination heuristics (landmark mismatch)
- Weekly review of lowest-confidence records.
Deliverables:
- `reports/qa_dashboard.md`
- `data/mtl_archives/gold_set.jsonl`

## Metrics to Track
- % records with portal linkage
- % records with original descriptions
- VLM error rate and hedge rate
- Language coverage (FR/EN)
- Geocoding coverage + confidence
- Trust score distribution

## Implementation Notes
- Keep existing scripts, but introduce new staged outputs rather than rewrites.
- Gate UI off `display_policy` rather than raw fields.
- Avoid using VLM captions for final marketing copy; use human metadata when present.

## Immediate Next Steps (Suggested Order)
1) Build `source_inventory.md` + `etl-schema.md`.
2) Implement canonical normalization output.
3) Implement record linkage + evidence tracking.
4) Add OCR + structured VLM tags.
5) Compute trust score + display policy.

