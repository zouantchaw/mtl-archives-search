# Autoresearch Outcomes

This document is the durable index for the completed autoresearch investigation. It records what was produced, where the artifacts live, and which decisions are supported by evidence.

## Executive Summary

Autoresearch moved the project from ad hoc archive search experiments to a reproducible research pipeline with GPU-backed VLM enrichment, visual taxonomy, image-quality labels, candidate discovery, visual collections, search/social evaluation, cleanup experiments, and embedding model evaluation.

The practical outcome is clear: product work should now use the generated taxonomy, quality labels, collections, and candidates. More broad investigation is lower value than integrating these outputs into search ranking, default filtering, and social/story selection.

## Decisions

- Keep the current CLIP embedding baseline. In the 500-record Lambda A10 CUDA benchmark, CLIP beat base SigLIP strongly on query retrieval.
- Do not re-embed production indexes with base SigLIP from the current evidence.
- Use `taxonomy_downstream.jsonl` and `quality_labels.jsonl` as downstream inputs for search, social, and product filtering.
- Use visual collections and candidate reports as reviewable inputs, not automatic publishing decisions.
- Do not blindly crop or normalize all flagged images. The cleanup experiment supports review samples and targeted fixes only.
- Run future GPU embedding experiments only when product search exposes a real gap that current CLIP, taxonomy, and ranking changes cannot address.

## Closed Issue Map

| Issue | Outcome | Primary artifacts |
| --- | --- | --- |
| #10 R2-backed managed VLM runs | Added repeatable Lambda/R2 managed job path for GPU VLM jobs. | `packages/scripts/src/autoresearch/vlm-managed-job.ts`, `data/mtl_archives/reports/autoresearch_vlm_sample/` |
| #11 Rare images, sequences, social and print candidates | Generated ranked rare-find, sequence, social, and print candidate sets from VLM and embedding evidence. | `data/mtl_archives/reports/autoresearch_candidates/candidates.md`, `candidates_downstream.jsonl` |
| #12 Cleanup before embedding | Tested deterministic crop/tone cleanup on flagged records and measured embedding effects. Decision: targeted review only, no blind cleanup. | `data/mtl_archives/reports/autoresearch_cleanup_embedding/completion_report.md` |
| #13 Full archive VLM run | Completed full archive structured VLM enrichment on 14,822 records. | `data/mtl_archives/reports/autoresearch_vlm_full/completion_report.md` |
| #14 Structured VLM metadata | Produced structured metadata schema and R2-backed structured smoke outputs. | `pipelines/vlm/structured_metadata.py`, `data/mtl_archives/reports/autoresearch_vlm_sample/issue14_structured_r2_smoke_fixed.jsonl` |
| #15 Weak-category VLM benchmark | Ran a 200-record detailed prompt benchmark for weak search categories. | `data/mtl_archives/reports/autoresearch_vlm_benchmark/report.md` |
| #16 Visual taxonomy classifiers | Classified all 14,822 rows into visual categories, themes, search facets, social tags, and product tags. | `data/mtl_archives/reports/autoresearch_taxonomy/completion_report.md`, `taxonomy_downstream.jsonl` |
| #17 CLIP/SigLIP embedding evaluation | Ran 500-record Lambda A10 CUDA benchmark. CLIP beat SigLIP on query retrieval; keep CLIP. | `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/gpu_500_completion_report.md` |
| #18 VLM prompt/model bakeoff | Compared compact and detailed VLM prompt variants; detailed prompt won and became the benchmark/full-run path. | `data/mtl_archives/reports/autoresearch_vlm_bakeoff/report.md` |
| #19 Visual collections | Generated 21 collections across theme, sequence, and editorial groupings. | `data/mtl_archives/reports/autoresearch_collections/completion_report.md`, `collections_downstream.jsonl` |
| #20 Image quality issues | Audited representative records for orientation, crop, border, scan, and fetch/decode issues. | `data/mtl_archives/reports/autoresearch_image_quality/completion_report.md`, `quality_labels.jsonl` |

## Report Index

### Search

- Baseline evaluator: `npm run autoresearch:search`
- Policy comparison: `npm run autoresearch:search:compare`
- Sweep evaluator: `npm run autoresearch:search:sweep`
- Query set: `experiments/autoresearch/search/queries.json`
- Summary reports:
  - `data/mtl_archives/reports/autoresearch_search_report.json`
  - `data/mtl_archives/reports/autoresearch_search_sweep.json`
  - `data/mtl_archives/reports/autoresearch_search_sweep/`

Current search evidence showed weak areas around winter/snow, residential neighborhoods, children/activity, parks, waterfront, and null-title aerial/visual records. The best recorded sweep config in the prior plan was `visualWeight=0.9`, `semanticWeight=1.3`, `rrfK=60`, `bothBonus=0.012`, with `precisionAt5=0.440`, `mrr=0.591`, and `duplicateRate=0`.

Issue #27 compared baseline, current autoresearch ranking, and a revised policy. The current broad taxonomy/quality demotion/boost policy underperformed baseline, mostly because taxonomy intent boosts moved visually plausible but keyword-irrelevant records ahead of keyword-relevant records for `park-2` and `waterfront-1`. The revised decision is to keep taxonomy and quality policy signals score-neutral in search responses until richer relevance labels prove a ranking lift; this restores the baseline weighted score while preserving explainability fields for review and future experiments.

### Social

- Evaluator: `npm run autoresearch:social`
- Baseline report: `data/social/autoresearch_social_report.json`
- Historical analysis:
  - `data/social/2026-03-18-analysis-summary.md`
  - `data/social/2026-05-05-analysis-april-content.md`
  - `data/social/2026-05-05-analysis-april-daily.md`

The current social baseline found 23 packages, 18 with inspection artifacts, a brand-ready rate of `1.000`, and an average score of `33.2`. Missing inspection artifacts are archive hygiene for older packages, not a current generation failure.

### VLM Enrichment

- Lambda planning: `npm run autoresearch:lambda:plan`
- Lambda control: `npm run autoresearch:lambda -- status`
- Managed job runner: `npm run autoresearch:vlm:managed -- ...`
- Prompt bakeoff report: `data/mtl_archives/reports/autoresearch_vlm_bakeoff/report.md`
- 200-record benchmark report: `data/mtl_archives/reports/autoresearch_vlm_benchmark/report.md`
- Full-run completion report: `data/mtl_archives/reports/autoresearch_vlm_full/completion_report.md`
- Full structured manifest: `data/mtl_archives/reports/autoresearch_vlm_full/manifest_vlm_structured_full_detailed_llava7b.jsonl`

The full run produced 14,822 rows, 14,706 captioned rows, 14,627 structured-valid rows, 79 structured-invalid rows, 116 image/model error rows, and 0 CUDA failed attempts. The recovered full-run estimate was 24.47 GPU hours.

### Taxonomy

- Command: `npm run autoresearch:taxonomy`
- Completion report: `data/mtl_archives/reports/autoresearch_taxonomy/completion_report.md`
- Downstream artifact: `data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_downstream.jsonl`
- Label report: `data/mtl_archives/reports/autoresearch_taxonomy/taxonomy_report.md`

The taxonomy classifier processed 14,822 rows, with 14,283 high-confidence rows and 995 review-required rows. The downstream contract joins on `id == metadata_filename` and includes `primaryCategory`, `primaryConfidence`, `vantage`, `mediaType`, `themes`, `searchFacets`, `socialTags`, `productTags`, `reviewRequired`, and `excludeFromDefaultVisualSearch`.

### Quality

- Command: `npm run autoresearch:image-quality`
- Completion report: `data/mtl_archives/reports/autoresearch_image_quality/completion_report.md`
- Downstream labels: `data/mtl_archives/reports/autoresearch_image_quality/quality_labels.jsonl`
- Downstream issues: `data/mtl_archives/reports/autoresearch_image_quality/quality_issues_downstream.jsonl`

The quality audit sampled 700 representative records, successfully audited 620 images, and flagged 577 rows. Common labels included `orientation_exif_rotation`, `border_light`, `image_fetch_network_failure`, `border_heavy`, `washed_out_scan`, `soft_or_blurry_scan`, and `unsafe_crop_candidate`.

### Candidates

- Candidate report: `data/mtl_archives/reports/autoresearch_candidates/candidates.md`
- Downstream combined rows: `data/mtl_archives/reports/autoresearch_candidates/candidates_downstream.jsonl`
- Specialized outputs:
  - `rare_find_candidates.jsonl`
  - `sequence_candidates.jsonl`
  - `social_candidates.jsonl`
  - `print_candidates.jsonl`

Candidate discovery produced 100 rare-find candidates, 13 sequence candidates, 100 social candidates, and 100 print candidates from 14,822 input rows and 14,715 rows with 2D embeddings.

### Collections

- Completion report: `data/mtl_archives/reports/autoresearch_collections/completion_report.md`
- Collections: `data/mtl_archives/reports/autoresearch_collections/collections.md`
- Downstream collections: `data/mtl_archives/reports/autoresearch_collections/collections_downstream.jsonl`
- Downstream collection records: `data/mtl_archives/reports/autoresearch_collections/collection_records_downstream.jsonl`

The collection run generated 21 collections: 10 theme collections, 8 sequence collections, and 3 editorial collections. The collection-record downstream artifact contains 383 rows.

`npm run autoresearch:collection-surfaces` converts those downstream rows into review-only product/story exports under `data/mtl_archives/reports/autoresearch_collection_surfaces/`: a Markdown review report, an HTML gallery, search-browse JSONL, story-draft JSONL, and full downstream surface JSONL. These artifacts preserve collection reasons, source metadata, and sequence ordering context, but they do not create public routes or publish stories.

### Cleanup

- Command: `npm run autoresearch:cleanup-embedding -- --limit 12`
- Completion report: `data/mtl_archives/reports/autoresearch_cleanup_embedding/completion_report.md`
- Cleanup rows: `data/mtl_archives/reports/autoresearch_cleanup_embedding/cleanup_embedding_rows.jsonl`
- Before/after images: `data/mtl_archives/reports/autoresearch_cleanup_embedding/images/`

The cleanup experiment selected 12 flagged rows, completed all 12, and measured an average original/cleaned cosine of `0.9379`, average embedding shift of `0.3464`, and 2 category changes. This supports targeted review, not a broad automatic cleanup pipeline.

### Embeddings

- Local CLIP smoke report: `data/mtl_archives/reports/autoresearch_embedding_eval/local_phase_completion_report.md`
- CUDA 500-record report: `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/gpu_500_completion_report.md`
- Full JSON: `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.json`
- Next experiment gate: `docs/autoresearch_embedding_experiment_plan.md`
- Per-model rows:
  - `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_clip.jsonl`
  - `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_model_siglip.jsonl`

The 500-record Lambda A10 CUDA run completed on `cuda` with `NVIDIA A10` and Torch `2.7.0`. It fetched 500 images, completed both `clip` and `siglip`, and had 0 model-load failures.

Key metrics:

| Metric | CLIP | SigLIP |
| --- | ---: | ---: |
| Query MRR | 0.8269 | 0.4484 |
| Query P@1 | 0.6923 | 0.3077 |
| Query P@5 | 1.0000 | 0.6154 |
| Prompt P@1 | 0.3840 | 0.3500 |
| NN same-category@5 | 0.4788 | 0.4856 |
| NN shared-theme@5 | 0.5076 | 0.5304 |

Decision: keep CLIP. SigLIP improved a few neighbor-cohesion metrics slightly, but it was much worse on query retrieval, which is the product-critical metric for search.

## Operational Commands

Use these commands to regenerate or inspect the current research lanes:

```bash
npm run autoresearch:status
npm run autoresearch:search
npm run autoresearch:search:compare
npm run autoresearch:search:sweep
npm run autoresearch:social
npm run autoresearch:taxonomy
npm run autoresearch:image-quality
npm run autoresearch:collections
npm run autoresearch:collection-surfaces
npm run autoresearch:candidates
npm run autoresearch:cleanup-embedding -- --limit 12
npm run autoresearch:embedding-eval -- --limit 20 --models clip
npm run autoresearch:embedding-eval:gpu -- --limit 500 --models clip,siglip --require-cuda
npm run autoresearch:lambda -- status
```

For GPU runs, always verify that `npm run autoresearch:lambda -- status` returns `instances=0` before launching and again after termination.

## Limitations

- The VLM full run contains 79 structured-invalid rows and 116 image/model error rows. These are isolated and retryable, not silently merged as valid structured metadata.
- The image-quality audit was representative, not exhaustive. It gives downstream labels for sampled records and a reproducible classifier path, but not a guaranteed complete archive-wide visual QA pass.
- The cleanup experiment did not use SAM in the completed path. It used a deterministic fallback because the local Python environment lacked the SAM stack. SAM remains a future confirmation option for difficult border/crop cases.
- The SigLIP comparison used base `google/siglip-base-patch16-224`. It does not rule out larger OpenCLIP, larger SigLIP, multilingual, or domain-tuned models.
- Candidate and collection outputs are ranking aids. They should feed reviewable search/social workflows before any automated publishing or production ranking change.

## Recommended Next Work

- Productize this decision log and keep it current when reports change.
- Integrate taxonomy and quality labels into search defaults and ranking evaluation.
- Feed candidate and collection artifacts into daily social/story selection as reviewable reason-coded shortlists.
- Keep the one-command autoresearch status report current as new artifacts are added.
- Use the gated embedding experiment plan only if product search still has gaps after taxonomy, quality, and ranking integration.
