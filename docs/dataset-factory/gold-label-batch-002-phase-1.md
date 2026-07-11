# Gold Label Batch 002: Phase 1

Issue: #68. Parent: #64. Status: frozen unlabeled packets; labeling has not started.

## Contract

Phase 1 regenerates 300 candidates against all 18,462 Canonical Corpus successor identities and the #77 Visual Family Graph v1 component/split authority. It excludes the 20 predecessor gold records and selects at most one record per authoritative leakage component. Retained Active Learning v0 signals influence acquisition but are not labels or family authority.

The ignored output root is `data/mtl_archives/reports/gold_label_batch_002`. It contains the pinned legacy inputs, 300-row hidden selection manifest, 12 sealed 25-image packets, 300 bounded direct-review JPEGs, empty primary/blind review paths, empty adjudication/search-disposition paths, and packet seals. No primary, blind, adjudicated, or search disposition label is present.

## Commands

```bash
DATASET_FACTORY_FIXED_NOW=2026-07-11T16:00:00.000Z npm run dataset-factory:gold-label-batch-002 -- --canonical-root /Users/wiel/Development/mtl-archives-search
npm run dataset-factory:gold-label-packets-002 -- --concurrency 8
npm run dataset-factory:gold-label-self-test-002
npm run dataset-factory:gold-label-bundle-002 -- --mode verify --bundle /path/to/gold-label-batch-002-phase-1.tar.gz
```

`dataset-factory:gold-label-validate-002` is intentionally expected to fail during phase 1. Completion requires 300 primary rows, 300 independently blind-reviewed rows, 300 explicit adjudications, all 49 silver dispositions, disjoint reviewer IDs, zero packet/schema/hash/family/split drift, and at least 200 supported promotions or an explicitly approved continuation shortfall.

## Worker Boundary

Primary workers receive only one packet directory, its `rows.jsonl`, `instructions.json`, and referenced `packets/images/*.jpg`. Blind workers receive the same visual-only shape under a different reviewer ID and must not read `batch/`, `inputs/`, `search/`, `reviews/primary/`, selection scores, metadata, prior labels, VLM/taxonomy output, components, or splits. Workers write `dataset_factory_label_v0` factual labels plus the review-pass sidecar; they must abstain rather than infer unsupported identity or location.

An adjudicator may read both completed passes only after both are frozen. It must preserve observed/metadata/inferred/verified boundaries and explicitly mark every row promoted, held, rejected, or unresolved. Search reviewers process all 49 tasks using the four allowed dispositions while preserving the pinned V1 component and split.

## Reproducibility

The tracked descriptor is `docs/dataset-factory/fixtures/gold-label-batch-002/phase-1-bundle-v1.json`. It describes an unuploaded, incomplete-label phase-1 bundle. Large packet artifacts remain ignored. A final labeled bundle must be rebuilt and separately registered only after independent review and adjudication; the phase-1 object must never be represented as completed gold evidence.
