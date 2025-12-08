# Montréal Archives Search

**Semantic and visual search API for the Montréal city archives photo collection (~15,000 historical images from 1870s-1990s).**

Built on Cloudflare's edge infrastructure: Workers, D1, Vectorize, R2, and Workers AI.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D23.5.0-green.svg)
![Cloudflare Workers](https://img.shields.io/badge/cloudflare-workers-orange.svg)

## Features

- **Text Search** — SQL-based keyword search across photo metadata
- **Semantic Search** — Find conceptually similar photos using BGE text embeddings
- **Visual Search** _(coming soon)_ — CLIP-based image similarity search
- **Signed URLs** — Secure, time-limited access to R2-hosted images
- **Edge Performance** — Sub-50ms response times globally via Cloudflare's network

## Live API

```bash
# Text search
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=church&mode=text"

# Semantic search - finds conceptually similar photos
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=old+cathedral+building&mode=semantic&limit=5"

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

## Project Structure

```
mtl-archives-search/
├── api/                    # Cloudflare Worker (REST API)
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

### `GET /api/search`

Search photos by text or semantic similarity.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | **required** | Search query |
| `mode` | string | `text` | `text` or `semantic` |
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
```

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

- [x] Text search (SQL LIKE)
- [x] Semantic search (BGE text embeddings)
- [ ] **CLIP visual search** — Search by image similarity
- [ ] Frontend UI — React/Next.js photo browser
- [ ] Geospatial search — Filter by location
- [ ] Date range filtering

## Dataset

The photo collection includes:
- **14,822 photographs** from the Montréal city archives
- Dates ranging from **1870s to 1990s**
- Aerial views, street scenes, parks, buildings, events
- French metadata with some English translations

Data sourced from [Montréal Open Data Portal](https://donnees.montreal.ca/).

## License

MIT — see [LICENSE](LICENSE) for details.

---

**Built by [@zouantchaw](https://github.com/zouantchaw)**
