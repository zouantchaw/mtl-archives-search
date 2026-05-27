# Next Embedding Experiment Plan

Issue: #25
Decision date: 2026-05-27

## Decision

Do not run another embedding benchmark or production re-embed immediately.

The current evidence supports keeping the existing CLIP baseline. A future GPU experiment is justified only if product search still shows concrete retrieval gaps after taxonomy, quality labels, and ranking policy work have been evaluated on real queries.

## Current Baseline

Source: `data/mtl_archives/reports/autoresearch_status/status_report.json`

| Model | Sample | GPU | Query MRR | Query P@1 | Query P@5 | Prompt P@1 | NN category@5 | NN theme@5 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CLIP | 500 | NVIDIA A10 | 0.8269 | 0.6923 | 1.0000 | 0.3840 | 0.4788 | 0.5076 |
| SigLIP base | 500 | NVIDIA A10 | 0.4484 | 0.3077 | 0.6154 | 0.3500 | 0.4856 | 0.5304 |

Interpretation:

- CLIP is much stronger on product-critical query retrieval.
- SigLIP base only slightly improves neighbor cohesion, which is not enough to justify re-indexing.
- The #22 search eval showed taxonomy/quality policy wiring is neutral to slightly negative as implemented, so the next search gains likely come from ranking policy design and query evaluation, not immediately from replacing embeddings.

## Trigger Conditions

Run a new embedding experiment only when at least one of these conditions is true:

- A post-#22 search evaluation shows persistent query failures that taxonomy/quality ranking cannot fix.
- The failing queries cluster around visual-language gaps where current CLIP is structurally weak, such as French phrasing, bilingual place descriptions, fine-grained document/map retrieval, snow/winter scenes, waterfront/industrial ambiguity, or sequence/route similarity.
- A new model candidate can be tested without forcing an immediate production schema/index migration.
- The benchmark question is explicit enough to define a pass/fail threshold before starting GPU work.

Do not run a broad exploratory benchmark just because GPU access exists.

## Candidate Models

| Candidate | Expected dim | GPU expectation | Retrieval rationale | Run priority |
| --- | ---: | --- | --- | --- |
| `laion/CLIP-ViT-H-14-laion2B-s32B-b79K` | 1024 | Fits Lambda A10 with small batches; model files are several GB. | Larger OpenCLIP model; closest comparison to current CLIP family while testing whether scale improves archive query retrieval. | First if English/visual retrieval gaps remain. |
| `jinaai/jina-clip-v2` | 1024, optionally truncatable | Likely A10 with small batches; may require `trust_remote_code`; higher 512x512 image resolution. | Multilingual multimodal model with French/English retrieval rationale and Matryoshka dimensions. Best candidate if bilingual or French phrasing is the observed gap. | First if language mismatch is the gap. |
| `google/siglip2-so400m-patch14-384` | 1152 | A10 likely with small batches; larger image size and model than base SigLIP. | Tests whether a newer/larger SigLIP family fixes the base SigLIP query-retrieval weakness. | Second-tier, because base SigLIP lost badly. |
| `laion/CLIP-ViT-bigG-14-laion2B-39B-b160k` | 1280 | Heavy; A10 may require very small batches or a larger GPU. | Ceiling test for OpenCLIP scale if ViT-H wins but still leaves gaps. | Only after a smaller model proves value. |

Before running, confirm the exact model config from the downloaded Hugging Face config and record `projection_dim`, image size, preprocessing, memory use, and runtime in the report.

## Benchmark Shape

Reuse the #17 harness unless a larger sample is justified:

```bash
python3 pipelines/vectorize/evaluate_embeddings.py \
  --limit 500 \
  --models clip,<candidate> \
  --require-cuda \
  --output-dir data/mtl_archives/reports/autoresearch_embedding_eval_<candidate>
```

Minimum required comparisons:

- Compare against saved CLIP baseline from `data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500/embedding_eval_report.json`.
- Preserve the same 500-record stratified sample unless intentionally expanding.
- Report query MRR, query P@1/P@5, prompt P@1, nearest-neighbor category/theme cohesion, failures, runtime, GPU memory if available, and expected production index dimension.
- Include a migration note if the candidate dimension differs from the current production embedding dimension.

## Pass Criteria

A candidate should not move forward unless it beats CLIP on query retrieval by a meaningful margin:

- Query MRR improves by at least `+0.05`, or
- Query P@1 improves by at least `+0.08`, and
- No major regression in query P@5, and
- Runtime/fetch/model failures remain operationally acceptable.

Neighbor cohesion alone is not enough to justify a production re-embed.

## Production Guardrail

No production re-embed should happen until:

- the candidate beats the saved CLIP baseline,
- the query failures it fixes are tied to real product/search needs,
- D1/Vectorize/index dimension implications are documented,
- rollback or parallel-index strategy is defined,
- and the Lambda instance is verified terminated after the run.

Current recommendation: keep CLIP and focus next on search-ranking policy, theme-aware shortlist filtering, and product query evaluation.
