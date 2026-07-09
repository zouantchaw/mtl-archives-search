# Visual Review 002

Issue: GitHub #48

Visual Review 002 exhausts the remaining clean ground-level rows after Visual Review 001. Only three held records still met the direct visual-review criteria: visible ground-level subject, no nested OCR/entity/georeference review flags, and only top-level `synthetic_description` holding them back.

## Scope

Rows reviewed:

- `mtl_archives_metadata_18.json` - Marché Saint-Jacques
- `mtl_archives_metadata_32.json` - Eaton's
- `mtl_archives_metadata_59.json` - Metropolitain Stores

The contact sheet used for review was generated at `/tmp/mtl_visual_review_002/contact_sheet.jpg`.

This pass confirms broad visual subject fit and readable storefront text where visible. It does not independently verify exact addresses.

## Command

```bash
npm run dataset-factory:apply-visual-review -- \
  --pass-id visual_review_002 \
  --input data/mtl_archives/reports/dataset_factory_batch_001/visual_review_001/visual-review-001-applied-labels.jsonl \
  --decisions data/mtl_archives/reports/dataset_factory_batch_001/visual_review_002/visual-review-decisions.jsonl \
  --output data/mtl_archives/reports/dataset_factory_batch_001/visual_review_002
```

## Outputs

Default output directory for this pass:

`data/mtl_archives/reports/dataset_factory_batch_001/visual_review_002`

Files:

- `visual-review-decisions.jsonl` - explicit review decisions.
- `visual-review-002-applied-labels.jsonl` - full 150-row label set after Visual Review 002.
- `gold-labels-batch-001.visual-review-002.jsonl` - gold rows after this pass.
- `batch-001-held-after-visual-review-002.jsonl` - rows still held for review.
- `visual-review-002-not-promoted.jsonl` - decisions that did not pass strict gold policy.
- `visual-review-002-report.json`
- `visual-review-002-report.md`

## Resulting Queue Shape

After this pass, direct visual review is no longer the main bottleneck. The remaining held rows are expected to be dominated by:

- aerial/georeference review
- OCR/entity review
- quality/orientation repair
- document/map handling

Those queues need stricter policies than a simple visual subject-match review.
