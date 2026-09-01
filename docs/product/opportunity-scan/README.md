# MTL Archives dataset-led opportunity scan

This directory contains the decision artifact for issue #127. It replaces a prospect-first approach with a dataset-first method.

## Decision

Build the first evidence packet around the Old Port of Montréal heritage-interpretation footprint. Keep SDC Vieux-Montréal in the same first tier as the most credible district buyer hypothesis and as the current-market baseline to beat. Do not pursue Hôtel Nelligan as the lead until the archive itself demonstrates a stronger property-specific fit.

This is an exploration decision, not buyer validation and not outreach authorization.

## Files

- `report.html` is the self-contained reader-facing report.
- `artifact.json` is the canonical source for the report.
- `candidate-scores-v1.csv` contains the reviewed scoring inputs and results.
- `capability-maturity-v1.csv` separates production, research-complete, review-ready, and deferred capabilities.
- `mtl-archives-opportunity-scan-v1.ipynb` contains the reproducible local profiling checks.

## Scoring method

Each candidate is a bounded commercial opportunity:

`place or collection footprint × current organization × buyer role × activation use case`

Archive Fit and Market Fit are scored independently. Balanced Fit is their harmonic mean, which penalizes a candidate that is strong on only one side.

Public evidence can establish a market hypothesis, not buyer intent. Every candidate remains at `Explore only` or `Hold` until there is an approved route, a reviewed evidence packet, and a real conversation.

## Reproduce the notebook

From this worktree:

```sh
MTL_ARCHIVES_DATA_ROOT=/Users/wiel/Development/mtl-archives-search/data/mtl_archives \
  jupyter nbconvert --to notebook --execute --inplace \
  docs/product/opportunity-scan/mtl-archives-opportunity-scan-v1.ipynb
```

The environment variable points to the populated local data checkout. The notebook performs read-only profiling and writes only its own execution outputs.
