# Visual Family Graph v1

Visual Family Graph v1 gives every record in the 18,462-record Canonical Corpus v1 identity universe either one grouping-authoritative leakage component or explicit singleton status. It is a read-only research workflow. Canonical/alternate rows are ranking and presentation recommendations; alternates remain addressable and no output is a deletion instruction.

## Commands

```bash
# Regenerate the exact tracked local normalization used by Canonical Corpus v1.
npm run canonical-corpus-v1:collect -- \
  --source local \
  --local-input data/mtl_archives/manifest_clean.jsonl.gz \
  --output data/mtl_archives/reports/visual_family_graph_v1/canonical_local

# Freeze the public read-only API identity/provenance delta.
npm run dataset-factory:visual-family-input-v1

# Extract full-corpus bounded DCT-pHash features. This is resumable.
npm run dataset-factory:visual-family-phash-v1

# Build typed edges, leakage components, splits, recommendations, and review packet.
# The reviewed v1 policy keeps all pHash distances non-authoritative; this is the default.
npm run dataset-factory:visual-family-graph-v1

# Render bounded local review sheets, then record inspected decisions in the tracked adjudication file.
npm run dataset-factory:visual-family-review-v1

# Rebuild after adjudication, evaluate frozen search candidates, and independently check all arithmetic.
npm run dataset-factory:visual-family-graph-v1
npm run dataset-factory:visual-family-search-eval-v1 -- --candidates /absolute/path/to/search_candidates.jsonl
npm run dataset-factory:visual-family-check-v1

# Credential-free deterministic and adversarial coverage.
npm run dataset-factory:visual-family-self-test-v1
```

Large inputs and outputs stay ignored under `data/mtl_archives/reports/visual_family_graph_v1/`. Compact schemas, fixture specifications, adjudications, evidence summaries, and artifact-registry records are tracked.

## Full-Corpus Result

The recorded issue-67 build uses acquisition snapshot `9235eb841d379f55973aa52f5558b264857bf35800871c85515a84bb227cb154`, corpus-input SHA-256 `0f9971c70ac242c44ee80835b4c71e9f771e742d8c80603cf39bc1163cc951cc`, and pHash-feature SHA-256 `1a90a86e34bca9eec9c25fbe937d83d5feb639f36a0e3b728f0d16e8eb6a7f68`.

- 18,462 records receive exactly one component mapping: 16,865 grouped records and 1,597 explicit singletons across 2,986 components.
- 340,792 typed edges include 31,413 grouping-authoritative, 96,614 review-required, and 212,765 uncertain edges.
- 18,253 pHash extractions succeeded; all 209 stable thumbnail-source failures are individually enumerated.
- pHash contributes zero grouping edges after the expanded distance-0 sample found one false match.
- train/validation/test contain 14,513/1,749/2,200 records and 2,351/329/306 complete components, with zero crossings.
- 1,389 canonical/alternate recommendations preserve all alternates and contain zero deletion instructions.
- 120 review rows contain 116 fully inspected pairs and four truthful unreviewed abstentions.
- The frozen top-10 component duplicate rates are 0.006757 semantic, 0.076333 smart, and 0.177772 visual, with zero unmapped candidate records.

The compact machine-readable evidence and residual-limitations record is `docs/dataset-factory/visual-family-graph-v1-evidence.json`. The five registered bundle digests are independently verified by `npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require ccv1_visual_family_input_20260710,ccv1_visual_family_phash_20260710,ccv1_visual_family_review_20260710,ccv1_visual_family_graph_20260710,ccv1_visual_family_search_eval_20260710`.

## Identity And Lineage

The removed issue-66 worktree did not leave its ignored live manifests behind. V1 therefore does not impersonate issue #66's `d9239bff...` snapshot. It:

1. verifies the tracked gzip and regenerated 14,822-row local inventory against the exact issue-66 local hash;
2. acquires a new bounded public API snapshot with one `GET /api/sitemap` plus detail reads for the 3,640 production-only IDs;
3. derives a new acquisition snapshot ID from the normalized local, sitemap, and production-detail hashes;
4. requires the union to reconcile to 18,462 records, 13,499 D1 records, 4,963 aliases, and 13,499 exact source groups;
5. stores `d9239bff...` only as `canonical_corpus_reference_snapshot_id`, with `byte_equivalent_to_canonical_reference=false`.

The checker independently recomputes the acquisition snapshot ID from the exact input files and rejects same-count mutable source drift.

## pHash Contract

The pHash pass never downloads or stages the 169 GB original corpus. Each record is requested through the existing read-only Worker thumbnail endpoint with:

- width and height: 256;
- fit: `scale-down`;
- format: JPEG;
- quality: 80;
- response cap: 1 MiB;
- decoded-dimension enforcement: no returned edge may exceed the requested edge by more than 5%;
- concurrency: 8 by default, maximum 16;
- retries: 3 with per-attempt timeout.

After decode, pixels are auto-oriented, flattened on white, and normalized to contain-fit RGB 256x256 for an exact normalized-pixel SHA-256. DCT-pHash64 uses an auto-oriented, white-flattened, contain-fit 32x32 grayscale image and the median of the 63 non-DC coefficients. This transformation is part of the model contract.

Within the v1 schema, `exact_payload` is intentionally and exclusively defined as `normalized_derivative_rgb_256x256_v1`: exact equality of the versioned normalized derivative pixel payload. It does **not** claim that original R2 object bytes are equal. Original byte-level hashing would require the prohibited unbounded transfer. `same_source_asset` separately represents deterministic normalized source identity. R2 ETag+size is never accepted as byte proof. The checker recomputes both endpoint hashes and rejects scope/name mismatch or any source-payload equality claim. Every feature failure remains as one record-level row and in the exact failure subset.

## Edge Authority

All graph relations use one of these edge types:

- `exact_payload`;
- `same_source_asset`;
- `near_duplicate_phash`;
- `visual_neighbor_clip`;
- `visual_neighbor_dino`;
- `sequence_precedes`;
- `same_reportage`;
- `same_aerial_run`;
- `alternate_crop`;
- `same_subject_unverified`.

Each edge is independently classified as `grouping_authoritative`, `review_required`, or `uncertain`. Only edges with `grouping_eligible=true` enter leakage components. The reviewed v1 policy uses exact normalized payloads, exact source-reference assets, and deterministic aerial sequence evidence as grouping evidence. All pHash distances remain non-authoritative: bins 1-2, 3-4, 5-8, 9-12, and hard-negative 13-16 were 0/4 in the implementation-author sample, while the expanded distance-0 sample contained one visibly different dark-aerial collision. `visual_neighbor_clip`, `visual_neighbor_dino`, `same_reportage`, `alternate_crop`, and `same_subject_unverified` never force grouping in v1. The checker hard-fails if this boundary is crossed.

`same_source_asset` is an exact provenance relation over normalized archive source URL and source-row identity, not a current-R2-pixel equality claim. The expanded review found current derivative disagreements inside several source-alias pairs; those are recorded as negative visual adjudications and retained as data-quality evidence. The source edge remains grouping-authoritative because its independent contract is shared source provenance and conservative split isolation, while `exact_payload` separately covers normalized pixel equality. Canonical recommendations for source-only components with a current derivative disagreement are capped at confidence 0.65 and carry a `source_reference_current_derivative_disagreement` reason.

CLIP evidence is limited to the frozen 500-query `Xenova/clip-vit-base-patch32` evaluation artifact. The production index contract is 512-dimensional cosine, but index membership does not supply neighbor pairs. Coverage and artifact hash are explicit, and similarity is never called historical identity. DINO/DINOv2 remains `not_run_no_approved_paid_compute_gate`; no Lambda or Hugging Face job is launched.

## Splits And Review

Train/validation/test assignment hashes each complete grouping-authoritative connected component. The record map and split file must cover all 18,462 records once. Singleton rows carry `leakage_status=singleton`, a null `leakage_group_id`, and their own component ID. The checker reconstructs every component and requires zero component crossings.

The review packet is deterministic and stratified across exact payload/source evidence, every pHash threshold bin, aerial/sequence evidence, reportage, repeated street scenes, documents/maps, crop candidates, CLIP neighbors, same-subject uncertainty, and pHash hard negatives. The machine-checked minimums are 20 pHash-0 pairs, 20 same-aerial-run pairs, and 12 each for exact normalized payload, same source asset, and sequence precedence; all other strata retain at least four. Decisions live at `docs/dataset-factory/fixtures/visual-family-graph-v1/review-adjudications.jsonl`. Positive and negative decisions require `image_inspected=true`; unavailable or incomplete rendered pairs use `decision=abstain` with `image_inspected=false`. Pairwise precision is reported by edge type and pHash threshold with inspected numerator/denominator, adjudication rows, abstentions, and a Wilson 95% interval. Zero-review rows remain explicit with null precision and documented uncertainty. This first pass was adjudicated by the implementation author; independent reviewer confirmation remains an explicit acceptance gate.

## Safety Boundary

This workflow performs no production D1/R2/Vectorize write, reindex, Worker/site deploy, ranking mutation, image deletion, credential change, external send, or paid compute. Public image and API access is bounded and read-only. Montreal Open Data attribution and per-record source provenance are preserved without expanding rights.
