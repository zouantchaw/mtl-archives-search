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

Issue #100 is merged and complete as an inactive synthetic Podman supervisor contract. Issue #101 Packet 1 freezes the exact 69-case Linux/Podman/D1/admission universe and its 71-file registered synthetic fixture, `dfv0_gate_h2_linux_conformance_v1_20260806`. Packet 2 completes the local synthetic/pending/nonproduction builder-receipts contract: [`dfv0_gate_h2_builder_receipts_v1_20260806`](docs/dataset-factory/gate-h2-builder-receipts-v1.md) is exactly 4 files, 17,539 bytes, SHA-256 `c9e2b0764b1070b479836abae1c7bd2fa362ad95710e3bd02f74c23c535a6688`, with 81 ordered adversarial cases and source identity pinned to Git commit `4ddf00e812610e3e029059f25ad3d951577f667d`. Its recipe intentionally leaves external builder image/vendor/trust/tool-artifact pins pending/null; synthetic two-build receipts only exercise the future comparator contract. This is not real Linux/Podman evidence or production admission. No paid host, Podman execution, D1 access or mutation, credentials, provider/model call, activation, publication, or deploy occurred. The next boundary is explicit approval to pin external build inputs, run independent real Linux/Podman builds, and then perform real conformance/D1 admission.

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
