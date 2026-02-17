# AGENTS.md

## Purpose
This repo powers **MTL Archives**: a Montreal city archives photo search engine with a daily location-guessing game and a manual print-order flow. It is optimized for fast, mobile-first discovery (Instagram traffic is a major funnel).

## Product Invariants
- **Manual print flow stays enabled**: checkout sends emails via Resend for manual fulfillment (no Stripe/Prodigi yet).
- **Leaflet maps** are the current map stack (gallery map + game map).
- **3D embedding explorer is research-facing** (`apps/web`) and not a core user product surface.

## Key Paths
- `apps/api/` — Cloudflare Worker API (`/api/search`, `/api/photos`, `/api/game/*`, `/api/map`, `/api/sitemap`).
- `apps/next-app/` — Main Next.js site, game UI, and print ordering.
- `apps/web/` — Vite + Three.js CLIP embedding explorer (research/outreach).
- `packages/scripts/` — TypeScript ETL, vectorize, and database tooling.
- `pipelines/` — Python OCR + CLIP pipelines.
- `infrastructure/d1/` — D1 migrations and schema.

## Common Commands
- `npm run dev` — run all workspaces in dev mode
- `npm run dev --workspace=apps/api` — Worker only
- `npm run dev --workspace=apps/next-app` — Next.js only
- `npm run deploy` — deploy Worker
- `npm run typecheck` — typecheck all workspaces

## Data & Infra
- D1, Vectorize, R2, and Workers AI are configured in `apps/api/wrangler.toml`.
- Game tables live in D1: `daily_challenge`, `daily_guess`, `practice_guess`.

## Docs to Keep in Sync
When behavior changes, update these together:
- `README.md`
- `FORWIEL.md`
- `TASKS.md`
- `docs/architecture.md`
- `CLAUDE.md`

## Practical Guidance
- Favor **mobile performance** and **fast first paint** (IG traffic is impatient).
- Keep counts in marketing copy **approximate** (e.g., “14k+ photos”) unless you’ve verified exact numbers.
- Avoid heavy refactors across the pipeline unless you also update the eval/quality notes in `TASKS.md`.

## Skills Directory
- Use **only** `./.agents/skills` for repository-local skills.
- `./.skills` is deprecated and should not be used.
