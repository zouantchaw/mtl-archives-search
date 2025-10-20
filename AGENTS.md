# Repository Guidelines

## Project Structure & Module Organization
Primary worker logic lives in `src/worker.ts` (Cloudflare Worker routing `/api/photos` and `/api/search`). Database schema and migrations sit in `cloudflare/d1/` with `migrations/0001_init.sql` and the generated seed `seed_manifest.sql`. Data preparation assets reside under `data/mtl_archives/` (Python scripts, JSONL manifests, raw CSV exports); treat them as the source for seeding the platform. Utility Node scripts stay in `scripts/`, while runtime configuration is tracked in `wrangler.toml`. Avoid editing `node_modules/`; it is vendor output.

## Build, Test & Development Commands
Use `npm run dev` to launch the worker locally via Wrangler with live reload. Deploy to Cloudflare Workers using `npm run deploy`. Generate the SQL seed manifest before seeding with `npm run generate:sql`. Populate the remote D1 database through `npm run d1:seed`. Run the full ingestion pipeline (SQL generation + seed) with `npm run pipeline`. Trigger vector embedding ingestion via `npm run vectorize:ingest`. Perform type safety checks with `npm run typecheck`.

## Coding Style & Naming Conventions
Write TypeScript with modern ECMAScript features; keep imports grouped by source. Favor immutable patterns and focused helpers (see `buildPhotoRecord` in `src/worker.ts`). Indent with two spaces and prefer single quotes. Name handlers with verb-first camelCase (`handleSearch`, `methodNotAllowed`). When adding Node scripts, use kebab-case filenames in `scripts/` and document required environment variables inline.

## Testing Guidelines
There are no Jest-style suites yet; rely on `npm run typecheck` and manual endpoint probes. For new logic, add focused helper functions and cover them with lightweight integration calls through `npm run dev`. Seed a disposable D1 database before tests when queries depend on data (`npm run d1:seed`). Capture payload samples under `data/mtl_archives/export/` to reuse across tests.

## Commit & Pull Request Guidelines
Follow the imperative, present-tense style observed in `git log` (e.g., `Enable vectorize ingestion`). Scope commits around a single behavior or migration. Pull requests should summarize the change, link any issue, and list data or schema updates. Attach screenshots or `curl` output when altering API responses. Mention required environment toggles so reviewers can reproduce locally.

## Security & Configuration Notes
Store Cloudflare credentials via Wrangler secrets; never commit `.wrangler-logs` or JSON exports containing personal data. Keep `Env` bindings (`DB`, optional `VECTORIZE`, R2 keys) defined in `wrangler.toml` and mirror updates into staging before production deploys. Export `CLOUDFLARE_AI_TOKEN` (or `CF_AI_TOKEN`/`CLOUDFLARE_API_TOKEN`) only when running the ingestion script; it reads `.env` automatically so leave long-lived secrets there and override per-shell when needed. Vectorize ingestion talks to the v2 API using NDJSON payloads, so double-check the binding points at the correct index before pushing.
