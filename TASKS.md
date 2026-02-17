# Tasks

Goal: Convert social audience (IG + FB + LinkedIn) into revenue. Validate both DTC print and B2B monetization paths.
Note: Non-code growth tasks and high-level goals live in the Logseq graph (MTL Archives Operating Plan). This file is for engineering tasks only.

Current state (Feb 16, 2026): last 30d funnel shows `page_loaded` 343 -> `order_mode_entered` 19 -> `cart_item_added` 3 -> `checkout_clicked` 2 -> `orders_completed` 0. Last 7d shows `page_loaded` 96 -> `order_mode_entered` 3 -> `cart_item_added` 1 -> `checkout_clicked` 1 -> `orders_completed` 0. Facebook remains the largest referrer.

Execution status: `47` open tasks. Completed work is consolidated in the archive section below. Active execution focus is now tech + UX first.

---

## P0: Technical UX Reliability (Do First)

Deliver the best on-site user experience (especially mobile/in-app browsers) before expansion work.

### Mobile performance + conversion
- [ ] **Diagnose mobile load time** — IG visitors are on iOS/Android in-app browser. Profile first paint speed.
- [ ] **Review print order flow on mobile** — Is pricing clear? Shipping visible? Frame preview working?
- [ ] **Mobile QA** — Test pinch/zoom, touch interactions on iOS/Android in-app browsers.
- [ ] **Social proof** — "X people viewed this photo" or "Popular in [neighborhood]".

### Reliability + correctness
- [ ] **Retry + resume ingestion** — Add retry/backoff and resumable checkpoints for Vectorize ingest (text + CLIP) so failures do not silently shrink index coverage.
- [ ] **Failure reporting** — Write per-run failure logs + summary counts to disk for auditability.
- [ ] **Stream manifests** — Avoid loading full JSONL into memory for large runs; switch to streaming batches.
- [ ] **Worker endpoint tests** — `/api/photos` id normalization, sitemap generation, search modes.
- [ ] **Pipeline smoke tests** — CLI runs with small fixtures + failure reporting.

### Recently completed platform blockers
- [x] **Fix sitemap/photo ID mismatch** — `/api/photos` now normalizes bare IDs and `.json` IDs, sitemap/photo URLs use canonical bare IDs, and OG/Twitter photo fetches use the same normalized format.
- [x] **Stop caching expired signed R2 URLs** — Cache TTL is clamped below signed URL expiry when public R2 domain is missing (API + sitemap), with API tests covering TTL behavior.
- [x] **Centralize API base config** — Next runtime + rewrites now share one env-driven resolver (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`) with safe local fallback.

---

## P1: Search Quality + Product UX

### Search/index quality pipeline
- [ ] **Detect + strip borders/stamps/templates** — Auto-crop scan borders, remove archive stamps/headers where possible.
- [ ] **Split document vs photo sets** — Classify scans into "photo" vs "document/print" and index separately.
- [ ] **De-dup near-identicals** — Perceptual hash (pHash/SSIM) to collapse repeats and protect search quality.
- [ ] **Normalize contrast/levels** — Light auto-levels + noise reduction to stabilize CLIP features.
- [ ] **OCR cleanup** — Remove obvious scan garbage (e.g., long headers, catalog numbers) from text fields.
- [ ] **ETL quality report** — Per-run counts: kept/removed/flagged, plus sample exports for manual QA.

### Evaluation + measurement
- [ ] **Build a 50-100 query eval set** — mix of place names, neighborhoods, objects, and "vibes."
- [ ] **Define success metrics** — MRR@10, nDCG@10, recall@50, plus quick human "good/bad" labels.
- [ ] **Pre/post comparison** — Run eval on current index vs cleaned index (same queries).
- [ ] **Manual spot-check set** — 25 image queries + 25 text queries scored by 2 people.

### Core UX improvements
- [ ] **Share button** — Shareable deep links to search results.
- [ ] **Neighborhood landing pages** — `/quartier/ahuntsic` with pre-filtered results (SEO + shareable).
- [ ] **Expand geocoding** — More map pins (155 -> 400+ records).
- [ ] **Neighborhood/area filter** — SQL-based, not just search.
- [ ] **Date range filter**.
- [ ] **Make shuffle more prominent on mobile** — Bigger button, above the fold.
- [ ] **Shuffle by neighborhood** — Combine shuffle with neighborhood filter.
- [ ] **Infinite shuffle mode** — Auto-advance after X seconds (like a screensaver/slideshow).
- [ ] **Share from shuffle** — Let users share a discovered photo directly to IG Stories.

---

## P2: Platform Expansion (After Core UX)

### AtoM integration discovery (phased)
New archive source is `archivesdemontreal.ica-atom.org`; ingest safely before full expansion.

- [ ] **AtoM discovery crawler (polite)** — collect browse slugs + metadata with crawl delay compliance.
- [ ] **DC/EAD fetcher** — ingest per-record exports (`;dc`, `;ead`) into local staging.
- [ ] **Normalized AtoM manifest** — build `atom_manifest.jsonl` with provenance fields.
- [ ] **Cross-linker** — match AtoM records against existing corpus (cote/title/date similarity).
- [ ] **Subset gate** — define quality and product criteria before any large-scale ingestion.

---

## P3: B2B Monetization (After UX Stabilization)

- [ ] **Add partner landing page** — `/partners` with concise value proposition, proof metrics, and booking CTA.
- [ ] **Track B2B events** — `partner_page_viewed`, `partner_cta_clicked`, `partner_form_submitted`, `partner_call_booked`.
- [ ] **Add source-aware partner attribution** — persist UTMs + referrer through partner CTA/form flow.
- [ ] **Create reusable proof payload endpoint** — serve latest headline metrics for quick embedding in partner surfaces.
- [ ] **Define event contract for outbound links** — standardized tags for LinkedIn/FB partner posts.

---

## P4: Tech Debt (Deprioritized)

- [ ] Re-run VLM with larger model (LLaVA-7B) — deferred until revenue.
- [ ] Add high-confidence OCR to D1 — deferred.
- [ ] Find similar button (CLIP similarity).
- [ ] Favorites/collection feature.
- [ ] Batch export for bulk downloads.
- [ ] Branding placeholder for B2B demos.

---

## Completed Milestones (Archive)

### Revenue + funnel groundwork
- [x] Deep-link game print CTA directly into order mode (`order=1`).
- [x] Show price before order mode in photo + game CTAs.
- [x] Clarify fulfillment upfront on order screen.
- [x] Open cart after add-to-cart in order mode.
- [x] Weekly funnel baseline instrumented (`order_mode_entered -> cart_item_added -> checkout_clicked -> order_completed`).

### Core platform + performance
- [x] Sitemap 404 fix for Clerk middleware/public routes.
- [x] D1 cost stabilization package (Cache API, offset sampling, semantic fallback, AbortController).
- [x] Vercel Image Optimization migration and 20MB image cap.
- [x] Client memory improvements (conditional rendering, `contentVisibility`, `fetchPriority`, responsive image sizing).
- [x] Semantic/session correctness pass (shareable mode, double-fetch fix, AI binding guard, smart blend/RRF).

### Product/features shipped
- [x] Main app live at `https://www.mtlarchives.com/`.
- [x] Three search modes (text, semantic, visual).
- [x] 13,499 photos indexed with trust scores.
- [x] Shuffle discovery flow.
- [x] Photo page with view/order modes and visible print CTA.
- [x] FR/EN bilingual UI.
- [x] Manual print ordering via Resend.
- [x] Daily game MVP (Leaflet map, API, leaderboard, practice mode, share card, Clerk optional auth, mobile UX pass, shared i18n helper).

### Analytics + distribution
- [x] Seline -> Vercel Analytics migration.
- [x] `/api/*` excluded from Vercel Analytics.
- [x] `search_refined` noise reduction (commit-only eventing).
- [x] IG + FB landing events tracked.
- [x] Game share links include UTMs.
- [x] Game results CTA simplification.
- [x] CTA workflow for posts/stories and LinkedIn 3D explorer post.

---

## Analytics Baseline (Jan 2026, Vercel window)

~384 visitors, ~2,252 pageviews. Mobile 59% (iOS 36.5%).
Top referrers: Facebook 155, Instagram 57, Google 8. ~40% direct/unknown.
Search CTR: 111/135 (82%). Game completion: 49/107 (46%). Game share: 1/107 (0.9%).
Geography: Montreal 57%, rest of QC 24%, US 14%, International 5%.
