# Montréal Archives Search

Semantic + visual search for Montréal city archives, plus a daily location game and print ordering.

Built on Cloudflare Workers, D1, Vectorize, R2, Workers AI, and a Next.js frontend.

[Live site](https://mtlarchives.com) · [Architecture](docs/architecture.md) · [Tasks](TASKS.md)

## Current product direction

**Provenance Activation** is the product and service: it turns visual,
cultural, archival, and historically significant collections into trusted,
usable assets. **Dataset Factory** is the internal evidence engine. **MTL
Archives** is the reference implementation, and **City Memory** is the first
commercial application.

The commercial model has two paths over the same trust contract: institutions
buy collection fit reviews or activation pilots; art, built-environment, and
hospitality partners buy City Memory concept studies for real places. Every
engagement moves through client collection, private processing, human review,
and approved output zones. Paid pilots come before recurring software or
workflow automation.

The active roadmap is deliberately small: [product definition (#123)](https://github.com/zouantchaw/mtl-archives-search/issues/123),
[Dataset Factory Core (#124)](https://github.com/zouantchaw/mtl-archives-search/issues/124),
[Provenance Package (#125)](https://github.com/zouantchaw/mtl-archives-search/issues/125),
[one client-sendable City Memory reference concept (#126)](https://github.com/zouantchaw/mtl-archives-search/issues/126),
and [buyer validation after internal release approval (#127)](https://github.com/zouantchaw/mtl-archives-search/issues/127).
See [Provenance Activation v1](docs/product/provenance-activation-v1.md) for the
product model and the [Montréal prospect shortlist](docs/product/city-memory-montreal-prospects-2026-08-31.md)
for the no-outreach research snapshot.

## Repo layout

- `apps/api` — Cloudflare Worker API
- `apps/city-memory` — standalone City Memory client reference artifact
- `apps/next-app` — main site, game, prints, auth
- `apps/web` — CLIP research explorer
- `packages/scripts` — ETL, vectorize, dataset-factory, evals
- `pipelines/` — OCR, VLM, and social/story scripts
- `infrastructure/d1/` — schema and migrations

Deferred cross-platform content analytics is local-only, identity-gated, and
provenance-explicit. Reports require `--evidence-kind` (`real_export` or
`synthetic_fixture`); `no_personal_data` events cannot carry raw queries or
candidate lists, and aggregate capture time is report-generation time. See
`docs/dataset-factory/content-signal-v1.md` for the required canonical join,
product-event contract, and self-test command.

Deferred Benchmark v1 research has only a pre-lock candidate/preflight
foundation. See
`docs/dataset-factory/benchmark-v1.md`; it does not claim a locked benchmark,
model result, or issue #70 completion.
Historical issue #71 also has an offline promotion-challenge preflight
scaffold; see
`docs/dataset-factory/promotion-challenge-preflight-v1.md`. It is permanently
no-ship and runs no models, GPU, production checks, or promotion.

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
npm run city-memory:validation:self-test-v1
npm run city-memory:validation:verify-v1
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

## City Memory client pilot and buyer validation

The active sequence is to make the Hôtel Nelligan–based [client pilot (#126)](https://github.com/zouantchaw/mtl-archives-search/issues/126)
sendable before running the approved [buyer-validation test (#127)](https://github.com/zouantchaw/mtl-archives-search/issues/127).
The implemented [uncommissioned reference concept](docs/city-memory-nelligan-reference/README.md),
**The Street Within**, is a standalone Vite/React presentation with an original
conceptual Three.js section, four independently reviewed archive records,
source-separated application images, explicit evidence and rights boundaries,
and a static-hosted client delivery contract. It bundles no current hotel
photography and does not present its 3D scene as a measured survey.
The hotel is a visual subject and possible recipient, not a presumed first
buyer; recipient selection remains a separate, relationship-led decision.
The predecessor issue #109 produced a privacy-preserving operating kit under
[`docs/city-memory-validation-v1/`](docs/city-memory-validation-v1/), but no
buyer evidence. Its checked-in ledger is intentionally empty: the validator
reports `kit_ready: true` with `status: "template_only"`; `--require-acceptance`
must fail until real, consented evidence is recorded. No outreach is authorized
by this repository.

## Gate H2 Linux Conformance

Issue #100 and Issue #101 Packets 1 and 2 remain merged inactive synthetic/local contracts. Packet 3A is the approved local, no-secrets, pre-launch builder implementation contract: [read the canonical Packet 3A document](docs/dataset-factory/gate-h2-builder-packet-3a-v1.md) for the future Rust/Cargo `1.85.0` and Node `22.22.0` floor, source proof, rootless boundary, dual helper rebuilds, and SBOM comparison. Packet 3B defines strict external-input-lock and builder-receipt schemas/validators. Packet 3C adds local digest-pinned acquisition, deterministic offline materialization, receipt emission, and two-bundle byte comparison: [read the Packet 3C contract](docs/dataset-factory/gate-h2-builder-packet-3c-local-machinery-v1.md). These packets still do not supply the final real upstream lock, x86 Linux/Podman build, signed independent-host evidence, or production admission, so Issue #101 remains incomplete.

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
