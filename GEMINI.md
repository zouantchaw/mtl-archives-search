# Gemini Context: MTL Archives Search

## Project Overview

**MTL Archives Search** is a Semantic and visual search API for the Montréal city archives photo collection (~15,000 historical images). It is built on the Cloudflare stack, utilizing Workers, D1, Vectorize, R2, and Workers AI to provide sub-50ms search performance globally.

## Architecture

The system is designed as a serverless application running on Cloudflare's edge network:

*   **API Runtime:** Cloudflare Workers (`api/worker.ts`) handles REST requests.
*   **Metadata Storage:** Cloudflare D1 (SQLite) stores photo metadata (titles, descriptions, dates).
*   **Image Storage:** Cloudflare R2 hosts the raw images. The API generates signed URLs for secure access.
*   **Search Engine:**
    *   **Text:** SQL `LIKE` queries on D1.
    *   **Semantic:** Cloudflare Vectorize (BGE embeddings) finding conceptually similar photos.
    *   **Visual (Planned):** Cloudflare Vectorize (CLIP embeddings) for image similarity.
*   **AI Models:**
    *   **Cloudflare Workers AI:** Generates BGE text embeddings for semantic search.
    *   **HuggingFace Inference API:** Used for generating CLIP text embeddings for visual search queries.

## Directory Structure

*   `api/`: Cloudflare Worker source code (TypeScript).
*   `data/`: Local data directory (contains raw CSVs, JSONs, and export artifacts).
*   `docs/`: Documentation files (`architecture.md`, `visual-search-deep-dive.md`).
*   `infrastructure/`: Cloudflare resources configuration (D1 migrations).
*   `pipelines/`: Data processing scripts.
    *   `etl/`: Python scripts for cleaning, normalizing, and exporting metadata.
    *   `sql/`: Node.js script to generate SQL seed files for D1.
    *   `vectorize/`: Scripts for generating and ingesting embeddings (Node.js for text, Python for CLIP).

## Key Commands

### Development & Deployment

*   **Start Local Dev Server:** `npm run dev` (uses `wrangler dev`)
*   **Deploy to Cloudflare:** `npm run deploy`
*   **Type Check:** `npm run typecheck`

### Data Pipeline

The data pipeline processes raw metadata into a deployable state.

*   **Full Pipeline:** `npm run pipeline` (Runs clean -> export -> audit -> seed)
*   **Clean Metadata:** `npm run etl:clean`
*   **Export Manifest:** `npm run etl:export`
*   **Audit Quality:** `npm run etl:audit`
*   **Seed D1 Database:** `npm run d1:seed` (Generates SQL and executes it remotely)

### Vectorization

*   **Ingest Text Embeddings:** `npm run vectorize:text` (BGE)
*   **Ingest CLIP Embeddings:** `npm run vectorize:clip` (Python)
*   **Evaluate Search:** `npm run search:eval`

## Environment Setup

### Prerequisites

*   **Node.js:** v23.5.0 (managed via `.nvmrc`)
*   **Python:** 3.10+ (for ETL and CLIP pipelines)
*   **Cloudflare Account:** Required for `wrangler` deployment.

### Python Environment

For CLIP embedding generation and ETL scripts:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipelines/vectorize/requirements.txt
```

### Secrets & Configuration

Secrets are managed via `wrangler secret put`. Required secrets include:

*   `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`
*   `HF_API_TOKEN`: HuggingFace API token for CLIP visual search.
*   `CLOUDFLARE_AI_TOKEN`: Required for local scripts accessing Cloudflare AI.

## Coding Conventions

*   **Language:** TypeScript for the Worker, Python for data pipelines, Node.js for utility scripts.
*   **Style:** Follows standard TypeScript/ESLint conventions.
*   **Database:** Migrations are stored in `infrastructure/d1/migrations`.
*   **API:** RESTful design with JSON responses.
