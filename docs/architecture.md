# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│                 (Next.js Web UI + Game, Research Explorer)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker (apps/api)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  /api/photos    │  │  /api/search    │  │  /api/search?mode=visual    │  │
│  │  (paginated)    │  │  ?mode=text     │  │  CLIP text→image search     │  │
│  │                 │  │  ?mode=semantic │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
         │                      │                           │
         │                      │                           │
         ▼                      ▼                           ▼
┌─────────────────┐   ┌─────────────────┐         ┌─────────────────┐
│   Cloudflare    │   │   Cloudflare    │         │   External AI   │
│       D1        │   │    Vectorize    │         │    Services     │
│   (metadata)    │   │   (embeddings)  │         │                 │
│                 │   │                 │         │  ┌────────────┐ │
│  ┌───────────┐  │   │  ┌───────────┐  │         │  │ Workers AI │ │
│  │ manifest  │  │   │  │mtl-archives│ │         │  │ (BGE + VLM)│ │
│  │  table    │  │   │  │ (BGE text)│  │         │  ├────────────┤ │
│  │  14,822   │  │   │  ├───────────┤  │         │  │ HuggingFace│ │
│  │  records  │  │   │  │mtl-archives│ │         │  │ (CLIP text)│ │
│  │           │  │   │  │-clip (img)│  │         │  ├────────────┤ │
│  │           │  │   │  │           │  │         │  │ Tesseract  │ │
│  │           │  │   │  │           │  │         │  │ (OCR)      │ │
│  └───────────┘  │   │  └───────────┘  │         │  └────────────┘ │
│                 │   │                 │         └─────────────────┘
└─────────────────┘   └─────────────────┘
         │
         ▼
┌─────────────────┐
│   Cloudflare    │
│       R2        │
│    (images)     │
│                 │
│   ~15k photos   │
│   Public URLs   │
└─────────────────┘
```

## Data Flow

### Next.js Runtime Config

- `apps/next-app/lib/runtime-env.ts` is the single source of truth for API/R2 origins.
- `apps/next-app/lib/runtime-config.ts` and `apps/next-app/next.config.ts` both consume this resolver to prevent client/server/rewrite drift.
- Production requires `NEXT_PUBLIC_API_URL`; local fallback is `http://localhost:8787`.
- Clerk client auth provider is route-scoped (`/game`, `/sign-in`, `/sign-up`) to reduce public-route script cost.

### 1. ETL Pipeline (Offline)

```
External Sources                    Processing                      Storage
─────────────────                   ──────────────                  ─────────

Montreal Open Data  ──┐             ┌──────────────┐
(CSV, JSON)           │             │              │
                      ├────────────▶│  ETL Scripts │
Logseq Knowledge    ──┤             │ (Node/Python)│
Base (JSONL)          │             │              │
                      │             └──────┬───────┘
                      │                    │
                      │                    ▼
                      │             ┌──────────────┐                ┌─────────┐
                      │             │  Clean &     │                │   R2    │
                      └────────────▶│  Normalize   │───────────────▶│ (images)│
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ Vision       │
                                    │ Enrichment   │  ◀── Workers AI VLM tags + Tesseract OCR
                                    │ (offline)    │      → vlm_tags + ocr_text
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ Merge +      │
                                    │ Trust Score  │
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │   D1    │
                                    │  Seed SQL    │───────────────▶│(metadata│
                                    │              │                │+vlm_cap)│
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│mtl-     │
                                    │  (BGE text)  │  Uses desc+cap │archives │
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│mtl-arch-│
                                    │  (CLIP img)  │  From R2 URLs  │ives-clip│
                                    └──────────────┘                └─────────┘
```

### 2. Search Flow (Runtime)

```
Text Search (?mode=text)
─────────────────────────
User Query ──▶ Cote fast-path (exact PK lookup) ──▶ D1 ──▶ Results
           └─▶ Fallback: semantic search (see below)

Semantic Search (?mode=semantic)
─────────────────────────────────
User Query ──▶ Workers AI (BGE) ──▶ Vectorize ──▶ D1 Hydration ──▶ Results
                                        │
                            Searches description + vlm_caption embeddings

Visual Search (?mode=visual)
────────────────────────────
User Query ──▶ HuggingFace (CLIP text) ──▶ Vectorize CLIP ──▶ D1 Hydration ──▶ Results
                                                │
                                    Matches against image embeddings
```

### SEO URL Canonicalization

- Canonical photo pages use bare IDs: `/photo/{id}` (no `.json` suffix).
- Worker endpoint `/api/photos?id=` accepts both bare IDs and `.json` IDs, normalizing to the same record.
- Sitemap and social metadata (OG/Twitter + JSON-LD) emit canonical bare-ID photo URLs.
- Legacy `/photo/{id}.json` links are redirected (308) to canonical bare-ID URLs.

### 3. Game Flow (Runtime)

```
Next.js /game ──▶ Worker /api/game/daily|guess|leaderboard ──▶ D1
                                          │
                             daily_challenge / daily_guess / practice_guess
```

### 4. Print Ordering Flow (Runtime)

```
Next.js /api/checkout ──▶ Resend (emails) ──▶ Manual fulfillment
```

## D1 Schema

```sql
CREATE TABLE manifest (
  metadata_filename TEXT PRIMARY KEY,
  image_filename TEXT,
  resolved_image_filename TEXT,
  image_size_bytes INTEGER,
  name TEXT,
  description TEXT,           -- Original/synthetic description
  vlm_caption TEXT,           -- VLM-generated image description (98% coverage)
  date_value TEXT,
  credits TEXT,
  cote TEXT,
  external_url TEXT,
  portal_match INTEGER,
  portal_title TEXT,
  portal_description TEXT,
  portal_date TEXT,
  portal_cote TEXT,
  aerial_datasets TEXT        -- JSON array
);
```

Note: D1 currently stores core fields plus `vlm_caption`. Structured VLM tags and OCR outputs live in
`manifest_enriched_v3.jsonl` and `manifest_scored.jsonl` until the schema is expanded.

## Repository Structure

```
mtl-archives-search/
├── apps/
│   ├── api/                      # Cloudflare Worker (REST API)
│   │   ├── src/worker.ts         # Single entry point
│   │   └── wrangler.toml         # Cloudflare bindings
│   ├── next-app/                 # Next.js UI (map + search)
│   │   └── src/
│   └── web/                      # React frontend
│       └── src/
├── packages/
│   ├── core/                     # Shared types (PhotoRecord)
│   └── scripts/                  # Node.js pipeline scripts
│       └── src/
│           ├── db/               # D1 seed generation
│           └── vectorize/        # Embedding ingestion
├── pipelines/
│   ├── etl/                      # Python: clean, export, audit
│   ├── geocoding/                # Geocode helpers
│   ├── ocr/                      # OCR pipeline (Tesseract)
│   ├── vectorize/                # CLIP GPU vectorization
│   └── vlm/                      # VLM captioning scripts
├── infrastructure/
│   └── d1/migrations/            # D1 schema migrations
├── docs/                         # Documentation
└── data/                         # Local data (gitignored)
```

## Search Modes Comparison

| Mode | Backend | Embedding | Matches On | Best For |
|------|---------|-----------|------------|----------|
| `text` | D1 (cote PK lookup) → semantic fallback | None / BGE | Cote references, then meaning | Known cotes, or falls through to semantic |
| `semantic` | Vectorize (BGE) | 1024-dim | Description + VLM caption text | Conceptual queries, synonyms |
| `visual` | Vectorize (CLIP) | 512-dim | Image content | "Show me X", visual similarity |

## Technology Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Database**: Cloudflare D1 (SQLite)
- **Vector Store**: Cloudflare Vectorize
  - `mtl-archives`: BGE text embeddings (1024-dim)
  - `mtl-archives-clip`: CLIP image embeddings (512-dim)
- **AI Models**:
  - Workers AI: BGE-M3 (semantic search + linkage)
  - Workers AI: uform-gen2-qwen-500m (structured VLM tags)
  - HuggingFace Inference API: CLIP ViT-B/32 (visual search)
  - Tesseract OCR (offline text extraction)
  - Legacy: LLaVA 1.5 7B captioning run (see metrics)
- **Object Storage**: Cloudflare R2 (public domain)
- **Image Delivery**: Vercel Image Optimization (Pro plan) — resizes, converts to WebP/AVIF, edge-caches. Source images from R2 public URLs.
- **Caching**: Cloudflare Cache API (read-through on Worker endpoints, 5m–24h TTLs). In-memory cached COUNT keyed by WHERE clause.
- **Analytics**: Vercel Analytics (custom events)
- **ETL**: Python 3.10+, Node.js 23+

## Vision Enrichment Pipeline

The trust-first pipeline now augments records with structured vision signals and OCR for evidence-backed descriptions.

1. **Input**: `manifest_linked.jsonl` (canonical + linked records)
2. **VLM tags**: Workers AI model → `manifest_vlm_structured.jsonl`
3. **OCR**: Tesseract OCR → `manifest_ocr.jsonl`
4. **Merge + score**: `manifest_enriched_v3.jsonl` + `manifest_scored.jsonl`
5. **Legacy**: LLaVA 1.5 7B captions in `manifest_vlm_complete.jsonl` still back the current text embeddings until reseeded.

See `docs/metrics/vlm-captioning/` for detailed run metrics.

## Vectorize Ingestion Reliability

- Text (`packages/scripts/src/vectorize/ingest-text.ts`) and CLIP (`packages/scripts/src/vectorize/ingest-clip.ts`) ingest scripts now include:
  - retry/backoff for transient API/network failures,
  - resumable checkpoints in `data/mtl_archives/.checkpoints/`,
  - structured failure logs in `data/mtl_archives/.logs/`.
- Default behavior is fail-loud on integrity issues so partial ingest does not silently reduce index coverage.
