# MTL-CityMemory-Bench v0

Issue: GitHub #49

Status: benchmark generator ready; reviewed-gold v0 artifact exists at `data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold`.

## Purpose

MTL-CityMemory-Bench v0 turns Dataset Factory labels into repeatable ML/search evaluation tasks.

The goal is to stop judging archive intelligence by vibes. Every model, search policy, OCR layer, reranker, or active-learning strategy should be compared against stable benchmark tasks.

## Build

```bash
npm run dataset-factory:benchmark-v0
```

Default input:

- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl`

Default outputs:

- `data/mtl_archives/reports/dataset_factory_benchmark_v0/manifest.json`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/README.md`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/record_splits.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/retrieval_tasks.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/classification_tasks.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/provenance_tasks.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/ranking_tasks.jsonl`

Generated benchmark outputs are ignored by git. Commit the generator and docs, not the local report payloads.

## Reviewed-Gold v0 Artifact

The current reviewed-gold v0 benchmark was generated from:

- `data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl`

Output directory:

- `data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold`

Current counts:

- labels: `20`
- splits: `15` train, `2` validation, `3` test
- retrieval tasks: `26`
- classification tasks: `120`
- provenance tasks: `107`
- derived pairwise ranking tasks: `8`

This is enough for v0 regression, reranker evaluation, CPU baseline modeling, reward-row generation, and active-learning acquisition. It is not large enough for a shipping model decision.

## Search Baseline

Run the current live API baseline:

```bash
npm run dataset-factory:benchmark-v0:search
```

Default outputs:

- `data/mtl_archives/reports/dataset_factory_benchmark_v0/search_baseline_current.json`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/search_baseline_current.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/search_baseline_current.md`

The search baseline evaluates every retrieval task in:

- `semantic`
- `smart`
- `visual`

The current live API does not have a real OCR lexical mode yet. OCR-specific tasks, such as `Magic baking powder`, are still included so the benchmark can prove whether future OCR/reranking work improves retrieval.

## Search Reranker

Run the offline search reranker evaluator:

```bash
npm run dataset-factory:search-reranker-v0
```

See `docs/dataset-factory/search-reranker-v0.md`.

The reranker evaluator exports candidate rows, generated pairwise preferences, learned linear weights, and smart-vs-reranker metrics including duplicate rate. It is an offline evaluation tool first; production ranking changes should wait until the query set is larger and benchmark lift is stable.

## Task Families

### Retrieval

Query-to-image tasks from `labels.search_expectations`.

Metrics:

- Precision@1
- Precision@3
- Precision@10
- MRR
- expected-bucket pass rate

### Classification

Label prediction tasks for:

- `image_mode`
- `aerial_land_use`
- `aerial_segmentation_candidate`
- `aerial_georeference_candidate`
- `human_legible`
- `story_value`
- `print_value`
- `search_value`
- `needs_human_review`

### Provenance

Evidence-bucket tasks that ask whether a claim is:

- observed visually
- copied from metadata
- inferred
- externally verified

### Ranking

Pairwise tasks derived from label-value deltas for:

- story value
- print value
- search value

These require adjudication before reward-model training.

## Split Policy

The generator splits by `family_key`:

- aerial `VM97-3_7P*` flight strip when available
- oblique `VM94-B*` reportage when available
- otherwise `record_id`

This is only a first leakage control. Replace it with the Visual Family Graph once #54 exists.

## Known Caveats

- The reviewed-gold set is small and must expand before model-training decisions are trusted.
- Ranking tasks are derived and need more adjudication before reward-model training.
- Aerial exact coordinates and acreage are not benchmark targets until georeferencing labels exist.
- Live search baselines can change with deployments, indexes, cache behavior, or API changes.
