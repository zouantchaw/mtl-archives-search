# Canonical Corpus v1

Canonical Corpus v1 reconciles the tracked local manifest, production D1, production R2, the text Vectorize index, and the CLIP Vectorize index by identity. It is a read-only evidence workflow: none of its commands writes D1, R2, Vectorize, Worker configuration, or deployed code.

The compact generated live result is `canonical-corpus-v1-snapshot-summary.json`. Large source inventories and generated manifests stay ignored under `data/mtl_archives/reports/canonical_corpus_v1/live/` and are registered by immutable hashes in `artifact-registry.v0.jsonl`.

## Identity contract

- Metadata identity: `mtl_archives_metadata_<decimal>.json`.
- Archive-image identity: `mtl_archives_image_<same-decimal>.<extension>`.
- The captured decimal token joins the two names; numeric order never determines authority or canonical state.
- Exact normalized source URL is the alias identity. A duplicate group receives a canonical member only when exactly one member exists in production D1. Groups with zero or multiple D1 members remain individually unresolved.
- Non-archive R2 objects retain `r2:<key>` reconciliation identities. Invalid vector IDs retain `vector:<id>` identities.

Every observed identity has exactly one primary state. State precedence is: non-corpus/invalid handling; evidence-backed alias or ambiguous alias; structural image conflicts; system-only candidates; complete-source document; R2 missing; text missing; CLIP missing; active. Missing-system and content findings remain secondary flags, so exact coverage is not lost when another primary state wins.

## Commands

Offline fixture collection, repeated deterministic build, and invariant checks:

```bash
npm run canonical-corpus-v1:fixture-smoke
npm run canonical-corpus-v1:self-test
npm run canonical-corpus-v1:r2-sample:self-test
```

Live read-only collection requires an approved local env file. The collector parses only the named account and R2 fields it needs; secret values are never printed, stored, or passed in process arguments.

```bash
export MTL_ARCHIVES_ENV_FILE=/absolute/path/to/approved/.env
npm run canonical-corpus-v1:collect -- --source all --env-file "$MTL_ARCHIVES_ENV_FILE" --r2-sample-per-stratum 2
npm run canonical-corpus-v1:build
npm run canonical-corpus-v1:check
```

Use `--source local`, `d1`, `r2`, or `vectorize` for a bounded recapture. D1 accepts only one `SELECT` statement and rejects mutation tokens; every Wrangler response must report zero changes and writes. Vectorize uses `list-vectors` to cursor termination and requires unique enumerated IDs to equal `totalCount`. R2 uses only `ListObjectsV2`, `HeadObject`, and `GetObject bytes=0-31`.

Build and check default to `--mode live` and verify `canonical-corpus-inputs.live.v1.json`. The fixture uses its tracked `input-manifest.v1.json`. Each manifest names exactly 12 raw files with kind, SHA-256, byte count, and JSONL row count; the canonical source snapshot ID hashes all of that verified lineage. Raw and generated files have separate allowlists, and absolute, escaping, missing, extra, or symlinked paths fail before content reads. Regenerating `artifact-manifest-v1.json` cannot bless changed raw input.

`--r2-sample-per-stratum` is a strict decimal integer from 1 through 4. The collector computes the complete sample plan before any HEAD/ranged GET, includes required evidence keys in the same arithmetic, and stops if the plan exceeds 64 keys or 128 sample requests. The credential-free planner self-test proves invalid values, the global cap, the 4-key fixture default, and the 54-key frozen live default.

Verify only the six current registered bundles when historical ignored Dataset Factory artifacts are not populated:

```bash
npm run dataset-factory:artifacts:check -- \
  --verify-files \
  --verify-required-only \
  --require ccv1_local_inventory_20260710,ccv1_d1_snapshot_20260710,ccv1_r2_snapshot_20260710,ccv1_text_vector_snapshot_20260710,ccv1_clip_vector_snapshot_20260710,ccv1_reconciliation_20260710 \
  --artifact-root /absolute/path/to/this/repo
```

## Outputs

- `corpus-manifest-v1.jsonl`: all valid record identities.
- `reconciliation-v1.jsonl`: every observed record, R2 non-corpus object, and invalid identity.
- `alias-map-v1.jsonl`: every alternate and its evidence-backed canonical identity.
- `unresolved-v1.jsonl`: the exact subset whose primary state is `unresolved_blocker`.
- `r2-payload-duplicate-candidates-v1.jsonl`: every repeated ETag+size group, explicitly labeled as a candidate rather than byte-equality proof.
- `summary-v1.json`: Draft 2020-12 schema-validated state/source/media/range/presence arithmetic, D1 field coverage, exact vector rates, R2 separation and sample findings. The checker recomputes the complete object from verified snapshots and reconciliation artifacts.
- `artifact-manifest-v1.json`: source and output SHA-256, row/byte counts, schema versions, lineage, and arithmetic.

The R2 listing provides exact keys, sizes, ETags, available checksum algorithms, and last-modified timestamps. Content type and magic-byte results are a deterministic stratified sample only; the summary states that inference boundary and must not generalize those sample rates to the full bucket.

## 9696 decision

The generated summary records the evidence and decision. `9696` is preserved as a source-identity alias of production-backed `9247`. Current bounded R2 evidence shows different payloads: `9247` has JPEG magic, while `9696` has PDF magic under `image/jpeg`. The workflow therefore preserves both keys, claims no payload equality, and does not infer precedence from their numbers.

The four malformed keys for `8227-0`, `8227-1`, `8465-0`, and `8465-1` remain separate identity-level blockers. Their captured ETag/size/magic evidence, investigation preconditions, postconditions, and exact-key restore boundaries are recorded in `canonical-corpus-v1-convergence-plan.md`; generic enumeration never authorizes action.

## Production boundary

This workflow must stop before any D1 mutation, R2 write/delete/copy, Vectorize insert/upsert/delete, metadata-index creation, reindex, Worker/site deploy, configuration change, credential change, or paid compute. The proposed future mutation sequence is documented separately in `canonical-corpus-v1-convergence-plan.md`.
