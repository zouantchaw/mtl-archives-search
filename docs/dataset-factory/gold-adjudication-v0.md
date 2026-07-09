# Gold Adjudication v0

Issue: GitHub #48

Status: conservative automated adjudication ready. This promotes only the rows that are already low-risk enough for seed gold use.

## Purpose

Gold Adjudication v0 separates candidate Batch 001 labels into:

- gold seed labels
- held batch labels needing visual/human/geo/quality/entity review

This is deliberately strict. The goal is not to inflate the gold count; the goal is to prevent draft Codex labels from becoming training truth before the evidence supports it.

## Build

```bash
npm run dataset-factory:adjudicate-batch-001
```

Default input:

- `data/mtl_archives/reports/dataset_factory_batch_001/active_learning_top_100/gold-labels-batch-001.jsonl`

Default outputs:

- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/adjudication-decisions.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/batch-001-adjudicated-labels.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/gold-labels-batch-001.adjudicated.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/batch-001-held-for-review.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/adjudication-report.json`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/adjudication-report.md`
- `data/mtl_archives/reports/dataset_factory_batch_001/adjudication_v0/adjudication-review-queue.html`

## Promotion Policy

A row is promoted to `review_stage: "gold"` only when all of these are true:

- no top-level review flags
- no nested label review flags
- `needs_human_review` is false
- overall confidence is at least `0.72`
- observed visual evidence exists
- source metadata evidence exists
- at least one search expectation exists
- source rights are mapped to a commercial-use-allowed source package

Everything else stays `review_stage: "batch"` and receives review queue assignments.

## Review Queues

Held rows can enter one or more queues:

- `direct_visual_review`
- `geo_aerial_review`
- `quality_repair_review`
- `ocr_entity_review`
- `metadata_model_review`
- `rights_review`

## Caveats

- This is a conservative automated adjudication pass.
- Held rows are still useful as candidate labels and review work, but not final truth.
- The gold-only file should be small until visual/human adjudication catches up.
- Aerial rows with `geo_reference_needed` should not become gold until georeferencing or explicit human review resolves the uncertainty.
