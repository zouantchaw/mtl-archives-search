# Ground Originals v1

This Issue #69 successor binds the exact ground IDs `0`, `10`, `100`, `101`, `102`, and `105` to their existing cotes, official JPEG URLs, sealed 4096-byte prefixes, predecessor descriptors, complete JPEG bytes, validators, Sharp decode metadata, orientation-normalized pixel hashes, and compact review material. It does not modify any predecessor fixture.

## Boundaries

- Acquisition permits public `HEAD` and `GET` only against the six literal HTTPS URLs in `ground-originals-v1.ts`. Credentials, query strings, fragments, alternate hosts/paths, and every redirect are rejected. Each body is capped at 2 MiB and the six-body total at 8 MiB.
- Full originals and `ground-originals-v1.tar.gz` live under ignored `data/mtl_archives/reports/ground-originals-v1/`. Git tracks only deterministic review JPEGs, crops, overlays, contact sheet, OCR proposals, ledgers, report, schemas, and descriptors.
- Every tracked raster is at most 256 KiB and 1600 px on its long edge; all tracked rasters total at most 2 MiB; the complete compact fixture is at most 3 MiB.
- Predecessor regions are defined on white-letterboxed 256x256 derivatives. Every localized region stores the exact contain-fit resize dimensions and padding and is transformed back into the orientation-normalized original frame. Record 105 resolves to CATELLI `[316,866,714,1030]` and WHITE ROSE `[2085,1112,2871,1429]`; both crops were visually checked against the full original.
- Tesseract runs on the orientation-normalized original, not the review derivative. Output is proposal-only and records engine/version, language, OEM/PSM configuration, preprocessing, confidence, original-frame native/normalized polygons, and alternatives. It is not accepted evidence.
- Independent review input contains six neutral scene images plus two neutral crops, with neutral parent linkage, pixel hashes/dimensions, machine OCR text/confidence only when an original-frame proposal actually intersects the crop, and empty decisions. It contains no record IDs, cotes, URLs, archive metadata, OCR paths, region identities, copied conclusions, or identity labels. `trusted-neutral-map-v1.json` binds neutral files to records and regions outside reviewer input. The builder never writes reviewer decisions.
- The six-row research ledger contains record-specific literal triggers labeled as official-cote, archive-metadata-report, or full-resolution-visible-text inputs; bounded authoritative target classes; pending status; null candidate URLs; and no claims. Record 105 preserves the prior 256px `CASTROL` reading only as a rejected false-precision hypothesis. The sealed external review independently corrected two literal crop transcriptions. Those transcriptions remain pixel observations only and are not brand, business, place, or other identity claims. External claims, identity claims, fully verified dossiers, and tasks remain zero.
- Rights lineage binds the official captured Montreal license page and canonical CC BY 4.0 page. This supports attribution/license lineage only, not image-content or historical claims.

## Commands

```bash
npm run dataset-factory:ground-originals-acquire-v1
npm run dataset-factory:ground-originals-derive-v1
npm run dataset-factory:ground-originals-ocr-v1
npm run dataset-factory:ground-originals-verify-v1
npm run dataset-factory:ground-originals-verify-full-v1
npm run dataset-factory:ground-originals-bundle-v1
npm run dataset-factory:ground-originals-publication-seal-v1
npm run dataset-factory:ground-originals-review-seal-v1
npm run dataset-factory:ground-originals-review-verify-v1
npm run dataset-factory:ground-originals-review-publish-v1
npm run dataset-factory:ground-originals-bundle-verify-v1 -- /path/to/ground-originals-v1.tar.gz
npm run dataset-factory:ground-originals-restore-v1 -- /path/to/ground-originals-v1.tar.gz /empty/or/matching/destination
npm run dataset-factory:ground-originals-self-test-v1
npm run dataset-factory:ground-originals-integration-test-v1
```

Clean checkouts run `verify-v1`, `self-test-v1`, and `integration-test-v1` offline against the compact fixture. Compact and full verification require exact neutral-input, external-decision, decision-seal, reviewer/session, trusted crop mapping, source-region geometry, original hash, derived transcription, metrics, report, publication-manifest, and fixture-descriptor linkage. Full replay first supplies the archive described by `full-originals-archive-descriptor-v1.json`, restores it, and runs `verify-full-v1`. Full verification also recomputes originals, decode/pixel facts, transport bindings, predecessor pixels/transforms, rights snapshots, records, review derivatives, crops, overlays, contact sheet, OCR, research literals, schemas, and complete fixture membership. Restore verifies the gzip hash before decompression, accepts exactly the six regular-file allowlist entries, uses `lstat` on every path component and target, rejects dangling or live symlinks, validates the real destination parent, creates files exclusively with `O_NOFOLLOW`, rejects traversal/duplicates/unknown members, and refuses an overwrite whose existing hash differs.

The coordinator uploaded the exact content-addressed archive to Cloudflare R2 and verified readback at 3,612,303 bytes with SHA-256 `cbbce269803e46c404440b148aa5e3d49c0500661759b1057a11b308535e1992`. These facts live in immutable `ground-originals-v1-publication-receipt-input.json`; the separate publication-seal command validates the closed receipt-input schema and verifies the local archive before creating and validating its hash-bound seal. Both receipt files have strict `additionalProperties: false` schemas with exact coordinator source, provider, bucket, key, archive identity, readback state, secret/link declaration, receipt linkage, and sealed status. Bundle generation, bundle verification, compact verification, and full verification validate the applicable receipt files before trusting publication state. Bundle generation defaults to unpublished when no seal exists, preserves a valid seal across deterministic rebuilds, and fails if a seal targets any other hash or byte count. Persistent self-tests reject unknown properties, changed schema/source/status, a true secret/link declaration, and a coordinated input/seal/archive-descriptor/fixture-descriptor reseal. The descriptor and object-store registry row contain no credentials, signed URLs, or temporary links. The generator does not invoke cloud tooling or credentials.

## Independent review publication

Review only `docs/dataset-factory/fixtures/ground-originals-v1/independent-review-input-v1.json` and its eight referenced images. Do not open `trusted-neutral-map-v1.json`, records, OCR files, research files, predecessor packets, or archive metadata. Use a reviewer identity beginning `independent-reviewer-` and a distinct session identity beginning `independent-session-`. Record one scene decision for each of the six neutral scene IDs and one crop decision for each of the two neutral crop IDs. `accept` means the literal text exactly matches a non-null machine proposal; because this packet has no intersecting crop proposals, use `correct` for independently read literal text, or `reject`/`abstain` when no transcription should be accepted. Alternatives are literal alternatives only, not identity claims.

The external review was authored as `independent-reviewer-pixel-ocr-v1` in distinct session `independent-session-20260713-ground-v1`. The ignored external decision and seal bytes remain the authoritative publication input. `review-publish-v1` cannot create either file: it validates their exact approved hashes, byte-copies them into the tracked compact fixture, derives trusted visual-transcription rows from the sealed neutral map, writes metrics/report/publication manifest, and reseals the fixture descriptor. Six scenes and two crops were reviewed; both crop decisions are `correct`. Raw OCR comparison is null because no original-frame machine OCR proposal intersects either crop.

Once publication exists, deterministic `derive-v1` requires both ignored external files to remain present, byte-identical to the tracked copies, and valid against the neutral input and seal. Missing or changed external bytes fail before fixture deletion. The tracked reviewed-transcription rows bind each literal correction to the exact neutral crop hash, source region geometry, and original JPEG hash with `identity_status: not_asserted`. No review metric or report field may promote literal text into an identity or external claim.
