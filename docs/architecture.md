# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│                         (Web UI, Mobile App, CLI)                            │
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
│                 │   │                 │         │  ┌───────────┐  │
│  ┌───────────┐  │   │  ┌───────────┐  │         │  │ Workers AI│  │
│  │ manifest  │  │   │  │mtl-archives│ │         │  │ (BGE)     │  │
│  │  table    │  │   │  │ (BGE text)│  │         │  ├───────────┤  │
│  │  14,822   │  │   │  ├───────────┤  │         │  │HuggingFace│  │
│  │  records  │  │   │  │mtl-archives│ │         │  │ (CLIP)    │  │
│  │           │  │   │  │-clip (img)│  │         │  └───────────┘  │
│  └───────────┘  │   │  └───────────┘  │         └─────────────────┘
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

### 1. ETL Pipeline (Offline)

```
External Sources                    Processing                      Storage
─────────────────                   ──────────────                  ─────────

Montreal Open Data  ──┐             ┌──────────────┐
(CSV, JSON)           │             │              │
                      ├────────────▶│  ETL Scripts │
Logseq Knowledge    ──┤             │  (Python)    │
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
                                    │     VLM      │
                                    │  Captioning  │  ◀── LLaVA 1.5 7B on Lambda Labs
                                    │  (GPU job)   │      ~15k images → vlm_caption
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
                                    │  (BGE text)  │  Uses vlm_cap  │archives │
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
User Query ──▶ SQL LIKE ──▶ D1 ──▶ Results + R2 URLs

Semantic Search (?mode=semantic)
─────────────────────────────────
User Query ──▶ Workers AI (BGE) ──▶ Vectorize ──▶ D1 Hydration ──▶ Results
                                        │
                            Searches vlm_caption embeddings

Visual Search (?mode=visual)
────────────────────────────
User Query ──▶ HuggingFace (CLIP text) ──▶ Vectorize CLIP ──▶ D1 Hydration ──▶ Results
                                                │
                                    Matches against image embeddings
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

## Repository Structure

```
mtl-archives-search/
├── apps/
│   ├── api/                      # Cloudflare Worker (REST API)
│   │   ├── src/worker.ts         # Single entry point
│   │   └── wrangler.toml         # Cloudflare bindings
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
│   └── vlm/                      # VLM captioning scripts
├── infrastructure/
│   └── d1/migrations/            # D1 schema migrations
├── docs/                         # Documentation
└── data/                         # Local data (gitignored)
```

## Search Modes Comparison

| Mode | Backend | Embedding | Matches On | Best For |
|------|---------|-----------|------------|----------|
| `text` | D1 (SQL LIKE) | None | Exact keywords | Known terms, names, dates |
| `semantic` | Vectorize (BGE) | 1024-dim | VLM caption text | Conceptual queries, synonyms |
| `visual` | Vectorize (CLIP) | 512-dim | Image content | "Show me X", visual similarity |

## Technology Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Database**: Cloudflare D1 (SQLite)
- **Vector Store**: Cloudflare Vectorize
  - `mtl-archives`: BGE text embeddings (1024-dim)
  - `mtl-archives-clip`: CLIP image embeddings (512-dim)
- **AI Models**:
  - Workers AI: BGE-large-en-v1.5 (semantic search)
  - HuggingFace Inference API: CLIP ViT-B/32 (visual search)
  - LLaVA 1.5 7B: VLM captioning (offline, Lambda Labs A100)
- **Object Storage**: Cloudflare R2
- **ETL**: Python 3.10+, Node.js 23+

## VLM Captioning Pipeline

The semantic search quality depends on having good text descriptions for each image. Since ~85% of records had only synthetic/placeholder descriptions, we ran VLM captioning:

1. **Input**: 14,822 images from R2
2. **Model**: LLaVA 1.5 7B on Lambda Labs A100 (40GB)
3. **Output**: `vlm_caption` field with 2-3 sentence descriptions
4. **Coverage**: 98% of records now have VLM captions
5. **Cost**: $14 for ~11 hours of GPU time

See `docs/metrics/vlm-captioning/` for detailed run metrics.
