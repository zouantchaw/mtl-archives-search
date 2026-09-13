# Vision model comparison — #139

**Decision: no automatic model or index promotion. Gemma is a useful next development candidate, but replacing Mistral alone does not solve the failures.** All original captions/indexes and production deployment remain unchanged.

## Measured comparison

Mistral's retained 50-image run was compared with 50 new Scout outputs and 50 new Gemma outputs. The report generator asserts identical record sets and image hashes. Text instructions and the 650-token output limit are unchanged. Gemma's thinking was disabled after a two-image probe spent the allowance on reasoning with no usable caption. Moondream used its documented image/query adapter with reasoning off. These are provider configuration differences, not a claim of equal internal compute.

| Model | Valid outputs | Owner coarse viewpoint agreement | Generation median / p95 | Estimated successful generation tokens |
|---|---:|---:|---:|---:|
| Mistral Small 3.1 | 50/50 | 11/12 | 5.97 s / 8.00 s | $0.0270 |
| Llama 4 Scout | 50/50 | 11/12 | 6.34 s / 10.65 s | $0.0289 |
| Gemma 4 26B A4B | 50/50 | 11/12 | 7.22 s / 17.34 s | $0.0055 |
| Moondream 3.1 | 0/2 smoke tests | Not evaluated | No full run | See raw usage receipts |

Moondream omitted required description fields and marked helicopters present in two cityscape images. Its nested response envelope is handled explicitly; the invalid schema and visual claims remain failures after normalization. It was not expanded to 50 images. This only tests this structured-caption contract, not all Moondream capabilities.

Costs use published rates, not invoice attribution, and exclude embeddings, failed probes, infrastructure and total request costs. New full runs used concurrency two per model, with up to four requests across simultaneous model runs. Small sample timing is not a load benchmark. Sources: [Gemma](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Scout](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/), [Moondream](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/).

## Factual findings

The independent owner labels judge only coarse viewpoint on legacy review images; they do not certify new captions. Targeted, non-blind assistant inspection found:

- Gemma avoids the invented rooftop transcription in A25, while Scout reads it as “The Gazel.” The visible sign is “The Gazette.” Gemma still adds a moving-car claim that a single image may not establish.
- All three models misclassify the sideways helicopter photograph A44 as aerial on the unchanged input.
- Mistral and Scout hallucinate a river in A40. Gemma hedges “waterways or streets” in prose but still sets the water feature to `present`. Hedged prose and asserted structured features can contradict each other.
- Gemma avoids an asserted water-reflection claim in the rotated tree photographs, but still misclassifies their viewpoint. Scout also makes cliff/landscape interpretations that remain unreliable.

These observations are diagnostic examples, not an exhaustive caption error rate or a blinded human ranking. No model has earned a broad recaptioning pass.

## Orientation experiment

A44 was rotated 90 degrees counterclockwise into a visually verified upright image. It is an explicit one-image preprocessing intervention, kept outside the model-only comparison. Original/derived image hashes are recorded.

| Model | Original sideways image | Upright derivative |
|---|---|---|
| Mistral | aerial oblique | ground |
| Scout | aerial oblique | aerial oblique |
| Gemma | aerial oblique | ground |

The intervention also JPEG-reencodes the image; it is a paired diagnostic, not proof of an orientation-only effect across the corpus. It supports testing verified orientation preprocessing before spending on training.

## Retrieval consequence

Both new models were embedded into separate local BGE indexes with the same source context. The original 20 queries and prior live candidate responses were reused, so this adds no new live latency claim.

For the five street variants, the Mistral-based strict feature filter returns the four reviewed positives; Scout and Gemma return three. Both new models mark `storefronts` unknown on A25, even though its advertisements are relevant to the user's request for businesses and brands. This exposes a **constraint-definition problem**: “businesses and brands” should not automatically require visible storefronts. Do not lower the unknown threshold or hardcode A25 to regain the metric.

Caption-only ranking also has mixed changes. For original street wording, reviewed sample BGE P@6 increases from 1/6 to 2/6 with either new model, still far below the target. All per-query sample metrics are in `results.json`; historical positives-only judgments cannot establish full precision. No new embeddings were written to production Vectorize.

## Fresh validation

Twelve new records were selected: eight deterministic random records and four unreviewed candidates from a concrete street query. Registered family components exclude the previous reviewed pool. A visually near-overlapping city scene was nevertheless quarantined, illustrating that the family graph is not proof of visual independence.

Assistant image judgments were frozen before fresh Gemma inference. On the 11 retained records, Gemma gets **10/11 coarse viewpoints** correct. It mistakes a scanned map for an aerial nadir photograph. These are assistant judgments, not human gold, and they do not establish overall caption or retrieval accuracy. The fresh set is now evaluation evidence; any future tuning on its errors requires another protected validation set.

## Next implementation decisions

1. Introduce a distinct image-kind field (photograph, map, document, unknown) before viewpoint. Do not conflate map content with a physical camera viewpoint.
2. Verify orientation upstream, preserving originals and transformation provenance. Test multiple rotated examples and abstain where correction is uncertain.
3. Separate exact OCR from descriptive captions. Require field-level evidence/uncertainty consistency; hedged water claims cannot become asserted water features.
4. Repair the intent contract: support advertisements/business signage without silently requiring storefronts. Preserve relationship constraints and keep unknowns explicit.
5. Evaluate this revised pipeline with Gemma and the retained Mistral baseline; only promote after factual, retrieval, coverage, latency and cost gates pass. GPU provisioning or fine-tuning remains unjustified.

## Artifacts and verification

`protocol.json`, `fresh-judgments.json`, `results.json` and `evidence.json` are public safe records. Raw captions, model replies, images, vectors and per-run manifests stay in the private generated-output directories. Evidence descriptors bind each manifest by SHA-256. Adapter tests cover Moondream's nested payload, preservation of token usage, Gemma configuration and unchanged prompt transport. The runner pins adapter code in new manifests so changed requests cannot silently reuse old results.

Reproduce summaries with `python3 packages/scripts/src/retrieval-pilot-v1/compare_models.py --root PRIVATE_OUTPUT_ROOT --publish docs/vision-comparison-v1`. Use `run.py --cf-model MODEL_ID` for fresh generation directories. Existing pilot reproduction and promotion limitations still apply. PR #144 remains draft; #139 remains open. Do not merge while the previously documented main/production source drift remains unresolved.
