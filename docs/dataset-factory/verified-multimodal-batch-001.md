# Verified Multimodal Intelligence Batch 001 Foundation

This is the first end-to-end foundation slice for issue #69. It is explicitly a synthetic, hermetic pilot and does not satisfy the 60-record acceptance target.

## Scope

- Tracked fixture: `docs/dataset-factory/fixtures/verified-multimodal-batch-001/`
- Schemas: `docs/dataset-factory/schemas/verified-multimodal-batch-001/`
- Contracts and validators: `packages/scripts/src/dataset-factory/verified-multimodal-batch-001-contract.ts`
- Artifact registry ID: `dfv0_verified_multimodal_batch_001_pilot`

The fixture covers both issue #69 lanes:

- Ground OCR/entity/place: visible text regions, source metadata, inference, external verification, rejected identity, and exact-location abstention.
- Aerial land-use/georeference: aerial mode, land-use regions, georeference candidacy, low-information hard control, and no area/distance without scale or georeference.

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
- exact-location claims without external georeference evidence;
- area or distance claims without scale/georeference evidence;
- primary, independent, or adjudication reviewer overlap;
- benchmark tasks derived from unresolved, rejected, inferred, metadata-only, or visual-only claims.

## Outputs

- `packets.v1.jsonl`: versioned synthetic packets separating visual observations, metadata claims, inference, external verification, rejected hypotheses, rights, regions, confidence, alternatives, review state, and abstentions.
- `benchmark-tasks.v1.jsonl`: derived only from accepted externally verified claims.
- `unresolved-queue.v1.jsonl`: unresolved hypotheses held out of benchmark derivation.
- `rejected-hypotheses.v1.jsonl`: explicit unsupported hypotheses and hard controls.
- `run-report.v1.json`: exact fixture digests, gate status, counts, gaps, and next-slice recommendation.

## Current Gap

Issue #69 still requires at least 60 real canonical records, at least 25 deeply verified dossiers, reviewed OCR/entity/place/aerial/abstention metrics, overlays/contact sheets, and independent reviewer inspection of every fully verified dossier. This foundation only proves the versioned contract and fail-closed mechanics on four synthetic records.
