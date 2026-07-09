# Search Judgments v0

Search Judgments v0 expands the search relevance set without weakening the reviewed-gold benchmark.

Run:

```bash
npm run dataset-factory:search-judgments-v0
```

Outputs:

- `data/mtl_archives/reports/search_judgments_v0/search-judgments-v0.jsonl`
- `data/mtl_archives/reports/search_judgments_v0/retrieval_tasks.search_judgments_v0.jsonl`
- `data/mtl_archives/reports/search_judgments_v0/search-judgments-v0-report.json`
- `data/mtl_archives/reports/search_judgments_v0/search-judgments-v0-report.md`
- `data/mtl_archives/reports/search_judgments_v0/live_baseline_current/search_baseline_current.json`
- `data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_reranker_report.json`

## Boundary

The output intentionally mixes two judgment types:

- `reviewed_gold`: the existing reviewed-gold benchmark retrieval tasks
- `research_enrichment_silver`: expected-positive retrieval tasks derived from Research Enrichment v0 packets

Silver rows are useful for stress testing search and reranking, but they must not be treated as final benchmark truth until review promotes them.

## Why This Matters

The first reviewed benchmark had 26 retrieval tasks. This expansion creates a 75-judgment set while preserving provenance:

- text-in-image rows expose OCR/signage gaps
- entity/place rows stress lexical + semantic search
- metadata/title rows preserve basic retrieval expectations
- leakage group IDs are carried from the visual family graph when available

## Current Baseline

The expanded set was run against live production search and the offline reranker:

| Ranker | Tasks | Expected Pass | MRR | nDCG@10 | Dup@10 |
|---|---:|---:|---:|---:|---:|
| current smart | 75 | 0.653 | 0.385 | 0.460 | 0.542 |
| offline reranker | 75 | 0.747 | 0.682 | 0.698 | 0.294 |

Keep the boundary clear: the reranker lift is useful evidence, but the 49 silver rows still need promotion review before they become gold benchmark truth.
