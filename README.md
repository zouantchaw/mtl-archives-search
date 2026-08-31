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
npm run gate-h2:linux-conformance-fixture-verify
npm run gate-h2:linux-conformance-self-test
npm run gate-h2:builder-receipts-fixture-verify
npm run gate-h2:builder-receipts-self-test
```

## Gate H2 Linux Conformance

Issue #100 and Issue #101 Packets 1 and 2 remain merged inactive synthetic/local contracts. Packet 3A is the approved local, no-secrets, pre-launch builder implementation contract: [read the canonical Packet 3A document](docs/dataset-factory/gate-h2-builder-packet-3a-v1.md) for the future Rust/Cargo `1.85.0` and Node `22.22.0` floor, source proof, rootless boundary, dual helper rebuilds, and SBOM comparison. Packet 3B now defines strict external-input-lock and builder-receipt schemas/validators plus a Linux-only descriptor-anchored offline stop boundary; see [the Packet 3B contract](docs/dataset-factory/gate-h2-builder-packet-3b-input-lock-v1.md). It does not yet supply a real lock, materialized image, Linux build, or evidence receipt, so Issue #101 remains incomplete.

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
