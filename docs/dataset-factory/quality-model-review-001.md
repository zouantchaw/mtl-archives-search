# Quality Model Review 001

Issue: GitHub #48

Quality Model Review 001 follows OCR Entity Review 001. It reviews OCR-rich held rows whose active blockers are not OCR anymore, but broad quality/model flags from the original active-learning acquisition.

## Scope

Input file:

`data/mtl_archives/reports/dataset_factory_batch_001/ocr_entity_review_001/ocr-entity-review-001-applied-labels.jsonl`

Reviewed rows:

- `mtl_archives_metadata_0.json` - Magic Baking Powder / The Gazette
- `mtl_archives_metadata_105.json` - Catelli / White Rose / Hertz / Tilden
- `mtl_archives_metadata_10.json` - Melachrino / Coca-Cola / Carter Ink / United Cigar Stores / Guinea Gold
- `mtl_archives_metadata_68.json` - Canadian Pacific / Gare Jean-Talon

## Command

```bash
npm run dataset-factory:apply-quality-model-review-001
```

## Policy

This pass can clear:

- `model_disagreement`
- stale `aerial_land_use_uncertain` on confirmed ground-level rows
- `quality_repair_needed` when the image is usable for label/eval gold
- stale top-level `needs_human_review` when other active flags remain to carry the review state

It does not clear:

- `external_verification_needed`
- `entity_resolution_needed`
- `geo_reference_needed`

That keeps georeference and external entity work in its own stricter queue.

## Outputs

Default output directory:

`data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001`

Files:

- `quality-model-review-decisions.jsonl`
- `quality-model-review-001-applied-labels.jsonl`
- `gold-labels-batch-001.quality-model-review-001.jsonl`
- `batch-001-held-after-quality-model-review-001.jsonl`
- `quality-model-review-001-updated-held.jsonl`
- `quality-model-review-001-not-promoted.jsonl`
- `quality-model-review-001-report.json`
- `quality-model-review-001-report.md`

## Notes

`mtl_archives_metadata_0.json` is the main promotion target: OCR Entity Review 001 already confirmed `MAGIC BAKING POWDER` and `The Gazette`, and this pass clears the remaining quality/model blockers. The other rows receive useful cleanup but stay held because exact place/entity resolution still needs external review.
