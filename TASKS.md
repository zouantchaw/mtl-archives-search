# Tasks

## Active product roadmap

- [ ] **Provenance Activation v1 (#123)** — define the customer, collection,
  transformation, trust boundary, offer, and acceptance evidence.
- [ ] **Dataset Factory Core v1 (#124)** — bound the reusable internal engine
  needed by the first delivery; do not turn every historical research track
  into a V1 dependency.
- [ ] **Provenance Package v1 (#125)** — specify and build the portable client
  handoff for sources, rights, claims, uncertainty, transformations, review,
  and activation readiness.
- [x] **City Memory evidence reference (#126)** — replace the weak
  property-first mockup with a dataset-led Port-to-City evidence core, a
  canonical crosswalk, a 100-record retrieval pool, ten reviewed records, and
  separate Old Port and SDC Vieux-Montréal internal-review routes.
- [ ] **City Memory Buyer Validation v2 (#127)** — complete final rights and
  sequence review, choose one recipient path, obtain explicit approval for the
  prospect and outreach materials, then test the corresponding offer without
  exposing private buyer data.

The closed issue #128 indexes deferred research and exact reopening triggers.
Historical issues #64, #69–#73, #92, #96, #97, #109, and #110 are not active
tasks and are not claimed complete. Agent-platform work has no active
replacement issue.

Current goal: turn the existing collection intelligence into one trusted,
client-sendable Provenance Activation and use approved buyer evidence to decide
what to productize next. DTC print and the public MTL Archives experience
remain operating surfaces, not the organizing principle for this roadmap.
Note: Non-code growth tasks and high-level goals live in the Logseq graph (MTL Archives Operating Plan). This file is for engineering tasks only.

Historical funnel snapshot (Feb 16, 2026): last 30d shows `page_loaded` 343 -> `order_mode_entered` 19 -> `cart_item_added` 3 -> `checkout_clicked` 2 -> `orders_completed` 0. Last 7d shows `page_loaded` 96 -> `order_mode_entered` 3 -> `cart_item_added` 1 -> `checkout_clicked` 1 -> `orders_completed` 0. Facebook was the largest referrer.

---

## Legacy engineering inventory

The sections below preserve the existing operational and technical backlog.
Their checkboxes are local engineering notes, not the current GitHub product
roadmap, and an unchecked historical issue reference does not mean that issue
is open. Promote an item into the active roadmap only through #123–#127 or an
explicitly approved successor.

## P0: Technical UX Reliability (Do First)

Deliver the best on-site user experience (especially mobile/in-app browsers) before expansion work.

### Incident: Mobile filter white-screen crash (highest priority)
- [x] **Reproduce + isolate crash path on iOS/in-app browsers** — Confirmed Arc-only white-screen repro; iPhone Safari + iOS in-app browsers validated stable (see `docs/performance/mobile-filter-crash-incident-2026-02-18.md`).
- [x] **Add crash telemetry for filter/search sessions** — Log JS runtime errors, unhandled rejections, filter-tap sequence length, and current result payload size before failure.
- [x] **Contain image/memory pressure on filter searches** — Apply mobile-safe caps to search results/images (not only shuffle), reduce concurrent image decode pressure, and prevent runaway re-renders during rapid filter taps.
- [x] **Add rapid-filter stress smoke test** — Added `npm run smoke:filters` / `npm run smoke:filters:prod` to stress discovery-filter taps and assert no fatal app error markers + tile render presence.
- [x] **Validate on real devices before release** — iPhone Safari + iOS in-app browsers validated over extended session; Arc has residual niche-browser issue tracked in incident doc.

### Mobile performance + conversion
- [x] **Diagnose mobile load time** — Baseline captured via `agent-browser` iPhone emulation (`docs/performance/mobile-load-diagnosis-2026-02-17.md`), showing photo/game route client-side render cost as the main issue.
- [x] **Review print order flow on mobile** — Added clearer mobile pricing breakdown and fulfillment/payment messaging in photo order mode + cart checkout UI.
- [x] **Mobile QA** — Executed iPhone Safari + iOS in-app browser checklist (`docs/performance/mobile-touch-qa-checklist-2026-02-18.md`) with no issues observed.
- [ ] **Social proof** — "X people viewed this photo" or "Popular in [neighborhood]".
- [x] **Reduce auth/script cost on public routes** — Clerk provider is route-scoped to `/game`, `/sign-in`, `/sign-up`; public home/photo routes no longer wrap root in Clerk.
- [x] **Ship explicit newsletter opt-in system** — Landing + game signup, D1 consent log, signed unsubscribe/resubscribe links, Resend welcome/daily sends, and Vercel cron wiring are implemented.

### Reliability + correctness
- [x] **Retry + resume ingestion** — Vectorize text + CLIP ingest now support retry/backoff, resumable checkpoints, and manual resume overrides.
- [x] **Failure reporting** — Vectorize ingest writes structured failure logs to `data/mtl_archives/.logs/*` and exits non-zero on integrity failures by default.
- [x] **Stream manifests** — Vectorize text + CLIP ingest now process manifest JSONL in streaming batches (no full-file memory load).
- [x] **Worker endpoint tests** — Added coverage for `/api/photos` id normalization + 404, `/api/sitemap` canonical IDs + TTL, and `/api/search` mode behavior (missing q, text cote fast-path, semantic configured/unconfigured, visual POST embedding).
- [x] **Pipeline smoke tests** — Added `npm run smoke:pipeline` fixture harness to validate canonicalize/normalize CLI flow and verify vectorize failure-report logging on controlled failure.
- [x] **Dataset Factory v0 durability gate (#65)** — Restored tracked Dataset Factory v0 docs/scripts; added a 76-entry, schema-validated, acyclic artifact phase graph with explicit human-decision and external-snapshot boundaries plus SHA-256/count/lineage/rights metadata; split search judgments into 3 exact entries (12 files) and quality repair into 25 exact entries (636 files); added missing-artifact, cycle, overlap, and symlink diagnostics plus strict fixed-clock tests; and made `npm run dataset-factory:smoke-v0` a fixed-clock exact-content/hash contract for packets, labels/adjudication, benchmark, active learning, search/reranker evaluation, quality repair, visual family graph, research enrichment, judgments, and reward data without copying generated report trees.
- [x] **Canonical Corpus v1 (#66)** — Added production-read-only local/D1/R2/text/CLIP inventory collectors, exact tracked 12-input snapshot lineage, independently raw-derived source/rights provenance and reversible alias groups, full corpus/reconciliation/summary consistency checks, 72 adversarial offline cases, bounded R2 sampling, individually enumerated blockers, six registry bundles, and an identity-level no-write convergence/rollback plan. Current counts and decisions are generated in `docs/dataset-factory/canonical-corpus-v1-snapshot-summary.json`.
- [x] **Gold Label Batch 002 (#68)** — Completed the 300-row corrected gold-label batch with sealed primary/blind passes, trusted adjudication, 50 post-fix audits, 49 search dispositions, completion validation, denominator-defined adjudication-change rates using the normalized adjudication-rate schema, and durable successor publication. The ignored local evidence remains `data/mtl_archives/reports/gold_label_batch_002`; the hash-bound final archive is `r2://wiel-codex-worker-cache/artifacts/mtl-archives/gold-label-batch-002/11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd.tar.gz`.
- **Deferred research history (#69; index #128)** — Added the synthetic foundation, 26-record canonical-real candidate pool, and hash-bound primary visual promotion. Direct 256px review selected 12 records (6 ground and 6 aerial/control) and retained 4 reserves. Independent visual review approved all 16 primary decisions with zero disagreements. Public source acquisition now verifies 17/17 required sources, all 12 HEAD + 4096-byte image samples, and six exact official CSV cote/source bindings. Signed Google transport is redacted and secret-scanned; the stable aerial page supports TIFF/index distribution and non-georeferenced or approximate boundaries. No historical, selected-image content, identity, geolocation, or land-use claim is promoted. The broader issue remains incomplete against dossier/benchmark targets; there is no production/search/index mutation.
- [ ] **Visual Family Graph v1 (#67)** — Draft implementation adds an 18,462-record typed leakage graph, identity-bound and streaming-capped full-corpus DCT-pHash extraction, complete linear aerial-run grouping, explicit source/CLIP/DINO contracts, component-safe splits, component-supported canonical/alternate recommendations, stratified image review, search duplicate-rate evaluation, schemas, and adversarial checks. The independent reviewer confirmed all 120 visual decisions with zero disagreements; review of the corrected leakage universe and remediation head remains the acceptance gate before this item can be marked complete.
- **Deferred research history (#70; index #128)** — Added only the versioned pre-lock candidate/preflight contract, exact input ID/hash bindings, family-component split audit, silver/stress separation, reviewed-query shortfall and human acquisition queue, frozen proposed thresholds, and deterministic adversarial tests. The benchmark is not locked or complete: current clean checkouts lack the ignored Gold Batch 002 and full graph materializations, retrieval remains 26 reviewed-gold queries versus the 100 minimum, baselines are unrecorded, and independent benchmark review is outstanding.
- **Deferred no-ship scaffold (#71; index #128)** — Added a machine-readable, fail-closed pre-lock report that binds to the #70 candidate shape, names benchmark/support/review/run/operational blockers, and permanently records `no_ship`, zero model/GPU/production runs, and no consumed results. It does not run a model or claim benchmark/promotion evidence.
- [x] **Production game smoke check** — Added `npm run smoke:game` + `npm run smoke:game:prod` guardrail for `/game` regressions.
- [x] **Add local social fallback pipeline** — `pipelines/daily-reel/main.py` now builds the daily IG carousel + FB reel package locally, with inspection artifacts, brand-readiness flags, and a `--reuse-research` rerender path for outage recovery when `spruce` is unavailable. Saved packages now rebuild the latest local public-story templates instead of freezing stale captions, and search/random runs auto-reroll until a brand-ready candidate passes or explicitly mark the strongest failed attempt for review.
- [x] **Add hardened `today` outage command** — `npm run social:today` now wraps the fallback pipeline with timezone-aware date resolution (`--timezone`, `MTL_SOCIAL_TIMEZONE`, or local system timezone), persists `resolved_timezone` in package metadata so weekday/theme selection is auditable during `spruce` outages, writes packages to `~/Downloads/mtl-daily`, and prints an operator-readable summary by default.
- [x] **Make outage command fail cleanly on Gemini network errors** — `npm run social:today` now converts raw Gemini request stack traces into a concise operator message with the resolved date/timezone and fallback guidance.
- [x] **Make Codex automations work from worktrees** — the social pipeline now loads `.env.local` / `.env` from the canonical checkout as well as the active worktree, and the story-video workspace runs through `scripts/run-tsx.mjs` so automations reuse the canonical repo's installed `tsx` instead of calling `npx` in an empty worktree.
- [x] **Add exact social usage ledger + story seed handoff** — the local pipeline now writes `data/social/publish-ledger.jsonl`, filters recent search/random candidates against that ledger, and emits `story_seed.json` so strong daily packages can be promoted into archive-linked story pages under `apps/next-app/content/stories/`.
- [x] **Add publish reconciliation + final package mirroring** — generated packages can now be reconciled against real IG/FB posts through `data/social/publish-registry.jsonl`, and registered publishes can be mirrored from Obsidian `experiments/` into `final/` so runtime state and editorial memory no longer have to guess at each other.
- [x] **Add durable Meta token bootstrap + health check** — `pipelines/daily-reel/token_manager.py` can now exchange a short-lived user token into a long-lived user token, derive the Page token, write `data/social/meta-token-state.json`, and report expiry/health so `spruce` does not depend on manually pasted Graph API Explorer tokens. The repo CLI now auto-loads `.env.local` / `.env`, so agents can run `npm run social:token-status` directly.
- [x] **Reuse durable Meta auth for history refresh + content correlation** — `npm run social:fetch-history` now falls back to `data/social/meta-token-state.json` when no explicit user token is set, and `npm run social:analyze-content` can emit dated JSON/Markdown reports that correlate Q1 post performance with content format + hook structure from `combined_posts.json`.
- **Deferred research history (#72; index #128)** — Partial local instrumentation scaffolding exists in `npm run social:analyze-cross-platform`, including explicit platform-post/package/canonical-record/visual-family/source-asset joins, canonical-manifest validation, explicit real-versus-synthetic provenance, `no_personal_data` raw-query/candidate-list rejection, report-generation capture-time labeling, exact permalink requirements for published joins, outcome boundaries, duplicate rejection, and fail-closed exploration propensity/safety-budget checks. It is not #72 complete: production instrumentation, real exports, a product cohort, durable cross-export event deduplication, causal attribution, and RL-ready policy evidence remain outstanding.
- [x] **Block unsupported exact location claims in social copy** — the fallback research layer now carries explicit location-confidence state, downgrades thin-metadata grounded guesses to broader public sector labels, and rejects any caption/reel candidate that reintroduces suppressed exact place names like unsupported street intersections.
- [x] **Replace naive carousel quadrants with contextual detail crops** — `pipelines/daily-reel/grids.py` now scores square crops against actual image texture plus light story cues, so Instagram detail slides favor contextual regions like signage, street activity, and architectural features instead of empty sky or dead edges.
- [x] **Add day-level Meta export correlation + Facebook Views mapping** — `npm run social:analyze-daily` now joins downloaded Meta daily CSV exports to `combined_posts.json`, can supplement Facebook with live Page Insights, and confirms that the Business Suite daily/monthly Facebook Views line maps to `page_media_view` rather than to summed reel `views`.
- [x] **Add Story publish CLI backed by persisted Meta auth** — `pipelines/daily-reel/story_publish.py` can now report Story publishing capabilities, upload a local Story video to public R2, publish through Instagram Story containers or Facebook Page `video_stories`, and log runs to `data/social/story-publish-log.jsonl`. The implementation intentionally surfaces the current product limitation: server-side Story publishing does not support link/poll/location stickers, so the usual clickable `DEFI DU JOUR` link sticker still requires a mobile/manual step.
- [x] **Add automated daily post publisher** — `pipelines/daily-reel/post_publish.py` publishes the normal generated package surfaces through Meta Graph: Instagram carousel slides and the Facebook Page reel. It checks package readiness, uploads media to public R2, skips already-published package/platform pairs through `data/social/publish-registry.jsonl`, logs runs to `data/social/post-publish-log.jsonl`, and registers successful live posts back into the publish registry.
- [x] **Harden social image reuse + daily game Story delivery** — `pipelines/daily-reel/social_identity.py` now builds durable archive image identities from metadata filename, image filename, cote, external URL, title/subject family, aerial-series hints, and optional local perceptual hashes. Generation and post-publish gates scan the ledger, publish registry, Story registry, and local packages to block recent exact or subject-family repeats unless intentional reuse has a different `story_angle_key` and `reuse_reason`. `npm run social:publish-game-story` now renders/reuses the daily game Story MP4, check/prepares platform delivery, and records Story date/platform idempotency in `data/social/story-registry.jsonl`.
- [x] **Restore `robots.txt` endpoint** — Added Next metadata robots route with host + sitemap output so `/robots.txt` no longer resolves to HTML 404.
- [x] **Add canonical metadata on `/game`** — Added `/game` canonical + language alternates to reduce duplicate route/indexing variants.
- [x] **Normalize escaped metadata control chars** — Worker now normalizes literal `\\n` and control-char artifacts in API text fields (photos/map/sitemap), with tests.
- [ ] **Fix rotated photo orientation consistency** — Rotation pipeline is now wired (`rotation_degrees` field + API/UI support + audit tooling), but full-dataset audit + backfill is still pending.
  - `npm run image-orientation:audit --workspace=@mtl-archives/scripts -- --input /absolute/path/to/manifest_clean.jsonl.gz --r2-domain pub-...r2.dev --write-preview-dir /absolute/path/to/reports/image_orientation_preview --write-sql /absolute/path/to/reports/image_orientation_updates.sql`
  - Temporary fallback for known bad records uses `apps/api/src/photo-orientation-overrides.ts` until DB backfill is complete.
- [ ] **Run GSC triage pass on remaining non-indexed buckets** — Prioritize `duplicate without user-selected canonical` and `discovered - currently not indexed`, then validate fixes in Search Console.
- [ ] **Add newsletter bounce/complaint webhook sync** — Ingest provider-level suppressions back into D1 so deliverability events are reflected in subscription state automatically.
- [ ] **Deploy Vercel cron env for newsletter** — Set `CRON_SECRET` and matching `NEWSLETTER_ADMIN_SECRET` on the Vercel project, then ship the Next app so `/api/cron/newsletter` starts running in production.

### Recently completed platform blockers
- [x] **Fix sitemap/photo ID mismatch** — `/api/photos` now normalizes bare IDs and `.json` IDs, sitemap/photo URLs use canonical bare IDs, and OG/Twitter photo fetches use the same normalized format.
- [x] **Stop caching expired signed R2 URLs** — Cache TTL is clamped below signed URL expiry when public R2 domain is missing (API + sitemap), with API tests covering TTL behavior.
- [x] **Centralize API base config** — Next runtime + rewrites now share one env-driven resolver (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_R2_PUBLIC_DOMAIN`) with safe local fallback.
- [x] **Prevent client hard crash on missing API env** — Runtime config now fails soft on client (same-origin fallback + explicit telemetry) instead of throwing.

---

## P1: Search Quality + Product UX

### Search/index quality pipeline
- [x] **Detect + strip borders/stamps/templates** — Added `npm run image-artifacts:audit` to detect border/template artifacts, emit crop/mask actions per image, and optionally export cleaned preview derivatives for review.
- [x] **Split document vs photo sets** — Baseline classifier/report plus index-time filtering control shipped (`search-quality:audit`, `--exclude-document-likely`, `vectorize:*:photos` commands).
- [x] **De-dup near-identicals** — Added image-level perceptual hash dedupe audit (`npm run image-dedupe:audit`) producing duplicate clusters and canonical keep/drop decisions.
- [ ] **Normalize contrast/levels** — Light auto-levels + noise reduction to stabilize CLIP features.
- [ ] **OCR cleanup** — Remove obvious scan garbage (e.g., long headers, catalog numbers) from text fields.
- [ ] **ETL quality report** — Baseline search-quality audit report + sample exports now available (`search_quality_audit.json`, document/duplicate samples); extend to full keep/remove/flag pipeline gates.

### Evaluation + measurement
- [ ] **Build a 50-100 query eval set** — seed eval set and runner now live under `experiments/autoresearch/search/`; expand beyond the initial 10-query baseline.
- **Superseded programme (#64; active scope #124)** — The broad v1 expansion was replaced by a client-delivery-bounded Dataset Factory Core. Its historical artifacts remain available; incomplete research is indexed in #128.
- [x] **Define initial success metrics** — `npm run autoresearch:search` now reports precision@1/3/5, MRR, duplicate rate, latency, and weighted score for smart-search fusion experiments.
- [ ] **Pre/post comparison** — Run eval on current index vs cleaned index (same queries).
- [ ] **Manual spot-check set** — 25 image queries + 25 text queries scored by 2 people.

### Core UX improvements
- [ ] **Share button** — Shareable deep links to search results.
- [ ] **Neighborhood landing pages** — `/quartier/ahuntsic` with pre-filtered results (SEO + shareable).
- [x] **Weak-metadata grounding tier for social selection** — the local social pipeline now adds a bounded Gemini + Google Search grounding pass for thin-metadata archive images, keeps that material in the probable/supporting lane, surfaces grounding metadata in inspection artifacts, and still relies on the brand/reroll gate when place identity remains too weak for the day’s theme. Cloud Vision web detection remains an optional future escalation, not a required dependency.
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

- **Superseded buyer-validation kit (#109; active sequence #126–#127)** — The privacy-preserving interview/proposal kit remains under `docs/city-memory-validation-v1/`; its empty ledger is intentionally `template_only` and contains no buyer evidence. The fixed $3,500 Diagnostic 001 is a versioned predecessor test, not the canonical service ladder. The active sequence requires a sendable pilot and owner-approved, preferably relationship-led outreach before a segment-appropriate offer test.
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
- [x] Issue #96 Reviewed Metrics v2 candidate contracts now cover the exact 63-row metric universe with fixed IDs/denominators, raw counts, support/provenance, reviewed-scene place precision/coverage, explicit aerial reviewability exclusions, gold-support/stop gates, prerequisite N/A rows, actual operation timing, and receipt-only cost availability. Authority activation remains a direct-child-only candidate gate. Consequential commands require distinct stage receipts, actual wall-clock windows, and durable one-use markers. Private R2 retention binds one account/dedicated bucket, HMAC-opaque keys, exact metadata and conditional versioned readback, complete domain/Worker exposure enumeration, postflight-before-issuance chronology, and verified absolute security executables. Three-process real-clock and no-network provider mocks cover replay, races, exposure, and exact AWS region/fingerprint failures. Real key/authority/prediction/gold/private evidence/score/publication remain absent.
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
- [x] V4 frontend redesign shipped for landing, search, photo detail/order mode, print gallery, checkout, order confirmation, auth shell, and game shell.
- [x] Photo page with view/order modes and visible print CTA.
- [x] FR/EN bilingual UI.
- [x] Stripe Checkout for print orders, with webhook-triggered Resend fulfillment emails and app-side CA/US shipping quotes.
- [x] Daily game MVP (Leaflet map, API, leaderboard, practice mode, share card, Clerk optional auth, mobile UX pass, shared i18n helper).
- [x] Daily newsletter system (explicit consent, welcome email, scheduled daily issue, signed unsubscribe/resubscribe, landing/game capture).

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
# Gold Label Batch 002 (#68)

- Corrected phase 1 tooling and 12 stratified, neutral-ID-only sealed packets are frozen locally.
- Next: run 300 primary visual labels and 300 independent blind labels with disjoint reviewer IDs.
- Then: adjudicate all 300 records and all 49 silver search tasks; validate class support, agreement, changes, and promotion policy.
- Do not call the batch complete or upload a final evidence bundle before those gates pass.
# Gate H2 HTTPS Broker (#99)

- [x] Implement the inactive production broker with detached Ed25519 launch authority, independently embedded trust/minimum sequence/replay state, resolve-once whole-set policy, exact peer pinning, rustls TLS 1.3 SNI/PKIX, live fsynced network milestones, full trust-root `FilePin` validation, strict HTTP/UDS framing and deadlines, safe-integer parity, sealed inherited secrets, descriptor-safe stage access, exact binary/empty retained-output joins, and terminal v1 evidence on every consumed handle or response-delivery failure.
- [x] Preserve the #98 v1 transcript and add the Ed25519 v2 authority envelope binding D1 begin/attempt, session, exact broker/runtime/root bytes, socket/token commitments, manifest, signer trust entry, events, outputs, times, and outcome. Validate emitted artifacts through the #98 production oracle.
- [x] Issue #104: add a source-pinned inactive enrollment contract that freezes verifier, D1, request-byte, endpoint/replay/report retained-descriptor, authority/launch, and exact lost-completion reconciliation identities. It blocks replacement/upsert migration bypasses and has one fail-closed production entry point; #100 still owns concrete retained-FD validation and activation.
- [x] Define a single digest-pinned hermetic builder-image contract plus truthful independent-source static ELF/rootfs/deterministic-OCI byte comparison, SBOM, and success-only provenance scripts. No builder digest or Linux result is invented or claimed by this macOS work.
- [x] Fail sticky on every post-consumption evidence append/fsync fault, withhold unsupported responses, reject invalid/nonterminal sealing, bind envelope validation to exact schema-pinned trust-entry bytes/key, hash exact canonical-LF transcript bytes, and normalize OCI modes independently of caller umask.
- [x] Close independent runtime and merge-gate review: require a terminal ACK proving prior exact stage acceptance; enforce one absolute UDS read deadline; use connected inherited production stage channels; validate exact descriptor cardinalities/sets/bounds before reads; require exactly 43 canonical signing-key bytes; commit raw output through retained FDs; export only the exact source allowlist; compile helpers twice under the pinned builder and verify/unlink/retained-FD execute them without host runtime compilation; bind replay to a privileged pre-opened append-journal inode; and keep admission/publication in one process. The publication capability contains one unlinked admission descriptor FD, one retained destination-parent directory FD, and six ordered unlinked admitted member FDs; admission closes the candidate source-directory FD before returning, and publication never consumes a source pathname or source-directory capability. Reject identity mismatch, classify only observed `EEXIST` as conflict, and retain descriptor-hash-bound durable publication state.
- [x] **Issue #100 inactive Podman supervisor contract** — Merged and complete. The retained combined relay/supervisor pin has fixed request, authorizer, and relay-liveness inputs; its synthetic tests remain production-ineligible. Real Linux/Podman conformance and admission remain exclusively #101.
- [x] **Issue #101 Packet 1 synthetic conformance contract** — Freeze the exact 69-case Linux/Podman/D1/admission universe and 71-file registered synthetic fixture `dfv0_gate_h2_linux_conformance_v1_20260806`, bound to the exact #100 predecessor commit, artifact, descriptors, and source allowlist. `npm run gate-h2:linux-conformance-fixture-verify` and `npm run gate-h2:linux-conformance-self-test` cover 69 cases and 39 exact-code adversarial rejections. Ordinary verification accepts only the synthetic/nonproduction triad; the tracked synthetic fixture under `--strict-production` fails early with `H2_LINUX_CONFORMANCE_STRICT_SYNTHETIC`. A future bundle with the required non-synthetic strict shape and metadata must still fail `H2_LINUX_CONFORMANCE_STRICT_SEMANTICS` until real per-case Linux semantic validators are implemented.
- [x] **Issue #101 Packet 2 builder-receipts contract** — Complete the local synthetic/pending/nonproduction reproducibility contract: fixture `dfv0_gate_h2_builder_receipts_v1_20260806` is exactly 4 files, 17,539 bytes, SHA-256 `c9e2b0764b1070b479836abae1c7bd2fa362ad95710e3bd02f74c23c535a6688`, with 81 ordered adversarial cases and source identity read from pinned Git objects at `4ddf00e812610e3e029059f25ad3d951577f667d`. The recipe intentionally keeps external builder image/vendor/trust/tool-artifact pins pending/null; synthetic two-build receipts/comparison exercise only the future contract, not real builds or production admission.
- [x] **Issue #101 Packet 3A builder implementation contract** — Document the local, no-secrets, pre-launch contract: Rust/Cargo `1.85.0` for Rust 2024 and Node `22.22.0`; image-owned Git/blob/archive source proof and sealed measured snapshot; exact runtime closure; rootless keep-id Podman with the restricted root proof supervisor and exact zero-capability `65532:65532` child; two independently rebuilt/admitted host helper families; Cargo-tree versus Cargo-metadata SBOM comparison; and the retained staging descriptor digest carried into container verification and host admission. This is not real Linux evidence or a completed Issue #101 build. See [`gate-h2-builder-packet-3a-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3a-v1.md).
- [x] **Issue #101 Packet 3B input-lock/receipt validation contract** — Strictly validate immutable external inputs, raw-lock joins, OCI metadata, derived runtime mappings, and the closed builder output graph. Byte-tree verification is Linux-only and descriptor-anchored; non-Linux execution fails closed. The offline materializer remains an intentional stop and no actual lock, image, build, or receipt exists yet. See [`gate-h2-builder-packet-3b-input-lock-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3b-input-lock-v1.md).
- [x] **Issue #101 Packet 3C local acquisition/materialization machinery** — Add no-credential digest-pinned HTTPS/OCI acquisition, deterministic offline runtime/rootfs/OCI materialization, exact receipt emission, and independently verified two-bundle byte comparison with explicit pending signed-host-independence status. Synthetic fixtures only; no final real lock, x86 build, host attestation, D1 action, or production admission exists. See [`gate-h2-builder-packet-3c-local-machinery-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3c-local-machinery-v1.md).
- [ ] **Issue #101 real Linux/D1 evidence and admission** — With explicit approval, choose and pin external build inputs, run independent real Linux/Podman builds, then prove real conformance/D1 admission, including `SO_PEERCRED`, mandatory sealed memfds, static linkage, sandbox flags, external TLS conformance, D1 chronology, and two-clean-source binary/rootfs/OCI byte identity. No paid host, Podman execution, D1 access or mutation, credentials, provider/model call, activation, publication, or deploy has occurred.
