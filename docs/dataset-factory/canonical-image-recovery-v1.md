# Canonical Image Recovery v1

Canonical Image Recovery v1 reconciles the exact 209 Visual Family Graph v1 thumbnail failures without changing production. It fails closed unless the sorted newline-terminated record-ID stream is exactly 209 rows with SHA-256 `62f266e28e26fe97d03c5bc17169e319f70a2ab07f7d87c4a5eaeb0bea4f046b`.

## Commands

```bash
npm run canonical-corpus-v1:collect -- --source local --local-input data/mtl_archives/manifest_clean.jsonl.gz --output data/mtl_archives/reports/visual_family_graph_v1/canonical_local
npm run dataset-factory:visual-family-input-v1
npm run dataset-factory:visual-family-phash-v1 -- --concurrency 16
npm run dataset-factory:canonical-image-recovery-v1 -- --concurrency 8 --timeout-ms 60000 --max-response-bytes 134217728 --thumbnail-attempts 3 --thumbnail-backoff-ms 300
npm run dataset-factory:visual-family-search-eval-v1 -- --candidates data/mtl_archives/reports/search_judgments_v0/search_reranker_v0_expanded/search_candidates.jsonl --map data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/record-leakage-map-v1.jsonl --output data/mtl_archives/reports/canonical_image_recovery_v1/search-evaluation
npm run dataset-factory:visual-family-check-v1 -- --recovery-root data/mtl_archives/reports/canonical_image_recovery_v1
npm run dataset-factory:canonical-image-recovery-impact-v1
npm run dataset-factory:canonical-image-recovery-self-test-v1
npm run dataset-factory:canonical-image-recovery-partial-self-test-v1
npm run dataset-factory:canonical-image-recovery-reproduce-v1 -- /path/to/canonical-image-recovery-v1-dab076491097ac1fa4c9b1295317d067e29442b12831ede65731941894a859a6.tar.gz
```

The live run recovered 209/209 rows: 133 from directly decodable public R2 objects, 56 through known canonical aliases, and 20 through the tracked byte-bound registered derivative tree `59defc44...`. Every row records three bounded thumbnail attempts with backoff; all 209 remained persistently unavailable through that transform path. The aerial-1964 ranges 8936-8974 and 9208-9246 share 39 source identities; each 103-112 MiB public payload was fetched and normalized once under a 128 MiB streaming cap, then reused only for its verified alias pair. Recovery payload hashes prove reuse; they do not claim equality to historical #67 derivatives or archive originals. Cleartext HTTP source pixels are rejected; only a vetted `depot.ville.montreal.qc.ca` URL upgrade to HTTPS is permitted before final host validation.

The ignored historical #67 bundle is still unavailable and is not claimed restored byte-for-byte. Recovery instead pins the complete adopted replay bundle: features `a50b8800...`, failures `283d8e51...`, report `4646f744...`, exact failure subset, and content-derived transform `derivative-contract:870f1b...`. The runner fails before copying any of the 18,253 successes if a member, row, count, report, subset, acquisition, or transform contract drifts.

Every row has an explicit lane trace, root cause, disposition, derivative, normalized-pixel hash, and pHash. No row is unavailable, indeterminate, excluded, or interpreted as a negative visual label. The no-apply remediation plan contains review inputs only and cannot mutate R2.

The recovery transform contract is `derivative-contract:1468504435f4dc67b22ced5539aab62672d00395829e1636aa1adc0d3f56ac30`. It signs all executable lanes, including vetted HTTPS `authoritative_source`, and the exact three-attempt/300 ms linear thumbnail retry policy. Ledger validation accepts explicit terminal `reviewed_unavailable`, `indeterminate`, and `held_over_contract` rows only when all visual fields are null and bounded attempt evidence is complete; recovered rows retain strict byte, path, identity, decode, and feature checks.

Mixed-contract validation derives its distribution from the exact terminal ledger and its report-bound SHA-256. The 18,253 baseline successes remain pinned. Each of the 209 historical failures must be either a recovery-contract success with a matching recovery-owned derivative-manifest entry or a baseline-contract terminal failure with null visual fields and an exact signed disposition/root-cause/attempt detail. A full-corpus 208-recovered/one-held fixture rebuilds and checks 18,462 nodes, 18,461 pHash successes, one explicit failure, 920 components, and zero split crossings. Thumbnail retry is a promotion operation: success atomically replaces residual state with payload, derivative, normalized hash, pHash, recovery lane/disposition, and regenerated manifest binding.

## Successor graph

The successor graph manifest is `b3b26b45e9508c5838f5045f6565b77201d19d14fba99c98f20c5ea147e113bf`. It has 18,462/18,462 pHash successes, 350,854 edges, 920 components, 470 singletons, and zero split crossings. Relative to #67 it adds 62 exact-payload edges, 4,915 pHash edges, seven alternate-crop edges, and 62 grouping-authoritative edges. Component membership counts and benchmark splits are unchanged; four component support rows, 46 leakage-map support rows, and 17 recommendations change. The 120-row review packet and split file are byte-identical. Frozen search rates are evaluator-derived from candidate hash `8e9bbfed...`, not literals. Issues #68 and #69 must pin this manifest digest; there are zero irrecoverable exclusions.

## Clean-checkout reproduction

The sanitized ignored-artifact bundle is stored in the non-production Agent OS cache at immutable key `bundles/issue-77/canonical-image-recovery-v1-dab076491097ac1fa4c9b1295317d067e29442b12831ede65731941894a859a6.tar.gz`. Its SHA-256 is `dab076491097ac1fa4c9b1295317d067e29442b12831ede65731941894a859a6`; compressed size is 33,679,975 bytes. The tracked descriptor enumerates 267 sorted regular-file members totaling 306,337,452 bytes with tree SHA-256 `38927e0e1fc4c205b2e7ae12f0522f64bcaec21dad31c27e045536515eebb47b`. The prior `c29478cf...` object and descriptor remain immutable, append-only history.

Download with `codex-cache get <key> <local-file>`, then run the reproduce command above. The restore tool verifies the bundle and every member before extraction, rejects unexpected entries, traversal, symlinks, and conflicting existing files, and reconstructs only allowlisted repository-relative paths. The check then verifies the pinned baseline and recovery ledger, runs the trusted mixed-contract graph checker, reruns the frozen evaluator and compares exact task metrics, verifies the byte-bound impact artifact, and runs adversarial and registry checks. Recomputing the historical before/after comparison additionally requires the #67 `graph-before` tree, which is intentionally not duplicated in this minimal successor bundle. No presigned URL is required or recorded.

Large artifacts remain ignored under `data/mtl_archives/reports/canonical_image_recovery_v1/`; the immutable cache object makes them recoverable. Compact evidence and the complete member descriptor are tracked, and registry history remains append-only.
