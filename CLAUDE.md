# CLAUDE.md

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
npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo
npm run dataset-factory:smoke-v0 # Fixture contract smoke; no Cloudflare/social mutation
```

## Architecture

### Monorepo Structure
```
apps/
├── api/                # Cloudflare Worker (REST API)
│   └── src/worker.ts   # Single entry point: /api/photos, /api/search
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
8. Dataset Factory v0: ignored report artifacts → tracked registry + schemas + fixture smoke → packets, labels/adjudication, benchmark, active learning, repair, family graph, enrichment, judgments, and reward-data outputs

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
- The artifact registry is `docs/dataset-factory/artifact-registry.v0.jsonl`. It must stay machine-readable and contain stable IDs, SHA-256 digests, counts, lineage, generation commands, dependency IDs, rights boundaries, and created timestamps. Never put secrets, `.env` values, private keys, or expiring signed URLs in it.
- Use `npm run dataset-factory:smoke-v0` for clean-checkout contract coverage. It uses tracked fixtures and a local mock `/api/search`; it is not a live API quality proof.
- Use `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo` before trusting full ignored artifact coverage.

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
