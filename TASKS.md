# Tasks

Goal: Convert social audience (IG + FB + LinkedIn) into revenue. Validate both DTC print and B2B monetization paths.
Note: Non-code growth tasks and high-level goals live in the Logseq graph (MTL Archives Operating Plan). This file is for engineering tasks only.

Current state (Feb 16, 2026): last 30d funnel shows `page_loaded` 343 -> `order_mode_entered` 19 -> `cart_item_added` 3 -> `checkout_clicked` 2 -> `orders_completed` 0. Last 7d shows `page_loaded` 96 -> `order_mode_entered` 3 -> `cart_item_added` 1 -> `checkout_clicked` 1 -> `orders_completed` 0. Facebook remains the largest referrer.

---

## P0: Monetization & Print Funnel (ASAP)

This is the clearest path to validating profit. Reduce steps, increase intent clarity, and measure drop‑offs.

- [x] **Deep‑link game print CTA directly into order mode** — skip the extra click (`order=1`).
- [x] **Show price before order mode** — surface "from $X" in photo + game CTAs.
- [x] **Clarify fulfillment upfront** — short copy on order screen (manual prints, turnaround).
- [ ] **Open cart after add‑to‑cart (print intent)** — reduce navigation friction when the user is in purchase mode.
- [ ] **Set a weekly baseline** — track `order_mode_entered → cart_item_added → checkout_clicked → order_completed`.

## P0: B2B Readiness (ASAP)

If DTC conversion remains low, B2B needs a clean path from social proof -> call booked.

- [ ] **Add partner landing page** — `/partners` with concise value proposition, proof metrics, and booking CTA.
- [ ] **Track B2B events** — `partner_page_viewed`, `partner_cta_clicked`, `partner_form_submitted`, `partner_call_booked`.
- [ ] **Add source-aware partner attribution** — persist UTMs + referrer through partner CTA/form flow.
- [ ] **Create reusable proof payload endpoint** — serve latest headline metrics for quick embedding in partner surfaces.
- [ ] **Define event contract for outbound links** — standardized tags for LinkedIn/FB partner posts.

## P0: Fix the Social Bounce (IG + FB)

IG and FB are the biggest acquisition channels. Their in‑app browsers are impatient, so first paint and clarity matter most.

- [ ] **Diagnose mobile load time** — IG visitors are on iOS/Android in-app browser. Profile first paint speed.
- [x] **Above-the-fold hook** — First thing IG visitors see must be compelling (not a loading spinner)
- [x] **Prominent search bar** — Analytics show engaged users immediately search. Make it unmissable on mobile.
- [x] **Quick-discovery entry point** — Show shuffle or trending photos before requiring any interaction
- [x] **Track IG + FB landings** — `instagram_visitor_landed`, `facebook_visitor_landed`

---

## P0: ETL Quality + Search Eval (High Priority)

Format artifacts are dominating embeddings. Fix the input data and prove the impact.

- [ ] **Detect + strip borders/stamps/templates** — Auto-crop scan borders, remove archive stamps/headers where possible.
- [ ] **Split document vs photo sets** — Classify scans into “photo” vs “document/print” and index separately.
- [ ] **De-dup near-identicals** — Perceptual hash (pHash/SSIM) to collapse repeats and protect search quality.
- [ ] **Normalize contrast/levels** — Light auto-levels + noise reduction to stabilize CLIP features.
- [ ] **OCR cleanup** — Remove obvious scan garbage (e.g., long headers, catalog numbers) from text fields.
- [ ] **ETL quality report** — Per-run counts: kept/removed/flagged, plus sample exports for manual QA.

**Eval / proof of impact**
- [ ] **Build a 50–100 query eval set** — mix of place names, neighborhoods, objects, and “vibes.”
- [ ] **Define success metrics** — MRR@10, nDCG@10, recall@50, plus quick human “good/bad” labels.
- [ ] **Pre/post comparison** — Run eval on current index vs cleaned index (same queries).
- [ ] **Manual spot-check set** — 25 image queries + 25 text queries scored by 2 people.

---

## P0: Core API + SEO Bugs (Worker + Next)

These block reliable indexing and create silent 404s/OG misses.

- [x] **Fix sitemap 404 (Clerk middleware blocking)** — Rename `proxy.ts` → `middleware.ts`, add `/sitemap.xml` + `/robots.txt` to public routes so Googlebot can access them.
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

## P1: AtoM Integration Discovery (Phased)

New archive source is `archivesdemontreal.ica-atom.org`; ingest safely before full expansion.

- [ ] **AtoM discovery crawler (polite)** — collect browse slugs + metadata with crawl delay compliance.
- [ ] **DC/EAD fetcher** — ingest per-record exports (`;dc`, `;ead`) into local staging.
- [ ] **Normalized AtoM manifest** — build `atom_manifest.jsonl` with provenance fields.
- [ ] **Cross-linker** — match AtoM records against existing corpus (cote/title/date similarity).
- [ ] **Subset gate** — define quality and product criteria before any large-scale ingestion.

---

## P2: Double Down on Shuffle

Gallery shuffle got 179 clicks from one user (9+ min session). It's the stickiest feature.

- [ ] **Make shuffle more prominent on mobile** — Bigger button, above the fold
- [ ] **"Shuffle by neighborhood"** — Combine shuffle with neighborhood filter
- [ ] **Infinite shuffle mode** — Auto-advance after X seconds (like a screensaver/slideshow)
- [ ] **Share from shuffle** — Let users share a discovered photo directly to IG Stories

---

## P2: Game MVP (Daily + 1 Practice, Leaflet)

Goal: Launch a daily challenge to turn engagement into habit + sharing, then expand.

- [x] **Game route `/game`** — Daily challenge + single practice round (unscored).
- [x] **Map UI (Leaflet)** — Pin drop on Montreal map, score by distance.
- [x] **D1 schema** — `daily_challenge`, `daily_guess` (anon), optional `practice_guess`.
- [x] **Worker API** — `GET /api/game/daily`, `POST /api/game/guess`, `GET /api/game/leaderboard`.
- [x] **Shareable score card** — Result screen with share button + deep link.
- [x] **Practice round** — One extra play/day (no leaderboard, no streak).
- [x] **Localize game UI (FR/EN)** — honor `lang` query param for all labels.
- [x] **Clerk auth (optional)** — sign-in/up routes + save streak when signed in.
- [x] **Clerk identity first** — signed-in guesses stored by `user_id`, anon only as fallback.
- [x] **Mobile-first game UX pass** — sticky CTA, cards, and refined map styling for touch.
- [x] **Shared i18n helper** — centralize `lang` parsing + links across app + game.

---

## P2: Test Coverage (Worker + Pipelines)

- [ ] **Worker endpoint tests** — `/api/photos` id normalization, sitemap generation, search modes.
- [ ] **Pipeline smoke tests** — CLI runs with small fixtures + failure reporting.

---

## P3: Print Conversion UX

We have order mode entries but zero print sales. Need to understand and fix the drop-off.

- [ ] **Review print order flow on mobile** — Is pricing clear? Shipping visible? Frame preview working?
- [x] **Add print CTA on photo pages** — "Own this print" button more visible
- [ ] **Social proof** — "X people viewed this photo" or "Popular in [neighborhood]"

---

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
- [x] Print ordering via Resend email (manual fulfillment)
- [x] Seline analytics events for all interactions
- [x] Mobile responsive design
- [x] SEO: Dynamic sitemap, JSON-LD, hreflang
- [x] Copy caption + download buttons
- [x] WebP optimization via Cloudflare → Vercel Image Optimization (Pro)
- [x] Seline analytics → Vercel Analytics migration
- [x] Exclude `/api/*` from Vercel Analytics
- [x] Reduce `search_refined` noise (only on committed searches)
- [x] D1 cost stabilization: Cache API, offset sampling, semantic fallback, AbortController
- [x] Client memory: conditional rendering, content-visibility, fetchPriority, 20MB image cap
- [x] Instagram Reels content workflow (Claude-generated)
- [x] CTA integration in posts/stories
- [x] LinkedIn 3D explorer post (drove real traffic)
- [x] Game results CTAs simplified (single sign‑in primary)
- [x] Game share links include UTMs
- [x] Game print CTA deep‑links into order mode

---

## Analytics Baseline (Jan 2026, Vercel window)

~384 visitors, ~2,252 pageviews. Mobile 59% (iOS 36.5%).
Top referrers: Facebook 155, Instagram 57, Google 8. ~40% direct/unknown.
Search CTR: 111/135 (82%). Game completion: 49/107 (46%). Game share: 1/107 (0.9%).
Geography: Montreal 57%, rest of QC 24%, US 14%, International 5%
