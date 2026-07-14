# Issue 90 Gate F Aerial Source Evidence v1

`aerial-source-evidence-v1` is the candidate-only Gate F evidence contract. It binds all 20 Phase D aerial records plus the deterministic next two component-distinct Gold reserves (`10153`, rank 31; `9504`, rank 32) to 22 unique Visual Family Graph components, exact official media bytes, decode dimensions, sanitized transport facts, source/rights/attribution records, and explicit high-risk abstentions.

The 22 originals total 946,387,779 bytes: 20 TIFFs and two JPEGs. `sharp` 0.33.5/libvips 8.15.3 fully decoded every image and computed pixel statistics; header-only parsing does not count as pixel verification. Exact bodies are not committed. Every sanitized transport receipt binds the raw `.meta`, `.headers`, and `.probe` sidecars by bytes and SHA-256. TIFF probes are exact media-prefix ranges with HTTP 206; the two JPEG probes are byte-identical full bodies with HTTP 200.

The private-snapshot descriptor binds the 22 exact media members and 22 sanitized receipts. Phase B defines deterministic local packing plus an external upload/readback seal, but performs no cloud write. Independent Gate E review and publication remain future work; therefore the tracked authority is `candidate_held_external_review_required`, issue completion is false, and the registry row is candidate-only.

## Deterministic private archive and archived candidate

The archive command emits deterministic `ustar+gzip` with fixed mode `0600`, uid/gid/mtime zero, lexical member order, and exactly two terminal zero blocks. Its payload is exactly 44 regular files: 22 hash-pinned media bodies and 22 generated sanitized transport receipts. It contains no raw sidecars, signed URLs, descriptors, upload receipts, or self-referential hashes.

The verifier independently decompresses and parses the archive. It rejects unsafe or non-normal paths, duplicates, links and non-regular types, metadata drift, checksum errors, nonzero padding, extras, substitutions, truncation, and any member-set/order/hash/byte mismatch.

After an approved coordinator uploads and completely reads back the archive, `seal-archived` consumes an externally authored receipt conforming to `external-archive-upload-readback-receipt-v1.schema.json`. The receipt must bind the local archive hash/bytes, a non-signed `r2://bucket/key` durable locator, upload time, and byte-identical readback hash/bytes/time. Sealing creates a new directory, byte-preserves the complete candidate and original descriptor, byte-preserves the external receipt, and adds a separately derived archived-candidate descriptor. Existing outputs are refused.

```bash
mkdir -p /tmp/mtl-gate-f-private
npm run dataset-factory:aerial-authority-v1 -- pack --candidate "$PWD/docs/dataset-factory/fixtures/aerial-source-evidence-v1" --media-root /tmp/mtl-gate-f-media --output /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
npm run dataset-factory:aerial-authority-v1 -- verify-archive --candidate "$PWD/docs/dataset-factory/fixtures/aerial-source-evidence-v1" --archive /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
shasum -a 256 /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
wc -c /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
# Upload with the coordinator's approved R2 tooling, read the complete object back, and author /absolute/UPLOAD_READBACK_RECEIPT.json outside this implementation.
npm run dataset-factory:aerial-authority-v1 -- seal-archived --candidate "$PWD/docs/dataset-factory/fixtures/aerial-source-evidence-v1" --archive /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz --receipt /absolute/UPLOAD_READBACK_RECEIPT.json --output /absolute/ARCHIVED_CANDIDATE
npm run dataset-factory:aerial-authority-v1 -- verify-archived --archived /absolute/ARCHIVED_CANDIDATE --archive /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
```

Phase B stops at `archived_candidate_external_review_required`; Phase C below is the only path from that state to source authority.

## External review and one-way publication

Phase C generates only a blank, hash-bound review template. A fresh external reviewer must use model `gpt-5.6-sol` with reasoning effort `high`, supply distinct `reviewer_id` and `session_id`, attest independence from implementation, acquisition, and dossier review, and author all 22 dispositions outside this implementation session. The receipt may accept source/media/rights/attribution evidence completeness. Location, georef, scale, land use, and measurement must remain `held` or `abstained`; georeference proposals remain null and accepted claims, dossiers, and tasks remain zero.

Reviewer inputs are the complete archived-candidate directory, the private archive through its durable readback binding, and the generated blank template. The template binds both candidate descriptors/trees, evidence and source-body ledgers, all ten body pins, source families and proposition hashes, archive/readback facts, predecessor pins, direct lineage families, and all 22 record/component/media/transport identities.

```bash
npm run dataset-factory:aerial-authority-review-template-v1 -- --archived /absolute/ARCHIVED_CANDIDATE --output /absolute/BLANK_SOL_HIGH_REVIEW.json
# Fresh external Sol High reviewer writes /absolute/COMPLETED_SOL_HIGH_REVIEW.json; implementation does not fill it.
npm run dataset-factory:aerial-authority-validate-review-v1 -- --archived /absolute/ARCHIVED_CANDIDATE --receipt /absolute/COMPLETED_SOL_HIGH_REVIEW.json
npm run dataset-factory:aerial-authority-publish-v1 -- --archived /absolute/ARCHIVED_CANDIDATE --receipt /absolute/COMPLETED_SOL_HIGH_REVIEW.json --output /absolute/NEW_PUBLISHED_AUTHORITY
npm run dataset-factory:aerial-authority-verify-published-v1 -- --output /absolute/NEW_PUBLISHED_AUTHORITY --archive /tmp/mtl-gate-f-private/aerial-source-evidence-v1.tar.gz
```

Publication requires a new output path, byte-preserves every archived-candidate file and the exact external receipt, and derives the review ledger, final status, final descriptor, and authoritative registry row from that receipt. Reusing an output path or attempting a second publication is refused. Issue #90 remains incomplete because semantic location/georeference/scale authority is intentionally absent.

## Official source bodies

The exact new CKAN bodies are stored outside git at `/tmp/issue90-gate-f-remediation-sources-v1`. The tracked `source-body-evidence-v1.json` contains permitted bounded representations and pins all ten private body hashes, all 22 structured row hashes, package/resource joins, source-family IDs, author, license, and required credit.

| Package | Family | Exact package body SHA-256 |
|---|---|---|
| `57f56aa9-1284-42d0-8b1a-336e66cd6de9` | oblique 1960-1992 | `08c49423cd603de776034ddced8a7204266eb3f206a84e40a7fb566f534e25f6` |
| `6555c320-77bf-4478-a3d2-c29733a7046c` | vertical 1958-1975 | `227f3cfc8d09946218566b21fee78472c5ca354f467cf5bcec0193d68ec9fb24` |
| `446b4220-6928-42eb-8d95-da0c67f22bc8` | vertical 1947-1949 | `6d3cf41d58d091e38d219b938d2167ea28b0d1369f6583fbddac569c47c145d6` |

The applicable resources are oblique CSV `0ef12a2f-da90-49fb-8c46-89024edece54`, corrected 1947-1949 CSV `09a0893e-3142-4950-8c54-1250540bde13`, and exact year CSVs from the vertical package for 1958, 1962, 1964, 1966, and 1971. All three packages state author `Service du greffe - Section des archives`, CC BY, and required credit exactly `Archives de la Ville de Montréal`.

The current oblique download physically publishes five columns, including combined `Titre / Photographe / Dates`; the source artifact also records the seven-field logical schema `Cote`, `Titre`, `Date`, `Nom du photographe`, `Description`, `Hyperliens`, and `Mention de crédits`. Reportage-scoped values are explicitly marked `present_reportage_scope`. Eleven vertical records have photographers explicitly marked `missing_in_applicable_csv_row`; no placeholder is promoted into attribution. The CSV text `Cote. Nom du photographe. Archives de la Ville de Montréal` is retained only as `placeholder_not_complete_attribution` evidence and is never used as required credit.

## Media outcomes

| ID | Role | Mode | Format | Dimensions | Bytes | SHA-256 |
|---:|---|---|---|---:|---:|---|
| 8132 | selected | vertical | TIFF | 10416x10316 | 107535752 | `f2e2a4f9dafcded0e87ab91c0e5097a94a449039c3d8e1dea3a53ee34ff85551` |
| 8134 | selected | vertical | TIFF | 10482x10383 | 108919438 | `de64604425fe320a1130c5fd7426b84077854bafcf3994071270b4ce1fb085fd` |
| 8139 | selected | vertical | TIFF | 10482x10415 | 109255118 | `a9c3e380e032c8f5d6a9901d75b2f98f6b24bb3b357784444801b33ea0715404` |
| 8143 | selected | vertical | TIFF | 10449x10382 | 108566342 | `8ace22de80fcf88c1fd5cda0e0cf6c3e83be15a7009973e28d9c5d3dd76659c1` |
| 12115 | selected | oblique | TIFF | 2051x2100 | 12938326 | `c514c7fc1184a32c4e2ee44367d304ca101ed4c8fa9d9fe8fe2392f0f1b468a9` |
| 11923 | selected | oblique | TIFF | 2100x1353 | 8534950 | `5d617a188f065466c9a42ad7a179b47c7263942246e912bb388bcd4cea5dd523` |
| 4501 | selected | vertical | JPEG | 3221x3300 | 3741223 | `86582e5411fddbf48272b219a7b5d6184f084c1d1acd9b0daa21c68c5997a18f` |
| 14135 | selected | oblique | TIFF | 2085x2100 | 13152526 | `5b5fcbf59faab579d0afef8b664dc1cacffba8d04adb09accb80976197582541` |
| 12623 | selected | oblique | TIFF | 2076x2100 | 13095826 | `4f3ddefe41aa67674051ac7ac6d1e64a2c1715006e75e6ecbe0be77a77217067` |
| 7929 | selected | vertical | JPEG | 3115x3300 | 3047708 | `14138db47ebf2868cba449d1bdd5159db2181d33e0871d7f459b765276d77e22` |
| 9844 | selected | vertical | TIFF | 8503x9189 | 78209348 | `25a75fe80890dea3aff8b6c3f8c787b76e12c23e241213a96e404e0e09127275` |
| 9092 | selected | vertical | TIFF | 8492x8493 | 72192268 | `f287a29536244aca762b2c0c26d0909b510807ce3499b0f33090d26afab323ac` |
| 13389 | selected | oblique | TIFF | 2057x2100 | 12976126 | `1e5ec15a345ebe71ead8eeab6409b18d1dfea363e75b59065523eaf905e125c4` |
| 14965 | selected | oblique | TIFF | 2100x2094 | 13209178 | `c6211182896856b4f2ed45e41bc5ae5e254bbd94c032754d033db0bb832ea25f` |
| 11836 | selected | oblique | TIFF | 2100x1645 | 10376886 | `6bb0e7710840b526050fee1c8585ab7c852b7ee525e04f110157d7ddc6774bd2` |
| 11993 | selected | oblique | TIFF | 2092x2100 | 13196626 | `852c0b95a400cd25a51df27186642de08e9cd0831fdcde1bfdcb1b64fa02549a` |
| 8432 | selected | vertical | TIFF | 8332x8347 | 69615748 | `d10f46b494b3b3d5bbbe46b7a760f18805e5a08bdf3ad211c5e9926841f28754` |
| 13272 | selected | oblique | TIFF | 2100x2022 | 12755002 | `223044f7618dca8bada2c32c64bab88cb9f83fc9363d546f07a288c53b094518` |
| 14813 | selected | oblique | TIFF | 2066x2100 | 13032826 | `a27b3e89a270f1828c30f5a75bbacf4b2985fe683d0fe2ec1b4e1e8eef1f406b` |
| 12117 | selected | oblique | TIFF | 2096x2100 | 13221826 | `29373b7799d4c6e45e97b611c36e7414562ad214e2638213a16ca5e6cffddddc` |
| 10153 | reserve | vertical | TIFF | 8180x8920 | 73038728 | `5925b241ee7eb9c7ec496359300a685ef78937d150a76822f3d2f3411f0dc938` |
| 9504 | reserve | vertical | TIFF | 8328x9090 | 75776008 | `553317df568fa46d3d78dd781b8f99634dcde2d22b36af233b24ee98e3686bf8` |

Record `10153` remains a reserve despite its promoted aerial-mode label: the bound Gold adjudication also sets `quality_failure=yes` and `needs_human_review=yes`. The authenticated Phase D replay rows report component sizes 247 for `10153` and two for `9504`; both entire components are excluded from all 60 Phase D components and from the other Gate F candidate. Sibling IDs remain held until the authenticated graph archive is restored rather than inferred from metadata.

## Authority boundary

The four pilot aerial dispositions (`8132`, `8134`, `8139`, `8143`) remain held. Every Gate F record is held, and exact location, scale, footprint, area, acreage, distance, land use, and measurement all abstain. No georeference proposal is authored because no independently reviewed authoritative map/index body supports one. A future proposal must identify at least three distinct control-point IDs and the authoritative body supporting each; measurement additionally requires accepted scale evidence.

Official City metadata, source URLs, year labels, index descriptions, and same-family records are not independent pictured-location, scale, or georeference corroboration. CKAN rights and attribution facts are exact, but record-level applicability remains held for fresh bounded Gate E review. Acquisition does not increase dossier or task counts.

## Verification

```bash
npm run dataset-factory:aerial-source-evidence-verify-v1
npm run dataset-factory:aerial-source-evidence-verify-v1 -- --media-root /tmp/mtl-gate-f-media --source-root /tmp/issue90-gate-f-remediation-sources-v1
npm run dataset-factory:aerial-source-evidence-self-test-v1
npm run dataset-factory:aerial-source-evidence-integration-test-v1 -- --media-root /tmp/mtl-gate-f-media --source-root /tmp/issue90-gate-f-remediation-sources-v1
npm run dataset-factory:artifacts:check -- --verify-files --verify-required-only --require dfv0_aerial_source_evidence_v1_candidate
```

Offline tracked verification checks strict schemas, exact source/body/row pins, package-resource-family-record joins, rights and attribution joins, raw-sidecar receipt semantics, all cross-derived counts, predecessor pins, component uniqueness, abstentions, descriptor tree, and candidate registry authority. Supplying both private roots additionally re-hashes every exact body and sidecar and fully decodes all 22 originals. Integration rebuilds all six tracked candidate files and requires byte identity. The resealed self-test attacks rights, metadata, claims, status, archive member representations, source family/row/proposition identity, attribution placeholders, components, media, sidecars, predecessors, and truncated pixel data.
