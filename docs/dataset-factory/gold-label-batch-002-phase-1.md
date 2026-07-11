# Gold Label Batch 002: Corrected Phase 1

Issue: #68. Parent: #64. Status: frozen neutral pixel-review packets; no labels, adjudications, audits, or search dispositions exist.

## Frozen acquisition

The selector validates exact hashes for the #77 graph manifest, 18,462 nodes, leakage map, benchmark splits, and every pinned legacy/signal input. It excludes the 20 predecessor gold rows and selects one record per authoritative component.

The authoritative pool has only 89 eligible non-gold ground components, so 150/150 ground/aerial is impossible under the leakage cap. All 89 ground components are included and the remaining 211 rows are aerial. Proxy lanes come from named canonical metadata, node collection, retained Active Learning v0, taxonomy, quality, search-failure, or recovery fields. They are acquisition candidates only, never labels or class-support claims. Final support and trainability depend exclusively on sealed review/adjudication evidence.

Selection is deterministically stratified across 12 packets. Every packet has 25 rows, 7–8 ground proxies, both retained-v0 and canonical-backfill origins, train/validation/test rows, quality/repaired candidates, and rare proxy candidates. Packet membership is not a contiguous selection-rank slice.

## Blind identity boundary

Worker packet rows expose only `schema_version`, neutral ID, packet ID, original pixel-evidence hash, detail limitation, and four local inspection views with hashes/dimensions. Views are deterministic 0/90/180/270 rotations and are never upscaled. No worker row contains record ID, filename, source, license, metadata, component, split, acquisition score, VLM, taxonomy, or hidden lineage.

Primary and blind review rows use `gold_label_review_pass_v1.0.0`, not `dataset_factory_label_v0`. Every target is `observed`, `not_visible`, or `uncertain`; observed values require direct pixel evidence and abstentions require explicit reasons. No inferred, metadata, or externally verified claims are allowed in a review pass.

Each packet includes nonempty validating primary/blind templates and an example. Actual pass files remain empty with `not_started` seals bound to the packet-manifest and review-schema hashes. Reviewers must have independent IDs. Only trusted adjudication, after both passes are sealed, may read `batch/trusted-neutral-map-v1.jsonl` to map neutral IDs to records/source/rights.

## Resolution policy

For selected #77 recovery rows, rendering retries bounded public R2 and authoritative HTTPS source acquisition under the 128 MiB contract. Higher-resolution source evidence is normalized to at most 1024px without enlargement. When only the verified 256px recovery derivative remains, the packet marks `detail_limited`, records the limitation outside worker metadata, and requires abstention for unreadable detail.

## Completion gates

`dataset-factory:gold-label-validate-002` compiles every phase schema and recomputes all results from evidence. It requires exact 300-row primary/blind/adjudication coverage; sealed pass hashes; trusted joins; 49 pinned search dispositions; independently audited labels for at least 50 neutral IDs plus every promoted high-risk claim; explicit promoted/held/rejected/unresolved outcomes; agreement, abstention, adjudication changes, class support, and trainability; and no unresolved relevant promoted fact.

Binary targets are trainable only with at least 100 promoted observed rows and 30 minority examples. Multiclass targets report support and abstention and remain non-trainable when support is insufficient. Fewer than 200 promotions requires a schema-valid, independent continuation approval with a concrete acquisition plan; file presence alone is not a bypass.

The phase-1 validator currently passes. Completion intentionally fails with `primary pass is absent or unsealed`.

## Commands

```bash
DATASET_FACTORY_FIXED_NOW=2026-07-11T20:00:00.000Z npm run dataset-factory:gold-label-batch-002 -- --canonical-root /Users/wiel/Development/mtl-archives-search
DATASET_FACTORY_FIXED_NOW=2026-07-11T20:00:00.000Z npm run dataset-factory:gold-label-packets-002 -- --concurrency 8
npm run dataset-factory:gold-label-self-test-002
npm run dataset-factory:gold-label-seal-pass-002 -- --pass primary --reviewer-id REVIEWER --labels /path/to/completed.jsonl --sealed-at 2026-07-12T00:00:00.000Z
npm run dataset-factory:gold-label-validate-002 # expected to fail before labels
```

Large artifacts remain ignored at `data/mtl_archives/reports/gold_label_batch_002`. The tracked descriptor is `docs/dataset-factory/fixtures/gold-label-batch-002/phase-1-bundle-v1.json`; its incomplete archive is not uploaded.
