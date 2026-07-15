# Reviewed Metrics v2 Candidate

Reviewed Metrics v2 is a candidate-only blind evaluation contract for issue #96. It freezes 36 image-mode tasks, two OCR crops, six neutral entity/place scenes, 16 aerial land-use tasks, and 18 abstention decisions before prediction. These 78 task memberships resolve to 44 unique source pixels. The candidate and both issue completion booleans are false. No prediction, gold, execution authorization, search answer, publication, or production mutation exists.

The coordinator input authority contains the exact source hashes, normalized pixel hashes, dimensions, component/split bindings, nullable per-input rights values, predecessors, fixed membership, and source-to-opaque mapping. It must never be copied into a predictor route. Rights values are copied exactly: `null` is not coerced to `false`, and completeness is not invented. The three Phase D controls are read from the registered ignored Gold evidence route and verified against the planned exact bytes; no source payload is duplicated in Git and no private object locator is recorded in the candidate.

The candidate records implementation base `5fe4dfbe51a320a51f1f126b4a2d8cf0722be5dc` separately from `candidate_commit=null`. This avoids a self-referential fixture hash. A later reviewed authority must bind the actual candidate commit before any execution path can exist.

## Blind bundle

The caller supplies a new absolute temporary route outside the repository. The builder refuses an existing route, repository route, symlink, traversal, extra file, duplicate opaque ID/hash, source drift, normalized-pixel drift, metadata, denylisted key/text, or authority substitution. Each source is decoded and written as deterministic lossless PNG with an opaque filename. EXIF, IPTC, XMP, comments, ICC profiles, and embedded JPEG thumbnails are absent. The blind route contains only 44 media members, purpose/output instructions, a sanitized descriptor, and an access/contents receipt with no source mapping.

```bash
npm run dataset-factory:reviewed-metrics-verify-v2
npm run dataset-factory:reviewed-metrics-build-blind-bundle-v2 -- --output /tmp/new-opaque-route
npm run dataset-factory:reviewed-metrics-self-test-v2
npm run dataset-factory:reviewed-metrics-integration-test-v2
npm run dataset-factory:reviewed-metrics-verify-tracked-v2
npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require dfv0_reviewed_metrics_v1_publication,dfv0_reviewed_metrics_v2_candidate_20260715
npm run typecheck --workspace=@mtl-archives/scripts
```

Prediction and gold validation plus task-review validation entrypoints exist so later authorized stages use one strict versioned contract. Normal prediction freeze and scoring entrypoints always refuse in this candidate; an arbitrary authority file cannot activate them. Synthetic scoring is guarded by a private in-process capability used only by the integration test and has no CLI flag. Publication also always refuses because final publication and the source-search task belong to issue #97.

The tracked supersession candidate notice pins v1 exactly and says v2 does not yet exist as a publication. It preserves the 32 v1 accepted task decisions while proposing to supersede only v1's historical close interpretation, unavailable-denominator satisfaction, blank-template evidence references, and task-acceptance-only completion logic.
