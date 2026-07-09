# Visual Family Graph v0

Visual Family Graph v0 converts repeated and related archive images into canonical/related-image families instead of letting them appear as noisy independent records.

Run:

```bash
npm run dataset-factory:visual-family-graph-v0
```

Outputs:

- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-families.jsonl`
- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-edges.jsonl`
- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-record-family-map.jsonl`
- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-review-sheet.html`
- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-report.json`
- `data/mtl_archives/reports/visual_family_graph_v0/visual-family-graph-v0-report.md`

## Evidence Used

The v0 graph combines:

- exact source/public image URL grouping
- repeated title/year metadata grouping
- existing sequence collections such as aerial flight runs
- CLIP nearest-neighbor rows from the 500-image GPU embedding evaluation sample
- existing search reranker duplicate-rate metrics

## Canonical Policy

Canonical records are display/search suggestions, not deletion decisions. Alternates stay attached as related images. The graph is designed to support:

- duplicate-aware search ranking
- visual-family browsing
- safer active-learning review queues
- benchmark split leakage control

Every record-family map row includes `leakage_group_id` with the policy `keep_family_in_single_split`.

## Known Limits

This is not yet the final visual graph. It does not include full-dataset pHash or DINO/DINOv2 neighborhoods. Those should be added after #55 expands the foundation-model benchmark.
