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

The recorded issue-67 build uses acquisition snapshot `9235eb841d379f55973aa52f5558b264857bf35800871c85515a84bb227cb154`, corpus-input SHA-256 `0f9971c70ac242c44ee80835b4c71e9f771e742d8c80603cf39bc1163cc951cc`, and identity-bound pHash-feature SHA-256 `9210a6459275ce8ec571577eeab97abc50a6468c73cca988edaa7ccd554a732a`.

- 18,462 records receive exactly one component mapping: 17,992 grouped records and 470 explicit singletons across 920 components.
- 345,870 typed edges include 36,491 grouping-authoritative, 96,614 review-required, and 212,765 uncertain edges.
- 18,253 pHash extractions succeeded; all 209 stable thumbnail-source failures are individually enumerated.
- pHash contributes zero grouping edges after the expanded distance-0 sample found one false match.
- All 317 parsed aerial runs are preserved with linear `n-1` run edges. The seven runs above 250 members contain 3,019 records, each in exactly one component and one split.
- train/validation/test contain 15,154/1,408/1,900 records and 731/87/102 complete components, with zero crossings.
- 450 canonical/alternate recommendations preserve all alternates, expose component-wide support and selection evidence, and contain zero deletion instructions.
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
- response cap: 1 MiB, enforced while streaming with immediate reader cancellation and request abort on overflow;
- decoded-dimension enforcement: no returned edge may exceed the requested edge by more than 5%;
- concurrency: 8 by default, maximum 16;
- retries: 3 with per-attempt timeout.

After decode, pixels are auto-oriented, flattened on white, and normalized to contain-fit RGB 256x256 for an exact normalized-pixel SHA-256. DCT-pHash64 uses an auto-oriented, white-flattened, contain-fit 32x32 grayscale image and the median of the 63 non-DC coefficients. This transformation is part of the model contract. Every feature row also binds its record ID and image key to the acquisition snapshot, corpus-input SHA-256, feature version, and content-derived derivative-contract ID. Resume fails before fetching if any checkpoint row is mixed or stale. The one-time migration of the existing verified pass adopted 18,462 rows with zero fetches only after the legacy feature/report hashes, corpus lineage, image keys, and transform semantics matched.

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

Each edge is independently classified as `grouping_authoritative`, `review_required`, or `uncertain`. V1 requires exact equivalence between `grouping_eligible=true` and `authority=grouping_authoritative`; the builder and checker both reject either direction of mismatch. The reviewed v1 policy uses exact normalized payloads, exact source-reference assets, and deterministic aerial sequence evidence as grouping evidence. Every parsed aerial run with at least two records gets `n-1` star edges plus at most `n-1` sequence edges; there is no member-count skip. All pHash distances remain non-authoritative: bins 1-2, 3-4, 5-8, 9-12, and hard-negative 13-16 were 0/4 in the implementation-author sample, while the expanded distance-0 sample contained one visibly different dark-aerial collision. `visual_neighbor_clip`, `visual_neighbor_dino`, `same_reportage`, `alternate_crop`, and `same_subject_unverified` never force grouping in v1. The checker hard-fails if this boundary is crossed.

`same_source_asset` is an exact provenance relation over normalized archive source URL and source-row identity, not a current-R2-pixel equality claim. The expanded review found current derivative disagreements inside several source-alias pairs; those are recorded as negative visual adjudications and retained as data-quality evidence. The source edge remains grouping-authoritative because its independent contract is shared source provenance and conservative split isolation, while `exact_payload` separately covers normalized pixel equality.

Recommendation confidence is computed over the whole component, never promoted by the mere presence of one exact edge. Each row reports edge counts by type, exact-payload member coverage, source equality/disagreement/unavailability, sequence-or-aerial-only membership, canonical score/margin/tie count, base confidence, and every applied cap. Source disagreement, sequence-only dominance, and ambiguous canonical selection cap confidence independently. Deterministic adversarial tests reproduce the review's 234-member/2-exact/115-of-117-disagreement and 222-member/8-exact/111-of-111-disagreement patterns; both cap at 0.60.

CLIP evidence is limited to the frozen 500-query `Xenova/clip-vit-base-patch32` evaluation artifact. The production index contract is 512-dimensional cosine, but index membership does not supply neighbor pairs. Coverage and artifact hash are explicit, and similarity is never called historical identity. DINO/DINOv2 remains `not_run_no_approved_paid_compute_gate`; no Lambda or Hugging Face job is launched.

## Splits And Review

Train/validation/test assignment hashes each complete grouping-authoritative connected component. The record map and split file must cover all 18,462 records once. Singleton rows carry `leakage_status=singleton`, a null `leakage_group_id`, and their own component ID. The checker reconstructs every component and requires zero component crossings.

The review packet is deterministic and stratified across exact payload/source evidence, every pHash threshold bin, aerial/sequence evidence, reportage, repeated street scenes, documents/maps, crop candidates, CLIP neighbors, same-subject uncertainty, and pHash hard negatives. The machine-checked minimums are 20 pHash-0 pairs, 20 same-aerial-run pairs, and 12 each for exact normalized payload, same source asset, and sequence precedence; all other strata retain at least four. Decisions live at `docs/dataset-factory/fixtures/visual-family-graph-v1/review-adjudications.jsonl`. Positive and negative decisions require `image_inspected=true`; unavailable or incomplete rendered pairs use `decision=abstain` with `image_inspected=false`. Pairwise precision is reported by edge type and pHash threshold with inspected numerator/denominator, adjudication rows, abstentions, and a Wilson 95% interval. Zero-review rows remain explicit with null precision and documented uncertainty. The independent reviewer inspected all 120 preserved decisions with zero disagreements. Review of the corrected leakage universe and remediation head remains the acceptance gate.

## Safety Boundary

This workflow performs no production D1/R2/Vectorize write, reindex, Worker/site deploy, ranking mutation, image deletion, credential change, external send, or paid compute. Public image and API access is bounded and read-only. Montreal Open Data attribution and per-record source provenance are preserved without expanding rights.
