# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for the Montréal city archives photo search (~15k historical images). REST API on Cloudflare Workers with D1/R2/Vectorize, plus React and Next.js frontends.

## Commands

```bash
# Development
npm run dev                    # Run all workspaces in dev mode
npm run typecheck              # TypeScript check all workspaces
npm run deploy                 # Deploy Worker to Cloudflare

# ETL pipeline (trust-first approach)
npm run canonicalize           # Normalize metadata → manifest_canonical.jsonl
npm run normalize-dates        # Parse dates → manifest_dated.jsonl
npm run link-records           # BGE-based record linkage → manifest_linked.jsonl
npm run vlm:tags               # Workers AI VLM structured tags
npm run ocr:run                # Tesseract OCR (Python)
npm run merge-vision           # Merge VLM + OCR → manifest_enriched_v3.jsonl
npm run score-trust            # Generate trust scores → manifest_scored.jsonl
npm run db:generate            # Generate SQL seed file

# Vectorize ingestion
npm run vectorize:text         # BGE embeddings → mtl-archives index
npm run vectorize:clip         # CLIP embeddings → mtl-archives-clip index

# Workspace-specific
npm run dev --workspace=apps/api
npm run dev --workspace=apps/next-app
```

## Architecture

### Monorepo Structure
```
apps/
├── api/                # Cloudflare Worker (REST API)
│   └── src/worker.ts   # Single entry point: /api/photos, /api/search
├── next-app/           # Next.js frontend (App Router, map visualization)
└── web/                # React SPA (Vite, 3D point cloud)

packages/
├── core/               # Shared types and utilities
└── scripts/            # ETL, vectorize, VLM pipelines (tsx)

pipelines/
├── ocr/                # Python OCR scripts (Tesseract)
└── vectorize/          # Python CLIP embedding scripts
```

### Cloudflare Bindings (apps/api/wrangler.toml)
- `DB`: D1 database → `manifest` table
- `VECTORIZE`: BGE index (1024-dim semantic search)
- `VECTORIZE_CLIP`: CLIP index (512-dim visual search)
- `AI`: Workers AI for BGE embeddings
- R2 secrets for signed image URLs

### Search Modes
| Mode | Vector Index | Embedding |
|------|--------------|-----------|
| `text` | None (SQL LIKE) | — |
| `semantic` | mtl-archives | Workers AI BGE |
| `visual` | mtl-archives-clip | HuggingFace CLIP |

### Data Flow
1. Source: `manifest_enriched.jsonl` (from Logseq pipeline)
2. ETL: canonicalize → dates → link-records → VLM tags + OCR → merge → trust score
3. Output: `manifest_scored.jsonl` → SQL seed → D1
4. Embeddings: BGE (text) and CLIP (images) → Vectorize indices

## Environment

Node 23.5.0 (see `.nvmrc`). Python 3.10+ for OCR/CLIP scripts.

Secrets via `wrangler secret put`:
- R2 credentials: `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`
- Visual search: `HF_API_TOKEN` (HuggingFace)

Local `.env` for scripts: `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

## Code Patterns

- Worker: module syntax with typed `Env` interface
- ETL scripts: tsx with streaming JSONL processing
- VLM/OCR outputs stored in separate files, merged via `merge-vision-enrichments.ts`
- Trust scoring determines which fields are reliable for search/display

## For Wiel
For every project, write a detailed FORWIEL.md file that explains the whole project in plain language. 

Explain the technical architecture, the structure of the codebase and how the various parts are connected, the technologies used, why we made these technical decisions, and lessons I can learn from it (this should include the bugs we ran into and how we fixed them, potential pitfalls and how to avoid them in the future, new technologies used, how good engineers think and work, best practices, etc). 

It should be very engaging to read; don't make it sound like boring technical documentation/textbook. Where appropriate, use analogies and anecdotes to make it more understandable and memorable."
