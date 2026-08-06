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
```

## Gate H2 Linux Conformance

Issue #100 is merged and complete as an inactive synthetic Podman supervisor contract. Issue #101 Packet 1 freezes the exact 69-case Linux/Podman/D1/admission universe and its 71-file registered synthetic fixture, `dfv0_gate_h2_linux_conformance_v1_20260806`. The fixture is bound to the exact #100 predecessor commit, artifact, descriptors, and source allowlist. Ordinary verification accepts only the synthetic/nonproduction triad; the tracked synthetic fixture under `--strict-production` fails early with `H2_LINUX_CONFORMANCE_STRICT_SYNTHETIC`. A future bundle with the required non-synthetic strict shape and metadata must still fail `H2_LINUX_CONFORMANCE_STRICT_SEMANTICS` until real per-case Linux semantic validators are implemented. Packet 1 records 69 cases and 39 exact-code adversarial rejections. No paid host, Podman execution, D1 access or mutation, credentials, provider/model call, activation, publication, or deploy has occurred. Next is the pinned hermetic builder recipe and cross-surface receipt comparator; real Linux/D1 execution requires explicit approval.

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
