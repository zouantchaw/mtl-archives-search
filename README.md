# Montréal Archives Search

Semantic + visual search for Montréal city archives, plus a daily location game and print ordering.

Built on Cloudflare Workers, D1, Vectorize, R2, Workers AI, and a Next.js frontend.

[Live site](https://mtlarchives.com) · [Architecture](docs/architecture.md) · [Tasks](TASKS.md)

## Reproducible research data

[Research dataset pipeline v1](docs/research-data-v1/README.md) freezes metadata
and verifies bounded byte-level releases in a separate D1 catalog and private R2
buckets. Run `python3 pipelines/research_data/run.py --help`. Its private release
workflow leaves app resources and bindings untouched.

The [full canonical backfill](docs/research-data-v1/backfill.md) now runs as a
managed background job with an isolated authenticated transfer Worker, streaming
hash checks, sequential large-image validation and explicit upstream outcomes.
Its live reports determine completion; the first 30-record release remains frozen.

The October 2 acquisition has now completed outcome accounting for both phases:
13,478 decoded deliveries and 13,473 byte-preserved originals, with 21 and 26
retained acquisition failures respectively. The final production comparison
passed. Failed inputs need reviewed new attempts; byte preservation does not
establish master decoding.

[Research platform v1](docs/research-platform-v1/README.md) adds a separate study
registry, the current collection's release adapter, immutable selections,
task-specific review packets and recoverable run records. Two studies share the
same preserved inputs: descriptive coverage executes now; bilingual retrieval
remains in preparation. Fresh model runs follow pilot/protocol validation.

The [first paper-based experiment](docs/research-platform-v1/first-experiment.md)
now specifies caption feedback, pinned reference code, comparison arms and human
relevance. Its numerical kernel passes synthetic checks; archive inference and
the heldout evaluation are pending.

The [October 3 pilot preparation](docs/research-platform-v1/pilot-preparation.md)
imports the completed delivery phase, verifies a fixed 100-image candidate set,
and prepares blind review views and blank bilingual-query worksheets.
Author-code arithmetic parity passes 360 synthetic CPU comparisons. Human family
review and human-authored queries come next; no caption-feedback experiment
inference has started. On-demand reviewer help is tracked separately.

The private [Cloudflare research reviewer](docs/research-platform-v1/reviewer-app.md)
is now deployed for that preparation: image decisions, related-photo families and
independent bilingual development queries, with draft recovery, explicit saves
and immutable history. It uses a new reviewer D1 and owner-only Access. Live app
resources are unchanged; human quality review remains pending.

October 4 reviewer assistance uses a separate R2 bucket, Queue/DLQ and AI
Gateway plus Images/Workers AI bindings. Region selection, edge presets and
independent detail rotation help inspect small text; Guide adds examples/practice
and Families adds comparison. Suggestions are optional, never fill labels, and
enter Notes only after acceptance. Runs, exact inputs/outputs, exposure and
decisions are retained. Export v2 and local import preserve assisted preparation
as pending quality review, never benchmark gold; prior exposure follows human
development queries. Existing review revisions and the product boundary remain
intact. Read the [reviewer runbook](docs/research-platform-v1/reviewer-app.md).

## Current product direction

Live MTL Archives is search, `/research`, game, and print on Cloudflare + Vercel.
Operator jobs live in D1; the Eve agent uses Cloudflare AI Gateway. Remaining
work: [#142](https://github.com/zouantchaw/mtl-archives-search/issues/142) budgeted GPU.
Commercial Provenance/City Memory issues #123–#127 stay deferred.

Keep vs archive: [docs/archive-v1/KEEP-LIST.md](docs/archive-v1/KEEP-LIST.md).

## Repo layout

- `apps/api` — Cloudflare Worker API (search, game, newsletter, operator jobs)
- `apps/next-app` — main site, game, prints, `/research`
- `apps/operator-agent` — Eve control surface (Gateway completions)
- `apps/web` — CLIP research explorer
- `apps/research-reviewer` — private pilot review app; separate Worker and D1
- `packages/scripts` — ETL, vectorize, ingest-v1, evals
- `pipelines/` — OCR, VLM, social/story
- `infrastructure/d1/` — schema and migrations

## Common commands

```bash
npm run dev
npm run typecheck
npm run deploy
npm run smoke:game:prod
```

## Required env

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_SECRET_KEY`
- `CRON_SECRET`
- `NEWSLETTER_ADMIN_SECRET`

## Notes

- Manual print fulfillment stays manual.
- Newsletter signup is explicit opt-in.
- See `FORWIEL.md` for the longer project overview.

## Canonical search repair (September 2026)

The canonical-ID repair and its rollout/evaluation procedure are documented in [docs/search-canonical-repair.md](docs/search-canonical-repair.md). Smart search combines CLIP and BGE with explicit branch-health diagnostics and separate ranking scores. Future ingestion defaults to `manifest_search_canonical.jsonl`; retain original archival descriptions alongside generated captions. See the repair report for verified coverage and remaining relevance limitations.

### Search gap repair (2026-09-13)

The follow-up backfill restores 29 missing canonical R2 objects, fills 184 caption gaps and adds 40 CLIP vectors. Captions retain AI provenance and their text vectors are regenerated together. See [the gap-repair runbook](docs/search-gap-repair.md) for checks, recovery and evidence.

Degraded smart-search responses now bypass caching so temporary inference outages can recover on the next request.

## Conversational reading room (September 2026)

`/research` adds a French/English conversation beside a photo collection, local pins, and a source/evidence drawer. Vercel AI SDK renders typed tool results; Mistral Small 3.1 on the existing Cloudflare AI binding interprets requests and checks bounded image candidates. GPT-5.4 is a query-time inspect fallback only (failed/uncertain cheap checks, or reviewed sideways/document flags). Result summaries and historical-evidence limitations are rendered from controlled tool output. Canonical metadata stays separate from AI observations. No training or GPU provisioning is required.

See [Reading room implementation and operations](docs/reading-room.md) for deployment, quotas, failure modes and live evaluation commands.

Offline #148 Gateway vision comparison (`openai/gpt-5.4`, `xai/grok-4.6`) is documented in [docs/vision-gateway-v1/README.md](docs/vision-gateway-v1/README.md). Frozen OCR/orientation eval is in [docs/vision-eval-v1/README.md](docs/vision-eval-v1/README.md). Image-kind and orientation provenance is in [docs/orientation-eval-v1/README.md](docs/orientation-eval-v1/README.md). OCR-as-separate-evidence is in [docs/ocr-eval-v1/README.md](docs/ocr-eval-v1/README.md). Versioned ingest and candidate indexes are in [docs/ingest-v1/README.md](docs/ingest-v1/README.md). Eve vs Cloudflare runtime split is in [docs/runtime-v1/README.md](docs/runtime-v1/README.md). Second-source onboarding is in [docs/onboard-v1/README.md](docs/onboard-v1/README.md). Operator D1 jobs and the Eve/Gateway agent are in [docs/operator-v1/README.md](docs/operator-v1/README.md). Selective frontier fallback (sideways/documents only) is in [docs/fallback-v1/README.md](docs/fallback-v1/README.md). Query-time `/research` inspect fallback is in [docs/inspect-fallback-v1/README.md](docs/inspect-fallback-v1/README.md). Candidate captions stay inactive.

### October 4: text inspection specific to archival review

The private reviewer now uses shadcn/Base UI and a dedicated **Text check**:
nine overlapping source-backed regions, enlarged/rotatable pixels, human region
check progress, Gemma text candidates and an optional Qwen second reader.
Candidate wording needs explicit pixel verification before adding a note;
empty detections never select No. New No decisions require human confirmation.
Exact model inputs/outputs, versioned recipes and acceptance/exposure events
remain private in the existing isolated R2/D1/Queue/Gateway resources. Historical
reviews and Moondream outputs are preserved. This is assisted preparation, not
OCR gold, a caption-feedback experiment or a product promotion. Details and
Cloudflare capability choices: [reviewer runbook](docs/research-platform-v1/reviewer-app.md).

## Research production domains — October 8, 2026

The private reviewer is https://reviewer.mtlarchives.com, protected by the existing owner-only Access application and JWT audience. Transfer is https://transfer.mtlarchives.com with its existing bearer protection and research-only bindings. Both live services and generated deployment configurations disable workers.dev and preview URLs. The finished October 2 frozen backfill keeps its original code/receipts; future executions use a new revision with the project endpoint. Main-site/API migration authority is the separate codex/cloudflare-migration-20261008 branch; this research checkout does not deploy the main application. See docs/research-platform-v1/reviewer-app.md and docs/research-data-v1/backfill.md.
