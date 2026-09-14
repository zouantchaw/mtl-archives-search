# Versioned collection ingest (#138)

Offline pipeline. It does **not** write production D1, R2, Vectorize, or captions.

Flow: adapter → immutable snapshot → canonicalize → candidate enrichment → candidate index → validate → optional local publish pointer. Original source bytes are never overwritten. Archive facts stay in `canonical`; OCR/captions/features stay in `candidate`.

| Acceptance | Mechanism |
|---|---|
| Stable identities, hashes, duplicate/variant/conflict | `record_id(adapter, source_id)`, content-addressed snapshots, `classify_relations` |
| Idempotent imports, receipts, checkpoints, failed queue | Per-stage receipts; reruns skip unchanged inputs; failures go to `failed/queue.jsonl` (max 3) |
| Derived field provenance | Receipts store input hash, model, prompt hash, pipeline version, review state |
| Candidate index before activation | `validate_index` must pass; invalid versions cannot activate |
| Add/change/remove | Retention `tombstone` keeps removed IDs out of the live set without deleting snapshots |
| Interrupt resume | Checkpoint + receipts; completed embeddings are not repeated |
| Inspectable status | `status()` JSON: costs, timings, receipts, failed queue, active pointer. No chat logs |
| Adapter isolation | `MtlAdapter` maps existing MTL manifest fields; `OtherAdapter` cannot leak into shared stages |

```sh
cd packages/scripts/src/ingest-v1
python3 -m unittest test_ingest
python3 run.py run --source mtl --input ../../../docs/ingest-v1/fixtures --out /tmp/ingest-v1 --version idx-1
python3 run.py status --out /tmp/ingest-v1
# Local pointer only; not production:
python3 run.py run --source mtl --input ../../../docs/ingest-v1/fixtures --out /tmp/ingest-v1 --version idx-1 --publish
python3 run.py rollback --out /tmp/ingest-v1
```
