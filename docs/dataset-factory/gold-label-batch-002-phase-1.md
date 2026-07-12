# Gold Label Batch 002: Corrected Phase 1

Issue: #68. Parent: #64. Status: primary and blind passes are sealed with 300 rows each from disjoint 12-reviewer rosters, 300 audit-corrected adjudications are frozen, and 50 post-fix independent audits are aggregated. Seven sealed search-review packets cover all 49 pinned silver tasks; search decisions do not yet exist.

## Frozen acquisition

The selector validates exact hashes for the #77 graph manifest, 18,462 nodes, leakage map, benchmark splits, and every pinned legacy/signal input. It excludes the 20 predecessor gold rows and selects one record per authoritative component.

The authoritative pool has only 89 eligible non-gold ground components, so 150/150 ground/aerial is impossible under the leakage cap. All 89 ground components are included and the remaining 211 rows are aerial. Proxy lanes come from named canonical metadata, node collection, retained Active Learning v0, taxonomy, quality, search-failure, or recovery fields. They are acquisition candidates only, never labels or class-support claims. Final support and trainability depend exclusively on sealed review/adjudication evidence.

Selection is deterministically stratified across 12 packets. Every packet has 25 rows, 7–8 ground proxies, both retained-v0 and canonical-backfill origins, train/validation/test rows, quality/repaired candidates, and rare proxy candidates. Packet membership is not a contiguous selection-rank slice.

## Blind identity boundary

Worker packet rows expose only `schema_version`, neutral ID, packet ID, original pixel-evidence hash, detail limitation, and four local inspection views with hashes/dimensions. Views are deterministic 0/90/180/270 rotations and are never upscaled. No worker row contains record ID, filename, source, license, metadata, component, split, acquisition score, VLM, taxonomy, or hidden lineage.

Primary and blind review rows use `gold_label_review_pass_v1.0.0`, not `dataset_factory_label_v0`. Every target is `observed`, `not_visible`, or `uncertain`; observed values require direct pixel evidence and abstentions require explicit reasons. No inferred, metadata, or externally verified claims are allowed in a review pass. Sealed pass sidecars carry sorted reviewer rosters: every row keeps its actual agent reviewer ID, every roster member must own rows, and primary/blind reviewer sets must be disjoint.

Each packet includes nonempty validating primary/blind templates and an example. Both completed passes are sealed to their sorted canonical rows, packet manifest, and review schema. Reviewers have independent IDs and disjoint pass rosters. Only trusted adjudication, after both passes are sealed, may read `batch/trusted-neutral-map-v1.jsonl` to map neutral IDs to records/source/rights.

## Resolution policy

For selected #77 recovery rows, rendering retries bounded public R2 and authoritative HTTPS source acquisition under the 128 MiB contract. Higher-resolution source evidence is normalized to at most 1024px without enlargement. When only the verified 256px recovery derivative remains, the packet marks `detail_limited`, records the limitation outside worker metadata, and requires abstention for unreadable detail.

## Completion gates

`dataset-factory:gold-label-validate-002` compiles every phase schema and recomputes all results from evidence. It requires exact 300-row primary/blind/adjudication coverage; sealed pass hashes; trusted joins; 49 pinned search dispositions; independently audited labels for at least 50 neutral IDs plus every promoted high-risk claim; explicit promoted/held/rejected/unresolved outcomes; agreement, abstention, adjudication changes, class support, and trainability; and no unresolved relevant promoted fact.

Binary targets are trainable only with at least 100 promoted observed rows and 30 minority examples. Multiclass targets report support and abstention and remain non-trainable when support is insufficient. Fewer than 200 promotions requires a schema-valid, independent continuation approval with a concrete acquisition plan; file presence alone is not a bypass.

Phase validation accepts both sealed review passes and exact adjudication coverage. A separate neutral audit candidate plan covers at least 50 neutral IDs, every target, disagreement/change risk, class-balance risk, blocking outcomes, and every promoted high-risk claim. It contains no audit decision or auditor identity and does not satisfy the audit gate.

Audit findings are applied through owning adjudicators. Completed audit rows remain bound to `audit-candidate-plan-pre-findings-v1.jsonl`; their candidate IDs must not be reinterpreted against the regenerated post-findings plan ordering. `audit-authority-compatibility-v1.json` records the exact pre-findings plan/adjudication hashes, corrected adjudication hash, post-fix audit hashes, and all applied finding rows. The canonical `audits-v1.jsonl` contains 50 independent post-fix affirmations. Completion intentionally advances to `search requires exact 49 source/authority/disposition rows`.

## Search review packets

`search/review-packets/glb002-search-p01` through `glb002-search-p07` contain seven tasks each. Task rows reproduce the exact pinned authority fields and separate metadata/source excerpts from visual evidence. Forty-four proposed positives use four copied, decoded, hash-bound issue-68 views. Five tasks (`ret-silver-0005`, `ret-silver-0032`, `ret-silver-0045`, `ret-silver-0046`, and `ret-silver-0047`) explicitly lack a verified bounded local derivative and require `stress_only` or `rejected_with_reason` unless an independently supported revised task is complete.

Reviewer and adjudicator templates are separate, blank, schema-valid files. Reviewers and adjudicators must use distinct IDs, and adjudicators may see reviewer output only after that reviewer pass is sealed. Reviewer-visible rows contain no live URLs, secrets, or prior decisions.

## Commands

```bash
DATASET_FACTORY_FIXED_NOW=2026-07-11T20:00:00.000Z npm run dataset-factory:gold-label-batch-002 -- --canonical-root /Users/wiel/Development/mtl-archives-search
DATASET_FACTORY_FIXED_NOW=2026-07-11T20:00:00.000Z npm run dataset-factory:gold-label-packets-002 -- --concurrency 8
npm run dataset-factory:gold-label-self-test-002
npm run dataset-factory:gold-label-seal-pass-002 -- --pass primary --labels /path/to/completed.jsonl --sealed-at 2026-07-12T00:00:00.000Z
npm run dataset-factory:gold-label-audit-plan-002
npm run dataset-factory:search-review-packets-002
npm run dataset-factory:search-review-packets-validate-002
npm run dataset-factory:search-review-packets-self-test-002
npm run dataset-factory:gold-label-validate-002 # expected to fail before labels
```

Large artifacts remain ignored at `data/mtl_archives/reports/gold_label_batch_002`. The tracked descriptor is `docs/dataset-factory/fixtures/gold-label-batch-002/phase-1-bundle-v1.json`; its incomplete archive is not uploaded.
