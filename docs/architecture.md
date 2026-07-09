# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│                 (Next.js Web UI + Game, Research Explorer)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Worker (apps/api)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  /api/photos    │  │  /api/search    │  │  /api/search?mode=visual    │  │
│  │  (paginated)    │  │  ?mode=text     │  │  CLIP text→image search     │  │
│  │                 │  │  ?mode=semantic │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
         │                      │                           │
         │                      │                           │
         ▼                      ▼                           ▼
┌─────────────────┐   ┌─────────────────┐         ┌─────────────────┐
│   Cloudflare    │   │   Cloudflare    │         │   External AI   │
│       D1        │   │    Vectorize    │         │    Services     │
│   (metadata)    │   │   (embeddings)  │         │                 │
│                 │   │                 │         │  ┌────────────┐ │
│  ┌───────────┐  │   │  ┌───────────┐  │         │  │ Workers AI │ │
│  │ manifest  │  │   │  │mtl-archives│ │         │  │ (BGE + VLM)│ │
│  │  table    │  │   │  │ (BGE text)│  │         │  ├────────────┤ │
│  │  14,822   │  │   │  ├───────────┤  │         │  │ HuggingFace│ │
│  │  records  │  │   │  │mtl-archives│ │         │  │ (CLIP text)│ │
│  │           │  │   │  │-clip (img)│  │         │  ├────────────┤ │
│  │           │  │   │  │           │  │         │  │ Tesseract  │ │
│  │           │  │   │  │           │  │         │  │ (OCR)      │ │
│  └───────────┘  │   │  └───────────┘  │         │  └────────────┘ │
│                 │   │                 │         └─────────────────┘
└─────────────────┘   └─────────────────┘
         │
         ▼
┌─────────────────┐
│   Cloudflare    │
│       R2        │
│    (images)     │
│                 │
│   ~15k photos   │
│   Public URLs   │
└─────────────────┘
```

## Data Flow

### Next.js Runtime Config

- `apps/next-app/lib/runtime-env.ts` is the single source of truth for API/R2 origins.
- `apps/next-app/lib/runtime-config.ts` and `apps/next-app/next.config.ts` both consume this resolver to prevent client/server/rewrite drift.
- Production requires `NEXT_PUBLIC_API_URL`; local fallback is `http://localhost:8787`.
- Clerk client auth provider is route-scoped (`/game`, `/sign-in`, `/sign-up`) to reduce public-route script cost.
- Commerce now validates CA/US shipping addresses, calculates shipping in `apps/next-app`, creates Stripe Checkout Sessions in `apps/next-app/app/api/checkout/route.ts`, then finalizes confirmation/admin email delivery from `apps/next-app/app/api/stripe/webhook/route.ts`.
- Newsletter subscription lives in Worker + D1 + Resend. The landing page and game page post explicit opt-in requests to Worker routes; game auth alone does not imply newsletter consent.
- Vercel cron hits `apps/next-app/app/api/cron/newsletter/route.ts` hourly. That route gates on `America/Toronto` local hour `7` and then calls the Worker admin endpoint, which avoids DST mistakes from a single hard-coded UTC schedule.
- The V4 Paper redesign lives in `apps/next-app` and centers route-specific surfaces for `/`, `/search`, `/photo/[id]`, `/print`, `/checkout`, `/order-confirmation`, `/sign-in`, `/sign-up`, and `/game`.
- Home no longer A/B redirects visitors into `/game`; the editorial landing page is now the default public entry point.

### 1. ETL Pipeline (Offline)

```
External Sources                    Processing                      Storage
─────────────────                   ──────────────                  ─────────

Montreal Open Data  ──┐             ┌──────────────┐
(CSV, JSON)           │             │              │
                      ├────────────▶│  ETL Scripts │
Logseq Knowledge    ──┤             │ (Node/Python)│
Base (JSONL)          │             │              │
                      │             └──────┬───────┘
                      │                    │
                      │                    ▼
                      │             ┌──────────────┐                ┌─────────┐
                      │             │  Clean &     │                │   R2    │
                      └────────────▶│  Normalize   │───────────────▶│ (images)│
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ Vision       │
                                    │ Enrichment   │  ◀── Workers AI VLM tags + Tesseract OCR
                                    │ (offline)    │      → vlm_tags + ocr_text
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ Merge +      │
                                    │ Trust Score  │
                                    └──────┬───────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │   D1    │
                                    │  Seed SQL    │───────────────▶│(metadata│
                                    │              │                │+vlm_cap)│
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│mtl-     │
                                    │  (BGE text)  │  Uses desc+cap │archives │
                                    └──────────────┘                └─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐                ┌─────────┐
                                    │  Generate    │                │Vectorize│
                                    │  Embeddings  │───────────────▶│mtl-arch-│
                                    │  (CLIP img)  │  From R2 URLs  │ives-clip│
                                    └──────────────┘                └─────────┘
```

### 2. Search Flow (Runtime)

```
Text Search (?mode=text)
─────────────────────────
User Query ──▶ Cote fast-path (exact PK lookup) ──▶ D1 ──▶ Results
           └─▶ Fallback: semantic search (see below)

Semantic Search (?mode=semantic)
─────────────────────────────────
User Query ──▶ Workers AI (BGE) ──▶ Vectorize ──▶ D1 Hydration ──▶ Results
                                        │
                            Searches description + vlm_caption embeddings

Visual Search (?mode=visual)
────────────────────────────
User Query ──▶ HuggingFace (CLIP text) ──▶ Vectorize CLIP ──▶ D1 Hydration ──▶ Results
                                                │
                                    Matches against image embeddings
```

### SEO URL Canonicalization

- Canonical photo pages use bare IDs: `/photo/{id}` (no `.json` suffix).
- Worker endpoint `/api/photos?id=` accepts both bare IDs and `.json` IDs, normalizing to the same record.
- Sitemap and social metadata (OG/Twitter + JSON-LD) emit canonical bare-ID photo URLs.
- Legacy `/photo/{id}.json` links are redirected (308) to canonical bare-ID URLs.
- Next metadata routes publish first-party crawl endpoints: `/sitemap.xml` and `/robots.txt`.
- `/game` page metadata includes canonical and language alternate URLs to avoid route/query duplicate buckets.
- Worker metadata fields (`name`, `description`, related text fields) are normalized to strip escaped control chars (for example literal `\\n`) before API responses.

### 3. Game Flow (Runtime)

```
Next.js /game ──▶ Worker /api/game/daily|guess|leaderboard ──▶ D1
                                          │
                             daily_challenge / daily_guess / practice_guess
```

### 4. Print Ordering Flow (Runtime)

```
Next.js checkout validation + shipping quote ──▶ Next.js /api/checkout ──▶ Stripe Checkout ──▶ Next.js /api/stripe/webhook ──▶ Resend ──▶ Manual fulfillment
```

### 5. Newsletter Flow (Runtime)

```
Landing/Game signup ──▶ Worker /api/newsletter/subscribe ──▶ D1 newsletter_subscription
                             │                                  │
                             │                                  └─▶ newsletter_subscription_event
                             ▼
                        Resend welcome email

Vercel Cron (hourly) ──▶ Next /api/cron/newsletter ──▶ Worker /api/newsletter/admin/run
                                                           │
                                                           ├─▶ newsletter_run lock/log
                                                           ├─▶ getDailyChallenge + newsletter_issue
                                                           ├─▶ newsletter_delivery log
                                                           └─▶ Resend daily email

Email unsubscribe link ──▶ Worker /api/newsletter/unsubscribe ──▶ D1 status update + confirmation email
```

### 6. Social Packaging Fallback (Local Runtime)

```
Local machine ──▶ pipelines/daily-reel/main.py ──▶ Worker API (/api/search, /api/photos)
        │                         │
        │                         ├─▶ Gemini research chain (theme + archivist public story)
        │                         ├─▶ Instagram carousel renderer
        │                         ├─▶ Facebook reel renderer
        │                         └─▶ inspection report + package manifest
        ▼
~/Desktop/mtl-social-fallback/YYYY-MM-DD/
```

- This path exists so the daily social operation can continue when the remote `spruce` host is unavailable.
- The fallback runner preserves the platform split:
  - Instagram: square carousel + archivist-teacher caption
  - Facebook: reel + hook-first caption
- The runner also supports package re-renders from an existing local directory via `--package-dir --reuse-research`, which avoids a second Gemini call during incident recovery while rebuilding the latest local public-story templates from saved research.
- The local FB reel renderer now traverses portrait panels derived from the original archive image so the full frame is progressively revealed across the video instead of living inside a single crop.
- The local IG carousel renderer now uses content-aware contextual detail crops instead of fixed quadrant splits, so slide-level closeups prefer meaningful regions in the image itself.
- Inspection artifacts now carry explicit review signals (`brand_ready`, per-channel scores, `caption_ok`) so the local runtime can flag weak packages instead of treating every render as publishable by default.
- Search/random fallback runs now keep a candidate pool and auto-reroll until a package passes the brand gate. If no candidate passes, the strongest attempt is still preserved for review, but the final package is explicitly marked with a failing `selection_status` rather than silently treated as publishable.
- Image reuse filtering starts at generation time through `data/social/publish-ledger.jsonl`, which stores archive identifiers, image identity, story angle, theme, selection status, and package outputs so the fallback can avoid recently used images before it renders a new package.
- The reuse policy is enforced again at post-publish time. It scans the generation ledger, `data/social/publish-registry.jsonl`, local package folders, and Story registry/log context. Exact image/metadata reuse is blocked for the cooldown window, and same-subject-family variants such as two filenames for the same aerial subject require an intentional different `story_angle_key`, a `reuse_reason`, and minimum-gap/lifetime caps.
- Publish reconciliation now has its own event log in `data/social/publish-registry.jsonl`, which records actual platform publishes, permalinks, post IDs, and publish timestamps separately from generation-time package state.
- Every strong package now emits `story_seed.json`, which is the handoff object for deeper archive-linked story pages. This keeps the daily social flow and long-form narrative flow connected to the same research package instead of forking into separate editorial systems.
- The fallback can also mirror a package into an Obsidian note bundle when `--obsidian-dir` (or `MTL_OBSIDIAN_EXPORT_DIR`) is set. Generated packages land under `experiments/`; once a real publish is registered, the package can be mirrored into `final/`. That mirror is deliberately optional: useful for editorial memory and synced review, but not part of the core generation dependency graph.

### 7. Story Promotion Flow (Optional, Slower Path)

```
Daily social package ──▶ story_seed.json ──▶ story_pages.py promote
        │                                      │
        │                                      ├─▶ apps/next-app/content/stories/*.json
        │                                      └─▶ Next.js /stories + /stories/[slug]
        ▼
IG carousel + FB reel
```

- Story pages are not part of the mandatory daily publish path.
- The daily package remains the fast surface: image selection, platform packaging, and captions.
- The story promotion path exists for stronger archive packages that deserve more depth.
- A promoted story page can carry:
  - stronger title and dek
  - the selected archive image
  - deeper sections derived from the same research package
  - related archive search links
  - product CTA back to archive search / game / prints
- This keeps social as the hook, the photo page as the object, and the story page as the deeper narrative surface.

### 8. Dataset Factory v0 (Offline Evaluation + Training Data)

```
Ignored reports in data/mtl_archives/reports/
        │
        ├─▶ docs/dataset-factory/artifact-registry.v0.jsonl
        │       stable IDs, SHA-256 digests, counts, lineage, commands, rights
        │
        └─▶ packages/scripts/src/dataset-factory/*.ts
                ├─ review packets + calibration/adjudication labels
                ├─ MTL-CityMemory-Bench v0 search/reranker evaluation
                ├─ active-learning and quality-repair queues
                ├─ visual-family graph and research-enrichment packets
                └─ search judgments + reward-data exports
```

- Dataset Factory v0 is an offline durability layer for search-quality evaluation and future training data. It does not deploy, mutate Cloudflare resources, publish social content, or require credentials for its tracked fixture smoke.
- The real generated artifacts are intentionally gitignored because they include large report trees. Their reproducibility contract is tracked in `docs/dataset-factory/artifact-registry.v0.jsonl` and validated by `npm run dataset-factory:artifacts:check`.
- `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo` verifies every registered ignored artifact by SHA-256, file count, byte count, and row count where meaningful.
- `docs/dataset-factory/fixtures/v0-smoke/` contains small tracked fixtures that mirror the contracts needed by the v0 workflows. `npm run dataset-factory:smoke-v0` runs the v0 scripts against those fixtures and a local mock search API, proving that a clean checkout can exercise the workflow without copying generated report trees.
- Missing required artifacts should fail loudly through the Dataset Factory artifact helpers rather than silently producing empty downstream reports.

## D1 Schema

```sql
CREATE TABLE manifest (
  metadata_filename TEXT PRIMARY KEY,
  image_filename TEXT,
  resolved_image_filename TEXT,
  image_size_bytes INTEGER,
  name TEXT,
  description TEXT,           -- Original/synthetic description
  vlm_caption TEXT,           -- VLM-generated image description (98% coverage)
  date_value TEXT,
  credits TEXT,
  cote TEXT,
  external_url TEXT,
  portal_match INTEGER,
  portal_title TEXT,
  portal_description TEXT,
  portal_date TEXT,
  portal_cote TEXT,
  aerial_datasets TEXT        -- JSON array
);
```

Note: D1 currently stores core fields plus `vlm_caption`. Structured VLM tags and OCR outputs live in
`manifest_enriched_v3.jsonl` and `manifest_scored.jsonl` until the schema is expanded.

Newsletter tables added in `0009_newsletter.sql`:
- `newsletter_subscription`: source of truth for consented subscribers, locale, source, Clerk linkage, and timestamps
- `newsletter_issue`: deterministic daily pairing of the game photo and a surprise archive photo
- `newsletter_delivery`: delivery log for welcome/daily/unsubscribe emails
- `newsletter_subscription_event`: consent and lifecycle audit trail, including source and IP metadata
- `newsletter_run` in `0010_newsletter_runs.sql`: per-day dispatch lock and run summary used by cron/admin triggers

## Repository Structure

```
mtl-archives-search/
├── apps/
│   ├── api/                      # Cloudflare Worker (REST API)
│   │   ├── src/worker.ts         # Single entry point
│   │   └── wrangler.toml         # Cloudflare bindings
│   ├── next-app/                 # Next.js UI (map + search)
│   │   └── src/
│   └── web/                      # React frontend
│       └── src/
├── packages/
│   ├── core/                     # Shared types (PhotoRecord)
│   └── scripts/                  # Node.js pipeline scripts
│       └── src/
│           ├── db/               # D1 seed generation
│           ├── dataset-factory/  # Offline evaluation/training-data workflows
│           └── vectorize/        # Embedding ingestion
├── pipelines/
│   ├── etl/                      # Python: clean, export, audit
│   ├── geocoding/                # Geocode helpers
│   ├── ocr/                      # OCR pipeline (Tesseract)
│   ├── vectorize/                # CLIP GPU vectorization
│   └── vlm/                      # VLM captioning scripts
├── infrastructure/
│   └── d1/migrations/            # D1 schema migrations
├── docs/                         # Documentation, including dataset-factory schemas/fixtures
└── data/                         # Local data (gitignored)
```

## Search Modes Comparison

| Mode | Backend | Embedding | Matches On | Best For |
|------|---------|-----------|------------|----------|
| `text` | D1 (cote PK lookup) → semantic fallback | None / BGE | Cote references, then meaning | Known cotes, or falls through to semantic |
| `semantic` | Vectorize (BGE) | 1024-dim | Description + VLM caption text | Conceptual queries, synonyms |
| `visual` | Vectorize (CLIP) | 512-dim | Image content | "Show me X", visual similarity |

## Technology Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Database**: Cloudflare D1 (SQLite)
- **Vector Store**: Cloudflare Vectorize
  - `mtl-archives`: BGE text embeddings (1024-dim)
  - `mtl-archives-clip`: CLIP image embeddings (512-dim)
- **AI Models**:
  - Workers AI: BGE-M3 (semantic search + linkage)
  - Workers AI: uform-gen2-qwen-500m (structured VLM tags)
  - HuggingFace Inference API: CLIP ViT-B/32 (visual search)
  - Tesseract OCR (offline text extraction)
  - Legacy: LLaVA 1.5 7B captioning run (see metrics)
- **Object Storage**: Cloudflare R2 (public domain)
- **Image Delivery**: Vercel Image Optimization (Pro plan) — resizes, converts to WebP/AVIF, edge-caches. Source images from R2 public URLs.
- **Caching**: Cloudflare Cache API (read-through on Worker endpoints, 5m–24h TTLs). In-memory cached COUNT keyed by WHERE clause.
- **Analytics**: Vercel Analytics (custom events)
- **Payments**: Stripe Checkout + webhooks, with shipping quoted in-app for Canada/US before redirect
- **Email**: Resend (post-payment order emails + newsletter sends)
- **ETL**: Python 3.10+, Node.js 23+

## Vision Enrichment Pipeline

The trust-first pipeline now augments records with structured vision signals and OCR for evidence-backed descriptions.

1. **Input**: `manifest_linked.jsonl` (canonical + linked records)
2. **VLM tags**: Workers AI model → `manifest_vlm_structured.jsonl`
3. **OCR**: Tesseract OCR → `manifest_ocr.jsonl`
4. **Merge + score**: `manifest_enriched_v3.jsonl` + `manifest_scored.jsonl`
5. **Legacy**: LLaVA 1.5 7B captions in `manifest_vlm_complete.jsonl` still back the current text embeddings until reseeded.

See `docs/metrics/vlm-captioning/` for detailed run metrics.

## Vectorize Ingestion Reliability

- Text (`packages/scripts/src/vectorize/ingest-text.ts`) and CLIP (`packages/scripts/src/vectorize/ingest-clip.ts`) ingest scripts now include:
  - retry/backoff for transient API/network failures,
  - resumable checkpoints in `data/mtl_archives/.checkpoints/`,
  - structured failure logs in `data/mtl_archives/.logs/`.
- Both ingest paths read JSONL manifests as streams and process fixed-size batches, avoiding full-manifest memory loads.
- Both ingest paths can optionally exclude records classified as `document_likely` (`--exclude-document-likely`) using shared rules from `packages/scripts/src/analysis/search-quality-rules.ts`.
- Default behavior is fail-loud on integrity issues so partial ingest does not silently reduce index coverage.

## Social Auth State

- Durable Meta auth for the social pipeline lives in `pipelines/daily-reel/token_manager.py`.
- Bootstrapped state is stored in `data/social/meta-token-state.json`.
- The token manager auto-loads repo env files (`.env.local`, then `.env`) so the common local workflow is:
  - `npm run social:token-bootstrap -- --print-env`
  - `npm run social:token-status`
- This keeps Graph API Explorer in the bootstrap role only. Ongoing health checks and page/IG linkage should run against the stored state file instead of requiring fresh pasted tokens.
- Historical social pulls can reuse the same saved state through `packages/scripts/src/analysis/fetch-social-history.ts`, which falls back to `data/social/meta-token-state.json` for the user token, page ID, and Instagram account ID.
- Content-performance correlation runs through `packages/scripts/src/analysis/social-content-correlation.ts`, which turns a post history snapshot into Q1-style summaries of format mix, feature correlations, and top-performing IG/FB patterns.
- Day-level social correlation runs through `packages/scripts/src/analysis/social-daily-correlation.ts`, which joins downloaded Meta export CSVs to the post snapshot and can optionally supplement Facebook with live Page Insights (`page_media_view`, `page_daily_follows`) for cleaner Q1 daily comparisons.
- The current history fetch stores per-post Instagram views for all IG Q1 posts and per-post Facebook views for reels via the `/{page-id}/video_reels` edge. That is intentionally separate from Facebook page-level Views: the Business Suite daily/monthly Views export aligns with Page Insights `page_media_view`, not with the sum of reel `views`.
- Story publishing uses the same persisted auth state through `pipelines/daily-reel/story_publish.py`.
- The current repo implementation supports Instagram and Facebook Page Story publishing from a local video asset by uploading the media to public R2 first, then using either the Instagram Story container flow or the Facebook Page `video_stories` flow.
- Story publish attempts are written to `data/social/story-publish-log.jsonl`.
- Daily game Story delivery is orchestrated by `pipelines/daily-reel/game_story_pipeline.py` / `npm run social:publish-game-story`. It reuses a valid `/Users/wiel/Desktop/mtl-game-stories/YYYY-MM-DD-daily-game-story.mp4`, renders only when needed in prepare/publish mode, and records prepared/published date/platform deliveries in `data/social/story-registry.jsonl` so future runs do not prepare or post the same Story again unless `--force` is explicit.
- Server-side Story publishing does not support link/poll/location stickers, so Story CTA workflows that depend on a clickable `mtlarchives.com/game` sticker still require a mobile/manual flow.
- Daily post publishing runs through `pipelines/daily-reel/post_publish.py`. It publishes Instagram carousel packages from `instagram_carousel/slide*.jpg` and Facebook reels from `facebook_reel.mp4`, uploads media to public R2 before calling Meta Graph, logs attempts to `data/social/post-publish-log.jsonl`, and records successful live posts in `data/social/publish-registry.jsonl`.

## Local Social Outage Path

- The local fallback runner lives in `pipelines/daily-reel/main.py`.
- The operator-facing entrypoint is `npm run social:today`.
- When no `--date` is provided, the runner resolves the run date in this order:
  - `--timezone`
  - `MTL_SOCIAL_TIMEZONE`
  - local system timezone
- The default local output root is `~/Downloads/mtl-daily/YYYY-MM-DD`.
- The final package records `resolved_timezone`, which makes weekday/theme selection auditable for outage-generated packages.
- The operator path prints a human-readable run summary by default. Use `npm run social:today:json` if an agent or wrapper needs the manifest on stdout.
- Codex cron/worktree runs do not automatically inherit untracked repo env files. The local social pipeline now loads `.env.local` / `.env` from both the current checkout and the canonical git checkout so Gemini and Meta credentials stay available to automations without duplicating secret files.
- The story-video workspace runs through `scripts/run-tsx.mjs` so automation worktrees can reuse the canonical repo's installed `tsx` binary rather than relying on `npx` to fetch it at run time.
- Gemini request failures are normalized into a concise operator error message so temporary network issues do not explode into raw library tracebacks during the outage workflow.
- Weak records now carry explicit location-confidence state (`location_confidence`, `exact_location_public_safe`). If exact place identity only comes from grounded search on thin metadata, the pipeline downgrades to a broader sector label and candidate scoring rejects any caption/reel that reintroduces the suppressed exact place names.
