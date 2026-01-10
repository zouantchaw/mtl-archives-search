# Tasks

Source of truth for active work. For deeper background, see `docs/etl-redesign-trust-plan.md`.

## Active (Jan 2026)
- [ ] Review a 50-record QA sample (OCR + tags) and log error rates.
- [ ] Define FR/EN localization policy with AI labeling and trust gating.

## Next
- [ ] Add OCR text to D1 (batch update or incremental approach).
- [ ] Build a gold set (300 records) + automated QA checks.
- [ ] Improve geocoding coverage and confidence scoring.
- [ ] Revisit portal linkage if new authoritative datasets become available.

## Done (recent)
- [x] OCR pass complete (13.5k images, 50% with text).
- [x] VLM structured tags complete (50% success rate with uform-500m).
- [x] Vision enrichments merged into `manifest_enriched_v3.jsonl`.
- [x] Trust scores generated in `manifest_scored.jsonl`.
- [x] D1 schema updated (added `ocr_text`, `trust_score` columns).
- [x] D1 seeded with 13,499 records + trust scores.
- [x] BGE text embeddings refreshed (13,499 vectors).
- [x] BGE record linkage + calibration report.
- [x] Structured VLM tagging + OCR pipelines implemented.
- [x] CLIP vectorize GPU pipeline added.
- [x] Architecture + trust docs refreshed.
