# OCR evidence and field-level uncertainty (#147)

Inactive candidate contract. Production captions, archive metadata, and indexes are unchanged.

Literal readings live in `ocr[]`, not in the visual description and not in `date_value` / identity / location fields. Each OCR item has text, `exact|partial|illegible|unknown`, method, version, region, and optional image SHA-256. Illegible/unknown items must not invent words. Model confidence is not stored as a probability.

Each generated feature has a value (`present|absent|unknown`) and a basis (`pixels|unknown`). Hedged “waterways or streets” cannot assert `water=present`. Inferred date, identity, location, or motion cannot appear on the candidate record.

## Frozen + fresh eval

| Record | Check |
|---|---|
| A25 | `The Gazette` and `MAGIC BAKING POWDER` in `ocr[]`; `The Gazel` forbidden; caption-only Gazette fails |
| A40 | water `unknown`; hedged prose + `present` fails |
| A44 | no OCR invented; empty/unknown readings only |
| F12 (fresh) | `SERVICE D'URBANISME`, `PLANNING DEPARTMENT`, `NOVEMBRE 1969` as OCR, not a canonical photo date |

Hand-authored inactive fixtures score **4/4** and are not promotable. Cheap model captions that bury OCR in prose still fail this contract.

```sh
python3 packages/scripts/src/retrieval-pilot-v1/write_ocr_fixtures.py
python3 packages/scripts/src/retrieval-pilot-v1/eval_frozen.py \
  --labels docs/vision-eval-v1/frozen-labels.json \
  --enrichment-dir docs/ocr-eval-v1/fixtures \
  --model ocr-v1-fixtures \
  --out docs/ocr-eval-v1/results-contract.json
```
