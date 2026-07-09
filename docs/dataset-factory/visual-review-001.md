# Visual Review 001

Issue: GitHub #48

Visual Review 001 is the first manual/Codex-assisted promotion pass after adjudication. Adjudication intentionally held most generated labels because batch labels are not gold just because they are schema-valid. This pass adds explicit visual evidence for a small ground-level slice and clears only the review flags that the visual review can actually support.

## Scope

The first slice is 12 ground-level or ground-object records from `batch-001-adjudicated-labels.jsonl`.

Selection rules:

- `review.review_stage` is `batch`.
- `labels.image_mode` starts with `ground`.
- The row already has observed evidence.
- The row has no nested entity/OCR/georeference review flags.

The contact sheet used for review was generated at `/tmp/mtl_visual_review_001/contact_sheet.jpg`. It confirmed broad visual subject fit for horse-drawn snow equipment, street/building views, park scenes, and named public/institutional places. This is not a geocoding or exact-address verification pass.

## Command

```bash
npm run dataset-factory:apply-visual-review-001
```

Optional inputs:

```bash
npm run dataset-factory:apply-visual-review-001 -- \
  --input data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/batch-001-adjudicated-labels.jsonl \
  --decisions data/mtl_archives/reports/dataset_factory_batch_001/visual_review_001/visual-review-decisions.jsonl \
  --output data/mtl_archives/reports/dataset_factory_batch_001/visual_review_001
```

## Outputs

Default output directory:

`data/mtl_archives/reports/dataset_factory_batch_001/visual_review_001`

Files:

- `visual-review-decisions.jsonl` - explicit review decisions.
- `visual-review-001-applied-labels.jsonl` - full 150-row label set after decisions.
- `gold-labels-batch-001.visual-review-001.jsonl` - gold rows after this pass.
- `batch-001-held-after-visual-review-001.jsonl` - rows still held for review.
- `visual-review-001-not-promoted.jsonl` - decisions that did not pass strict gold policy.
- `visual-review-001-report.json`
- `visual-review-001-report.md`

## Promotion Policy

A visual-review decision can add observed evidence and clear named top-level review flags. It does not clear nested OCR/entity/georeference flags. A row is promoted to `gold` only when:

- `confidence.needs_human_review` is false after flag clearing.
- top-level review flags are empty.
- nested label review flags are empty.
- `confidence.overall >= 0.72`.
- observed and metadata evidence both exist.
- search expectations exist.

## Next Review Slices

- Continue direct visual review on the remaining ground-level rows that do not need entity/OCR/georeference review.
- Run an OCR/entity review slice for billboards, signs, brands, and named buildings.
- Run a separate aerial/georeference review slice; those rows need different evidence and should not be promoted by direct visual subject match alone.
