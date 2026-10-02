# Full canonical backfill

Status: launched 2026-10-02; multi-hour processing, not yet a completed corpus.

The frozen selector contains 13,499 canonical public aliases, their exact source
URLs, production image keys, inventory ETags and sizes. Selected delivery bytes
total 106,353,595,071 (106.35 GB decimal), rather than the entire 169.74 GB app
bucket. Noncanonical images, social media and other app objects remain untouched.

## Isolation

An additional Worker, `mtl-archives-research-transfer`, is deployed through `cf`.
It has ONLY these bindings:

- `SOURCES`: `mtl-archives-research-sources`
- `DERIVED`: `mtl-archives-research-derived`
- `CATALOG`: `mtl-archives-research-catalog`
- `BULK_TOKEN`: a generated secret stored outside Git and evidence outputs

There are no production D1/R2 bindings or app routes. Incoming requests require
the token. Acquisition accepts only aliases/roles in the frozen selector, not
arbitrary URLs. Source redirects are limited to known archival hosts. Production
delivery is accessed through HTTP GET and must match the frozen inventory ETag.
The existing app Worker, indexes, migrations and bindings are not changed.

## Execution and verification

1. Streaming acquisition writes scratch objects only in private research R2.
   Known lengths use backpressure with `FixedLengthStream`; unknown lengths use
   bounded 8 MiB multipart buffers. Each source is limited to 512 MiB. SHA-256 is
   computed while reading; content-addressed publication uses `If-None-Match: *`.
   Stored bytes are independently re-read and hashed before acknowledging success.
   Owned scratch objects are deleted after processing.
2. Delivery images are streamed into a temporary local file, hashed again, then
   decoded fully through sequential libvips tiles. The pixel budget is one billion
   pixels. Truncated-image tests fail. A new 1024 px JPEG rendition is attached to
   its checked parent with libvips/settings provenance. Temporary working files
   are removed on normal completion. Original upstream files are independently
   byte-preserved; their TIFF/PDF decode remains a separate stage, explicitly
   marked `not_attempted_source_master`.
3. Frozen raw enrichment joins require alias AND source URL. A local immutable
   copy of the full enrichment input prevents app jobs from changing the input
   mid-run. Metadata versions, source/derived assertions and asset associations
   enter the existing research contract tables. Additional append-only
   `backfill_item` rows record every outcome, including failures and size gaps.
4. SQLite checkpoints are committed per item. Catalog batches contain at most 20
   records and reject conflicting existing rows. Only acknowledged rows receive
   the local catalog flag. A restart replays unacknowledged transactions and
   resumes pending aliases. The future queue is bounded by concurrency.
5. Each completed phase accounts for all selected aliases, including failures.
   It emits immutable per-item shards and a collection manifest. A completion
   marker is written only after D1's phase count agrees. Byte hash groups retain
   separate record identities. Full-corpus grouping lives in these versioned
   manifests; the earlier `duplicate_group` table contains the first pilot slice.

Delivery concurrency is 24; upstream acquisition concurrency is four. These are
explicit local dispatcher limits. The run uses a Python 3.12 virtual environment,
Pillow 12.1.0, pyvips 3.2.0 and libvips 8.18.7. The exact code/config/input digests
are frozen in its plan. Different processing code requires a new run revision.
Existing research objects are retained and deduplicate by content hash.

The Python dependencies are pinned in `pipelines/research_data/bulk_requirements.txt`.
The dispatcher also requires system libvips and the authenticated `cf` CLI on
PATH. The tested CLI version is `1.0.0-beta.5`. Setup for a separate run:

```sh
uv venv --python 3.12 .venv-bulk
uv pip install --python .venv-bulk/bin/python \
  -r pipelines/research_data/bulk_requirements.txt
```

Selection/inventory export and the transfer Worker's embedded selector must agree
with the new plan. Never repoint the active Worker to a new job while this run is
using it. Its generated secret remains outside the repo and release evidence.

## Managed run

The current run directory is:

`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-backfill-full-2026-10-02`

Job ID: `26e244cbd2a871b94ca30b7b55e971ac9321e1673ebe61bddbb4aaac2b8b74c2`.
Worker version: `063b0581-ff6a-4c53-89cc-d737c68d1c39`.

The LaunchAgent `com.wiel.mtl-research-backfill.20261002` owns a frozen copy of the
runner and both phases. It uses background process priority and `caffeinate -i`
to prevent idle computer sleep while running. The Mac must remain powered and
connected; closing its lid or losing connectivity can interrupt local dispatch.
The job resumes from checkpoints when relaunched or on the next login. Each
dispatcher has three bounded retries; a remaining error produces a
`needs_attention` receipt. It never silently changes frozen inputs or activates
serving resources. There is no recurring completed-run schedule.

```sh
# From the isolated research worktree:
.venv-bulk/bin/python pipelines/research_data/bulk.py \
  --out /Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-backfill-full-2026-10-02 status

launchctl print gui/$(id -u)/com.wiel.mtl-research-backfill.20261002

# Relaunch an exited/interrupted job; its supervisor lock prevents duplicate owners.
launchctl kickstart gui/$(id -u)/com.wiel.mtl-research-backfill.20261002

# Stop the managed job if needed. Completed artifacts remain preserved.
launchctl bootout gui/$(id -u)/com.wiel.mtl-research-backfill.20261002
```

The directory contains `legacy_delivery.log`, `source_original.log`,
`supervisor.log`, `production-comparison.log` and `backfill.sqlite`. Completed phases add their reports and
release pointers. `execution-finished.json` records phase exits and the final
production comparison. A failed comparison has bounded retries through the CLI's
normal read-only authentication status path, then produces `needs_attention`.
`complete_accounting` means every alias has an outcome and the comparison passed,
not that all source fetches or image validations succeeded: read status counts
and exclusions before selecting research examples.

A source exceeding the byte cap, unavailable URL, unexpected HTML response,
decode failure or changed production ETag remains an explicit outcome. Retrying
acquisition under a new policy requires a new selector/run revision. Historic
caption/OCR input hashes and legacy transformations remain unknown; reacquisition
does not reconstruct them.

## Validation evidence

Twenty-five focused tests passed, including corruption, checkpoint resume,
conflicting catalog rows and source-byte preservation without invented decode
claims. The 123,086,611-byte largest delivery image (13,947 × 14,157 pixels) was
preserved, independently downloaded/hash-checked and fully decoded with libvips.
Unauthenticated Worker calls return 401 and conflicting upload bytes return 409.
Small live batches passed both delivery and upstream catalog paths. A real
LaunchAgent restart retained checkpoints and continued cataloging completed work.
A supervisor test verifies that failed production checks cannot report completion,
that an interrupted verification can resume, and that a completed job does not rerun.

Full backfill completion and counts must be read from the live run reports; this
document does not assert all 13,499 images or upstream files are already copied.

References for the chosen storage mechanics:
[streaming digests](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#constructors),
[fixed-length streams](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/#fixedlengthstream),
[conditional R2 writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).
