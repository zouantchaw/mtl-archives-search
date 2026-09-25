# AGENTS.md

MTL Archives: Montreal city photo search, daily location game, Stripe prints, `/research`.

## Invariants

- Manual print fulfillment after Stripe.
- MapLibre / mapcn maps (CARTO Positron vector tiles, not Mapbox).
- Do not overwrite original archive bytes or recaption the 14k corpus unless explicitly asked.
- `apps/web` (snapshot explorer) is not the core product. Do not deploy it with the root deploy script. See [docs/explorer-modernization.md](docs/explorer-modernization.md).

## Paths

- `apps/api` — Cloudflare Worker
- `apps/next-app` — site, game, prints, reading room
- `apps/operator-agent` — Eve → Worker / AI Gateway
- `packages/scripts` — ETL and indexes
- `infrastructure/d1` — migrations (keep applied ones)

## Commands

- `npm run dev --workspace=apps/next-app`
- `npm run deploy --workspace=apps/api`
- `npm run typecheck`
- `npm run test --workspace=apps/api`

## Docs

Keep [README.md](README.md) and [docs/architecture.md](docs/architecture.md) in sync with behavior. Do not resurrect `FORWIEL.md`, `CLAUDE.md`, or `TASKS.md`.
