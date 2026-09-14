# Evals

Frozen labels and fixtures used by unit tests. They do not change production captions.

| What | Where |
|---|---|
| Gazette / water / kind labels | `docs/vision-eval-v1/frozen-labels.json` |
| OCR as separate evidence | `docs/ocr-eval-v1/fixtures/` |
| Caption rubric | `docs/quality-baseline-v1/` |
| Second-source fixture | `docs/onboard-v1/fixtures/` |
| Ingest fixture | `docs/ingest-v1/fixtures/` |

Run:

```bash
cd packages/scripts/src/retrieval-pilot-v1 && python3 -m unittest
cd packages/scripts/src/onboard-v1 && python3 -m unittest
cd packages/scripts/src/ingest-v1 && python3 -m unittest
npm run test --workspace=apps/api
```
