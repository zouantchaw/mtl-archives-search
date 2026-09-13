# Canonical search gap backfill — 2026-09-13

This follows `search-canonical-repair.md`. The initial four sampled 404s understated the asset gap: the full R2 inventory identified 29 missing canonical objects, all recovered from the canonical Montréal archive source URLs. Existing objects were not overwritten; conditional R2 writes protected them. JPEG sources were restored directly; TIFF sources were converted to JPEG for their existing serving keys. Archival titles, descriptions, dates, references, locations and record identities were preserved.

## Backfill

- 184 previously empty captions, with per-record image checksums, model/source provenance and retained raw generations.
- Every image/caption was visually inspected by Codex. 155 descriptions were revised to remove unsupported details or describe the visible scene more clearly. These remain AI-generated and `unreviewed` in the public provenance schema: this is not human archival verification.
- 184 corresponding BGE-M3 text vectors, using the same metadata-plus-caption representation and content hashes as the canonical repair.
- 40 missing 512-dimensional CLIP image vectors, computed locally with the FP32 `Xenova/clip-vit-base-patch32` image encoder and L2 normalization. No GPU instance or training was used. Hosted Workers AI supplied caption and text-embedding inference.
- Most missing CLIP images were 112 MB aerial scans. Downloads were checkpointed; local 1024 px JPEG derivatives were used for inference while the serving originals were preserved. Several scans are very dark, so captions deliberately avoid uncertain fine detail.

A three-image calibration against historical vectors showed cosine similarity of 0.913–0.960 for FP32 and 0.926–0.982 for quantized inference. This confirms a shared representation but not bit-identical historical preprocessing. The new vectors use an explicit FP32 configuration; no existing image vectors were replaced.

## Operation and evidence

Run from the repository root, using existing `.env` credentials (never print them):

```sh
node packages/scripts/src/vectorize/repair-gaps.mjs assets
node packages/scripts/src/vectorize/repair-gaps.mjs captions
node packages/scripts/src/vectorize/repair-gaps.mjs clip
node packages/scripts/src/vectorize/review-gap-captions.mjs
# Inspect the images and descriptions; record corrections and reviewed IDs.
node packages/scripts/src/vectorize/repair-gaps.mjs prepare
node packages/scripts/src/vectorize/repair-gaps.mjs publish
node packages/scripts/src/vectorize/repair-gaps.mjs verify
node packages/scripts/src/vectorize/verify-gap-assets.mjs
```

This is a targeted repair job, not a general-purpose ingest command. Its expected inputs and immutable baseline come from `data/mtl_archives/reports/search-repair-20260912/`; its checkpoints, prepared changes, vector backups, review sheets and verification reports live in `data/mtl_archives/reports/gap-repair-20260913/`. `prepare` requires all 184 captions to have visual review records and all 40 image vectors. `publish` refuses conflicting caption edits or changes to the canonical source fields and fills only still-empty captions. It retains pre-update text vectors and updates the canonical export for future ingestion.

After mutation processing, verify every changed vector and its text hash, every imported caption/provenance field, the full R2-to-canonical inventory, and the unchanged archival fields. Search evaluation uses the existing 24 cases / 68 requests per pass (`gap-before`, `gap-preview`, `gap-production`). Worker cache version `2026-09-13-canonical-gap-repair-v3` refreshes cached records and results.

## Recovery

`text-before.json` retains overwritten text vectors; `clip-before.json` records any preexisting vectors for the target IDs (initially none). `targets-before.json` retains original D1 caption values. Rollback must be conditional on the currently stored values still matching this job's output, so subsequent edits are not discarded. Restored R2 assets can remain when rolling back search data. The prior Worker version is `68ff633f-0640-4e41-b560-aec271488a77`; switching Worker versions alone does not roll back D1 or Vectorize data.

This closes coverage gaps. It does not add conversational historical reasoning, strict multi-object matching, or expert verification of legacy captions.

## Transient inference recovery

The production sweep exposed a successful HTTP 200 response with a failed semantic branch. It had been cached for ten minutes, retaining visual-only results after the temporary inference failure. Smart search now sends `Cache-Control: no-store` when degraded, and the cache wrapper honors it. A regression test checks a failed branch, recovery on the next identical request, and caching of the recovered result. The evaluation harness also fails on degraded/failed branches rather than treating every HTTP 200 as a pass.

Vectorize uses approximate scoring by default. A strict self-similarity threshold initially failed even though the correct image was rank 1 and stored vector values matched. All 40 self-queries subsequently passed at rank 1 with scores above 0.999 using `returnValues: true`, which enables [high-precision scoring](https://developers.cloudflare.com/vectorize/best-practices/query-vectors/). Production ranking precision was not changed.

## Final production result

Worker `a0e1e294-5794-4960-9ceb-704c209a05c1` is deployed at 100%. D1 captions, text vectors and visual vectors each cover all 13,499 canonical records; full R2 inventory has no missing canonical objects after 29 restorations. All 184 changed text vectors, 40 added image vectors and caption provenance rows matched readback. All 40 image self-queries ranked their source first. The final 68-request production sweep had healthy branches throughout and identical ordering to the verified preview. Automated tests: 29 API plus four reconciliation; typechecks and desktop/mobile browser smoke passed. See `release-verification.json` in the repair evidence directory. Coverage is complete; broad semantic matching and historical reasoning limitations remain.
