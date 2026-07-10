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

Issues #65 and #66 made this durable and identity-explicit:

- `docs/dataset-factory/artifact-registry.v0.jsonl` records the original 76 Dataset Factory artifacts plus six Canonical Corpus source/build bundles as an 82-entry acyclic graph with stable IDs, SHA-256, counts, lineage, commands, dependencies, rights boundaries, and timestamps.
- `docs/dataset-factory/fixtures/v0-smoke/` has tiny tracked fixture rows that let the workflow run in a clean checkout.
- `npm run dataset-factory:smoke-v0` runs the v0 chain against those fixtures and a local mock search API. It fixes the fixture clock, asserts exact rows/content, and checks a committed output hash; it proves deterministic contract wiring, not live search quality.
- `npm run dataset-factory:artifacts:self-test` exercises 14 contract/adversarial cases, including a valid in-root file, path-component symlinks, and overlapping members.
- `npm run dataset-factory:clock:self-test` proves strict timezone-qualified fixed-clock parsing under UTC and America/Toronto.
- `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /path/to/populated/repo` proves the registry still matches the real ignored artifacts.
- `npm run canonical-corpus-v1:fixture-smoke` exercises all 12 reconciliation states twice, checks exact hashes, and uses no credentials or network.
- `npm run canonical-corpus-v1:collect -- --source all --env-file "$MTL_ARCHIVES_ENV_FILE"` captures local/D1/R2/both-Vectorize identity evidence without production writes. `canonical-corpus-v1:build` and `:check` produce and validate the ignored full reconciliation. Exact current counts and hashes live in the generated `docs/dataset-factory/canonical-corpus-v1-snapshot-summary.json`.

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
npm run dataset-factory:artifacts:self-test
npm run dataset-factory:clock:self-test
npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo
npm run dataset-factory:smoke-v0
npm run canonical-corpus-v1:fixture-smoke
npm run canonical-corpus-v1:build
npm run canonical-corpus-v1:check
```

## Pitfalls To Avoid

- Silent empty outputs are dangerous. Dataset Factory scripts should fail clearly when required inputs are missing.
- A fixture smoke is not a benchmark. It protects contracts and clean-checkout reproducibility; it does not replace human-reviewed gold labels or live API evaluation.
- A registry without hashes is just a list. The SHA-256/count fields are what make the artifact contract auditable.
- A clean clone should not need a previous worker's generated report folder to run the focused smoke.
