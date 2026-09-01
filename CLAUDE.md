# CLAUDE.md

## Current product direction

Provenance Activation is the product/service, Dataset Factory is its internal
engine, MTL Archives is the reference implementation, and City Memory is the
first commercial application. The active roadmap is issues #123–#127 and is
defined in `docs/product/provenance-activation-v1.md`. Older issue references
in this file describe preserved technical contracts, not active roadmap items
or completion claims; deferred research is indexed by closed issue #128.

Do not build or activate an agent platform as part of the current roadmap.
Reopen workflow automation only after repeated manual delivery identifies a
measured bottleneck. Do not contact any City Memory prospect until the pilot,
prospect list, message, sender, channel, and follow-up boundary are explicitly
approved by the owner.

Preserve two commercial projections over one technical contract: institution
fit/activation work and place-based City Memory concept studies. Preserve the
four trust zones—client collection, private processing, human review, and
approved output—in product contracts and handoffs. Hôtel Nelligan is the pilot's
subject and a possible recipient, not an assumed first buyer. The historical
$3,500 proposal may be used only as explicitly approved, credited discovery;
it must not silently replace the service ladder or a City Memory Concept Study.

For historical Issue #69 Gate B ground research, use the
`dataset-factory:ground-authoritative-research-*-v1` scripts and
`docs/dataset-factory/ground-authoritative-research-v1.md`. This artifact is
evidence capture and pending claim drafting only, never a production or
claim-promotion surface.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Monorepo for the Montréal city archives photo search (~15k historical images), daily game, and Stripe-backed print ordering with manual fulfillment. REST API on Cloudflare Workers with D1/R2/Vectorize, a Next.js main UI (Leaflet maps + game), and a Vite/Three.js research explorer.

## Commands

```bash
# Development
npm run dev                    # Run all workspaces in dev mode
npm run typecheck              # TypeScript check all workspaces
npm run deploy                 # Deploy Worker to Cloudflare

# ETL pipeline (trust-first approach)
npm run canonicalize           # Normalize metadata → manifest_canonical.jsonl
npm run normalize-dates        # Parse dates → manifest_dated.jsonl
npm run link-records           # BGE-based record linkage → manifest_linked.jsonl
npm run vlm:tags               # Workers AI VLM structured tags
npm run ocr:run                # Tesseract OCR (Python)
npm run merge-vision           # Merge VLM + OCR → manifest_enriched_v3.jsonl
npm run score-trust            # Generate trust scores → manifest_scored.jsonl
npm run db:generate            # Generate SQL seed file

# Vectorize ingestion
npm run vectorize:text         # BGE embeddings → mtl-archives index
npm run vectorize:clip         # CLIP embeddings → mtl-archives-clip index
npm run vectorize:text:photos  # text ingest excluding document-likely records
npm run vectorize:clip:photos  # CLIP ingest excluding document-likely records
# Resume/retry controls:
#   --reset                     # ignore checkpoint and restart from index 0
#   --from-batch <n>            # resume from a specific batch index
#   --exclude-document-likely   # skip records classified as likely document scans
# Failure logs/checkpoints:
#   data/mtl_archives/.checkpoints/
#   data/mtl_archives/.logs/

# Workspace-specific
npm run dev --workspace=apps/api
npm run dev --workspace=apps/next-app
npm run social:fallback -- --date 2026-03-19 --id mtl_archives_metadata_65.json
npm run social:fallback -- --date 2026-03-19 --package-dir /absolute/path/to/package --reuse-research
npm run social:promote-story -- --package-dir /absolute/path/to/package
npm run autoresearch:search     # Evaluate smart-search fusion experiment config
npm run autoresearch:social     # Score saved daily social packages
npm run autoresearch:lambda:plan # Check Lambda Labs GPU capacity/env; does not launch
npm run dataset-factory:artifacts:check
npm run dataset-factory:artifacts:self-test
npm run dataset-factory:clock:self-test
npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo
npm run dataset-factory:smoke-v0 # Fixture contract smoke; no Cloudflare/social mutation
npm run canonical-corpus-v1:fixture-smoke # All 12 states; no credentials/network
npm run canonical-corpus-v1:self-test # 72 negative lineage/path/summary/raw-provenance cases
npm run canonical-corpus-v1:r2-sample:self-test # Bounded planner; no credentials/network
npm run canonical-corpus-v1:build
npm run canonical-corpus-v1:check
npm run dataset-factory:canonical-image-recovery-self-test-v1
npm run dataset-factory:canonical-image-recovery-impact-v1
npm run dataset-factory:canonical-image-recovery-reproduce-v1 -- /path/to/content-addressed-bundle.tar.gz
npm run dataset-factory:verified-multimodal-001
npm run dataset-factory:verified-multimodal-self-test-001
npm run city-memory:validation:self-test-v1
npm run city-memory:validation:verify-v1
npm run dev --workspace=@mtl-archives/city-memory
npm run typecheck --workspace=@mtl-archives/city-memory
npm run validate:client --workspace=@mtl-archives/city-memory
npm run build --workspace=@mtl-archives/city-memory
```

## Architecture

### Monorepo Structure
```
apps/
├── api/                # Cloudflare Worker (REST API)
│   └── src/worker.ts   # Single entry point: /api/photos, /api/search
├── city-memory/        # Standalone City Memory client reference artifact
├── next-app/           # Next.js frontend (search, Leaflet map, game, prints)
└── web/                # Research explorer (Vite + Three.js, CLIP point cloud)

packages/
├── core/               # Shared types and utilities
└── scripts/            # ETL, vectorize, VLM pipelines (tsx)

pipelines/
├── ocr/                # Python OCR scripts (Tesseract)
└── vectorize/          # Python CLIP embedding scripts
```

### Cloudflare Bindings (apps/api/wrangler.toml)
- `DB`: D1 database → `manifest` table
- `VECTORIZE`: BGE index (1024-dim semantic search)
- `VECTORIZE_CLIP`: CLIP index (512-dim visual search)
- `AI`: Workers AI for BGE embeddings
- R2 secrets for signed image URLs
- Newsletter runs are triggered by Vercel cron, not Worker cron. Keep `wrangler.toml` free of `triggers.crons` unless the account limit situation changes.

### Search Modes
| Mode | Vector Index | Embedding |
|------|--------------|-----------|
| `text` | None (SQL LIKE) | — |
| `semantic` | mtl-archives | Workers AI BGE |
| `visual` | mtl-archives-clip | HuggingFace CLIP |

### SEO URL Invariant
- Canonical photo route is `/photo/{id}` (bare ID, no `.json`).
- `/api/photos?id=` accepts both bare IDs and `.json` IDs.
- Legacy `/photo/{id}.json` URLs should redirect to canonical bare-ID routes.
- Next metadata routes should keep `/sitemap.xml` and `/robots.txt` live.
- `/game` should include canonical + language alternates to reduce duplicate indexing variants.
- Worker text metadata returned to clients should be normalized to strip escaped control chars (for example literal `\\n` artifacts).

### Data Flow
1. Source: `manifest_enriched.jsonl` (from Logseq pipeline)
2. ETL: canonicalize → dates → link-records → VLM tags + OCR → merge → trust score
3. Output: `manifest_scored.jsonl` → SQL seed → D1
4. Embeddings: BGE (text) and CLIP (images) → Vectorize indices
5. Newsletter: explicit signup from `/` or `/game` → Worker → D1 (`newsletter_*` tables) → Resend, with Vercel cron calling the Worker admin endpoint for daily sends
6. Social fallback: local machine → `pipelines/daily-reel/main.py` → Worker API + Gemini → IG carousel + FB reel package under `~/Desktop/mtl-social-fallback/YYYY-MM-DD`
7. Story promotion: `story_seed.json` from a strong social package → `pipelines/daily-reel/story_pages.py` → `apps/next-app/content/stories/*.json` → `/stories/[slug]`
8. Dataset Factory v0: ignored report artifacts → tracked registry + schemas + fixture smoke → packets, labels/adjudication, benchmark, active learning, repair, family graph, enrichment, judgments, reward-data outputs, and Gold Label Batch 002 reviewed evidence

9. Verified Multimodal Intelligence Batch 001: synthetic foundation → 26 mechanically eligible canonical-real candidates → primary 256px visual promotion with 12 selected and 4 reserves. Independent visual review approved all 16 primary decisions with zero disagreements; historical verification, dossiers, and benchmarks remain zero.
10. City Memory client path (#126–#127): internally approved visual-reference pilot → owner-approved commercial path, recipient, outreach, and versioned fixed offer → categorical ledger → fail-closed acceptance decision. The predecessor #109 template is intentionally empty and its $3,500 Diagnostic 001 remains digest-bound; `kit_ready: true` is not external evidence and `--require-acceptance` must remain failing until real buyer evidence exists.

MTL-CityMemory-Bench v1 (#70) currently has only a pre-lock candidate/preflight
foundation. `npm run dataset-factory:benchmark-v1-candidate` must keep
`lock_authority: false` and `issue_70_complete: false` until the exact graph and
Gold Batch 002 evidence are available, 100 reviewed retrieval queries exist,
and an independent benchmark review passes.

Cross-platform content analytics (`npm run social:analyze-cross-platform`) is
identity-gated and requires explicit `real_export` or `synthetic_fixture`
provenance. Supply an explicit platform-post identity map and canonical
manifest; missing joins fail closed. `no_personal_data` events cannot carry raw
queries or candidate lists; published joins require exact permalinks; and
aggregate capture is labeled as report-generation time. Product events remain
`reward_not_fact` behavior signals. Event IDs are deduplicated only within one
export; durable cross-export deduplication remains an external ingestion gate.
The contract self-test is `npm run social:analyze-cross-platform:self-test`.

## Environment

Node 23.5.0 (see `.nvmrc`). Python 3.10+ for OCR/CLIP scripts.

Secrets via `wrangler secret put`:
- R2 credentials: `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`
- Visual search: `HF_API_TOKEN` (HuggingFace)
- Newsletter:
  - `RESEND_SECRET_KEY`
  - `NEWSLETTER_TOKEN_SECRET`
  - `NEWSLETTER_ADMIN_SECRET`

Local `.env` for scripts: `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

Next app runtime env:
- `NEXT_PUBLIC_API_URL` (required in production)
- `NEXT_PUBLIC_R2_PUBLIC_DOMAIN` (preferred public asset host)
- `STRIPE_SECRET_KEY` is required for `/api/checkout`
- `STRIPE_WEBHOOK_SECRET` is required for `/api/stripe/webhook`
- `RESEND_SECRET_KEY` is required for post-payment order emails and is also used by the Worker newsletter sender.
- Print checkout currently validates Canadian and US shipping addresses in-app and computes shipping before redirecting to Stripe Checkout.
- `CRON_SECRET` protects `/api/cron/newsletter` on Vercel.
- `NEWSLETTER_ADMIN_SECRET` must match between the Vercel project and the Worker so the cron route can call `/api/newsletter/admin/run`.
- Clerk publishable/secret keys are required for production builds that include `/game`, `/sign-in`, and `/sign-up`
- Clerk client provider is scoped to auth/game routes to keep public route payload lighter.
- If `NEXT_PUBLIC_API_URL` is ever missing in a client bundle, Next app falls back to same-origin relative API paths and logs an explicit runtime error (no hard client crash).
- Smoke command for game route: `npm run smoke:game:prod`

## Frontend UX Notes

- `apps/next-app/app/globals.css` now carries the V4 Paper brand tokens (warm paper background, Spectral/Figtree/IBM Plex Mono stack, editorial card surfaces).
- Public entry now defaults to the editorial landing page on `/`; do not reintroduce random home-to-game redirects.
- Route-specific V4 surfaces exist for `/`, `/search`, `/photo/[id]`, `/print`, `/checkout`, `/order-confirmation`, `/sign-in`, `/sign-up`, and `/game`.
- Stripe Checkout now handles payment collection for prints; fulfillment remains manual after the paid order webhook fires.
- Hosted Stripe Checkout is not the shipping-pricing authority in this repo; the app validates the address and fixes the quote before redirect.
- Newsletter consent is explicit-only. Do not auto-enroll Clerk/game signups without a dedicated opt-in action and audit log entry.
- The local social fallback is the outage path for MTL Archives daily posting. It must keep the platform split intact: IG carousel, FB reel, and weekday theme as lens.
- The standard outage command is `npm run social:today`. It should resolve "today" using a real timezone (`--timezone`, `MTL_SOCIAL_TIMEZONE`, or local system timezone), write the package to `~/Downloads/mtl-daily`, record that timezone in the package metadata so the chosen weekday/theme is auditable later, print an operator-readable summary by default, and fail with a concise operator message if Gemini is unreachable.
- In fallback mode, `--reuse-research` should reuse saved evidence while rebuilding the latest local public-story templates so copy/design iteration is still possible during outages.
- Carousel detail slides should use contextual image crops, not fixed quadrants. Empty sky and dead edge crops are a bug, not a style choice.
- Reels should progressively reveal the source image via portrait panels or equivalent full-frame traversal, not sit inside one static crop for the entire video.
- Treat fallback inspection artifacts as operational signals, not decoration: if `brand_ready` or per-channel `caption_ok` is false, that package should be considered a reroll/review case rather than quietly shipped.
- Search/random fallback runs should prefer automatic reroll over silent acceptance. The final date folder should represent the first brand-ready candidate that passes; if nothing passes, the package must stay explicitly marked as review-required rather than pretending the strongest failed attempt is publishable.
- The social pipeline now writes `data/social/publish-ledger.jsonl` and persists image identity/reuse-policy decisions in generated packages. Use the ledger, `data/social/publish-registry.jsonl`, local package folders, and Story registry/log context for reuse decisions; scraped social captions alone are not authoritative enough to prevent accidental duplicate image reuse. Exact image/metadata reuse is blocked for the cooldown window, and same-subject-family variants require an intentional different `story_angle_key` plus `reuse_reason` and must pass minimum-gap/lifetime caps.
- Real publish reconciliation belongs in `data/social/publish-registry.jsonl`. Generation state and publish state are different things; do not collapse them.
- Strong packages should emit `story_seed.json`. Daily social and deeper archive-linked story pages should share that handoff object instead of rebuilding story structure from scratch later.
- Autoresearch lanes are documented in `docs/autoresearch.md`. Keep search experiments constrained to `experiments/autoresearch/search/config.json` until a winning config is promoted into Worker code, and do not let Lambda-backed VLM experiments launch GPU instances until planning, SSH selection, artifact upload, and termination have been manually tested.
- Issue #71's `dataset-factory:promotion-challenge-preflight-v1` is an offline, permanently no-ship scaffold. It may enumerate prerequisites but must not run models/GPU, inspect production, or claim Benchmark v1/promotion results.
- Weak-metadata images can escalate through a bounded grounding ladder: archive metadata first, then Gemini image understanding, then optional web-grounded visual/context lookup. If identity is still too weak for the day’s theme, reroll instead of forcing a story.
- Treat exact location labels as a higher bar than general Montreal context. If a thin record only gets a place identity from grounded search, public copy should downgrade to a broader sector label or fail reroll; it must not publish a confident intersection/building claim just because the web-grounded guess sounded plausible.
- Obsidian should stay an optional editorial mirror. Generated packages should mirror into `experiments/`; registered published packages can be mirrored into `final/`. Do not make generation depend on the vault being mounted.
- The durable Meta token flow should live outside Graph API Explorer. Bootstrap a long-lived user token once via `pipelines/daily-reel/token_manager.py`, store state in `data/social/meta-token-state.json`, and let repo or `spruce` status checks run against that file instead of depending on ad hoc browser-minted tokens. The token manager auto-loads `.env.local` / `.env`, so `npm run social:token-status` should work without manual flags in the normal local workflow.
- Codex automations run in worktrees. Do not assume the worktree contains untracked `.env.local` files or a populated `node_modules`. The repo now solves that in code: social/token paths load env from the canonical checkout, and story-video runs through `scripts/run-tsx.mjs` to reuse the canonical repo's installed `tsx`.
- Post-history refreshes should reuse that same durable Meta auth path. Prefer `npm run social:fetch-history` against `data/social/meta-token-state.json` over one-off env tokens, use `npm run social:analyze-content` for post-level pattern reports, and use `npm run social:analyze-daily` when the question is about daily Business Suite exports versus publish-day content mix.
- Be precise about Facebook Views vocabulary. Page-level daily/monthly Views come from Page Insights `page_media_view`; per-post Facebook reel `views` from `/{page-id}/video_reels` are useful but they do not recreate page-level totals by themselves.
- Autoresearch social review should pass the resolved weekday lens to `npm run social:autoresearch-shortlist -- --theme <weekday-or-theme-key>`. The command scores theme fit and preserves reuse/quality exclusions, but it remains review-only and must not publish or mutate package output.
- Story operations should use `pipelines/daily-reel/story_publish.py` against the persisted Meta token state. The repo now supports local-video -> public R2 URL -> Instagram Story container or Facebook Page `video_stories` upload -> optional live publish.
- Daily game Story operations should use `npm run social:publish-game-story -- --all --check-only` or `--prepare-only`. That wrapper reuses a valid 1080x1920 MP4, renders only when needed outside check-only mode, records prepared/published Story deliveries in `data/social/story-registry.jsonl`, and skips date/platform repeats unless `--force` is explicit. Live Story publishing requires the wrapper's `--publish` flag and explicit user approval.
- Post operations should use `pipelines/daily-reel/post_publish.py` against the persisted Meta token state. The repo supports daily-package publishing for Instagram carousel posts and Facebook Page reels, with idempotency through `data/social/publish-registry.jsonl`.
- Do not imply feature parity with manual Story posting. Server-side Story publishing does not support link, poll, or location stickers. If the creative depends on a clickable `DEFI DU JOUR` link to `/game`, that is a manual/mobile step, not something the repo can silently fake.
- Dataset Factory v0 lives under `docs/dataset-factory/` and `packages/scripts/src/dataset-factory/`. Keep large generated output under ignored `data/mtl_archives/reports/`; do not commit generated report trees.
- The Hôtel Nelligan City Memory reference lives under `apps/city-memory/`, with its evidence and release boundary under `docs/city-memory-nelligan-reference/`. Keep it standalone and static-hostable, preserve the uncommissioned/non-affiliation label, never describe conceptual Three.js massing as a measured survey, and do not add current hotel photography without explicit permission and rights review.
- The artifact registry is `docs/dataset-factory/artifact-registry.v0.jsonl`. Its 118 entries include the issue #69 synthetic pilot plus tracked candidate, primary visual-promotion, independent visual-review, and Gate H2 runtime-source descriptors; they must stay a schema-valid acyclic graph with stable IDs, SHA-256 digests, exact non-overlapping membership, lineage, explicit human decision/external acquisition boundaries, generation methods/commands, dependency IDs, rights boundaries, and created timestamps. Never put secrets, `.env` values, private keys, cursors, or expiring signed URLs in it.
- Gold Label Batch 002 for issue #68 is complete, reviewed, validated, and durably published. Keep the ignored evidence tree (`data/mtl_archives/reports/gold_label_batch_002`) distinct from the hash-bound R2 final archive (`r2://wiel-codex-worker-cache/artifacts/mtl-archives/gold-label-batch-002/11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd.tar.gz`). Completion reports must derive adjudication-change rates from the existing per-target change counts divided by the explicit 300-row denominator; do not invent counts or expose temporary URLs.
- Verified Multimodal Intelligence Batch 001 for issue #69 has a synthetic foundation, a 26-record canonical-real candidate pool, and a hash-bound primary visual promotion of 12 selected plus 4 reserves. The selected set is balanced 6 ground and 6 aerial/control. Independent visual review approved all 16 primary decisions with zero disagreements; historical verification, dossiers, and benchmarks remain zero. Run all three stages' build, self-test, verify, and integration commands. Do not claim the 60-record target is complete until reviewed dossiers, metrics, overlays, external verification, and independent review are present.
- For #69 packets, never promote a visual claim without a region, an external claim without source URL and note, an exact location without georeference evidence, or an area/distance claim without scale/georeference. Benchmark tasks must derive only from accepted externally verified claims; unresolved, rejected, metadata-only, visual-only, and inferred claims stay out.
- For #69 benchmark derivation, validate each complete packet before selecting claims, including zero-output synthetic batches. External URLs must be stable end-anchored HTTPS URLs with no query string or fragment, and metadata evidence must name a present, non-null source metadata field.
- The #69 packet contract has explicit synthetic and canonical-real variants. Run canonical AJV validation before semantic checks; keep reviewer IDs as the unique fixed-order `[primary, independent, adjudicator]` string tuple and bounding boxes as `[x_min, y_min, x_max, y_max]` percentages. Real packets require stable archive and rights provenance; never persist the hermetic real-packet self-test control as evidence.
- Derive #69 real benchmark tasks only from `pilot_reviewed` packets with unique input record IDs. Reuse Visual Family Graph v1 `deterministicSplit(component_id)` for authoritative 80/10/10 splits. AJV-validate each benchmark task before batch semantics, require unique task and `(record_id, claim_id)` identities while allowing multiple distinct claims from one dossier, and require at least three distinct control-point IDs for exact-location georeference evidence.
- The #69 `synthetic_hermetic_pilot` run report must validate all packet/task inputs itself, reject empty/duplicate/malformed/canonical-real packet sets, require four lowercase 64-character SHA-256 values and zero benchmark tasks, recompute counts/gates, and AJV-validate the final report before return.
- Run `npm run dataset-factory:artifacts:self-test` after registry/checker changes; its 14 cases must accept the regular in-root control and reject schema, containment, symlink, overlap, identity, dependency, cycle, boundary, and missing-command violations.
- Run `npm run dataset-factory:clock:self-test` after clock changes; timezone-less fixed timestamps must remain invalid.
- Use `npm run dataset-factory:smoke-v0` for clean-checkout contract coverage. It uses tracked fixtures, a fixed clock, exact content assertions, a committed tree hash, and a local mock `/api/search`; it is not a live API quality proof.
- Use `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo` before trusting full ignored artifact coverage.
- Canonical Corpus v1 lives under `packages/scripts/src/canonical-corpus-v1/` and `docs/dataset-factory/canonical-corpus-v1.md`. Live collection is production-read-only: D1 SELECT only, exact Vectorize list/get only, and R2 ListObjectsV2/HeadObject/bounded GetObject range only. Never add write commands, deploys, reindexing, metadata-index creation, or credentials to its artifacts.
- Build/check must verify the mode-specific tracked 12-input manifest before reading raw data. Do not replace the pinned live lineage with a directory scan or refresh it to accommodate drift. R2 sampling accepts only decimal integers 1-4 and must stay within 64 selected keys and 128 sample requests.
- Checker alias authority must come from verified local/D1 rows, never generated reconciliation or corpus rows. Preserve normalized source group IDs, exact reversible members, exactly one D1-backed target, full corpus/reconciliation row equality, and the local-primary provenance boundary for shared records.
- Keep the full Canonical Corpus inventories/manifests ignored under `data/mtl_archives/reports/canonical_corpus_v1/`. Refresh the tracked compact summary only through `canonical-corpus-v1:build -- --compact-summary docs/dataset-factory/canonical-corpus-v1-snapshot-summary.json` after a reviewed live capture.
- Visual Family Graph v1 lives under `packages/scripts/src/visual-family-graph-v1/` and `docs/dataset-factory/visual-family-graph-v1.md`. Keep full graph/features/review images ignored. Public API recaptures must receive a new content-derived acquisition snapshot ID; never reuse the Canonical Corpus reference ID from count equality alone.
- V1 pHash extraction must enforce the response cap while streaming and bind resumed rows to record/image, acquisition/input, feature-version, and derivative-contract identity. Every parsed authoritative aerial run must remain one component with linear edge count; never silently cap run size. `grouping_eligible` and `grouping_authoritative` are equivalent in v1. CLIP/DINO/same-subject/crop/reportage evidence cannot become grouping-authoritative without an explicit reviewed policy change and updated adversarial tests. Canonical outputs are component-supported recommendations only; never emit image deletion instructions.

## Skills

- Always reference repo-local skills from `./.agents/skills`.
- Do not use `./.skills` (deprecated).
- Installed skill examples in this repo:
  - `./.agents/skills/agent-browser`
  - `./.agents/skills/game-design-theory`
  - `./.agents/skills/game-developer`

## Code Patterns

- Worker: module syntax with typed `Env` interface
- ETL scripts: tsx with streaming JSONL processing
- VLM/OCR outputs stored in separate files, merged via `merge-vision-enrichments.ts`
- Trust scoring determines which fields are reliable for search/display

## For Wiel
For every project, write a detailed FORWIEL.md file that explains the whole project in plain language. 

Explain the technical architecture, the structure of the codebase and how the various parts are connected, the technologies used, why we made these technical decisions, and lessons I can learn from it (this should include the bugs we ran into and how we fixed them, potential pitfalls and how to avoid them in the future, new technologies used, how good engineers think and work, best practices, etc). 

It should be very engaging to read; don't make it sound like boring technical documentation/textbook. Where appropriate, use analogies and anecdotes to make it more understandable and memorable."

Make sure to keep it updated as the project evolves
# Gold Label Batch 002 Worker Rule

## Reviewed Metrics v2 Rule

Do not create or activate the issue #96 execution authority, generate a real evaluator key, run either prediction, author private expected data/gold, score, or publish from candidate work. Reviewed Metrics v2 remains candidate-only. Every consequential production command requires a fresh stage-specific coordinator receipt, actual wall-clock validation, and an `O_EXCL`, fsynced durable start/completion marker pair that rejects replay before side effects.

Gate H2 broker/runtime work lives only in `crates/gate-h2-broker`. The inactive issue #100 path uses one retained combined relay/supervisor executable pin. Its fixed inherited inputs are request, authorizer, and liveness; verifier trust is source-pinned and compiled, and the replay journal arrives inside the signed SCM_RIGHTS grant. Every canonical compact request/grant/config is authenticated and durably claimed before run-tree/process creation. Read-only mounts are fsynced supervisor-owned immutable snapshots, only explicit target FDs survive exec, and one absolute lifecycle deadline plus mandatory cleanup reserve bounds waits, walks, removal, and cleanup. Strict signed reports are required for all 12 v2.5 stages. Synthetic peers remain test-only and production-ineligible; issue #101 retains independent real-Linux/Podman evidence responsibility.

Issue #100 is merged and complete as an inactive synthetic Podman supervisor contract. Issue #101 Packets 1 and 2 remain merged historical synthetic/local contracts. Packet 3A is the approved local, no-secrets, pre-launch builder implementation contract; read [`gate-h2-builder-packet-3a-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3a-v1.md) before changing this boundary. Its actual future builder floor is Rust/Cargo `1.85.0` for Rust 2024 and Node `22.22.0`. The image-owned proof binds retained source-descriptor digest, commit/tree/archive/exact Git blobs, rejects `.gitattributes` transformations, and seals a measured snapshot. Rootless keep-id Podman proves the restricted supervisor and exact zero-capability `65532:65532` child; exactly two host helper families are independently rebuilt/admitted; Cargo tree and metadata independently derive SBOMs; disagreement fails. Packet 3B defines the strict external-input-lock/builder-receipt validators and Linux-only descriptor-anchored offline stop boundary in [`gate-h2-builder-packet-3b-input-lock-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3b-input-lock-v1.md). It has not produced an actual lock, materialized image, Linux build, or receipt. The frozen Packet 2 fixture remains historical evidence. No D1 mutation, activation, publication, production deploy, or production authority occurred.

Issue #104 adds the separate source-pinned post-begin enrollment contract under `packages/scripts/src/dataset-factory/post-begin-authority-enrollment-v1.ts`; its one production entry point derives the root itself and fails closed for the synthetic fixture. Do not add a caller-selected adapter, fetch, D1 identity, credential, path, key, socket, or journal. #100 must provide native retained-FD evidence through the coordinator-owned boundary; TypeScript labels are not capabilities.

Private retention requires exact account/endpoint identity, a dedicated bucket, secret HMAC-keyed opaque addresses, exact metadata, conditional ETag/version readback, stable HEAD, and complete pre/post domain plus Worker-binding enumeration. Receipt issue occurs only after postflight and semantic validation. Security executables use verified absolute root-owned paths, never `PATH`.

Place precision and coverage use only the opaque official-source-search task joined through Gate E acceptance, frozen source prediction, private retention, and signed finalization. Visual rows must contain zero place opportunities or links, preserve `no_pixel_identity_claim`, and cannot turn Gate E into scene support. Entity arrays are capped at 12 per row, reject quantized/IoU-near duplicates at `0.98`, and use deterministic polynomial min-cost assignment maximizing match count then integerized IoU with stable ties. Mask/geolocation remain prerequisite N/A; model/tool cost remains explicitly unavailable because no real usage receipt exists. No real trust/evaluator key, authority, route receipt, prediction, gold/private evidence, R2 write, score, publication, push, deploy, or production mutation exists. Task review must not author `private_score_passed`.

For issue #68 pixel review, read only the assigned sealed packet, instruction file, neutral templates, and referenced orientation views. Do not inspect hidden inputs, record/source/licensing fields, metadata, acquisition scores, prior labels, VLM/taxonomy, components/splits, search tasks, lineage, or another pass. Use `gold_label_review_pass_v1.0.0`; record directly observed pixels or explicit abstention only. Never add inferred, metadata, verified, identity, date, or location claims.
Packet 3C local machinery is now implemented for synthetic fixtures: digest-pinned acquisition, deterministic offline materialization, exact receipt emission, and two-bundle byte comparison. This does not claim a final real lock, x86 Linux build, signed host-independence evidence, D1 action, or production admission. See [`gate-h2-builder-packet-3c-local-machinery-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3c-local-machinery-v1.md).
