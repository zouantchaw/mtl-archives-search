# Quality Repair v0

Quality Repair v0 turns the existing image-quality artifacts into a repair planner, not a blind cleanup pipeline.

Run:

```bash
npm run dataset-factory:quality-repair-v0
```

Full-manifest coverage run:

```bash
npm run dataset-factory:quality-coverage-v0
```

Resumable pixel audit run:

```bash
npm run autoresearch:image-quality -- \
  --input data/mtl_archives/manifest_clean.jsonl \
  --output-dir data/mtl_archives/reports/quality_repair_v0/full_image_quality_audit \
  --limit 14822 \
  --concurrency 1 \
  --fetch-timeout-ms 30000 \
  --fetch-attempts 1 \
  --progress-interval 50 \
  --resume
```

Archived full derivative acquisition command:

```bash
npm run dataset-factory:quality-derivatives-v0 -- \
  --input data/mtl_archives/manifest_clean.jsonl \
  --candidates data/mtl_archives/reports/quality_repair_v0/_absent_candidates.json \
  --collections data/mtl_archives/reports/quality_repair_v0/_absent_collections.json \
  --output-dir data/mtl_archives/reports/quality_repair_v0/kami_full_derivatives_14822 \
  --limit 14822 \
  --concurrency 4 \
  --width 1024 \
  --height 1024 \
  --quality 82 \
  --fetch-timeout-ms 90000 \
  --fetch-attempts 2 \
  --progress-interval 250 \
  --public-domain pub-6a29793ea7664738880d1cc5afb21b87.r2.dev \
  --resume \
  --skip-existing-failures
```

Archived full derivative-backed pixel audit acquisition command:

```bash
npm run autoresearch:image-quality -- \
  --input data/mtl_archives/manifest_clean.jsonl \
  --candidates data/mtl_archives/reports/quality_repair_v0/_absent_candidates.json \
  --collections data/mtl_archives/reports/quality_repair_v0/_absent_collections.json \
  --output-dir data/mtl_archives/reports/quality_repair_v0/kami_full_audit_14822 \
  --limit 14822 \
  --concurrency 8 \
  --fetch-timeout-ms 30000 \
  --fetch-attempts 3 \
  --progress-interval 500 \
  --public-domain pub-6a29793ea7664738880d1cc5afb21b87.r2.dev \
  --audit-image-mode local-derivative \
  --audit-derivatives-manifest data/mtl_archives/reports/quality_repair_v0/kami_full_derivatives_14822/derivatives_manifest.jsonl \
  --audit-width 1024 \
  --audit-height 1024 \
  --metadata-mode range \
  --metadata-range-bytes 262144 \
  --require-derivative-resize \
  --resume
```

These two commands depend on mutable remote image/object bytes and resume state. They acquire new snapshots; they do not reconstruct the archived SHA-256 byte-for-byte. The registry records the exact archived phase membership, parameter-equivalent commands, dependencies, counts, digests, and acquisition boundary. The empty `bounded_pixel_audit_500/` workspace contains no artifact files and is intentionally excluded from the 25 quality entries.

Outputs:

- `data/mtl_archives/reports/quality_repair_v0/quality-repair-v0-report.json`
- `data/mtl_archives/reports/quality_repair_v0/quality-repair-v0-report.md`
- `data/mtl_archives/reports/quality_repair_v0/quality-repair-v0-review-queue.jsonl`
- `data/mtl_archives/reports/quality_repair_v0/quality-repair-v0-review-sheet.html`
- `data/mtl_archives/reports/quality_repair_v0/quality-repair-v0-backfill.sql`
- `data/mtl_archives/reports/quality_repair_v0/full_manifest_coverage_v0/quality-coverage-v0-report.json`
- `data/mtl_archives/reports/quality_repair_v0/full_manifest_coverage_v0/quality-coverage-v0-repair-candidates.jsonl`
- `data/mtl_archives/reports/quality_repair_v0/resumable_smoke/quality_labels.jsonl`
- `data/mtl_archives/reports/quality_repair_v0/resumable_smoke/quality_progress.json`
- `data/mtl_archives/reports/quality_repair_v0/resumable_smoke/quality_failures.jsonl`
- `data/mtl_archives/reports/quality_repair_v0/resumable_pixel_repair_plan_30/quality-repair-v0-report.json`
- `data/mtl_archives/reports/quality_repair_v0/local_derivative_smoke/derivatives_manifest.jsonl`
- `data/mtl_archives/reports/quality_repair_v0/local_derivative_smoke/derivatives_report.json`
- `data/mtl_archives/reports/quality_repair_v0/local_derivative_audit_smoke/quality_report.json`
- `data/mtl_archives/reports/quality_repair_v0/derivative_thumb_guard_smoke/quality_report.json`
- `data/mtl_archives/reports/quality_repair_v0/derivative_pilot_500/derivatives_report.json`
- `data/mtl_archives/reports/quality_repair_v0/derivative_audit_pilot_500/quality_report.json`
- `data/mtl_archives/reports/quality_repair_v0/derivative_repair_plan_pilot_500/quality-repair-v0-report.json`

## Current Finding

The project has useful quality evidence, but it is not yet a complete full-dataset repair audit:

- `quality-coverage-v0` covers all 14,822 current manifest rows and found:
  - 14,822 rows with metadata IDs
  - 14,822 rows with image keys
  - 14,821 rows with image size bytes
  - 14,822 unique image keys
  - 0 duplicate image-key groups
  - 109 phototheque rows and 14,713 aerial/greffe rows by source-family heuristic
- The pixel audit now writes checkpoint rows to `quality_labels.jsonl`, writes `quality_progress.json`, writes `quality_failures.jsonl`, and supports `--resume`.
- A stop/resume smoke was interrupted after partial output, then resumed successfully: 24 existing rows were reused and the remaining 6 rows completed.
- The completed resumable smoke audited 30/30 rows and found 23 EXIF orientation candidates plus crop/tone review candidates.
- The current manifest points at about 164 GB of source images. A naive full-original pixel audit is possible but inefficient and timeout-prone.
- The live Worker `/api/thumb` endpoint and the current Vercel image optimizer both returned full-size source bytes for a 49 MB test image, so neither should be trusted as the #53 derivative source until transform configuration changes.
- `autoresearch:image-quality` now supports tiered audit sources:
  - `--audit-image-mode original`
  - `--audit-image-mode thumb-api`
  - `--audit-image-mode cloudflare-transform`
  - `--audit-image-mode local-derivative`
- `--require-derivative-resize` fails derivative-backed runs when the supposed derivative is still larger than the requested audit edge.
- `dataset-factory:quality-derivatives-v0` creates resumable local 1024px JPEG audit derivatives and writes `derivatives_manifest.jsonl`.
- A 5-row local-derivative smoke read 14.2 MB of originals, wrote 0.97 MB of derivatives, audited 5/5 derivative rows with 0 failures, and matched original-mode labels/severity/actions on 5/5 comparable rows.
- The 500-row derivative pilot generated 482 local derivatives and quantified 18 unresolved source failures. It read 7.0674 GB of originals and wrote 81.01 MB of derivatives.
- The 500-row derivative-backed audit processed all 500 sample rows: 482 successful pixel audits, 18 `image_derivative_missing` rows, 423 flagged rows, 404 EXIF orientation candidates, 93 light-border candidates, and 0 derivative decode failures.
- Pilot agreement with the prior original-mode 30-row smoke was 30/30 for labels, severity, actions, and orientation presence.
- The pilot repair planner produced a 500-row queue, 0 safe SQL updates, and `full_audit_ready=false`.
- Pilot recommendation: proceed to the full derivative pass, but treat it as two lanes: normal derivative generation/audit first, and a separate hard-source retry/backfill lane for large, missing, or transiently failing originals.
- `autoresearch_image_quality` audited a 700-row sample from 14,822 input rows.
- The older orientation audit scanned 2 records and emitted no safe `UPDATE` statements.
- The older artifact audit processed 10 of 200 candidates and failed 190 fetches.
- The cleanup embedding experiment produced 12 before/after pairs and found category changes on some transformed images.
- The missing-image report is useful, but it was generated against the older 13,499-record manifest and must be reconciled against the current 14,822-row dev manifest.
- A previous 500-row pixel audit was attempted before checkpointing, reached 250/500, then was stopped because the old script did not emit partial artifacts. That failure mode is now fixed for the next full run.

Because of that, Quality Repair v0 is deliberately conservative:

- rotate, crop, tone, and border actions are queued for review
- fetch/decode failures are routed to retry/ingest, not D1 mutation
- generated SQL is safe-by-default and emits no updates unless a source audit provides explicit `UPDATE` statements
- benchmark baselines are recorded as guardrails that must be rerun before promoting transformed derivatives

## Closeout Requirement

GitHub #53 should not be treated as fully closed until:

- derivative generation covers the full current manifest or a Cloudflare transform source is configured and guarded by `--require-derivative-resize`
- the derivative-backed pixel-decode orientation/artifact audit covers the full current manifest
- any residual full-original fetch/decode failures are routed to a retry queue
- risky transforms have human-reviewed before/after evidence
- any promoted derivative/index has been checked against the benchmark retrieval/provenance slices
- safe D1 backfills are generated from reviewed decisions rather than inferred from a partial sample
