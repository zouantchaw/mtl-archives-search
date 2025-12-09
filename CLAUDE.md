# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cloudflare Worker serving REST APIs for the Montréal city archives photo collection (~15k images). Uses D1 for metadata storage, R2 for image hosting, Vectorize for semantic search, and Workers AI for embeddings.

## Common Commands

```bash
# Development
npm run dev              # Local Worker development
npm run typecheck        # TypeScript type checking
npm run deploy           # Deploy Worker to Cloudflare

# Data pipeline (run in order, or use `npm run pipeline` for all)
npm run etl:clean        # Python: normalize strings, expand abbreviations → manifest_clean.jsonl
npm run etl:export       # Python: flatten to NDJSON/Parquet
npm run etl:audit        # Python: generate quality reports
npm run d1:seed          # Regenerate SQL and seed remote D1

# Vectorize
npm run vectorize:text   # Generate BGE embeddings and upsert to Vectorize (requires CLOUDFLARE_AI_TOKEN)
npm run vectorize:clip   # Generate CLIP image embeddings (requires Python venv, see below)

# Database utilities
npm run db:count         # Check row count in D1
```

## Architecture

### Repository Structure
```
mtl-archives-search/
├── api/                    # Cloudflare Worker (REST API)
│   └── worker.ts           # Single entry point
├── pipelines/
│   ├── etl/               # Python: metadata processing
│   ├── vectorize/         # Embedding generation
│   └── sql/               # D1 seed generation
├── infrastructure/        # Cloudflare D1 migrations
└── data/                  # Local data (gitignored)
```

### Cloudflare Stack
- **Worker** (`api/worker.ts`): Single entry point handling `/api/photos` (paginated listing) and `/api/search` (text/semantic/visual modes)
- **D1** (`mtl-archives`): SQLite database with `manifest` table containing photo metadata
- **R2** (`mtl-archives`): Image storage; Worker generates signed URLs or uses public domain
- **Vectorize** (`mtl-archives`): Vector index for semantic search using `@cf/baai/bge-large-en-v1.5` embeddings (1024-dim)
- **Vectorize** (`mtl-archives-clip`): Vector index for visual/CLIP search using 512-dim CLIP embeddings
- **Workers AI**: Generates BGE embeddings for semantic search
- **HuggingFace Inference API**: Generates CLIP text embeddings for visual search at query time

### Data Flow
1. Source manifests in `data/mtl_archives/manifest_enriched.jsonl` (from upstream Logseq pipeline)
2. Python scripts clean/export → `manifest_clean.jsonl` → `manifest_enriched.ndjson`
3. Node script generates SQL → `infrastructure/d1/seed_manifest.sql`
4. Wrangler seeds D1 and ingests vectors to Vectorize

### Key Bindings (wrangler.toml)
- `DB`: D1 database binding
- `VECTORIZE`: Vectorize index binding (BGE semantic search)
- `VECTORIZE_CLIP`: Vectorize index binding (CLIP visual search)
- `AI`: Workers AI binding

## Environment Setup

Node.js 23.5.0 required (see `.nvmrc`). Python 3.10+ for data scripts.

Store secrets via `wrangler secret put`:
- `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`
- Optional: `CLOUDFLARE_R2_PUBLIC_DOMAIN` (if not using signed URLs)
- `HF_API_TOKEN`: HuggingFace API token for CLIP visual search (get from huggingface.co/settings/tokens)

For local scripts, use a `.env` file with `CLOUDFLARE_AI_TOKEN` for vectorize ingestion.

### CLIP Embedding Setup (Python)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipelines/vectorize/requirements.txt
# Run with environment variables:
CLOUDFLARE_AI_TOKEN="..." CLOUDFLARE_ACCOUNT_ID="..." python3 pipelines/vectorize/ingest_clip.py
```

## Code Patterns

- Worker uses module syntax with typed `Env` interface
- R2 URLs are signed using AWS Signature V4 when no public domain is configured
- Text search: SQL LIKE queries across `name`, `description`, `portal_title`, `portal_description`
- Semantic search (`mode=semantic`): query → Workers AI BGE embedding → Vectorize query → D1 hydration
- Visual search (`mode=visual`): query → HuggingFace CLIP text embedding → Vectorize CLIP query → D1 hydration
