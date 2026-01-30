# Tasks

Goal: Convert Instagram audience (3,100+) into website engagement and print sales.

Current state (Jan 24, 2026): Funnel is live and working — Reels drive 55% of IG visitors to engage deeply (18.57 pages/visit, 4m22s avg). Gallery shuffle is the stickiest feature. Zero print sales yet.

---

## P0: Fix the IG Bounce (45% drop-off)

5 of 11 Instagram visitors in the last 24h bounced immediately. This is the biggest leak.

- [ ] **Diagnose mobile load time** — IG visitors are on iOS/Android in-app browser. Profile first paint speed.
- [x] **Above-the-fold hook** — First thing IG visitors see must be compelling (not a loading spinner)
- [x] **Prominent search bar** — Analytics show engaged users immediately search. Make it unmissable on mobile.
- [x] **Quick-discovery entry point** — Show shuffle or trending photos before requiring any interaction

---

## P0: Core API + SEO Bugs (Worker + Next)

These block reliable indexing and create silent 404s/OG misses.

- [ ] **Fix sitemap/photo ID mismatch** — Ensure `/api/photos` accepts bare IDs or update sitemap to include `.json` IDs. Align OG/Twitter fetches with the same ID format.
- [ ] **Stop caching expired signed R2 URLs** — If public R2 domain is missing, shorten cache TTL to signed URL expiry or skip caching for signed responses (API + sitemap).
- [ ] **Centralize API base config** — Remove hard-coded prod worker/R2 from rewrites/preconnects; use env-driven base (with safe local fallback) for client + server + Next config.

---

## P0: Infra & Cost Stabilization (D1 + Images) ✅

Was reading ~4.3M D1 rows/day. Target: <250k/day. All items implemented Jan 27, 2026.

- [x] **Add Worker Cache API for read endpoints** — read-through cache on `/api/photos`, `/api/search` (GET), `/api/map`, `/api/sitemap` with TTLs (5m–24h). Shuffle bypasses cache (offset sampling is cheap enough).
- [x] **Replace `ORDER BY RANDOM()`** — random offset sampling with `ORDER BY metadata_filename LIMIT ? OFFSET ?`. No more full table scan.
- [x] **Remove per-request `COUNT(*)`** — cached total count (keyed by WHERE clause, 24h TTL). Display count is now a static "13,000+ photos" string — no DB query.
- [x] **Deprecate text mode → semantic fallback** — cote/reference fast-path for exact lookups, all other text queries redirect to semantic search. 4-column LIKE scan eliminated.
- [x] **Abort in-flight searches** — AbortController cancels pending fetch on new keystroke.
- [x] **Ensure stable image URLs** — R2 public domain set as wrangler.toml var.
- [x] **Migrate to Vercel Image Optimization** — removed `/api/thumb` worker proxy (was passing through full 45MB originals unresized). Next.js `<Image>` on Vercel Pro now handles resizing, WebP/AVIF conversion, and edge caching. Removed `unoptimized` from all Image components.
- [x] **Exclude oversized aerials** — base WHERE clause caps at 20MB (`image_size_bytes <= 20000000`) to stay within Vercel's 50MB source limit.

### Client Memory (Mobile Stability)
- [x] **Unmount hidden photo mode** — conditional rendering replaces CSS hiding (releases decoded image memory).
- [x] **Responsive hero sizing** — Vercel Image Optimization auto-serves correct sizes via `sizes` attribute.
- [x] **Grid content-visibility** — `contentVisibility: auto` + `containIntrinsicSize` on PhotoTile.
- [x] **Defer non-critical images** — `fetchPriority="low"` for non-priority tiles, `"high"` for first row.

---

## P1: Search & Session Correctness

- [x] **Make semantic mode shareable** — Persist `mode=semantic` in URL (or change default mode to semantic) so reload/share preserves results.
- [x] **Avoid double fetch on desktop** — Defer initial `loadPhotos` until `isMobile` detection completes to prevent duplicate API calls.
- [x] **Guard missing AI binding** — If `AI` is unbound, return a 501 config error instead of a 500 for semantic search.
- [x] **Improve smart mode blending** — Add cote fast-path + rank-based fusion (RRF) instead of visual-first ordering.

---

## P1: Neighborhood Shortcuts (Analytics-Driven)

Users search: "Miron", "Portuguais", "Ahuntsic", "rue notre-dame", "Rue st Catherine". All Montreal neighborhoods/landmarks. Make this frictionless.

- [x] **One-tap neighborhood filters** — Pill/chip UI with top neighborhoods (Miron, Ahuntsic, Plateau, Villeray, Portugais, Vieux-Montréal)
- [x] **Pre-populated search suggestions** — Show popular searches on empty search state
- [ ] **Neighborhood landing pages** — `/quartier/ahuntsic` with pre-filtered results (SEO + shareable)

---

## P1: Pipeline Reliability (Vectorize + R2)

- [ ] **Retry + resume ingestion** — Add retry/backoff and resumable checkpoints for Vectorize ingest (text + CLIP) so failures don’t silently shrink index coverage.
- [ ] **Failure reporting** — Write per-run failure logs + summary counts to disk for auditability.
- [ ] **Stream manifests** — Avoid loading full JSONL into memory for large runs; switch to streaming batches.

---

## P2: Double Down on Shuffle

Gallery shuffle got 179 clicks from one user (9+ min session). It's the stickiest feature.

- [ ] **Make shuffle more prominent on mobile** — Bigger button, above the fold
- [ ] **"Shuffle by neighborhood"** — Combine shuffle with neighborhood filter
- [ ] **Infinite shuffle mode** — Auto-advance after X seconds (like a screensaver/slideshow)
- [ ] **Share from shuffle** — Let users share a discovered photo directly to IG Stories

---

## P2: Game MVP (Daily + 1 Practice, MapLibre)

Goal: Launch a daily challenge to turn engagement into habit + sharing, then expand.

- [ ] **Game route `/game`** — Daily challenge + single practice round (unscored).
- [ ] **Map UI (MapLibre)** — Pin drop on Montreal map, score by distance.
- [ ] **D1 schema** — `daily_challenge`, `daily_guess` (anon), optional `practice_guess`.
- [ ] **Worker API** — `GET /api/game/daily`, `POST /api/game/guess`, `GET /api/game/leaderboard`.
- [ ] **Shareable score card** — Result screen with share button + deep link.
- [ ] **Practice round** — One extra play/day (no leaderboard, no streak).

---

## P2: Test Coverage (Worker + Pipelines)

- [ ] **Worker endpoint tests** — `/api/photos` id normalization, sitemap generation, search modes.
- [ ] **Pipeline smoke tests** — CLI runs with small fixtures + failure reporting.

---

## P3: Print Conversion UX

One real LinkedIn visitor entered order mode (Jan 20). Need to understand and fix the drop-off.

- [ ] **Review print order flow on mobile** — Is pricing clear? Shipping visible? Frame preview working?
- [ ] **Add print CTA on photo pages** — "Own this print" button more visible
- [ ] **Reduce friction** — Show price upfront before entering order mode
- [ ] **Social proof** — "X people viewed this photo" or "Popular in [neighborhood]"

---

## P4: Content & Growth (Instagram)

Reels are working (65% non-follower reach, 3 "Miron" searchers from one Reel).

- [ ] **Create "Miron" IG highlight** — The Miron Reel drove 3 unique searchers in 24h
- [ ] **Create "CHERCHER" highlight** — Search demos showing AI finding locations
- [ ] **Create "PRINTS" highlight** — Mockups, ordering walkthrough
- [ ] **Create "SECRETS" highlight** — Best mystery Reels saved
- [ ] **DM 5 real estate agents** — Warm leads who already follow
- [ ] **LinkedIn explorer post follow-up** — First post drove real traffic + order mode entry

---

## P5: Polish & SEO

- [ ] **Mobile QA** — Test pinch/zoom, touch interactions on iOS/Android in-app browsers
- [ ] **Share button** — Shareable deep links to search results
- [ ] **Expand geocoding** — More map pins (155 → 400+ records)
- [ ] **Neighborhood/area filter** (SQL-based, not just search)
- [ ] **Date range filter**

---

## Tech Debt (Deprioritized)

- [ ] Re-run VLM with larger model (LLaVA-7B) — deferred until revenue
- [ ] Add high-confidence OCR to D1 — deferred
- [ ] "Find similar" button (CLIP similarity)
- [ ] Favorites/collection feature
- [ ] Batch export for bulk downloads
- [ ] Branding placeholder for B2B demos

---

## Done

- [x] Deploy Next.js app — live at https://www.mtlarchives.com/
- [x] Three search modes: text, semantic, visual
- [x] 13,499 photos indexed with trust scores
- [x] BGE text embeddings + CLIP image embeddings
- [x] Shuffle button for random discovery
- [x] Photo page with viewing/ordering toggle modes
- [x] FR/EN bilingual UI
- [x] Print ordering via Stripe + Prodigi
- [x] Seline analytics events for all interactions
- [x] Mobile responsive design
- [x] SEO: Dynamic sitemap, JSON-LD, hreflang
- [x] Copy caption + download buttons
- [x] WebP optimization via Cloudflare → Vercel Image Optimization (Pro)
- [x] Seline analytics → Vercel Analytics migration
- [x] D1 cost stabilization: Cache API, offset sampling, semantic fallback, AbortController
- [x] Client memory: conditional rendering, content-visibility, fetchPriority, 20MB image cap
- [x] Instagram Reels content workflow (Claude-generated)
- [x] CTA integration in posts/stories
- [x] LinkedIn 3D explorer post (drove real traffic)

---

## Analytics Baseline (Jan 24, 2026)

All-time: 126 visits, 107 unique visitors, 724 page views, 37% bounce rate
Last 24h: 21 visits, 390 page views, 18.57 views/visit, 4m22s duration

Top sources: Direct 60%, Instagram 19%, LinkedIn 12%
Top behavior: Gallery shuffle (185), photo viewed (175), search (88)
Geography: Montreal 57%, rest of QC 24%, US 14%, International 5%
