# Tasks

Source of truth for active work. For deeper background, see `docs/etl-redesign-trust-plan.md`.

## Active (Jan 2026)
- [ ] Define FR/EN localization policy with AI labeling and trust gating.
- [ ] Investigate larger VLM model for structured tagging (uform-500m insufficient).

## QA Report (2026-01-10)

50-record sample + full dataset analysis. See `pipelines/qa/qa_report.json`.

**VLM Structured Tags**:
- 50.1% returned JSON, 49.9% errors (`no_json_object` - model returns prose)
- Of successful JSON, 37.9% are placeholder values (`"..."`, `[object Object]`)
- Effective useful rate: ~12% (1,656 records with real content)
- Confidence: 0.00 (uform-500m doesn't emit confidence scores)
- **Verdict**: uform-500m is too small for reliable structured output

**OCR (Tesseract fra+eng)**:
- 2.7% high confidence (>0.5) with actual text (368 records)
- These are mostly city stamps on aerial photos ("SERVICE DE L'HABITATION...")
- 97% are noise extraction from images without text
- **Verdict**: OCR works when text exists, but most archive images don't have text

**Trust Scores**:
- High (>0.7): 1.8% (239 records)
- Medium (0.4-0.7): 1.1% (146 records)
- Low (<0.4): 97.1% (13,114 records)
- Low scores reflect poor VLM output quality

## Next
- [ ] Add OCR text to D1 (batch update for high-confidence records only).
- [ ] Build a gold set (300 records) + automated QA checks.
- [ ] Improve geocoding coverage and confidence scoring.
- [ ] Revisit portal linkage if new authoritative datasets become available.
- [ ] Re-run VLM tagging with larger model (LLaVA-7B or Qwen-VL-7B).

## Done (recent)
- [x] QA sample analysis complete (50 records + full dataset stats logged).
- [x] OCR pass complete (13.5k images, 2.7% with high-confidence text).
- [x] VLM structured tags complete (50% JSON rate, ~12% usable).
- [x] Vision enrichments merged into `manifest_enriched_v3.jsonl`.
- [x] Trust scores generated in `manifest_scored.jsonl`.
- [x] D1 schema updated (added `ocr_text`, `trust_score` columns).
- [x] D1 seeded with 13,499 records + trust scores.
- [x] BGE text embeddings refreshed (13,499 vectors).
- [x] BGE record linkage + calibration report.
- [x] Structured VLM tagging + OCR pipelines implemented.
- [x] CLIP vectorize GPU pipeline added.
- [x] Architecture + trust docs refreshed.
