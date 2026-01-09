# Repository Guidelines

## Project Structure & Module Organization
- Root is an npm workspaces monorepo (`apps/*`, `packages/*`).
- `apps/api/` — Cloudflare Worker API. Entry: `apps/api/src/worker.ts`; bindings in `apps/api/wrangler.toml`.
- `apps/next-app/` — Next.js UI (port 3001) with map + search experience.
- `apps/web/` — React + Vite + Tailwind front‑end. Source in `apps/web/src/`, static assets in `apps/web/public/`.
- `packages/core/` — shared TypeScript types/utilities consumed by API and UIs.
- `packages/scripts/` — offline ETL/vectorization/db scripts run with `tsx` (see `packages/scripts/src/`).
- `pipelines/` — Python ETL + VLM captioning workflows (offline).
- `infrastructure/d1/` holds D1 migrations; `data/mtl_archives/` contains large datasets and generated artifacts (gitignored).

## Build, Test, and Development Commands
- `npm install` — install all workspace deps (requires Node ≥23.5; use `.nvmrc` with `nvm use`).
- `npm run dev` — start all available dev servers (API worker + web UI).
  - API only: `npm run dev --workspace=apps/api` (Wrangler remote dev at `localhost:8787`).
  - Next.js UI only: `npm run dev --workspace=apps/next-app` (Next dev server at `localhost:3001`).
  - Web only: `npm run dev --workspace=apps/web` (Vite at `localhost:5173`).
- `npm run build` — build web app for production.
- `npm run typecheck` — run `tsc --noEmit` across workspaces.
- Data/scripts (from root): `npm run open-data:fetch`, `open-data:match`, `open-data:missing`, `open-data:ingest-missing`, `manifest:dedupe`, `clean`, `canonicalize`, `normalize-dates`, `link-records`, `link-records:report`, `vlm:tags`, `merge-vision`, `ocr:run`, `apply-aerial`, `merge-enrichments`, `score-trust`, `vlm:merge`, `vectorize:text`, `vectorize:clip`, `vectorize:export`, `db:generate`.

## Runtime/Search Notes
- API search modes: `text`, `semantic`, `visual` via `/api/search?mode=...`; hybrid weighting is done client-side.
- Use `/api/thumb` for previews/tooltips to avoid loading full-resolution images.
- CLIP embeddings for browser-side visual search live in `apps/web/public/embeddings_*`.

## Coding Style & Naming Conventions
- TypeScript/TSX, ESNext modules, strict mode (`tsconfig.base.json`).
- Indent 2 spaces; keep semicolons; follow the existing quote style within a file.
- React components in PascalCase (`EmbeddingExplorer.tsx`); functions/vars in camelCase; script filenames in kebab‑case (`ingest-text.ts`).

## Testing Guidelines
- No formal automated test suite yet; `npm run test` is currently a no‑op.
- Validate changes with `npm run typecheck` and manual smoke tests (API endpoints via curl; web UI via `npm run dev`).
- If adding tests, colocate near code and name `*.test.ts(x)`.

## Commit & Pull Request Guidelines
- Commit history favors short, imperative messages (no required conventional‑commit prefixes).
- PRs should include a clear summary, rationale, and how to verify. Link related issues, and add screenshots/gifs for UI changes. Ensure `npm run typecheck` passes before requesting review.
