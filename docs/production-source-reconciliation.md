# Production source reconciliation (#145)

This records how live MTL Archives behavior was brought back into reviewed version control after the #136 merge deployed `main` without the reading-room source. Green preview checks alone do not prove parity with the working production deployment.

## Inventory (2026-09-13)

| Surface | Working production | `origin/main` before this branch | Local mixed WIP |
|---|---|---|---|
| Next.js | Vercel production `dpl_9YCpZVsxbQw8yxRTw7ymtLza7krx` (`mtl-archives-search-next-9whrxgmff-zouantcha.vercel.app`, created 2026-09-13 07:58 EDT). `/research` is live. | No `/research` routes. Merging #136 and deploying `main` removed the reading room; production was rolled back to the working deployment. | Uncommitted reading-room UI/API on `codex/search-canonical-repair`. |
| Worker | Canonical indexes `mtl-archives-text-canonical-20260912` and `mtl-archives-clip-canonical-20260912`. Search contract includes `rankingScore`, degraded `Cache-Control: no-store`, caption provenance, and `/api/research/*`. Current version at inventory: `a2cc8f42-0fd5-4b44-80f6-a703208a533d`. Prior serving versions: `a0e1e294-5794-4960-9ceb-704c209a05c1` (degraded-cache fix), `eed0e037-0f97-487b-97e8-6c0e9c42e361` (gap-repair cache refresh), `68ff633f-0640-4e41-b560-aec271488a77` (canonical indexes). | Still bound to legacy `mtl-archives` / `mtl-archives-clip`. No research routes. | Same live Worker source, mixed with one-off repair scripts. |
| D1 | Additive `vlm_caption_*` columns and `research_usage` already applied. | Migrations were not in git. | `0012_caption_provenance.sql`, `0013_research_usage.sql` untracked. |

Original mixed local work was snapshotted without overwrite:

- stash: `stash@{0}` on the canonical checkout (`issue-145: mixed local reading-room + canonical-repair snapshot before reconciliation`)
- branch: `wip/issue-145-mixed-local-snapshot` (`1381122`)

## What this branch lands

Intended live behavior, on top of current `main`:

- Conversational reading room (`/research`) and its Worker budget/inference adapters
- Canonical Vectorize bindings and the live smart-search contract
- Caption provenance + research-usage migrations (already applied in production)
- Print-gallery unverified-caption labels and landing-room entry point
- Canonical ingest defaults and the recorded search-repair/gap-repair runbooks

Separated and **not** in this branch:

- Draft [PR #144](https://github.com/zouantchaw/mtl-archives-search/pull/144) retrieval-pilot / vision-comparison experiment tooling
- Unrelated local WIP in `codex/mtl-local-wip-mixed` (daily-reel / dataset-factory)

Merging this branch does not promote a new caption model and does not close #139.

## Rollback

- **Frontend:** restore Vercel production deployment `dpl_9YCpZVsxbQw8yxRTw7ymtLza7krx` (the working reading-room deployment at inventory). After this branch is the production source, roll back to the previous Vercel production deployment from this merge rather than to `main` at #136.
- **Worker:** old indexes `mtl-archives` and `mtl-archives-clip` remain untouched. Immediate traffic rollback is Worker version `68ff633f-0640-4e41-b560-aec271488a77` plus restoring those index names in Wrangler before any later deploy. Do not restore a full D1 snapshot over game, payment, newsletter, or newer metadata. Caption rollback must be conditional on current values still matching the repair output.
- **Reading room only:** rolling back the frontend removes `/research`; additive Worker routes and `research_usage` can remain.

## Verification

Preview and production must both show:

1. `/research` loads (FR default, EN via `?lang=en`)
2. Search returns canonical records with images (not hydration misses)
3. Research image proxy (`/api/research/image?id=...`) serves a JPEG
4. A follow-up in the reading room preserves the prior constraint
5. Gallery, game, and print pages load; no real purchase

Commands:

```sh
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api
npm run typecheck --workspace=apps/next-app
node --import tsx --test apps/next-app/lib/research/schema.test.ts
node --test packages/scripts/src/vectorize/repair-lib.test.mjs
npm run smoke:filters:prod --workspace=apps/next-app
npm run smoke:game:prod --workspace=apps/next-app
```

Live reading-room evals (uses existing inference and production archive data):

```sh
node --import tsx apps/next-app/scripts/eval-research.mjs
node apps/next-app/scripts/smoke-research.mjs https://www.mtlarchives.com
```
