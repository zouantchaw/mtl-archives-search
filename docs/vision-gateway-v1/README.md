# Frontier vision through Cloudflare AI Gateway (#148)

This reuses the #144 retrieval-pilot runner. It does **not** recaption production.

Pinned 2026-09-13 against Unified Billing (image understanding, not generation):

- `openai/gpt-5.4` via `POST /ai/run` — `max_completion_tokens` (the old 650 `max_tokens` field is rejected)
- `xai/grok-4.6` via `POST /ai/run` — 4096-token output budget

The OpenAI-compatible `/ai/v1/chat/completions` path rewrote image parts into an unsupported `image` field. `/ai/run` preserves `image_url` parts. Cache is skipped with `cf-aig-skip-cache: true`.

## Diagnostic result (same 50 image bytes as Mistral/Gemma)

| Model | Valid | Owner coarse viewpoint | Median latency | Est. USD |
|---|---:|---:|---:|---:|
| Mistral Small 3.1 | 50/50 | 11/12 (misses sideways helicopter A44) | 6.0s | $0.027 |
| Gemma 4 | 50/50 | 11/12 (same A44 miss) | 7.2s | $0.006 |
| OpenAI GPT-5.4 | 50/50 | **12/12** (A44 correctly ground) | 3.0s | $0.297 |
| xAI Grok 4.6 | 50/50 | **12/12** (A44 correctly ground) | 45s | $0.786 |

A44 used the **unchanged** original bytes. Stronger hosted models can read that sideways helicopter as ground-level without a rotate-and-reencode step. That does not promote them into production captions: cost, latency, and remaining map/document/OCR errors still need #146–#147, and reading-room constraint bugs remain #137.

```sh
python3 packages/scripts/src/retrieval-pilot-v1/run.py \
  --baseline "$BASELINE" \
  --output "$OUT" \
  --env-file "$ENV" \
  --provider gateway \
  --cf-model openai/gpt-5.4 \
  --concurrency 2 \
  --budget-usd 8.5
```

Candidate captions stay `generated_unreviewed`. Run artifacts live under `0xPKM_Lab/04_outputs/mtl-vision-gateway-openai-v1` and `.../mtl-vision-gateway-grok-v1`.
