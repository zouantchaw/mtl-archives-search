# Active Learning v0

Issue: GitHub #50

Status: generator ready; selected records still need Codex/human labeling before they become gold labels.

## Purpose

Active Learning v0 chooses the next records to label so Dataset Factory effort improves ML/search coverage faster than random sampling.

The selector scores every currently unlabeled record using:

- benchmark search failures from MTL-CityMemory-Bench v0
- model-baseline gaps from Model Baseline v0, including single-class targets and weak classifier targets
- taxonomy uncertainty and review-required signals
- scene-text, entity, and landmark candidates
- aerial land-use/geolocation candidates
- rare clusters and collection overlaps
- quality-repair risk from image-quality, artifact, and cleanup reports
- commercial/story/reward candidates from social and print signals
- lightweight family throttling so one aerial strip or reportage does not dominate the queue

## Build

```bash
npm run dataset-factory:active-learning-v0
```

Useful options:

```bash
npm run dataset-factory:active-learning-v0 -- --queue-size 500 --max-per-family 8
```

Default inputs:

- `data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl`
- `data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl`
- `data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl`
- `data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl`
- `data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl`
- `data/mtl_archives/reports/dataset_factory_benchmark_v0/search_baseline_current.jsonl`
- `data/mtl_archives/reports/image_artifact_decisions.ndjson`
- `data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_rows.jsonl`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_report.json`

Default outputs:

- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.jsonl`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-batch-001.csv`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/random-baseline-batch-001.jsonl`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-contact-sheet.html`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-report.json`
- `data/mtl_archives/reports/dataset_factory_active_learning_v0/active-learning-report.md`

Generated outputs are ignored by git. Commit the generator and docs, not the local queue payload.

## Queue Contract

Each queue row includes:

- selected record metadata and image URL
- acquisition score, primary stratum, all strata, score components, and reasons
- lightweight family key and family count in the queue
- current VLM/taxonomy/quality/candidate/collection/search-failure signals
- model-baseline gap targets when the row is selected to repair a measured weak target
- required label fields
- ML tasks the row is meant to support
- cautions about evidence boundaries, OCR certainty, aerial geolocation, and repair-dependent labels

## Done Criteria

For #50, the queue is considered useful when:

- `active-learning-batch-001.jsonl` exists
- the report explains why each stratum was selected
- the active queue has better benchmark/search/label coverage than the deterministic random baseline

## Caveats

- This is an acquisition queue, not a final gold-label set.
- Family throttling is metadata-based until Visual Family Graph v0 exists.
- Search-failure boosts use the current live API baseline; regenerate the baseline after search or index changes.
- Model-baseline boosts use the current CPU text baseline; rerun `npm run dataset-factory:model-baseline-v0` after materially changing reviewed labels.
- Scores optimize labeling value, not public product quality.
