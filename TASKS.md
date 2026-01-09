# Tasks

Source of truth for active work. For deeper background, see `docs/etl-redesign-trust-plan.md`.

## Active (Jan 2026)
- [ ] Finish OCR pass + VLM tags retry on the remote instance.
- [ ] Merge vision enrichments into `manifest_enriched_v3.jsonl` and regenerate `manifest_scored.jsonl`.
- [ ] Review a 50-record QA sample (OCR + tags) and log error rates.

## Next
- [ ] Decide which OCR/VLM fields to store in D1 (schema + seed update).
- [ ] Refresh semantic embeddings to use description + caption (+ OCR when trusted).
- [ ] Define FR/EN localization policy with AI labeling and trust gating.
- [ ] Build a gold set (300 records) + automated QA checks.
- [ ] Improve geocoding coverage and confidence scoring.
- [ ] Revisit portal linkage if new authoritative datasets become available.

## Done (recent)
- [x] BGE record linkage + calibration report.
- [x] Structured VLM tagging + OCR pipelines implemented.
- [x] CLIP vectorize GPU pipeline added.
- [x] Architecture + trust docs refreshed.
