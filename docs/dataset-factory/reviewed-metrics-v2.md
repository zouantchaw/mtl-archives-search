# Reviewed Metrics v2 Candidate

Reviewed Metrics v2 is a candidate-only blind evaluation contract for issue #96. It freezes 36 image-mode tasks, two OCR crops, six neutral entity/place scenes, 16 aerial land-use tasks, and 18 abstention decisions before prediction. These 78 task memberships resolve to 44 unique source pixels. The candidate and both issue completion booleans are false. No prediction, gold, execution authorization, search answer, publication, or production mutation exists.

The coordinator input authority contains the exact source hashes, normalized pixel hashes, dimensions, component/split bindings, nullable per-input rights values, predecessors, fixed membership, and source-to-opaque mapping. It must never be copied into a predictor route. The normal bundle command reads only the committed `input-authority-v2.json` at its fixed path and requires exactly 56,908 bytes with SHA-256 `34be01a2750894eab27ad8882acb79a0366f1de9b6c85fb96bb84e95ecfd81fa`; there is no `--authority` override. It also regenerates and compares the complete semantic authority, including the exact `v2-0001` through `v2-0044` mapping. This is non-circular because the authority records `candidate_commit=null`; a later execution authorization separately binds the reviewed candidate commit.

Rights values are copied exactly: `null` is not coerced to `false`, and completeness is not invented. The three Phase D controls are read from the registered ignored Gold evidence route and verified against the planned exact bytes; no source payload is duplicated in Git and no private object locator is recorded in the candidate. All six ground-scene mappings join by neutral ID through exact `ground-originals-v1/records-v1.json` bytes. Both OCR crops additionally join their parent, record, region coordinates, and crop hash through exact `reviewed-visual-transcriptions-v1.json` bytes. Both authorities are pinned globally and per applicable input.

The candidate records implementation base `5fe4dfbe51a320a51f1f126b4a2d8cf0722be5dc` separately from `candidate_commit=null`. This avoids a self-referential fixture hash. A later reviewed authority must bind the actual candidate commit before any execution path can exist.

## Blind bundle

The caller supplies a new absolute temporary route whose parent already exists. Every existing ancestor is checked with `lstat` and `realpath`; symlink parents/leaves, traversal, existing outputs, repository/private/PKM overlap, extra files, duplicate opaque IDs/hashes, source drift, normalized-pixel drift, metadata, and authority substitution are refused. The output directory is created exclusively with an invocation-secret owner marker and inode/device binding. A failure recursively removes only that newly created child after marker and inode verification; an arbitrary caller-supplied route is never recursively removed.

Each source is decoded and written as deterministic lossless PNG with an opaque filename. Every ancillary PNG chunk, including `pHYs`, is stripped; verification requires only critical chunks and zero EXIF, IPTC, XMP, comments, ICC profiles, or thumbnails. The predictor-visible route contains exactly 44 uniformly shaped neutral media rows, neutral instructions requiring the same full-superset output for every row, the exact tracked `prediction-output.schema.v2.json` bytes, and a descriptor that binds those schema bytes. It exposes no purpose, subset, membership, source mapping, per-task count, or self-authored mount attestation. Semantic no-inference tests reject task-family words in descriptor/instructions.

```bash
npm run dataset-factory:reviewed-metrics-verify-v2
npm run dataset-factory:reviewed-metrics-build-blind-bundle-v2 -- --output /tmp/new-opaque-route
npm run dataset-factory:reviewed-metrics-self-test-v2
npm run dataset-factory:reviewed-metrics-integration-test-v2
npm run dataset-factory:reviewed-metrics-verify-tracked-v2
npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require dfv0_reviewed_metrics_v1_publication,dfv0_reviewed_metrics_v2_candidate_20260715
npm run typecheck --workspace=@mtl-archives/scripts
```

Prediction, gold, result, criterion-matrix, publication, and task-review contracts fail closed on completed states. Semantic validators require exact fixed and unique IDs, controlled image/entity/place values, complete bindings, reviewed support, 12 reviewable aerial inputs, retained denominators, status/value arithmetic, all-abstention undefined state, supported final rows, full publication predecessor pins, commit-last membership, reviewer/predictor independence, and freeze-before-gold chronology.

The freeze implementation is authority-activatable without another code change, but it currently refuses because `docs/dataset-factory/authorities/reviewed-metrics-v2/execution-authorization-v2.json` does not exist. A later committed authorization must exact-bind candidate commit, bundle tree, predictor principal/session/model/reasoning/route, authorization and execution timestamps, freeze time, and expiry. The freeze pins the raw prediction bytes and hash. The CLI has no authority override; only the integration test can inject synthetic authority through an unexported symbol-gated capability. Normal scoring and publication remain unavailable because no prediction/gold/publication authority exists and the source-search task belongs to issue #97.

The tracked supersession candidate notice pins v1 exactly and says v2 does not yet exist as a publication. It preserves the 32 v1 accepted task decisions while proposing to supersede only v1's historical close interpretation, unavailable-denominator satisfaction, blank-template evidence references, and task-acceptance-only completion logic.
