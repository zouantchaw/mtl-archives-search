# Verified Multimodal Intelligence Batch 001 Foundation

This is a synthetic, hermetic contract foundation for issue #69. It contains no verified historical claims, produces zero benchmark tasks, and does not satisfy the 60-record acceptance target.

## Scope And Surfaces

Synthetic foundation:

- Fixture: `docs/dataset-factory/fixtures/verified-multimodal-batch-001/`
- Schemas: `docs/dataset-factory/schemas/verified-multimodal-batch-001/`
- Runtime contract: `packages/scripts/src/dataset-factory/verified-multimodal-batch-001-contract.ts`
- Registry ID: `dfv0_verified_multimodal_batch_001_pilot`

Canonical-real selection and visual review:

- Candidate, promotion, and independent-review descriptors: `docs/dataset-factory/fixtures/verified-multimodal-batch-001/real-pilot-*.json`
- Candidate/promotion/review runtimes: `packages/scripts/src/dataset-factory/real-pilot-*.ts` and their build, self-test, and integration-test commands
- Registry IDs: `dfv0_verified_multimodal_batch_001_real_pilot_selection_v1`, `dfv0_verified_multimodal_batch_001_real_pilot_visual_promotion_v1`, and `dfv0_verified_multimodal_batch_001_real_pilot_independent_visual_review_v1`

Canonical-real public source acquisition:

- Clean-checkout fixture: `docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/`
- Schemas: `docs/dataset-factory/schemas/real-pilot-source-acquisition-v1/`
- Runtime and exact tuple/validator contract: `packages/scripts/src/dataset-factory/real-pilot-source-acquisition-v1.ts`
- Network staging command: `packages/scripts/src/dataset-factory/acquire-real-pilot-sources-v1.ts`
- Offline verifier: `packages/scripts/src/dataset-factory/verify-real-pilot-sources-v1.ts`
- Manifest/descriptor sealer: `packages/scripts/src/dataset-factory/seal-real-pilot-source-acquisition-v1.ts`
- Adversarial and clean-replay tests: `self-test-real-pilot-source-acquisition-v1.ts` and `integration-test-real-pilot-source-acquisition-v1.ts`
- Registry ID: `dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1`

The fixture covers both issue #69 lanes:

- Ground OCR/entity/place: mock visible text regions, mock source metadata, inference, rejected identity, and exact-location abstention.
- Aerial land-use/georeference: mock aerial mode, land-use regions, georeference candidacy, low-information hard control, and no area/distance without accepted structured external evidence.

## Commands

```bash
npm run dataset-factory:verified-multimodal-001
npm run dataset-factory:verified-multimodal-self-test-001
npm run dataset-factory:real-pilot-sources-verify-v1
npm run dataset-factory:real-pilot-sources-integration-test-v1
npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require dfv0_verified_multimodal_batch_001_real_pilot_source_acquisition_v1 --artifact-root /absolute/path/to/repo
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

Synthetic foundation outputs:

- `packets.v1.jsonl`: versioned synthetic packets separating visual observations, metadata claims, inference, external verification, rejected hypotheses, rights, regions, confidence, alternatives, review state, and abstentions.
- `benchmark-tasks.v1.jsonl`: truthfully empty because synthetic claims are never externally verified or benchmark eligible; future real tasks require family/component identity, deterministic split, and a source snapshot digest.
- `unresolved-queue.v1.jsonl`: unresolved hypotheses held out of benchmark derivation.
- `rejected-hypotheses.v1.jsonl`: explicit unsupported hypotheses and hard controls.
- `run-report.v1.json`: exact fixture digests, gate status, counts, gaps, and next-slice recommendation.

Tracked public source-acquisition outputs under `docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/`:

- `manifest-v1.json`: complete 23-member payload/evidence inventory with relative path, SHA-256, and byte count. The manifest and descriptor are the two additional files in the 25-file registered directory.
- `descriptor-v1.json`: binds the manifest hash, payload tree/counts, exact candidate/promotion/independent-review descriptor hashes, selected IDs, run-file hashes, rights boundary, zero historical claims, and clean-checkout output root.
- `promotion-bindings-v1.json`: exact selected record ID, candidate ID, promotion ID, and source-identity binding for all 12 records.
- `source-ledger-v1.json`: exact five document and 12 image tuples, sanitized signed-transport metadata, HEAD/range headers, stable validators, object lengths, and bounded sample hashes.
- `snapshot/ground_csv.csv` and four official HTML snapshots: bounded official bytes used for exact row, rights, and aerial-boundary verification.
- `snapshot/image-samples/*.bin`: twelve 4096-byte JPEG/TIFF magic-byte samples; availability samples are not full-file or image-content verification.
- `selected-ground-rows-v1.json`: six exact cote/source rows and canonical row hashes parsed from the captured official CSV.
- `verification-run-v1.json`: deterministic 17/17, 12/12, 6/6 offline verification report, aerial/rights limitations, secret scan, and source snapshot digest.
- `acquisition-run-v1.json` and `unresolved-rejected-v1.json`: network capture status plus truthfully empty final unresolved/rejected queues.

## Current Gap

The canonical-real path now has 12 primary visual selections and 4 reserves from direct 256px review. A separate immutable independent review approved all 16 decisions with zero disagreements. Public source acquisition is tracked under `docs/dataset-factory/fixtures/real-pilot-source-acquisition-v1/`: all 17 required public sources, 12 bounded 4096-byte image samples, and six exact official CSV cote/source rows are available to a clean checkout. `manifest-v1.json` lists every payload/evidence member with SHA-256 and byte count; `descriptor-v1.json` binds that manifest, the candidate/promotion/independent-review descriptor hashes, exact selected IDs, run-file hashes, counts, rights, and zero historical claims. The offline verifier recomputes exact per-key tuples, source payload hashes, HEAD/range identity and validators, object totals, promotion/candidate bindings, manifest membership, descriptor tree/counts, and secret redaction without network access.

This source evidence verifies availability, official row provenance, CC BY 4.0 attribution requirements, and the official aerial collection's TIFF/index plus non-georeferenced or approximate boundary only. It does not verify historical claims, selected-image content, named ground buildings or brands, aerial land use/geolocation/scale/date, or full large-image payloads. Completed dossiers and derived benchmarks remain zero. Issue #69 still requires at least 60 real canonical records, at least 25 deeply verified dossiers, reviewed metrics, and independent reviewer inspection of every fully verified dossier.
