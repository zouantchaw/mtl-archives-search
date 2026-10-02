# Foundation acceptance — October 2, 2026

The isolated source/study/review/run foundation is implemented and verified.
This acceptance covers engineering execution and recovery, not the retrieval
hypothesis, full backfill completion or fresh OCR/caption quality.

## Recorded live artifacts

| Item | Immutable identity |
| --- | --- |
| Preserved 30-record input release | `f0f29477c75943ec6b5161239fb4837950f15fa9381c2e309bd990b98636576a` |
| Final platform publication | `f4f639803ccb473bc25361865bb7beb83800c10130358eab2401847da243558d` |
| Current coverage run | `feba356422505844e0f09e89b696b426a9bd114f96728ef218bbe193eacfc4a4` |
| Current coverage snapshot | `12d2a79d2c913e54a2a524b3c668d2e8610638527ed7432d6b52911e66a75130` |
| Retrieval preparation snapshot | `7db9d85b199cea90b2cdb9be5bdb89a594c681c4c7ca1927682935dc50e1c1ea` |
| Regenerated coverage report | `f20a11c2568a36a05c7ae70ed2c76a32c76f04d3fb19005fdfd22c57fa839ccf` |
| Unlabeled OCR practice packet | `52977f1878ef75f366875916fedf25be90557ae43866ac7f98ebe23384426074` |

The complete publication contains 24 registry entries and eight run events.
These include retained implementation revisions and four coverage attempts;
they are not 24 datasets or new archive records. Both study definitions reuse
the same shared archive bytes. No new Worker or Vectorize index was deployed.

## Checks performed

1. **17 tests passed.** They exercise retained v1 record identity, immutable
   refreshes, corrupt-byte rejection, duplicate/family separation, query-intent
   partition conflicts, task/label binding, failure retention and retries,
   recipe pinning, full-phase adapter accounting, cloud publication conflicts,
   rollback/replay and recovery. A config-file replacement with production IDs
   is rejected by the fixed resource boundary.
2. **Live D1 rollback and immutability passed.** A two-statement failing batch
   left no probe row. Deleting the registered source was rejected and the row
   remained. These probes targeted the new research studies database only.
3. **Two real study definitions share the release.** The descriptive coverage
   study executed; the bilingual retrieval study remains in preparation. Neither
   fabricates query intents, human labels or an accepted hypothesis.
4. **All selected bytes verified.** Each selection contains 30 delivery images
   and 30 traced thumbnails. Exact duplicates leave 44 distinct referenced image
   blobs; SHA-256 and size checks passed. Master decoding was not inferred from
   these checks.
5. **Private cloud recovery and exact reproduction passed.** The initial complete
   publication was restored into an empty ledger with no external blob roots.
   Its 44 input blobs and metadata versions were downloaded privately, verified
   and used to reproduce an identical report hash. The final publication was
   restored into another empty ledger; it reused that already verified private
   image cache, verified the current selections again, and regenerated the
   current report with the identical hash. Its archived code matches the current
   runner. No mutable original-project data export was used for regeneration.
6. **Publication replay passed.** Repeating a complete live publication returned
   the same publication hash and matching D1 rows.
7. **Production comparison passed.** Manifest metadata, the production Worker
   deployment and both Vectorize index descriptions matched the earlier read-only
   baseline. The public Worker health endpoint returned HTTP 200. This is a
   resource/health check, not a load or latency-regression experiment.
8. **Backfill isolation passed.** Its acquisition builder hash still matches the
   frozen plan. No acquisition schema, selector, receipt or deployment was edited.

## What the coverage report says

For this deliberately limited engineering selection:

| Inherited field | Nonempty records / 30 |
| --- | ---: |
| Legacy serving description | 4 |
| Legacy serving caption | 30 |
| Legacy serving caption model field | 3 |
| Legacy serving OCR field | 0 |
| Separately retained raw OCR text | 29 |
| Legacy serving date field | 25 |

These are presence counts from legacy channels, not independently verified source
facts or accuracy measurements. They show why retaining historical artifacts as
baselines is useful while rebuilding fresh derivations with known inputs and
recipes. Nothing here establishes that the OCR or captions are good.

## Background acquisition at the last recorded check

At **2026-10-02 20:20 UTC**, the full 13,499-record acquisition was still running:

- Delivery: 13,152 decode-verified outcomes; 18 failed outcomes retained.
- Originals: 12,368 byte-preserved outcomes; 19 failed outcomes retained.
- Catalog commits were still catching up; the overall completion receipt was absent.

These are a timestamped observation, not the current live status or final exclusion
counts. Inspect the job's status/completion receipts before importing a full phase.
The phase adapter has been tested with completed/failing fixtures; the real-data
acceptance above uses the existing completed bounded release.

## Durable evidence

Local evidence is under:

`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-platform-v1-2026-10-02`

- `final-cloud-acceptance.json`: final publication, current selections/code and
  exact regenerated report identity.
- `recovery-proof.json`: independent private recovery and repeated coverage run.
- `cloud-risk-checks.json`, `publication-replay-proof.json`, `tests.log`.
- `production-check/`, `production-health.json`, `backfill-code-check.json`,
  `backfill-status.json`.
- `local/`: authoritative local study ledger, versioned practice packets and
  empty reviewer response templates.
- `recovered/` and `recovered-final/`: restored ledgers and verified artifact caches.

The private R2 artifacts and new D1 registry preserve the publication independently
of these local directories. Credentials are excluded from Git and evidence.

## Next research milestone

Account for completed backfill phases and recorded failures, validate selected
masters, review families and freeze the 100–200-image development pilot. Then pin
the render/OCR/caption recipes, prepare independent human tasks/query intents and
run small candidates under recorded budgets. Heldout evaluation and any product
adoption follow their own protocol and serving gates. No model generation or
human benchmark labeling was performed by this acceptance.
