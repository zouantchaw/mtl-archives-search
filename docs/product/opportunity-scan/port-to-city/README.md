# Port to City, evidence reference v1

Port to City replaces the property-first Hôtel Nelligan mockup with a use case
that begins inside the MTL Archives corpus. The package connects a canonical
crosswalk, a broad retrieval pool, a reviewed evidence core, a baseline-lift
test, and three internal-review routes.

## What exists

- `data/crosswalk-v1.csv`: 13,499 canonical rows joined to available VLM,
  taxonomy, geocode, OCR, date, aerial, and v0 visual-family artifacts.
- `data/candidate-pool-v1.jsonl` and `.csv`: the top 100 bounded place-signal
  candidates, with source-supported and model-inferred evidence kept separate.
- `data/run-summary-v1.json`: input paths, row counts, join coverage, limits,
  and gaps for the build. The machine-specific root is projected as
  `${MTL_ARCHIVES_DATA_ROOT}` in the committed copy.
- `reviewed-selection.md`: the ten records selected after source and visual
  review.
- `lift-test.md`: an eight-query comparison with ordinary web search, official
  City archive surfaces, and SDC Vieux-Montréal's public storytelling.
- `design/`: the generated interface concept, final browser captures, and the
  implementation fidelity ledger.
- `apps/next-app/content/port-to-city/evidence-core.v1.json`: the versioned
  application evidence package.

The complete nested JSONL crosswalk is intentionally not committed because it
is about 104 MB uncompressed and 40 MB compressed. The committed CSV contains
the canonical row projection. The exact nested JSONL remains reproducible with
the checked-in builder.

## Routes

- `/port-to-city`: recipient-neutral evidence core
- `/port-to-city/old-port`: Old Port Corporation cut
- `/port-to-city/sdc-vieux-montreal`: SDC Vieux-Montréal cut

All routes are `noindex`. The release status is `internal_review`, not public
or buyer clearance.

## Reproduce the crosswalk

```bash
npm run city-memory:opportunity-v1 --workspace=@mtl-archives/scripts -- \
  --data-root /absolute/path/to/data/mtl_archives \
  --output /absolute/path/to/output \
  --max-candidates 100
```

The populated run used 13,499 canonical scored records. Join coverage is
recorded in `data/run-summary-v1.json`; it must not be inferred from the larger
14,822-row taxonomy/VLM grain.

## Validate the application package

```bash
npm run city-memory:opportunity-v1:self-test --workspace=@mtl-archives/scripts
npm run validate:port-to-city --workspace=mtl-archives-next
```

The second command checks release state, canonical identity, family and cut
references, source URLs, claim boundaries, application asset presence, and
all ten derivative hashes.

## Release boundary

Before any buyer send or outreach:

1. Complete frame-level review of report-sequence records 11606 and 11708.
2. Repeat the rights and third-party-interest check at production resolution.
3. Approve bilingual copy for the selected recipient cut.
4. Name the recipient, sender, channel, message, and follow-up boundary.
5. Keep private contact and commercial evidence outside the public repository.

No outreach was performed as part of this work.
