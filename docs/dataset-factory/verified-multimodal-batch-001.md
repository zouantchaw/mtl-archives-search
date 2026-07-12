# Verified Multimodal Intelligence Batch 001 Foundation

This is a synthetic, hermetic contract foundation for issue #69. It contains no verified historical claims, produces zero benchmark tasks, and does not satisfy the 60-record acceptance target.

## Scope

- Tracked fixture: `docs/dataset-factory/fixtures/verified-multimodal-batch-001/`
- Schemas: `docs/dataset-factory/schemas/verified-multimodal-batch-001/`
- Contracts and validators: `packages/scripts/src/dataset-factory/verified-multimodal-batch-001-contract.ts`
- Artifact registry ID: `dfv0_verified_multimodal_batch_001_pilot`

The fixture covers both issue #69 lanes:

- Ground OCR/entity/place: mock visible text regions, mock source metadata, inference, rejected identity, and exact-location abstention.
- Aerial land-use/georeference: mock aerial mode, land-use regions, georeference candidacy, low-information hard control, and no area/distance without accepted structured external evidence.

## Commands

```bash
npm run dataset-factory:verified-multimodal-001
npm run dataset-factory:verified-multimodal-self-test-001
npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require dfv0_verified_multimodal_batch_001_pilot --artifact-root /absolute/path/to/repo
```

The build command regenerates only tracked synthetic fixture files. It does not read secrets, call external services, mutate production D1/R2/Vectorize, deploy, or launch compute.

## Fail-Closed Rules

The TypeScript validator rejects:

- visual claims without a valid region or whole-image evidence;
- externally verified claims without stable HTTPS source URL and source note;
- incomplete rights/license/attribution fields;
- non-external claims marked externally verified;
- synthetic records with archive URLs, externally verified claims, or benchmark eligibility;
- exact-location claims without accepted externally verified structured georeference evidence;
- area or distance claims without accepted externally verified structured scale/georeference evidence;
- blank or overlapping primary, independent, or adjudication reviewer IDs;
- invalid collection-boundary mapping, metadata evidence fields, enums, or evidence relations;
- benchmark tasks derived from unresolved, rejected, inferred, metadata-only, or visual-only claims.
- benchmark family/component split leakage or missing source snapshot digests.

Benchmark derivation validates every complete source packet before inspecting eligible claims, including the synthetic empty-output path. Stable external URLs are end-anchored HTTPS values: query strings and fragments are rejected. The packet schema independently enforces collection-specific claim boundaries and evidence boundary requirements, while runtime validation additionally resolves metadata evidence fields against present, non-null source metadata.

The packet contract has two explicit variants: tracked `synthetic_hermetic_foundation` mocks and untracked `canonical_real_slice` inputs. Real packets require stable archive-record and rights URLs, canonical provenance, and accepted externally verified claim evidence before benchmark derivation. The self-test constructs one hermetic real packet with two distinct verified claims in memory to prove two-task derivation; it does not write fabricated real evidence. Validation runs the canonical AJV schema before semantic checks. Reviewer IDs are a unique fixed-order `[primary, independent, adjudicator]` string tuple. Bounding boxes use `[x_min, y_min, x_max, y_max]` percentages so schema bounds each endpoint and runtime enforces endpoint order.

Benchmark derivation accepts canonical-real packets only after `review_state.status` is `pilot_reviewed`, requires unique input record IDs, and validates generated tasks against the canonical benchmark schema. Splits reuse Visual Family Graph v1's authoritative `deterministicSplit(component_id)` 80/10/10 helper, so every family in one leakage component remains in one split. Benchmark batches require unique task IDs and unique `(record_id, claim_id)` identities; multiple distinct claims from one reviewed dossier may produce distinct tasks. Exact-location claims require a georeference basis with at least three distinct, nonblank control-point IDs; three is the minimum for a defensible two-dimensional map alignment, while production review may require more based on geometry and residual error.

The current run-report schema is specifically the synthetic pilot variant. `deriveRunReport` independently validates every packet and benchmark task before computing counts or passed gates, rejects empty or duplicate packet sets plus canonical-real or malformed packet inputs, requires four lowercase 64-character SHA-256 values, and requires the synthetic benchmark task set to be empty. The fully constructed report is AJV-validated against the canonical run-report schema before return.

## Outputs

- `packets.v1.jsonl`: versioned synthetic packets separating visual observations, metadata claims, inference, external verification, rejected hypotheses, rights, regions, confidence, alternatives, review state, and abstentions.
- `benchmark-tasks.v1.jsonl`: truthfully empty because synthetic claims are never externally verified or benchmark eligible; future real tasks require family/component identity, deterministic split, and a source snapshot digest.
- `unresolved-queue.v1.jsonl`: unresolved hypotheses held out of benchmark derivation.
- `rejected-hypotheses.v1.jsonl`: explicit unsupported hypotheses and hard controls.
- `run-report.v1.json`: exact fixture digests, gate status, counts, gaps, and next-slice recommendation.

## Current Gap

Issue #69 still requires at least 60 real canonical records, at least 25 deeply verified dossiers, reviewed OCR/entity/place/aerial/abstention metrics, overlays/contact sheets, and independent reviewer inspection of every fully verified dossier. This foundation only proves the versioned contract and fail-closed mechanics on four synthetic records.
