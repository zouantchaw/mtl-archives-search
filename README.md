# MTL Archives

Search, play, and print from ~14k photographs in the City of Montreal archives.

**Live:** [www.mtlarchives.com](https://www.mtlarchives.com)

A visitor can search by what a picture *looks like* or what its caption says, play a daily “where is this?” game, order a print, or ask the [reading room](https://www.mtlarchives.com/research) in French or English.

## Stack

| Layer | What |
|---|---|
| [apps/next-app](apps/next-app) | Next.js site — search, game, prints, newsletter, `/research` (Vercel) |
| [apps/api](apps/api) | Cloudflare Worker — D1, Vectorize, R2, Workers AI, operator jobs |
| [apps/operator-agent](apps/operator-agent) | Eve control surface; completions go through Cloudflare AI Gateway |
| [packages/scripts](packages/scripts) | ETL, CLIP/text index ingest, evals |
| [pipelines](pipelines) | OCR / VLM / Instagram packaging |

Search is CLIP (visual) + BGE (captions) on Cloudflare Vectorize. `/research` uses Mistral Small on Workers AI, with GPT-5.4 only as a bounded inspect fallback. Original archive bytes are never overwritten.

## Develop

```bash
npm install
cp .env.example .env   # if present; otherwise see env below
npm run dev --workspace=apps/next-app
npm run dev --workspace=apps/api
```

```bash
npm run typecheck
npm run test --workspace=apps/api
npm run deploy --workspace=apps/api   # Worker
```

**Env (site):** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_SECRET_KEY`, `CRON_SECRET`, `NEWSLETTER_ADMIN_SECRET`, `RESEARCH_API_SECRET`.

**Secrets (Worker):** `RESEARCH_API_SECRET`, optional `LAMBDA_API_KEY` (GPU stays off until a named job is authorized).

## Docs

- [Architecture](docs/architecture.md) — data flow, search, reading room, operator jobs
- [Reading room](docs/reading-room.md) — `/research` behavior and quotas
- [Operator](docs/operator-v1/README.md) — D1 job store, Eve, AI Gateway
- [GPU](docs/gpu-v1/README.md) — budgeted Lambda jobs (mock-first)
- [Ingest](docs/ingest-v1/README.md) / [Onboarding](docs/onboard-v1/README.md) — versioned ingest, second source
- [Evals](docs/evals.md) — frozen vision/OCR labels used by tests

Instagram/Facebook packaging lives in `pipelines/daily-reel` and `apps/story-video` (`npm run social:today`). That is the social funnel, not search.

Print fulfillment is still manual after Stripe payment. Newsletter is explicit opt-in.
