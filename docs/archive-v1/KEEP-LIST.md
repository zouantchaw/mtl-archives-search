# Keep vs archive (#161)

Written before the first large delete. Git history still has everything.

## Keep (production + live architecture)

- `apps/next-app` — site, game, print, `/research`
- `apps/api` — Worker search, photos, game, newsletter, operator jobs
- `apps/operator-agent` — Eve control surface (CF AI Gateway)
- `apps/web` — CLIP explorer (research-facing, still shipped)
- `apps/story-video` — reel renderer used by automations
- `packages/core`
- `packages/scripts/src/etl`, `vectorize`, `db`, `analysis`, `vlm`
- `packages/scripts/src/ingest-v1`, `runtime-v1`, `onboard-v1`, `retrieval-pilot-v1`, `quality-baseline-v1`
- `pipelines/ocr`, `etl`, `geocoding`, `vectorize`, `vlm`, `qa`, `daily-reel`
- `infrastructure/d1` — **all migrations stay**, including already-applied Gate H2 tables
- `data/mtl_archives`
- Docs for live contracts: architecture, reading-room, search repair, ingest/runtime/onboard/operator, vision/OCR/orientation/fallback, quality-baseline, performance

## Archive (removed from HEAD; recover from git)

- `crates/` (Gate H2 broker)
- `docs/dataset-factory/`
- `docs/city-memory-study-001/`, `docs/city-memory-validation-v1/`, `docs/product/`
- `packages/scripts/src/dataset-factory/`, `canonical-corpus-v1/`, `canonical-image-recovery-v1/`, `city-memory-*`, `visual-family-graph-v1/`, `autoresearch/`
- `experiments/`, `pipelines/sam-experiment/`, `visualization/`, root `skills/`
- Root npm scripts that only launched those packets

## Not in this PR

- Recaption / Vectorize rebuild
- GPU (#142)
- Closing deferred commercial issues #123–#127
- Deleting applied D1 migrations
