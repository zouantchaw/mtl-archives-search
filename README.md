# Montréal Archives Cloudflare Stack

Cloudflare Worker, D1, R2, and Vectorize scaffolding for the Montréal city archives dataset. This project packages the outputs from the Logseq pipeline (`data/mtl_archives/...`) into production-friendly APIs with **semantic search** powered by Workers AI.

## Quick Links

- 📖 [**WORKFLOW.md**](./WORKFLOW.md) - Development, testing, and deployment guide
- 📊 [**MONITORING.md**](./MONITORING.md) - Metrics, quality measurement, and observability
- 🔗 [**Live API**](https://mtl-archives-worker.wiel.workers.dev)

## Architecture

- **R2** – canonical object store for the image corpus (mirrors the backup drive).
- **D1** – structured metadata (`manifest` table) queried by Worker endpoints.
- **Vectorize** – semantic search index with 14,822 embedded photo descriptions.
- **Workers AI** – generates embeddings (`@cf/baai/bge-large-en-v1.5`) for queries and ingestion.
- **Worker** – REST API (`/api/photos`, `/api/search`) serving metadata with both text and semantic search.

## Repository Layout

```
cloudflare/              # D1 migrations and seed SQL
  └── d1/
      ├── migrations/    # Schema definition(s)
      └── seed_manifest.sql
data/
  └── mtl_archives/      # Exports, staged assets, R2/R2 logs (gitignored where sensitive)
scripts/                 # Node helpers (e.g., generate_manifest_sql.js)
src/
  └── worker.ts          # Worker entry point (module syntax)
wrangler.toml            # Worker, D1, and Vectorize bindings
.nvmrc                   # Node version (v23.5.0)
```

## Prerequisites

1. **Node.js 23.5.0** – via `nvm use 23.5.0` (see `.nvmrc`).
2. **Cloudflare Wrangler 4.43+** – `npm install -g wrangler` or rely on `npx` in the provided scripts.
3. **AWS CLI** (optional) – for syncing R2 objects.
4. **Cloudflare account** with:
   - D1 database (`mtl-archives`) already created.
   - R2 bucket (`mtl-archives`) populated with images.
   - Vectorize index (placeholder binding `VECTORIZE`) for future semantic search.

Clone or move this repo into a clean directory (e.g., `~/Development/mtl-archives-cloudflare`) and run:

```bash
nvm use 23.5.0
npm install
wrangler login
```

## Development Workflow

| Mode                   | Command              | What it Does                                        |
| ---------------------- | -------------------- | --------------------------------------------------- |
| **Local Dev (Empty)**  | `npm run dev`        | Local temporary D1 (empty), no Vectorize, remote AI |
| **Local Dev (Seeded)** | See setup below      | Local D1 with real data, no Vectorize, remote AI    |
| **Remote Dev**         | `npm run dev:remote` | Uses production resources (read-only testing)       |
| **Production**         | `npm run deploy`     | Deploy to live API                                  |

### Setting Up Local Dev with Data

**Note:** Vectorize cannot run locally (Cloudflare limitation). For semantic search testing, use `npm run dev:remote`.

To seed local D1 with production data:

```bash
# 1. Start dev server once to create local database
npm run dev
# Stop it (Ctrl+C)

# 2. Seed with all data (14,822 records)
npm run dev:seed

# OR seed with sample data (100 records, faster)
npm run dev:seed:sample

# 3. Start dev server again - now with data!
npm run dev
```

Now you can test `/api/photos` and text search locally with real data!

See [WORKFLOW.md](./WORKFLOW.md) for details and [MONITORING.md](./MONITORING.md) for quality measurement.

## Commands

**Development:**

- `npm run dev` - Local dev server (empty temporary D1)
- `npm run dev:seed` - Seed local D1 with all production data
- `npm run dev:seed:sample` - Seed local D1 with 100 sample records
- `npm run dev:remote` - Dev server with production data + Vectorize
- `npm run typecheck` - TypeScript type checking

**Testing:**

- `npm run test:search` - Quick API smoke tests
- `npm run vectorize:eval` - Evaluate semantic search quality

**Data Pipeline:**

- `npm run generate:sql` - Generate SQL from manifest
- `npm run pipeline` - Seed production D1 database
- `npm run vectorize:ingest` - Ingest vectors to production

**Deployment:**

- `npm run deploy` - Deploy to production

All scripts set `WRANGLER_LOG_PATH` to `data/mtl_archives/.wrangler-logs/` to avoid macOS permission issues.

## API Endpoints

`GET /api/photos`
: Returns paginated metadata ordered by `metadata_filename`, embedding a signed (or public) R2 URL for each image under `imageUrl`.

Query parameters:

- `limit` (1–100, default 50)
- `cursor` (use the `nextCursor` value from the previous page)

`GET /api/search`
: Search across photos using text matching or semantic similarity.

Query parameters:

- `q` _(required)_ – search term
- `limit` (1–100, default 25)
- `mode` (`text` | `semantic`, default `text`)
  - **`text`**: SQL `LIKE` queries across `name`, `description`, `portal_title`, and `portal_description` fields
  - **`semantic`**: Uses Workers AI embeddings (`@cf/baai/bge-large-en-v1.5`) and Vectorize to find semantically similar photos. Returns results with similarity scores (0-1, higher is better).

**Examples:**

```bash
# Text search
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=church&mode=text"

# Semantic search - finds conceptually similar photos
curl "https://mtl-archives-worker.wiel.workers.dev/api/search?q=old+cathedral+building&mode=semantic&limit=5"
```

Every response is JSON and includes `Access-Control-Allow-Origin: *` so the Worker can be called from browser prototypes.

## Data Pipeline

1. Produce fresh exports within your Logseq repo (`manifest_enriched.ndjson`, R2 sync artifacts, etc.).
2. Run `npm run pipeline` to regenerate SQL and seed D1 remotely.
3. Use AWS CLI or Cloudflare dashboard to sync imagery to R2, e.g.:
   ```bash
   aws --endpoint-url https://<account>.r2.cloudflarestorage.com \
     s3 sync \
     "/Volumes/FREE SPACE/mtl_archives_photographs" \
     s3://mtl-archives
   ```
4. Generate embeddings and push them to Vectorize so `/api/search?mode=semantic` can return meaningful results (see **Vectorize ingestion** below).

## Secrets & Environment Variables

Never commit raw credentials. Rotate any keys that previously lived in `data/mtl_archives/cloundflare.md`. Store required values using Wrangler secrets or your preferred secret manager:

```bash
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_BUCKET
wrangler secret put R2_PUBLIC_DOMAIN  # optional: remove if using signed URLs exclusively
```

The Worker signs R2 URLs automatically when no public domain is provided. Signing uses AWS Signature Version 4 so
clients can access private imagery without exposing your credentials. Supply `R2_PUBLIC_DOMAIN` only if you intend
to serve assets from a public bucket/domain.

For local tooling, place the same values (plus `CLOUDFLARE_AI_TOKEN` and any embedding model overrides) in a local
`.env` file and export them before running the scripts, e.g.:

```bash
set -a
source .env
set +a
```

> **Tip:** keep your deployment shell free of `CLOUDFLARE_API_TOKEN` so `wrangler deploy` continues using the OAuth
> session from `wrangler login`. Store the Workers AI/Vectorize token in `CLOUDFLARE_AI_TOKEN` (or `CF_AI_TOKEN`) and only export it when running
> `npm run vectorize:ingest`.

## Vectorize Ingestion

Run `npm run vectorize:ingest` after updating `manifest_enriched.ndjson` to keep your semantic index in sync. The
script uses Workers AI to generate embeddings (defaults to `@cf/baai/bge-large-en-v1.5`) and upserts them into the
Vectorize index defined in `wrangler.toml`. The Vectorize API for this project runs on **v2**, so the script streams
newline-delimited JSON (`application/x-ndjson`) to `/vectorize/v2/indexes/<name>/upsert`.

Environment variables consumed:

- `CLOUDFLARE_AI_TOKEN` _(preferred)_, `CF_AI_TOKEN`, or `CLOUDFLARE_API_TOKEN` – must allow `Workers AI:Edit` and `Vectorize:Write`.
- `CLOUDFLARE_R2_ACCOUNT_ID` – reused for AI/Vectorize REST endpoints.
- `CLOUDFLARE_VECTORIZE_INDEX` – optional override of the index name (`mtl-archives` by default).
- `CLOUDFLARE_EMBEDDING_MODEL` – optional embedding model name.
- `VECTORIZE_BATCH_SIZE` / `VECTORIZE_LIMIT` – optional batching/tuning knobs.
- `VECTORIZE_REQUEST_TIMEOUT_MS` – optional fetch timeout (default 60000).

The script loads variables from `.env` automatically; exported values in your shell take precedence if you need a temporary override.

Embeddings are stored alongside lightweight metadata (name, date, image key) so Vectorize results can be joined
with D1 rows or returned directly to clients.

## Next Steps

- ✅ **Semantic search** – COMPLETE! `/api/search?mode=semantic` now uses Workers AI and Vectorize to return semantically similar photos with similarity scores.
- **Automation** – wrap R2 sync + D1 seed + Vectorize ingestion into a CI-friendly workflow.
- **Monitoring** – add logging/metrics (e.g., Workers Analytics Engine) and guardrails (rate limiting, auth) as you move towards production.
- **Frontend** – build a React/Next.js UI to showcase the photo collection with both text and semantic search capabilities.

With the data pipeline and semantic search API complete, you can now prototype web or ML front-ends without disturbing the Logseq knowledge base.
