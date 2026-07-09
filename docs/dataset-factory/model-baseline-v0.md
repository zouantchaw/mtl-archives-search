# Model Baseline v0

Issue: GitHub #51

Model Baseline v0 is the first cheap classifier pass over MTL-CityMemory-Bench v0.

It is intentionally CPU-only and deterministic. The current reviewed-gold benchmark has 20 records, so the purpose is not to ship a model. The purpose is to measure whether the labels are learnable yet, expose false positives and false negatives, and decide what labels to collect next before paid GPU work.

## Command

```bash
npm run dataset-factory:model-baseline-v0
```

Default outputs:

- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_report.json`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_report.md`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_predictions.jsonl`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_error_review.jsonl`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/model_baseline_weights.json`
- `data/mtl_archives/reports/model_baseline_v0_cpu_text/gpu-experiment-registry.model-baseline-v0.jsonl`

## Method

The baseline is multinomial naive Bayes over text features:

- source metadata title, description, date, and cote
- VLM caption/metadata when present
- visual-review observed claims after removing generic image-mode leakage claims
- scene text, entities, and search expectations from Dataset Factory labels

The script excludes record ids and image filenames from feature text. It also treats the naive Bayes posterior as uncalibrated review metadata, not a user-facing confidence score.

It reports holdout metrics and leave-one-out metrics against the reviewed-gold MTL-CityMemory-Bench v0 classification tasks.

## Current Decision Rule

- Do not ship these outputs into production ranking.
- Do not launch paid GPU training from this benchmark size.
- Use the output to guide active-learning label collection.
- Rerun after the reviewed-gold set has balanced positives and negatives for print value, search value, partner fit, human-legibility, and quality review routing.
