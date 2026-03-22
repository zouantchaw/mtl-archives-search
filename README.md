# Montréal Archives Search

**Semantic and visual search API for the Montréal city archives photo collection (~15,000 historical images from 1870s-1990s).**

Built on Cloudflare's edge infrastructure: Workers, D1, Vectorize, R2, and Workers AI.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D23.5.0-green.svg)
![Cloudflare Workers](https://img.shields.io/badge/cloudflare-workers-orange.svg)

## Features

- **Text Search** — SQL-based keyword search across photo metadata
- **Semantic Search** — Find conceptually similar photos using BGE text embeddings
- **Visual Search** — CLIP-based image similarity search (512-dim embeddings)
- **Daily Game** — Guess-the-location daily challenge + practice round
- **Map Exploration** — Leaflet-based map view for geolocated photos
- **Print Ordering** — Stripe Checkout payment with manual fulfillment emails
- **Daily Newsletter** — Explicit opt-in email list with landing/game signup, welcome flow, daily send, and one-click unsubscribe
- **V4 Frontend** — Paper-driven editorial landing, search, photo, print, checkout, auth, and game surfaces across desktop + mobile
- **Bilingual UI** — French + English across the site and game
- **Signed URLs** — Secure, time-limited access to R2-hosted images
- **Edge Performance** — Sub-50ms response times globally via Cloudflare's network

## Live API

```bash
# Text search (SQL LIKE)
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=church&mode=text"

# Semantic search (BGE embeddings)
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=old+cathedral+building&mode=semantic&limit=5"

# Visual search (CLIP embeddings)
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=snowy+park&mode=visual&limit=5"

# Paginated listing
curl "https://mtl-archives-worker.wiel.workers.dev/api/photos?limit=10"
```

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Worker     │────▶│     D1       │
│  (Browser)   │     │   (Edge)     │     │  (Metadata)  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │Vectorize │  │Workers AI│  │    R2    │
       │(Vectors) │  │(Embed)   │  │ (Images) │
       └──────────┘  └──────────┘  └──────────┘
```

See [docs/architecture.md](docs/architecture.md) for detailed system design.

## Quick Start

```bash
# Clone and install
git clone https://github.com/zouantchaw/mtl-archives-search.git
cd mtl-archives-search
nvm use 23.5.0
npm install

# Local development
wrangler login
npm run dev

# Deploy
npm run deploy
```

## Runtime Env

For `apps/next-app`, API and asset origins are env-driven:
- `NEXT_PUBLIC_API_URL` (required in production)
- `NEXT_PUBLIC_R2_PUBLIC_DOMAIN` (preferred; falls back to `CLOUDFLARE_R2_PUBLIC_DOMAIN` if present)
- `STRIPE_SECRET_KEY` is required for hosted Stripe Checkout session creation
- `STRIPE_WEBHOOK_SECRET` is required for `/api/stripe/webhook`
- `RESEND_SECRET_KEY` is required for Stripe post-payment confirmation/admin emails
- Print checkout currently validates and quotes shipping for Canada and the US before redirecting to Stripe.
- Next newsletter cron env:
  - `CRON_SECRET` for the Vercel cron route authorization header
  - `NEWSLETTER_ADMIN_SECRET` so the Next cron route can call the Worker admin endpoint
- Worker newsletter env:
  - `RESEND_SECRET_KEY` for welcome/daily/unsubscribe sends
  - `NEWSLETTER_TOKEN_SECRET` for signed unsubscribe/resubscribe links
  - `NEWSLETTER_ADMIN_SECRET` for manual `/api/newsletter/admin/run`
  - `SITE_URL`, `API_ORIGIN`, `NEWSLETTER_REPLY_TO`
- Local social fallback env:
  - `GEMINI_API_KEY` for the offline/local MTL social research chain
  - optional `GEMINI_RESEARCH_MODEL` to override the default Gemini research model
- Clerk publishable/secret keys are required for production builds that include `/game`, `/sign-in`, and `/sign-up`
- Clerk client auth is loaded on auth/game routes, not globally, to reduce public-route script cost.
- Next metadata routes publish SEO endpoints (`/sitemap.xml`, `/robots.txt`) from the app layer.
- `/game` exports canonical + language alternates to reduce duplicate indexing variants.
- Worker text responses normalize escaped control chars (for example literal `\\n`) before returning photo/map/sitemap metadata.

In local development, API base falls back to `http://localhost:8787`.

Stripe local test flow:
- Start the Next app on `http://localhost:3001`
- Forward Stripe webhooks with `stripe listen --forward-to localhost:3001/api/stripe/webhook`
- Put the emitted webhook signing secret into `STRIPE_WEBHOOK_SECRET`
- Hosted Checkout payment happens after the site checkout has already validated the address and calculated shipping.

Client safety: if `NEXT_PUBLIC_API_URL` is missing from a client bundle, the app logs an explicit runtime error and falls back to same-origin relative API paths instead of throwing a white-screen error.

Smoke checks:
- `npm run smoke:game -- http://localhost:3001/game`
- `npm run smoke:game:prod`

Newsletter ops:
- Apply D1 migrations `0009_newsletter.sql` and `0010_newsletter_runs.sql`
- Vercel cron lives in `apps/next-app/vercel.json` and runs hourly
- The Next cron route gates on `7:00 AM` Toronto time before calling the Worker admin endpoint, which avoids DST drift from a fixed UTC schedule
- Public signup entry points live on `/` and `/game`
- Vercel cron endpoint:
  - `GET /api/cron/newsletter` with `Authorization: Bearer ${CRON_SECRET}`
- Worker endpoints:
  - `POST /api/newsletter/subscribe`
  - `GET /api/newsletter/unsubscribe?token=...`
  - `GET /api/newsletter/resubscribe?token=...`
  - `POST /api/newsletter/admin/run` with `x-newsletter-admin-secret`

## Local Social Fallback

When `spruce` is down, the repo can still produce the daily social package locally:

```bash
# Full dual package (IG carousel + FB reel)
npm run social:fallback -- --date 2026-03-19 --id mtl_archives_metadata_65.json

# Re-render assets from an existing local package without calling Gemini again
# (saved research/evidence is reused, but the latest local public-story templates are rebuilt)
npm run social:fallback -- --date 2026-03-19 --package-dir /absolute/path/to/package --reuse-research

# Let the fallback auto-reroll weak search/random picks until a brand-ready
# candidate passes, or surface the best failed candidate explicitly for review
npm run social:fallback -- --date 2026-03-19 --theme mystery --max-rerolls 4 --candidate-pool 8

# Mirror the generated package into an Obsidian project folder for synced review
npm run social:fallback -- --date 2026-03-19 --id mtl_archives_metadata_65.json --obsidian-dir "/Users/wiel/pkm/0xPKM_O/03_projects/active/MTL Archives/Daily Social Packages"

# Register a real published post and mirror it into final/
npm run social:register-publish -- --package-dir /absolute/path/to/package --platform instagram --permalink https://instagram.com/p/ABC123 --post-id ABC123 --obsidian-dir "/Users/wiel/pkm/0xPKM_O/03_projects/active/MTL Archives/Daily Social Packages"

# Bootstrap durable Meta tokens from one short-lived Graph API Explorer token
npm run social:token-bootstrap -- --app-id 1979061736153270 --app-secret YOUR_APP_SECRET --short-token YOUR_SHORT_LIVED_USER_TOKEN --page-id 100799958627875 --print-env

# Check token health later and warn if expiry is close
npm run social:token-status -- --app-id 1979061736153270 --app-secret YOUR_APP_SECRET --warn-days 14 --print-env

# Promote a generated package into a committed story page draft
npm run social:promote-story -- --package-dir /absolute/path/to/package
```

The fallback runner lives in [`pipelines/daily-reel/main.py`](/Users/wiel/Development/mtl-archives-search/pipelines/daily-reel/main.py) and writes a complete package under `~/Desktop/mtl-social-fallback/YYYY-MM-DD/`:
- `research.json` + `research_full.json`
- `caption_instagram.txt`
- `caption_facebook.txt`
- `instagram_carousel/slide01.jpg` through `slide05.jpg`
- `facebook_reel.mp4`
- `inspection_summary.json`
- `inspection_report.txt`
- `story_seed.json`
- ledger entry in `data/social/publish-ledger.jsonl`
- publish reconciliation entry in `data/social/publish-registry.jsonl`
- optional durable token state in `data/social/meta-token-state.json`
- optional Obsidian note export with mirrored text artifacts

This keeps the platform split intact even during an outage:
- Instagram: square carousel, archivist-teacher voice
- Facebook: reel, hook-first Montreal reveal
- Reels now traverse portrait panels derived from the source image so the viewer sees the full archive frame over the course of the video
- Daily theme: still applied as a lens for the chosen date
- Thin-metadata cases can now escalate into a Google-grounded Gemini pass before story generation. The grounded output is treated as supporting context only, never as archive metadata.
- The inspection artifacts now include brand-readiness gates (`caption_ok`, per-channel scores, overall `brand_ready`) so weak edge cases like thin-metadata `beauty` or unresolved `mystery` packages can fail review explicitly instead of looking implicitly acceptable.
- Search/random fallback runs now auto-reroll across a small candidate pool. The final date folder is the first `brand_ready` package that passes; if nothing passes, the runner still preserves the strongest attempt but marks it as `selection_status: no_brand_ready_candidate` and writes `attempts_summary.json`.
- Exact image reuse tracking now starts at generation time via `data/social/publish-ledger.jsonl`. The fallback can consult that ledger and skip recently used archive images before it builds a new package.
- Strong packages now emit `story_seed.json`, which can be promoted into `apps/next-app/content/stories/*.json` for deeper archive-linked story pages.
- If `--obsidian-dir` (or `MTL_OBSIDIAN_EXPORT_DIR`) is set, the fallback mirrors generated packages into `Daily Social Packages/experiments/...`. `npm run social:register-publish` can then promote real posted packages into `Daily Social Packages/final/...` while writing actual permalinks into a publish registry.
- The durable Meta token flow is separate from Graph API Explorer. Use `npm run social:token-bootstrap` once with a short-lived user token to write `data/social/meta-token-state.json`, then use `npm run social:token-status` on `spruce` to verify health and warn before expiry.
- State ownership is intentionally split:
  - repo = code, templates, schemas, docs
  - `spruce` = operational truth (canonical day package, ledgers, publish registry, delivery state)
  - Obsidian = editorial memory, review, experiments, and final mirrors

## Frontend Routes

The main `apps/next-app` product surface now follows the V4 Paper redesign:
- `/` — editorial landing page with brand system, discovery shortcuts, route cards, commitments, daily-game promo, and newsletter signup wired to the Worker
- `/search` — dedicated search surface with semantic/visual mode switching and responsive result grids
- `/photo/[id]` — desktop/mobile photo detail plus order mode
- `/print` — curated print gallery
- `/checkout` — Stripe Checkout handoff for print orders
- `/order-confirmation` — post-payment confirmation page
- `/sign-in`, `/sign-up`, `/game` — dark-shell auth and game surfaces, with explicit newsletter opt-in on `/game`

## Project Structure

```
mtl-archives-search/
├── apps/
│   ├── api/                # Cloudflare Worker (REST API)
│   ├── next-app/           # Next.js UI (search, map, game, prints)
│   └── web/                # 3D CLIP embedding explorer (research)
├── packages/
│   ├── core/               # Shared types and utilities
│   └── scripts/            # ETL, vectorize, VLM pipelines (tsx)
├── pipelines/
│   ├── etl/               # Python: metadata cleaning & export
│   ├── vectorize/         # Embedding generation (BGE, CLIP)
│   └── sql/               # D1 seed generation
├── infrastructure/        # Cloudflare D1 migrations
├── data/                  # Local data (gitignored)
└── docs/                  # Architecture & documentation
```

## API Reference

### `GET /api/photos`

Paginated photo listing with signed R2 URLs.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page (1-100) |
| `cursor` | string | — | Pagination cursor from previous response |
| `id` | string | — | Fetch a single photo by ID (`foo` or `foo.json`) |

Canonical photo page URLs use bare IDs (`/photo/{id}`); legacy `.json` photo paths redirect to the canonical bare-ID route.

### `GET /api/search`

Search photos by text or semantic similarity.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | **required** | Search query |
| `mode` | string | `text` | `text`, `semantic`, or `visual` |
| `limit` | number | 25 | Max results (1-100) |

**Response includes:**
- Photo metadata (title, description, date, credits)
- Signed R2 image URL
- Similarity score (semantic mode only)

## Data Pipeline

```bash
# Full pipeline: clean → export → audit → seed D1
npm run pipeline

# Individual steps
npm run etl:clean       # Normalize metadata
npm run etl:export      # Export to NDJSON
npm run etl:audit       # Generate quality reports
npm run d1:seed         # Seed remote D1

# Vectorize
npm run vectorize:text  # Generate BGE embeddings
npm run vectorize:clip  # Generate CLIP embeddings
npm run vectorize:text:photos  # Ingest text vectors while excluding document-likely records
npm run vectorize:clip:photos  # Ingest CLIP vectors while excluding document-likely records
npm run vectorize:status  # Show checkpoint/failure-log status for both ingest jobs
npm run smoke:pipeline  # Fixture-based ETL/vectorize smoke test + failure-log assertion
npm run search-quality:audit  # Non-destructive doc-vs-photo + duplicate audit report
npm run image-artifacts:audit  # Border/template detection audit + optional cleaned previews
npm run image-dedupe:audit  # Perceptual image hash dedupe audit (clusters + keep/drop decisions)
```

Vectorize reliability notes:
- `vectorize:text` and `vectorize:clip` now support resumable checkpoints by default.
- Failed batches/records are written to `data/mtl_archives/.logs/`.
- Both scripts use retry/backoff for transient API/network failures.
- Both ingest scripts stream JSONL input in batches (no full manifest load into memory).
- Use `--reset` to ignore checkpoint state and re-run from the start.

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| API | Cloudflare Workers | Edge-deployed REST API |
| Database | Cloudflare D1 | SQLite for metadata |
| Vectors | Cloudflare Vectorize | Embedding storage & ANN search |
| AI | Cloudflare Workers AI | BGE/CLIP embedding generation |
| Storage | Cloudflare R2 | Image hosting with signed URLs |
| ETL | Python 3.10+ | Metadata processing |

## Roadmap

Engineering tasks and roadmap are tracked in `TASKS.md`.

## Dataset

The photo collection includes:
- **14,000+ photographs** from the Montréal city archives
- Dates ranging from **1870s to 1990s**
- Aerial views, street scenes, parks, buildings, events
- French metadata with some English translations

Data sourced from [Montréal Open Data Portal](https://donnees.montreal.ca/).

## License

MIT — see [LICENSE](LICENSE) for details.

---

**Built by [@zouantchaw](https://github.com/zouantchaw)**
