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
- **Print Ordering** — Manual print requests via email checkout
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
- Clerk client auth is loaded on auth/game routes, not globally, to reduce public-route script cost.

In local development, API base falls back to `http://localhost:8787`.

Client safety: if `NEXT_PUBLIC_API_URL` is missing from a client bundle, the app logs an explicit runtime error and falls back to same-origin relative API paths instead of throwing a white-screen error.

Smoke checks:
- `npm run smoke:game -- http://localhost:3001/game`
- `npm run smoke:game:prod`

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
npm run vectorize:status  # Show checkpoint/failure-log status for both ingest jobs
npm run smoke:pipeline  # Fixture-based ETL/vectorize smoke test + failure-log assertion
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
