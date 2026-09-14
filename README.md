# Montréal Archives Search

Semantic + visual search for Montréal city archives, plus a daily location game and print ordering.

Built on Cloudflare Workers, D1, Vectorize, R2, Workers AI, and a Next.js frontend.

[Live site](https://mtlarchives.com) · [Architecture](docs/architecture.md) · [Tasks](TASKS.md)

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

Offline #148 Gateway vision comparison (`openai/gpt-5.4`, `xai/grok-4.6`) is documented in [docs/vision-gateway-v1/README.md](docs/vision-gateway-v1/README.md). Frozen OCR/orientation eval is in [docs/vision-eval-v1/README.md](docs/vision-eval-v1/README.md). Image-kind and orientation provenance is in [docs/orientation-eval-v1/README.md](docs/orientation-eval-v1/README.md). OCR-as-separate-evidence is in [docs/ocr-eval-v1/README.md](docs/ocr-eval-v1/README.md). Versioned ingest and candidate indexes are in [docs/ingest-v1/README.md](docs/ingest-v1/README.md). Eve vs Cloudflare runtime split is in [docs/runtime-v1/README.md](docs/runtime-v1/README.md). Second-source onboarding is in [docs/onboard-v1/README.md](docs/onboard-v1/README.md). Operator D1 jobs and the Eve/Gateway agent are in [docs/operator-v1/README.md](docs/operator-v1/README.md). Budgeted GPU jobs are in [docs/gpu-v1/README.md](docs/gpu-v1/README.md). Selective frontier fallback (sideways/documents only) is in [docs/fallback-v1/README.md](docs/fallback-v1/README.md). Query-time `/research` inspect fallback is in [docs/inspect-fallback-v1/README.md](docs/inspect-fallback-v1/README.md). Candidate captions stay inactive.
