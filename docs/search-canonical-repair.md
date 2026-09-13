# Canonical search repair — September 2026

The serving D1 `manifest` is the canonical ID authority. The legacy text and image indexes contained pre-deduplication IDs that could not hydrate: water/trees lost 50 of 50 semantic candidates in the September 12 audit.

## Reproducible repair

Run from the repository root with the existing Cloudflare credentials in `.env`:

```sh
node --test packages/scripts/src/vectorize/repair-lib.test.mjs
node packages/scripts/src/vectorize/repair-search.mjs snapshot
node packages/scripts/src/vectorize/repair-search.mjs prepare
node packages/scripts/src/vectorize/eval-search.mjs before
node packages/scripts/src/vectorize/repair-search.mjs build
node packages/scripts/src/vectorize/repair-search.mjs verify
# Only after verifying the replacement indexes and frontend caption labels:
node packages/scripts/src/vectorize/repair-search.mjs captions
```

Generated snapshots, content-hashed embedding batches, inventories, caption conflicts and evaluation output live in `data/mtl_archives/reports/search-repair-20260912/` (ignored by Git). `prepare` also writes `manifest_search_canonical.jsonl`, the default input for future text and CLIP ingestion. This repair is explicitly dated; start a new snapshot/output directory for a later corpus revision rather than reusing this one.

Snapshot reads production data; prepare is local only. Build creates replacement indexes and uses hosted BGE inference. It copies existing CLIP vectors without GPU inference. Verify enumerates every replacement ID and compares a sample of stored vectors and text hashes. Captions adds three nullable provenance columns idempotently and updates only empty caption cells, leaving original metadata unchanged. Do not run the generic database seed generator to perform this repair: it emits a full seed rather than a targeted update. Its default now also uses the canonical manifest; research inputs require an explicit override.

Canonical aliases require the recorded dedupe relationship and either an identical image filename or identical source URL (case-sensitive path). Captions tied directly to the surviving image take precedence. Conflicting alias captions are recorded and marked `unreviewed_conflict`; when there is no direct caption and aliases disagree, no caption is selected. Legacy per-record model information is unknown unless recorded in the source; script defaults are not asserted as provenance.

## API contract

Smart search returns legacy `score` plus `rankingScore`, `branchScores`, and `ranks`. Sort by response order or `rankingScore`; raw branch scores are not comparable confidence probabilities. `countKind: "returned"` makes the capped list count explicit.

`retrieval.visual` and `retrieval.semantic` contain status, vector candidate count, hydrated count, missing record count, and size-filter count. A failed branch produces a degraded response if the other works; both failed/unavailable produces HTTP 503. Intentional empty results are distinct from errors. Existing relevance thresholds and compound-scene verification remain outside this repair.

Restored captions are AI observations, not archival descriptions. API responses expose `captionProvenance`; the print-gallery caption fallback labels them unverified. Missing captions remain null. Archive IDs and original metadata are preserved.

## Evaluation

`search-eval-cases.json` defines 24 queries, with English/French equivalents, screenshot examples, untitled scenes, exact references, compound requests and negative controls. `eval-search.mjs PHASE BASE_URL` saves raw API evidence and known-item ranks for all modes. `render-eval-review.mjs before preview` builds side-by-side image review sheets. Known-item rankings are partial judgments, not complete corpus recall. Constraint-only questions and the nonsense control are deliberately not counted as factual answering successes.

Inspect screenshots and record per-query top-five relevance labels before describing quality gains. Keep hydration correctness separate from relevance: an intact index can still retrieve a poor match or an inaccurate generated caption.

## Rollback

The old indexes (`mtl-archives`, `mtl-archives-clip`) are retained, untouched. The pre-repair Worker version is saved in `worker-deployments-before.json`. Deploy that specific version for an immediate traffic rollback, and restore the old index bindings in the checked-in Wrangler config before any later deployment. The additive caption columns do not break the previous Worker.

`manifest-before.json` preserves the previous caption values. If captions require rollback, update only rows whose current caption still equals the repair's selected caption, so later edits are not overwritten. Never restore the entire database snapshot over game, payment, newsletter, or newer metadata state.

## Initial reconciliation

- D1: 13,499 canonical records.
- Old text: 18,464 vectors, 4,965 IDs not present in D1, including two unmapped IDs.
- Old CLIP: 18,382 vectors, 4,923 IDs not present in D1.
- Recoverable captions: 13,315; 184 remain missing; 63 conflicting duplicate-caption sets are recorded.
- Reusable canonical CLIP vectors: 13,459; 40 image records had no old vector. Many of these source images exceed 100 MB; they remain represented in text search. This is an explicit visual coverage gap, not a hydration failure.


## Release result

Shipped Worker `68ff633f-0640-4e41-b560-aec271488a77` and frontend `dpl_FDPGvewpYrnh3Ki92KiQA4pEwdJM`. Production matched all 68 preview evaluation orderings, with zero lost candidates. Both indexes passed full ID enumeration and 16 vector-value checks each. All 13,315 caption restores matched the prepared data. See [mtl-search-repair-2026-09-12](/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-search-repair-2026-09-12/report.md) for the visual review and remaining limits.
