# Montréal Archives Cloudflare Stack

Cloudflare Worker, D1, R2, and Vectorize scaffolding for the Montréal city archives dataset. This project packages the outputs from the Logseq pipeline (`data/mtl_archives/...`) into production-friendly APIs, making it easy to launch web or ML experiments on top of Cloudflare infrastructure.

## Architecture

- **R2** – canonical object store for the image corpus (mirrors the backup drive).
- **D1** – structured metadata (`manifest` table) queried by Worker endpoints.
- **Vectorize** – reserved binding for semantic search once embeddings are generated.
- **Worker** – REST API (`/api/photos`, `/api/search`) that serves metadata and will orchestrate future search/index tasks.

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

## Commands

| Command                   | Description |
| ------------------------- | ----------- |
| `npm run generate:sql`    | Regenerates `cloudflare/d1/seed_manifest.sql` from `data/mtl_archives/export/manifest_enriched.ndjson`. |
| `npm run d1:seed`         | Regenerate SQL and bulk upload into the remote D1 database. |
| `npm run db:count`        | Sanity-check the number of rows currently in D1. |
| `npm run pipeline`        | Shortcut for `generate:sql` + remote D1 seed. |
| `npm run vectorize:ingest`| Generate embeddings with Workers AI and upsert them into Cloudflare Vectorize. |
| `npm run dev`             | Run the Worker locally with Wrangler dev. |
| `npm run deploy`          | Deploy the Worker to Cloudflare (make sure variables/secrets are set). |
| `npm run typecheck`       | TypeScript type checking for the Worker code. |

All scripts set `WRANGLER_LOG_PATH` to `data/mtl_archives/.wrangler-logs/` to avoid macOS permission issues.

## API Endpoints

`GET /api/photos`
: Returns paginated metadata ordered by `metadata_filename`, embedding a signed (or public) R2 URL for each image under `imageUrl`.

Query parameters:
- `limit` (1–100, default 50)
- `cursor` (use the `nextCursor` value from the previous page)

`GET /api/search`
: Text search across `name`, `description`, and portal fields.

Query parameters:
- `q` *(required)* – search term
- `limit` (1–100, default 25)
- `mode` (`text` | `semantic`). Semantic mode returns HTTP 501 until Vectorize is wired in.

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

For local tooling, place the same values (plus `CLOUDFLARE_API_TOKEN` and any embedding model overrides) in a local
`.env` file and export them before running the scripts, e.g.:

```bash
set -a
source .env
set +a
```

> **Tip:** keep your deployment shell free of `CLOUDFLARE_API_TOKEN` so `wrangler deploy` continues using the OAuth
> session from `wrangler login`. Store the Workers AI/Vectorize token in `CF_AI_TOKEN` and only export it when running
> `npm run vectorize:ingest`.

## Vectorize Ingestion

Run `npm run vectorize:ingest` after updating `manifest_enriched.ndjson` to keep your semantic index in sync. The
script uses Workers AI to generate embeddings (defaults to `@cf/baai/bge-large-en-v1.5`) and upserts them into the
Vectorize index defined in `wrangler.toml`.

Environment variables consumed:

- `CF_AI_TOKEN` *(preferred)* or `CLOUDFLARE_API_TOKEN` – must allow `Workers AI:Edit` and `Vectorize:Write`.
- `CLOUDFLARE_R2_ACCOUNT_ID` – reused for AI/Vectorize REST endpoints.
- `CLOUDFLARE_VECTORIZE_INDEX` – optional override of the index name (`mtl-archives` by default).
- `CLOUDFLARE_EMBEDDING_MODEL` – optional embedding model name.
- `VECTORIZE_BATCH_SIZE` / `VECTORIZE_LIMIT` – optional batching/tuning knobs.

Embeddings are stored alongside lightweight metadata (name, date, image key) so Vectorize results can be joined
with D1 rows or returned directly to clients.

## Next Steps

- **Fully enable semantic search** – `npm run vectorize:ingest` loads vectors, but `/api/search?mode=semantic` still needs an embedding provider at query time (Workers AI or an external service). Once you add that, swap the placeholder in `handleSemanticSearch` with a real Vectorize query.
- **Automation** – wrap R2 sync + D1 seed + Vectorize ingestion into a CI-friendly workflow.
- **Monitoring** – add logging/metrics (e.g., Workers Analytics Engine) and guardrails (rate limiting, auth) as you move towards production.

With the data pipeline encoded in this repo, you can now prototype new web or ML front-ends without disturbing the Logseq knowledge base.
