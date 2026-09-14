# Image kind and orientation provenance (#146)

Inactive candidate contract. Production captions and indexes are unchanged.

`image_kind` is `photograph | map | document | unknown`. Viewpoint is camera pose only (`ground | aerial_oblique | aerial_nadir | interior | unknown`). A map or document cannot carry an aerial viewpoint. `document` is not a viewpoint.

Orientation is a derived object: original SHA-256, derived SHA-256, degrees, method, `orientation-v1`, and `accepted | abstain | review`. Original bytes are never overwritten. Missing EXIF abstains. Mirrored/unknown EXIF tags enter review. Identity transforms keep bytes; a real rotation writes a new JPEG. Re-encoding without a transform is a control, not an uprighting.

Enrichment cache keys include the orientation receipt. Changing rotation, review state, or stage version invalidates only that record’s downstream enrichment key.

## Frozen labeled eval (11/11, not promotable)

| Example | Result |
|---|---|
| A25, A40, A44, F12 (no EXIF) | abstain; originals unchanged; reencode control differs |
| Synthetic EXIF 1/3/6/8 | accepted; 90/180/270 change bytes |
| Synthetic EXIF 2 (mirrored) | review |
| A44 reviewed 90° rotate | new bytes; source JPEG unchanged; enrichment cache stale |

```sh
python3 packages/scripts/src/retrieval-pilot-v1/eval_orientation.py \
  --labels docs/vision-eval-v1/frozen-labels.json \
  --images "$IMAGES" \
  --out docs/orientation-eval-v1/results.json
```
