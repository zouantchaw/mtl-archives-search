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
- **Worker** (`api/worker.ts`): Single entry point handling `/api/photos` (paginated listing) and `/api/search` (text/semantic modes)
- **D1** (`mtl-archives`): SQLite database with `manifest` table containing photo metadata
- **R2** (`mtl-archives`): Image storage; Worker generates signed URLs or uses public domain
- **Vectorize** (`mtl-archives`): Vector index for semantic search using `@cf/baai/bge-large-en-v1.5` embeddings
- **Workers AI**: Generates embeddings for both ingestion and runtime queries

### Data Flow
1. Source manifests in `data/mtl_archives/manifest_enriched.jsonl` (from upstream Logseq pipeline)
2. Python scripts clean/export → `manifest_clean.jsonl` → `manifest_enriched.ndjson`
3. Node script generates SQL → `infrastructure/d1/seed_manifest.sql`
4. Wrangler seeds D1 and ingests vectors to Vectorize

### Key Bindings (wrangler.toml)
- `DB`: D1 database binding
- `VECTORIZE`: Vectorize index binding
- `AI`: Workers AI binding

## Environment Setup

Node.js 23.5.0 required (see `.nvmrc`). Python 3.10+ for data scripts.

Store secrets via `wrangler secret put`:
- `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`
- Optional: `CLOUDFLARE_R2_PUBLIC_DOMAIN` (if not using signed URLs)

For local scripts, use a `.env` file with `CLOUDFLARE_AI_TOKEN` for vectorize ingestion.

## Code Patterns

- Worker uses module syntax with typed `Env` interface
- R2 URLs are signed using AWS Signature V4 when no public domain is configured
- Semantic search: query → Workers AI embedding → Vectorize query → D1 hydration
- Text search: SQL LIKE queries across `name`, `description`, `portal_title`, `portal_description`
