# First private research release — 2026-10-02

Release SHA-256:
`f0f29477c75943ec6b5161239fb4837950f15fa9381c2e309bd990b98636576a`

| Measure | Verified result |
| --- | ---: |
| Full frozen metadata rows | 13,499 |
| Byte-verified record slice | 30 |
| Unique private R2 artifacts | 85 |
| Artifact bytes | 133,650,685 |
| Asset associations | 65 |
| Preserved assertions | 150 |
| Exact duplicate groups | 8 (16 records retained) |
| Source files reacquired | 5 (four decoded images; one signature-only PDF) |
| Selected delivery exclusions | 0 |
| Durable fetch attempts/checkpoints | 35 / 35 |
| Catalog release rows | 436 in one atomic batch |
| Local failure/recovery tests | 19 passed |

The local canonical export omitted caption source/model/status on 13,315 records.
A new research export reconciles those fields with the frozen live values. Existing
local source files and production D1 were not edited.

`mtl_archives_metadata_9247.json` still declares 5,793,383 image bytes, while the
current decoded delivery JPEG has 5,345,070. Its declared external URL yields a
PDF, now separately preserved. The release records both sizes and unknown historic
transform lineage; it makes no serving correction.

## Verification

Publication read back and SHA-256 checked every artifact before catalog commit.
Live D1 probes confirmed failed-batch rollback and rejected UPDATE/DELETE on
research version rows. A fresh local directory restored all 85 artifacts from
private R2, verified catalog membership, and regenerated thumbnails offline.
The rebuilt manifest hash equals the published hash above.

Production metadata digest, Worker deployment and Vectorize info remained
unchanged. Thirty sampled delivery ETags/sizes remained unchanged. Live smart
search checks for `tramway`, `streetcar`, `église` and `church` returned HTTP 200,
healthy visual/semantic branches, no missing records and no degraded result.

## Coverage limits

This engineering convenience slice includes street/aerial/map material and all
eight duplicate candidates; it is not a representative benchmark. Five source
files were reacquired, not all 30. Source transcriptions and legacy OCR/captions
are not reviewed ground truth. Photographic series and evaluation splits remain
unassigned.

Inherited source associations in the slice: phototheque 2, aerial 1947–1949 17,
obliques 1960–1992 7, aerial 1966 2, aerial 1964 1, aerial 1969 1. The frozen
conditions evidence covers related packages for the first three associations.
The other four records lack matching package conditions in this snapshot; their
conditions are unknown. No universal image-license inference is made.

Detailed local evidence, full card and frozen builder:
`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-data-v1-2026-10-02/`.
The [runbook](README.md) describes recovery directly from private Cloudflare.
