# Search Reranker v0

Issue: GitHub #52

Status: offline evaluator complete for v0; production shipping is deliberately deferred until silver judgments are promoted and a Worker integration gate passes.

## Purpose

Search Reranker v0 turns reviewed-gold retrieval tasks into measurable ranking data:

- candidate rows from the existing `semantic`, `smart`, and `visual` search modes
- pairwise preferences where the reviewed positive is preferred over retrieved hard negatives
- a small linear pairwise reranker trained from those preferences
- metrics comparing current smart ranking against the learned reranker
- duplicate-rate tracking with a v0 duplicate penalty

This is the bridge between the current heuristic search system and later reward/reranker work.

## Run

```bash
npm run dataset-factory:search-reranker-v0
```

Useful reviewed-gold run:

```bash
npm run dataset-factory:search-reranker-v0 -- \
  --tasks data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/retrieval_tasks.jsonl \
  --labels data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl \
  --manifest data/mtl_archives/manifest_clean.jsonl \
  --output data/mtl_archives/reports/dataset_factory_benchmark_v0_quality_model_review_001_gold/search_reranker_v0_prod \
  --api-base https://www.mtlarchives.com \
  --modes semantic,smart,visual \
  --limit 24 \
  --max-size 1000000 \
  --cache-bust reranker-v0-$(date +%s)
```

Default outputs:

- `search_candidates.jsonl`
- `search_pairwise_preferences.jsonl`
- `search_reranker_weights.json`
- `search_reranker_report.json`
- `search_reranker_report.md`

Generated report payloads are local evidence artifacts. Commit the evaluator and docs, not every benchmark payload.

## Current v0 Evidence

Against production candidates on the reviewed-gold 26-task retrieval benchmark:

| Ranker | Expected Pass | MRR | nDCG@10 | Dup@10 |
|---|---:|---:|---:|---:|
| current smart | 0.846 | 0.638 | 0.724 | 0.530 |
| offline reranker | 1.000 | 1.000 | 1.000 | 0.334 |

The evaluator generated 625 candidate rows and 293 pairwise preferences with zero API errors.

Against the expanded Search Judgments v0 set:

- tasks: 75
- reviewed-gold tasks: 26
- silver-needs-review tasks: 49
- candidate rows: 1,756
- pairwise preferences: 653
- API errors: 0

| Ranker | Tasks | P@1 | P@3 | P@10 | Expected Pass | MRR | nDCG@10 | Dup@10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current smart | 75 | 0.267 | 0.400 | 0.707 | 0.653 | 0.385 | 0.460 | 0.542 |
| offline reranker | 75 | 0.640 | 0.733 | 0.747 | 0.747 | 0.682 | 0.698 | 0.294 |

Source-aware lift:

| Source | Ranker | Tasks | Expected Pass | MRR | nDCG@10 | Dup@10 |
|---|---|---:|---:|---:|---:|---:|
| reviewed_gold | current smart | 26 | 0.846 | 0.638 | 0.724 | 0.530 |
| reviewed_gold | offline reranker | 26 | 1.000 | 1.000 | 1.000 | 0.292 |
| research_enrichment_silver | current smart | 49 | 0.551 | 0.252 | 0.320 | 0.548 |
| research_enrichment_silver | offline reranker | 49 | 0.612 | 0.514 | 0.538 | 0.295 |

Generated artifacts:

- `data/mtl_archives/reports/search_judgments_v0/search-judgments-v0-report.json`
- `data/mtl_archives/reports/search_judgments_v0/retrieval_tasks.search_judgments_v0.jsonl`
- `data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_reranker_report.json`
- `data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_pairwise_preferences.jsonl`

## Caveats

- The reviewed-gold benchmark is still small: 26 retrieval tasks from 20 reviewed-gold labels.
- The expanded 75-task set includes 49 silver tasks derived from research-enrichment packets; those are useful for stress testing but not final benchmark truth.
- The reranker is offline and can only reorder candidates returned by existing search modes.
- Perfect reviewed-gold scores should be treated as a readiness signal, not proof of generalization.
- The next useful lift is promoting silver tasks to gold, adding OCR/scene-text fields to production search candidates, and only then testing a Worker integration.
