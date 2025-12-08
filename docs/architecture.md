# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│                    (Web UI, Mobile App, ML Experiments)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker (api/worker.ts)                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  /api/photos    │  │  /api/search    │  │  /api/search/visual (TODO)  │  │
│  │  (paginated)    │  │  ?mode=text     │  │  CLIP image search          │  │
│  │                 │  │  ?mode=semantic │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
         │                      │                           │
         │                      │                           │
         ▼                      ▼                           ▼
┌─────────────────┐   ┌─────────────────┐         ┌─────────────────┐
│   Cloudflare    │   │   Cloudflare    │         │   Cloudflare    │
│       D1        │   │    Vectorize    │         │   Workers AI    │
│   (metadata)    │   │   (embeddings)  │         │  (BGE / CLIP)   │
│                 │   │                 │         │                 │
│  ┌───────────┐  │   │  ┌───────────┐  │         │  ┌───────────┐  │
│  │ manifest  │  │   │  │ text idx  │  │         │  │ BGE-large │  │
│  │  table    │  │   │  │ (BGE)     │  │         │  │  en-v1.5  │  │
│  │  14,822   │  │   │  ├───────────┤  │         │  ├───────────┤  │
│  │  records  │  │   │  │ clip idx  │  │         │  │   CLIP    │  │
│  └───────────┘  │   │  │  (TODO)   │  │         │  │  (TODO)   │  │
│                 │   │  └───────────┘  │         │  └───────────┘  │
└─────────────────┘   └─────────────────┘         └─────────────────┘
                                                           │
                                                           │
                              ┌─────────────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │   Cloudflare    │
                    │       R2        │
                    │    (images)     │
                    │                 │
                    │   ~15k photos   │
                    │   Signed URLs   │
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
                      │             │  Clean &     │                │   D1    │
                      └────────────▶│  Normalize   │───────────────▶│ (SQL)   │
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│ (BGE)   │
                                    │  (BGE text)  │                └─────────┘
                                    └──────────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│ (CLIP)  │
                                    │  (CLIP img)  │                │  TODO   │
                                    └──────────────┘                └─────────┘
```

### 2. Search Flow (Runtime)

```
Text Search (?mode=text)
─────────────────────────
User Query ──▶ SQL LIKE ──▶ D1 ──▶ Results + R2 URLs

Semantic Search (?mode=semantic)
─────────────────────────────────
User Query ──▶ Workers AI ──▶ BGE Embedding ──▶ Vectorize ──▶ D1 Hydration ──▶ Results

Visual Search (?mode=visual) [TODO]
────────────────────────────────────
User Query/Image ──▶ Workers AI ──▶ CLIP Embedding ──▶ Vectorize ──▶ D1 Hydration ──▶ Results
```

## Repository Structure

```
mtl-archives-search/
├── api/                          # Cloudflare Worker
│   └── worker.ts                 # Single entry point, REST API
├── pipelines/                    # Data processing scripts
│   ├── etl/                      # Python: clean, export, audit metadata
│   │   ├── clean_metadata.py
│   │   ├── export_manifest.py
│   │   └── audit_metadata_quality.py
│   ├── vectorize/                # Embedding generation
│   │   ├── ingest_text.js        # BGE text embeddings
│   │   └── ingest_clip.js        # CLIP image embeddings (TODO)
│   └── sql/                      # D1 seed generation
│       └── generate_manifest_sql.js
├── infrastructure/               # Cloudflare resources
│   └── d1/
│       └── migrations/
├── data/                         # Local data (gitignored)
│   └── mtl_archives/
├── docs/                         # Documentation
│   └── architecture.md           # This file
├── wrangler.toml                 # Cloudflare bindings
└── package.json                  # Scripts and dependencies
```

## Search Modes Comparison

| Mode | Backend | Matches On | Best For |
|------|---------|------------|----------|
| `text` | D1 (SQL LIKE) | Exact keywords in metadata | Known terms, names, dates |
| `semantic` | Vectorize (BGE) | Conceptually similar text | Fuzzy queries, synonyms |
| `visual` (TODO) | Vectorize (CLIP) | Visual similarity | "Find similar photos", image upload |

## Technology Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Database**: Cloudflare D1 (SQLite)
- **Vector Store**: Cloudflare Vectorize
- **AI Models**: Cloudflare Workers AI
  - BGE-large-en-v1.5 (text embeddings)
  - CLIP (image embeddings, planned)
- **Object Storage**: Cloudflare R2
- **ETL**: Python 3.10+, Node.js 23+
