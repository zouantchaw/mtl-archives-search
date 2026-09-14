# Selective frontier fallback (sideways + documents only)

Production captions and indexes are unchanged. A frontier model is used only when a record is explicitly selected.

Escalate when **any** of these is true:

- EXIF orientation 6 or 8 (90° / 270°)
- a reviewed `sideways` flag (A44 has no EXIF, so it must be flagged, not guessed)
- `image_kind` is `map` or `document`

Do **not** escalate just because EXIF is missing. Ordinary street photographs (A25) stay on the cheap model.

## Measured run (GPT-5.4, ~$0.012)

| Record | Selected? | Result |
|---|---|---|
| A25 street ads | no | left on cheap model |
| A44 sideways helicopter | yes (`reviewed_sideways`) | `photograph` / `ground` |
| F12 scanned planning sheet | yes (`kind_document`) | `document` / `unknown` |

Frozen eval on the two fallback outputs: **2/2**. Gemma had called F12 an aerial photograph.

```sh
python3 packages/scripts/src/retrieval-pilot-v1/fallback.py \
  --images "$IMAGES" \
  --cheap-enrichment "$CHEAP" \
  --review docs/fallback-v1/review.json \
  --output "$OUT" \
  --env-file "$ENV" \
  --budget-usd 2 --max-n 8
```
