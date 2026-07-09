# OCR Entity Review 001

Issue: GitHub #48

OCR Entity Review 001 is the first pass over the held rows with text/entity uncertainty after Visual Review 002. The goal is to separate actual visible text from source-metadata-only entity guesses, then promote only rows whose remaining flags are fully resolved.

## Scope

Input file:

`data/mtl_archives/reports/dataset_factory_batch_001/visual_review_002/visual-review-002-applied-labels.jsonl`

Candidate rows reviewed: 15.

Local contact sheet:

`/tmp/mtl_ocr_entity_review_001/contact_sheet.jpg`

Rows with confirmed OCR/entity updates:

- `mtl_archives_metadata_0.json` - Magic Baking Powder / The Gazette
- `mtl_archives_metadata_13.json` - Buckingham / Turret / Matthew's Lunch
- `mtl_archives_metadata_26.json` - PARADISE / DANCE
- `mtl_archives_metadata_6.json` - Melachrino / Coca-Cola / Carter Ink / United Cigar Stores / Guinea Gold
- `mtl_archives_metadata_105.json` - Catelli / White Rose / Hertz / Tilden
- `mtl_archives_metadata_10.json` - replaces title-derived false OCR with visible commercial text
- `mtl_archives_metadata_68.json` - Canadian Pacific / Gare Jean-Talon

The remaining reviewed rows stay held because the blocking issue is external entity/georeference, quality, or visual-subject verification rather than OCR.

## Command

```bash
npm run dataset-factory:apply-ocr-entity-review-001
```

Optional explicit form:

```bash
npm run dataset-factory:apply-ocr-entity-review-001 -- \
  --input data/mtl_archives/reports/dataset_factory_batch_001/visual_review_002/visual-review-002-applied-labels.jsonl \
  --decisions data/mtl_archives/reports/dataset_factory_batch_001/ocr_entity_review_001/ocr-entity-review-decisions.jsonl \
  --output data/mtl_archives/reports/dataset_factory_batch_001/ocr_entity_review_001
```

## Outputs

Default output directory:

`data/mtl_archives/reports/dataset_factory_batch_001/ocr_entity_review_001`

Files:

- `ocr-entity-review-decisions.jsonl` - explicit review decisions.
- `ocr-entity-review-001-applied-labels.jsonl` - full 150-row label set after the pass.
- `gold-labels-batch-001.ocr-entity-review-001.jsonl` - gold rows after the pass.
- `batch-001-held-after-ocr-entity-review-001.jsonl` - rows still held for review.
- `ocr-entity-review-001-updated-held.jsonl` - reviewed rows that received updates but remained held.
- `ocr-entity-review-001-not-promoted.jsonl` - requested promotions blocked by strict policy.
- `ocr-entity-review-001-report.json`
- `ocr-entity-review-001-report.md`

## Promotion Policy

This pass can clear OCR/entity flags only when the image itself supports the claim. It does not clear:

- `external_verification_needed`
- `geo_reference_needed`
- `quality_repair_needed`
- `orientation_uncertain`
- broad `model_disagreement`

Rows with those remaining flags stay in `batch` even if useful OCR labels were added.
