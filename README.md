# MTL Archives

Search, play, and print from ~14k photographs in the City of Montreal archives.

**Live:** [www.mtlarchives.com](https://www.mtlarchives.com)

A visitor can search by what a picture *looks like* or what its caption says, play a daily “where is this?” game, order a print, or ask the [reading room](https://www.mtlarchives.com/research) in French or English. A reading-room collection can be saved as a [provenance package](https://www.mtlarchives.com/research) — a shareable handoff of sources, claims, unknowns, and assembler review. `client-ok` is not a City certification.

## Stack

| Layer | What |
|---|---|
| [apps/next-app](apps/next-app) | Next.js site — search, stories, game, prints, newsletter, `/research` (Cloudflare Workers / OpenNext) |
| [apps/api](apps/api) | Cloudflare Worker — D1, Vectorize, R2, Workers AI, operator jobs, provenance packages |
| [apps/operator-agent](apps/operator-agent) | Eve control surface; completions go through Cloudflare AI Gateway |
| [packages/scripts](packages/scripts) | ETL, CLIP/text index ingest, evals, explorer snapshot export |
| [apps/web](apps/web) | Optional similarity explorer with a dated canonical snapshot, live Smart/Visual search, connection webs, and a device-local collection. Not the main site. See [explorer notes](docs/explorer-modernization.md). |
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
npm run deploy --workspace=apps/api   # API Worker
npm run deploy:cloudflare --workspace=apps/next-app   # Site (builds first)
npm run deploy:cloudflare --workspace=apps/web        # Explorer (separate deployment)
```

**Env (site):** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `NEWSLETTER_ADMIN_SECRET`, `RESEARCH_API_SECRET`.

**Site bindings:** `ARCHIVE_API` service binding to the existing API Worker, Images, Analytics Engine, R2 incremental cache, Durable Object revalidation queue/tag cache, `MAIL_DB` and native `EMAIL`. The public API is `https://api.mtlarchives.com`; new newsletter action links and standalone video/reel clients use that domain. Email templates and recipient rules are preserved; delivery evidence is durable and unknown outcomes require review. Clerk remains the game identity provider.

**Secrets (Worker):** `RESEARCH_API_SECRET`, optional `LAMBDA_API_KEY` (GPU stays off until a named job is authorized).

## Docs

- [Cloudflare operations](docs/cloudflare-operations.md) — deployment, bindings, schedules, mail and rollback
- [Architecture](docs/architecture.md) — data flow, search, reading room, operator jobs
- [Reading room](docs/reading-room.md) — `/research` behavior and quotas
- [Operator](docs/operator-v1/README.md) — D1 job store, Eve, AI Gateway
- [GPU](docs/gpu-v1/README.md) — budgeted Lambda jobs (mock-first)
- [Ingest](docs/ingest-v1/README.md) / [Onboarding](docs/onboard-v1/README.md) — versioned ingest, second source
- [Evals](docs/evals.md) — frozen vision/OCR labels used by tests

Instagram/Facebook packaging lives in `pipelines/daily-reel` and `apps/story-video` (`npm run social:today`). That is the social funnel, not search.

Print fulfillment is still manual after Stripe payment. Newsletter is explicit opt-in.

The snapshot Explorer includes researcher map settings: published/local/broad layouts, true 2D/3D similarity, date-depth views, and cancellable custom UMAP. Custom layouts persist on the device; uncached shared layouts ask before computing. Shared links and result exports record settings and snapshot identity; see [Explorer documentation](docs/explorer-modernization.md).

Production hosting uses Cloudflare Custom Domains: www.mtlarchives.com (site), explorer.mtlarchives.com (snapshot Explorer), and api.mtlarchives.com (API). The previous site and Explorer Vercel projects are retired. See [Cloudflare operations](docs/cloudflare-operations.md) for manual deployment, mail evidence, cron, private domains and the historical email-link compatibility transition.
