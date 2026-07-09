# Active-Learning Labeling 001

Issue: GitHub #48

Status: top-100 Codex draft labeler ready. These labels are candidate gold, not adjudicated gold.

## Purpose

This pass converts the highest-ranked rows from Active Learning v0 into evidence-aware Dataset Factory labels.

It starts with the top 100 records from:

- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl`

The labeler keeps the evidence boundary conservative:

- source metadata claims go into `evidence.metadata`
- acquisition/current-signal claims go into `evidence.inferred`
- `evidence.observed` stays empty until direct visual review/adjudication records observations
- exact coordinates and acreage are not claimed
- every row is marked `needs_human_review`

## Build

```bash
npm run dataset-factory:label-active-learning-001
```

Useful options:

```bash
npm run dataset-factory:label-active-learning-001 -- --limit 150
```

Default outputs:

- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/active-learning-top-100-labels.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/gold-labels-batch-001.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/active-learning-top-100-contact-sheet.html`
- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/active-learning-top-100-label-summary.json`
- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/active-learning-top-100-label-summary.md`

`gold-labels-batch-001.jsonl` combines:

- 50 existing calibration labels
- 100 active-learning draft labels

It is named for downstream compatibility, but labels still carry `review_stage: "batch"` until adjudicated.

## Acceptance Notes

This pass satisfies the first #48 scaling step when:

- the top-100 label file exists
- the combined candidate Batch 001 label file exists
- all generated rows pass the lightweight label-contract check
- at least the first 50 generated rows pass the same spot-check
- summary includes lane balance, image-mode balance, land-use balance, review flags, and known weak spots

## Caveats

- These labels are safe for baseline experiments with review-stage filtering.
- They should not be treated as final gold without visual/human adjudication.
- Document/map rows from aerial packages are intentionally kept as hard negatives and georeference context.
