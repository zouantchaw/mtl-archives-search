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

## P0: Infra & Cost Stabilization (D1 + Images)

We are reading ~4.3M D1 rows/day. Likely sources: shuffle `ORDER BY RANDOM()`, `COUNT(*)`, `/api/map`, `/api/sitemap`, and text `LIKE` searches.

- [ ] **Add Worker Cache API for read endpoints** — `/api/photos`, `/api/map`, `/api/sitemap`
- [ ] **Replace `ORDER BY RANDOM()`** — precompute daily shuffled ID list, or random-offset sampling
- [ ] **Remove per-request `COUNT(*)`** — maintain a cached `manifest_total` value
- [ ] **FTS5 or deprecate text mode** — avoid table scan on `LIKE '%q%'`
- [ ] **Abort in-flight searches** — client should cancel pending search requests on new input
- [ ] **Ensure stable image URLs** — prefer R2 public domain over signed URLs for caching

### Client Memory (Mobile Stability)
- [ ] **Unmount hidden photo mode** — avoid keeping both view/ordering image trees alive
- [ ] **Responsive hero sizing** — use smaller thumbnail widths on mobile (no fixed 1000px)
- [ ] **Grid virtualization or content-visibility** — reduce decoded image memory on long sessions
- [ ] **Defer non-critical images** — lower fetch priority for tiles beyond first rows

---

## P1: Neighborhood Shortcuts (Analytics-Driven)

Users search: "Miron", "Portuguais", "Ahuntsic", "rue notre-dame", "Rue st Catherine". All Montreal neighborhoods/landmarks. Make this frictionless.

- [x] **One-tap neighborhood filters** — Pill/chip UI with top neighborhoods (Miron, Ahuntsic, Plateau, Villeray, Portugais, Vieux-Montréal)
- [x] **Pre-populated search suggestions** — Show popular searches on empty search state
- [ ] **Neighborhood landing pages** — `/quartier/ahuntsic` with pre-filtered results (SEO + shareable)

---

## P2: Double Down on Shuffle

Gallery shuffle got 179 clicks from one user (9+ min session). It's the stickiest feature.

- [ ] **Make shuffle more prominent on mobile** — Bigger button, above the fold
- [ ] **"Shuffle by neighborhood"** — Combine shuffle with neighborhood filter
- [ ] **Infinite shuffle mode** — Auto-advance after X seconds (like a screensaver/slideshow)
- [ ] **Share from shuffle** — Let users share a discovered photo directly to IG Stories

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
- [x] WebP optimization via Cloudflare
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
