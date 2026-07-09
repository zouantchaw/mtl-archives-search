# Foundation Model Benchmark v0

Foundation Model Benchmark v0 is the decision layer for archive image features. It prevents re-embedding or training work from advancing without measurable evidence.

Run:

```bash
npm run dataset-factory:foundation-model-benchmark-v0
```

Outputs:

- `data/mtl_archives/reports/foundation_model_benchmark_v0/foundation-model-benchmark-v0-report.json`
- `data/mtl_archives/reports/foundation_model_benchmark_v0/foundation-model-benchmark-v0-report.md`
- `data/mtl_archives/reports/foundation_model_benchmark_v0/foundation-model-decision-log-v0.jsonl`
- `data/mtl_archives/reports/foundation_model_benchmark_v0/foundation-model-next-experiments-v0.jsonl`
- `data/mtl_archives/reports/foundation_model_benchmark_v0/gpu-experiment-registry.foundation-model-benchmark-v0.jsonl`
- `data/mtl_archives/reports/foundation_model_benchmark_v0/foundation-model-gpu-job-spec-openclip-dino-1k.json`

## Current Decision

The current evidence says:

- Keep CLIP as the control/production embedding.
- Do not replace CLIP with the tested SigLIP model.
- Test OpenCLIP and DINOv2 only through an approved GPU run with explicit acceptance gates.
- Defer GeoCLIP/StreetCLIP-style features until enough verified geo labels exist.
- Treat OCR/document features as a separate feature family, not as something solved by global image embeddings.

## Existing GPU Evidence

The promoted benchmark is the existing 500-image A10 run:

```bash
python3 pipelines/vectorize/evaluate_embeddings.py \
  --limit 500 \
  --models clip,siglip \
  --require-cuda \
  --fp16 \
  --output-dir data/mtl_archives/reports/autoresearch_embedding_eval_gpu_500
```

Observed result:

- CLIP query MRR: `0.8269`
- SigLIP query MRR: `0.4484`
- CLIP query P@5: `1.0`
- SigLIP query P@5: `0.6154`
- SigLIP slightly improves neighbor coherence, but not enough to overcome the retrieval loss.

## Next Gate

The next paid GPU run should only happen if it tests larger retrieval and pure-vision families with clear gates:

- OpenCLIP beats CLIP query MRR by at least `0.05`.
- DINOv2 improves same-family or same-category @5 by at least `0.08`.
- The run writes a registry row, copies all artifacts back, and verifies no GPU instance remains active.

## GPU Job Spec

The generated job spec is ready for approval but was not launched:

- recommended instance: Lambda `gpu_1x_a10`
- observed price: `$1.29/hr`
- observed available regions: `us-east-1`, `us-west-1`
- active Lambda instances during preflight: `0`
- SSH key names present: `mtl-autoresearch-lambda`, `wiel-macbook-pro`

Do not launch it without an explicit budget/duration confirmation. The spec includes stop rules, expected outputs, and acceptance gates.
