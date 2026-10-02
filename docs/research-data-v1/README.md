# Research dataset pipeline v1

Follow-up: [full canonical backfill](backfill.md) is now running through an
additional research-only transfer Worker and managed dispatcher. The resource
description below records the initial bounded milestone; its "no additional
Worker" statement applies to that initial release, not the subsequent bulk run.

An isolated data plane for reproducible archive engineering and research. The CLI
freezes the full live metadata, preserves a bounded slice of exact bytes, separates
source payloads from inherited assertions, generates traced renditions, and
publishes a verified immutable release to private Cloudflare resources.

This is the first dataset-contract milestone. A thesis, benchmark labels, model
training, complete original-source preservation and a serving migration follow
their own evaluation work. The first slice is an engineering convenience sample,
not a statistically representative benchmark.

## Resource boundary

| Resource | Purpose |
| --- | --- |
| D1 `mtl-archives-research-catalog` (`36147ac0-44c6-43db-84bf-6a8d2bb41b8a`) | Append-only snapshots, record versions, assets, assertions, groups, attempts, runs, releases |
| Private R2 `mtl-archives-research-sources` | Frozen metadata, source conditions, inherited raw evidence, legacy images, reacquired source bytes |
| Private R2 `mtl-archives-research-derived` | New thumbnails, processing reports, recovery state, release manifests |

The existing Worker, D1, R2, Vectorize indexes, app deployment and bindings are
not changed. Production access in this tool is a fixed manifest SELECT, delivery
image GETs and read-only health inventory. Write targets are allowlisted by name;
the configured D1 UUID must resolve to the research catalog. Public bucket
domains cause publication to fail. No scheduled jobs, serving index, public
dataset/media endpoint or additional Worker is created.

The operator-v1 D1 schema owns app/operator job state. This catalog owns research
data releases and is deliberately not a second conversation/control service.
The existing ingest-v1 offline prototype remains intact; this module implements
actual acquisition and Cloudflare artifact verification. Future operator tools
can invoke these bounded jobs without moving catalog state into conversations.

## Contract

- Identity is `mtl:url-v1:SHA256(exact source URL)`. Sequential public IDs remain
  aliases. Byte equality groups records without collapsing their identities.
  A source URL migration needs an explicit reviewed alias mapping. Multiple
  legitimate records at one URL need a resource/native-ID adapter; this builder
  refuses that collision instead of choosing a record silently.
- Metadata versions include full frozen serving fields and matched local raw
  evidence. The local enrichment join requires both public alias and source URL.
  Reconciliation produces a new research export; it does not edit the old file.
- Legacy delivery JPEGs have `legacy_parent_unknown` lineage. Reacquired source
  bytes are separate assets: different bytes do not establish the historical
  JPEG conversion. New thumbnails have a verified legacy-JPEG parent and a
  versioned Pillow/config/code receipt. Originals are not re-encoded in place.
- Source transcriptions, inherited serving fields, captions, OCR, geocodes and
  quality fields retain distinct assertion origins. Inherited generated fields
  with no historic input hash stay `historical_input_hash_unknown`. Empty model
  history is retained as unknown. No assertion is promoted to human ground truth.
- SHA-256 keys are computed from checked bytes. Existing remote keys are read
  and compared; new uploads are read back and hashed before catalog publication.
  `cf r2 objects put` currently exposes no conditional `If-None-Match` flag.
  Immutability is enforced by the application/content identity, not by an R2
  retention lock: a conflicting payload never receives the same computed key.
  Account administrators can still mutate storage; verification detects it.
- D1 versions reject UPDATE/DELETE via triggers. Exact insert replays are allowed;
  conflicting existing rows fail a transaction. The whole bounded catalog release
  is one D1 batch, verified against the release's record membership. A live failed
  batch probe confirmed rollback before first publication.
- Downloads stream with a 32 MiB per-object limit, one image at a time. Images
  must decode within 50 million pixels and 32 frames. Thumbnails use EXIF
  transpose, first frame, max 1024 px, RGB JPEG quality 85, Pillow 12.1.0.
  A too-large object becomes a recorded failure, not an assumed success. PDF
  source bytes are preserved with signature-only validation; no page-render
  verification is claimed. Research media release requires decoded JPEGs.
- SQLite checkpoints commit after artifact persistence. The frozen input,
  builder hash, config and environment must match to resume. A crash before a
  checkpoint may repeat a fetch but cannot duplicate a logical record.
- Missing delivery bytes exclude a record explicitly. Original reacquisition
  failures are retained without excluding an otherwise verified legacy image.
  Retrying a failed original requires a new snapshot/run. A release accounts
  for every selected record, including exclusions.
- Recovery artifacts contain the frozen plan, acquisition checkpoints and fetch
  attempts. `restore` reads all artifacts from private R2 into a fresh directory,
  verifies their hashes and catalog membership; `build --offline` regenerates
  thumbnails and rebuilds the release without network source fetches. Its hash
  must equal the published release hash.

## Runbook

Use a checkout containing `pipelines/research_data`. Authenticate `cf` using its
existing account profile. Credentials stay outside the repository and artifacts.
Python 3.14 and Pillow 12.1.0 were used for the first release; the exact environment
is part of the frozen plan. A different environment requires a new release.

```sh
python3 -m pip install -r pipelines/research_data/requirements.txt
python3 -m unittest discover -s pipelines/research_data -v

# Choose a NEW durable directory for each frozen input snapshot.
export MTL_RESEARCH_RUN=/absolute/path/to/research-run
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" guard-production
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" freeze \
  --enriched /absolute/path/to/manifest_enriched_v3.jsonl \
  --local-canonical /absolute/path/to/manifest_search_canonical.jsonl \
  --conditions /absolute/path/to/source-metadata-current.json \
  --conditions-observed-at 2026-10-02T13:27:00Z

# IDs default to 30 engineering records; originals to 0,94,3436,15046,9247.
# Supply --ids and --original-ids on freeze to define another bounded slice.
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" build --stop-after 5
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" status
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" build
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" verify
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" publish
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RUN" guard-production

# Use the manifest SHA-256 printed by build/publish as RELEASE_SHA256.
export MTL_RESEARCH_RECOVERY=/absolute/path/to/fresh-recovery-dir
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RECOVERY" restore \
  --release-id RELEASE_SHA256
python3 pipelines/research_data/run.py --out "$MTL_RESEARCH_RECOVERY" build --offline
# Compare the rebuilt release.json id to RELEASE_SHA256.
```

`publish` is private catalog publication, not app deployment or operator pointer
activation. It is resumable: already uploaded objects are checked and an exact
catalog replay is idempotent. Leave local run state outside Git. Preserve frozen
code alongside the release because the builder checks its code digest.

## Coverage and next gates

The first release card records actual counts, failed acquisitions, original vs
legacy coverage, duplicate hashes, size discrepancies and source conditions.
The full 13,499-row metadata snapshot is broader than the byte-verified slice.
Series grouping is not inferred from captions; raw cote/reportage evidence stays
available for reviewed grouping. Neither this release nor its convenience sample
defines a research train/test split.

Before expanding: paginate source adapters, handle large aerial scans explicitly,
attach missing source-resource conditions, measure acquisition/storage cost, and
freeze source metadata directly from the portal alongside legacy imports. Before
choosing a thesis: human-review a pilot, establish group-aware splits and a
separately versioned evaluation protocol. Serving publication requires its own
index reconciliation, activation and rollback implementation.
