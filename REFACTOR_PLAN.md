# Refactoring Plan: TypeScript Monorepo

We will restructure the project into a modern TypeScript monorepo using **NPM Workspaces**. This eliminates the Python dependency, unifies the tech stack, and enables code sharing.

## 1. Directory Structure

```
/
├── package.json              # Root config (workspaces definition)
├── tsconfig.base.json        # Shared TS config
├── apps/
│   ├── api/                  # Cloudflare Worker (Backend)
│   │   └── src/              # Ported from current api/worker.ts
│   └── web/                  # New React App (Visualization UI)
│       └── src/              # Ported from visualization/embedding_explorer.html
└── packages/
    ├── core/                 # Shared types (PhotoRecord) and utils
    └── scripts/              # Unified ETL & Vectorization pipelines (Node.js)
        ├── src/
        │   ├── etl/          # Replaces pipelines/etl/*.py
        │   └── vectorize/    # Replaces pipelines/vectorize/*.py (using transformers.js)
        └── package.json
```

## 2. Key Changes

### A. Shared Core Package (`packages/core`)
*   Define the `PhotoRecord` type once and use it in the API, Frontend, and ETL scripts.
*   Centralize validation logic (e.g., `validateMetadataQuality`) so the pipeline and API use the exact same rules.

### B. ETL Pipeline Migration (Python → TypeScript)
*   **Input:** `clean_metadata.py` → `clean-metadata.ts`
*   **Logic:** Port regex and string manipulation to TS.
*   **Library:** Use `franc` or `languagedetect` for language detection.

### C. ML Pipeline Migration (Python → TypeScript)
*   **Clip Ingestion:** Port `ingest_clip.py` to `ingest-clip.ts` using `@xenova/transformers`.
*   **Execution:** Run via `node` instead of `python`.
*   **Benefit:** "One command" setup (`npm install` handles everything).

### D. API Modernization
*   Switch from the monolithic `worker.ts` to a modular structure using **Hono** (a lightweight, standard-compliant framework for Workers).
*   Add **Vitest** for unit testing search logic.

### E. Frontend Modernization
*   Convert the raw HTML/JS visualization to a **Vite + React** app.
*   Use `react-map-gl` or `deck.gl` React bindings for the map visualization.

## 3. Implementation Steps

1.  **Monorepo Setup:** Initialize root `package.json` with workspaces.
2.  **Core Package:** Extract types from `worker.ts` into `packages/core`.
3.  **ETL Port:** Rewrite `clean_metadata.py` and `audit_metadata_quality.py` in TypeScript.
4.  **API Refactor:** Move `api/` to `apps/api` and implement Hono.
5.  **ML Port:** Rewrite `ingest_clip.py` using `transformers.js`.
6.  **Web App:** Scaffold `apps/web` and migrate the visualization.

## 4. Verification
*   Ensure `npm run pipeline` works purely with Node.js.
*   Ensure types are shared correctly (changing a type in `core` updates API and Frontend).
