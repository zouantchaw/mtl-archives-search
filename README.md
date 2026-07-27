# Montréal Archives Search

Semantic + visual search for Montréal city archives, plus a daily location game and print ordering.

Built on Cloudflare Workers, D1, Vectorize, R2, Workers AI, and a Next.js frontend.

[Live site](https://mtlarchives.com) · [Architecture](docs/architecture.md) · [Tasks](TASKS.md)

## Repo layout

- `apps/api` — Cloudflare Worker API
- `apps/next-app` — main site, game, prints, auth
- `apps/web` — CLIP research explorer
- `packages/scripts` — ETL, vectorize, dataset-factory, evals
- `pipelines/` — OCR, VLM, and social/story scripts
- `infrastructure/d1/` — schema and migrations

## Common commands

```bash
npm run dev
npm run typecheck
npm run deploy
npm run smoke:game:prod
npm run social:today
npm run dataset-factory:packets
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
