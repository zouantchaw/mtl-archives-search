# Dataset Factory Batch 001

Issue: GitHub #48

Status: seed Batch 001 complete. The current strict gold output is `quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl`; held rows remain future review work.

## Purpose

Batch 001 starts the Dataset Factory as an ML/reward-data pipeline, not a captioning exercise. It creates a reviewable packet that separates two different intelligence jobs:

1. **Ground Text / Entity Intelligence**
   - visible text
   - brands and businesses
   - streets, landmarks, institutions, transit, and neighborhood entities
   - search expectations such as `Magic baking powder -> mtl_archives_metadata_0.json`

2. **Aerial Land-Use / Geo Intelligence**
   - vertical vs oblique aerial mode
   - land-use class and rough mix
   - segmentation candidacy
   - georeference candidacy
   - low-information detection

The batch is designed to feed #49, #50, #52, and #57:

- #49: gold benchmark queries and task splits
- #50: active-learning queues
- #52: search/ranking pairwise evals
- #57: preference and reward data

## Command

```bash
npm run dataset-factory:batch-001
```

Default outputs:

- `data/mtl_archives/reports/dataset_factory_batch_001/batch_001_manifest.json`
- `data/mtl_archives/reports/dataset_factory_batch_001/batch_001_profile.json`
- `data/mtl_archives/reports/dataset_factory_batch_001/batch_001_review_packet.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/batch_001_review_packet.csv`
- `data/mtl_archives/reports/dataset_factory_batch_001/batch_001_contact_sheet.html`

Generated reports are ignored by git. Commit the script/docs, not the local report payloads.

## Calibration Pass

Create the 50-row calibration subset:

```bash
npm run dataset-factory:calibration-001
```

Create schema-valid calibration labels:

```bash
npm run dataset-factory:label-calibration-001
```

Default calibration outputs:

- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_manifest.json`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_packet.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_packet.csv`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_contact_sheet.html`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_labels.jsonl`
- `data/mtl_archives/reports/dataset_factory_batch_001/calibration_50/calibration_label_summary.json`

Calibration labels are not final gold. They are the first adjudication surface for schema fit, uncertainty policy, and label usefulness.

## Default Selection

The generator includes:

- all non-aerial/ground records from the current manifest
- the named `Magic Baking Powder` search regression
- a broad aerial sample across farmland, residential, waterfront/water, industrial/infrastructure, oblique, low-information, and mixed/unknown buckets

The current default aerial sample limit is `420`, producing roughly 500 total review records after de-duplication.

## Labeling Contract

Labels must validate against `label-schema.v0.json`.

Batch 001 should populate the optional intelligence fields when evidence supports them:

- `image_mode`
- `scene_text`
- `entities`
- `aerial_land_use`
- `geo_hypotheses`
- `search_expectations`
- `ml_tasks`

Do not treat VLM captions as truth. Evidence must remain separated into observed, metadata, inferred, and verified claims.

## Done Criteria

Batch 001 is done when:

- a gold JSONL label file exists for the selected packet
- at least 50 labels are spot-checked for schema and evidence consistency
- the batch summary reports lane balance, uncertainty rates, and weak spots
- the batch can train or evaluate at least one baseline classifier/ranker
- named regressions from the batch are included in #49

## Current Seed-Gold Result

Quality / Model Review 001 produced the current strict reviewed-gold file:

- `data/mtl_archives/reports/dataset_factory_batch_001/quality_model_review_001/gold-labels-batch-001.quality-model-review-001.jsonl`

Current counts:

- candidate labels after Active Learning Top 100: `150`
- strict reviewed-gold labels after Quality / Model Review 001: `20`
- held labels after Quality / Model Review 001: `130`
- Magic Baking Powder is gold and feeds `text_in_image` / `reranker_required` benchmark tasks

This closes Batch 001 as a seed gold batch. Scaling the gold set beyond this should continue through active-learning and review passes rather than by weakening the promotion policy.
