# Autoresearch Worktree Stabilization

Issue: #28
Date: 2026-05-27

## Commit Boundary

This stabilization groups the completed autoresearch work from issues #10 through #25 into a reviewable code/docs boundary.

Committed scope:

- Autoresearch CLI scripts under `packages/scripts/src/autoresearch/`.
- Search/social/VLM experiment configs under `experiments/autoresearch/`.
- Search API taxonomy/quality metadata wiring and D1 migration.
- Social/story tooling that is part of the reusable pipeline:
  - autoresearch shortlist generation
  - Story publishing CLI
  - post publishing CLI
  - contextual carousel crop improvements
  - location-confidence guardrails
- VLM and embedding harness improvements.
- Durable docs:
  - `docs/autoresearch.md`
  - `docs/autoresearch_embedding_experiment_plan.md`
  - README/architecture/operator notes.
- The tracked generation ledger `data/social/publish-ledger.jsonl`, because the daily social reuse guard depends on it.

Left local / generated:

- `data/social/2026-05-05*` social analysis exports.
- `data/social/autoresearch_shortlist/` generated shortlist reports.
- `data/social/autoresearch_social_report.json`.
- `data/social/post-publish-log.jsonl`.
- `data/social/publish-registry.jsonl`.
- Ignored `data/mtl_archives/reports/**` generated autoresearch reports.
- Unrelated local agent platform drafts:
  - `docs/agent-native-blueprint.md`
  - `docs/agent-platform-bootstrap.md`

## Verification Commands

Run before commit/push:

```bash
npm run typecheck --workspace=@mtl-archives/scripts
npm run typecheck --workspace=@mtl-archives/core
npm run typecheck --workspace=apps/api
npm run typecheck --workspace=apps/next-app
npm test --workspace=apps/api
npm run autoresearch:status
python3 -m py_compile pipelines/daily-reel/autoresearch_shortlist.py pipelines/daily-reel/story_publish.py pipelines/daily-reel/post_publish.py pipelines/vectorize/evaluate_embeddings.py pipelines/vlm/structured_metadata.py pipelines/vlm/caption_images_resilient.py
```

## Follow-Up Issues

- #26: turn visual collections into reviewable story/search surfaces.
- #27: iterate search ranking policy from #22 regressions.
- #29: add theme-aware autoresearch social shortlist.
