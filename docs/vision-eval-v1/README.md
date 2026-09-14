# Frozen orientation and OCR evaluation (#146, #147)

These labels are frozen against the quality-baseline JPEGs. Candidate captions stay inactive.

- **A25** (street with painted ads): exact OCR includes `The Gazette` (water tower) and `MAGIC BAKING POWDER`. `The Gazel` is unsupported.
- **A40** (snowy roofs, dark channels): water is **unknown**. Hedged “waterways or streets” cannot assert `water=present`.
- **A44** (sideways helicopter): photograph, ground-level. No EXIF orientation tag, so automatic uprighting must **abstain** unless a reviewed transform is recorded.
- **F12**: scanned map. Image kind is `map`; viewpoint is not aerial.

Orientation helpers (`orientation.py`) apply EXIF 1/3/6/8, keep original bytes, re-encode only when a real rotation happens, and cache derived JPEGs under `orientation-v1` keys. Missing EXIF abstains; mirrored tags enter review. Multi-example comparison is in [orientation-eval-v1](../orientation-eval-v1/README.md).

```sh
python3 packages/scripts/src/retrieval-pilot-v1/eval_frozen.py \
  --labels docs/vision-eval-v1/frozen-labels.json \
  --enrichment-dir PRIVATE_OUTPUT/enrichment \
  --model openai_gpt_54 \
  --out docs/vision-eval-v1/results-openai_gpt_54.json
```
