# MTL Archives Search, In Plain Language

MTL Archives Search turns a large municipal photo archive into a product people can explore, play with, learn from, and eventually buy from. The public app is the visible part: search, maps, photo pages, the daily game, newsletter signup, and print ordering. Under that is a data system that cleans archive metadata, enriches records with vision/OCR signals, builds search indexes, and now keeps evaluation/training data reproducible through Dataset Factory v0.

## How The Pieces Fit

- `apps/api` is the Cloudflare Worker. It serves `/api/photos`, `/api/search`, game routes, newsletter routes, and talks to D1, Vectorize, Workers AI, and R2.
- `apps/next-app` is the customer-facing site: landing, search, photo detail, print checkout, auth, and game UI.
- `packages/scripts` is the workshop. It contains ETL, vector ingestion, audits, autoresearch, and Dataset Factory scripts.
- `pipelines/` holds Python-heavy workflows such as OCR, CLIP experiments, and daily social packaging.
- `docs/` explains the system and now includes Dataset Factory schemas, registry, and smoke fixtures.
- `data/` is local and ignored. It can contain large manifests, reports, generated packets, and experiment outputs. Do not assume a clean clone has it.

The key engineering idea is separation of durable code from bulky generated evidence. Code, schemas, small fixtures, and reproducibility manifests are tracked. Large generated report trees stay local and ignored.

## Dataset Factory v0

Dataset Factory is the offline layer for making search quality measurable. It builds review packets, calibration labels, benchmark tasks, active-learning queues, quality-repair queues, visual-family graphs, research-enrichment packets, search judgments, and reward-data rows.

Issue #65 made this durable:

- `docs/dataset-factory/artifact-registry.v0.jsonl` records every required ignored artifact with stable ID, schema version, SHA-256, file/row counts, lineage, storage/path class, generation command, dependencies, rights boundary, and timestamp.
- `docs/dataset-factory/fixtures/v0-smoke/` has tiny tracked fixture rows that let the workflow run in a clean checkout.
- `npm run dataset-factory:smoke-v0` runs the v0 chain against those fixtures and a local mock search API. It proves contract wiring, not live search quality.
- `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /path/to/populated/repo` proves the registry still matches the real ignored artifacts.

The lesson: if an important workflow depends on ignored files, either track the files, track a registry that proves what the files are, or track small fixtures that prove the code can still run. Here we do the last two.

## Important Boundaries

- No generated report tree should be committed just because a script produced it.
- No `.env`, tokens, private keys, credentials, or signed URLs belong in docs, registries, fixtures, commits, or PR text.
- Dataset Factory smoke does not deploy, publish, mutate D1/R2/Vectorize, call paid compute, or prove production ranking quality.
- A populated local artifact root is still needed for full artifact hash verification.

## Useful Commands

```bash
npm install
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:check
npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo
npm run dataset-factory:smoke-v0
```

## Pitfalls To Avoid

- Silent empty outputs are dangerous. Dataset Factory scripts should fail clearly when required inputs are missing.
- A fixture smoke is not a benchmark. It protects contracts and clean-checkout reproducibility; it does not replace human-reviewed gold labels or live API evaluation.
- A registry without hashes is just a list. The SHA-256/count fields are what make the artifact contract auditable.
- A clean clone should not need a previous worker's generated report folder to run the focused smoke.
