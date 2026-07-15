# MTL Archives Search, In Plain Language

Issue #69 Gate B has a tracked, offline-replayable `ground-authoritative-research-v1` evidence-capture artifact for six ground records. It is explicitly non-promoting and does not create dossiers, tasks, or production changes.

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

- `docs/dataset-factory/artifact-registry.v0.jsonl` records the artifact graph, including the tracked Issue 69 candidate, visual-review, source-research, and ground-research descriptors. Use the registry checker for the current count instead of copying a volatile number into this guide.
- `docs/dataset-factory/fixtures/v0-smoke/` has tiny tracked fixture rows that let the workflow run in a clean checkout.
- `npm run dataset-factory:smoke-v0` runs the v0 chain against those fixtures and a local mock search API. It fixes the fixture clock, asserts exact rows/content, and checks a committed output hash; it proves deterministic contract wiring, not live search quality.
- `npm run dataset-factory:artifacts:self-test` exercises 14 contract/adversarial cases, including a valid in-root file, path-component symlinks, and overlapping members.
- `npm run dataset-factory:clock:self-test` proves strict timezone-qualified fixed-clock parsing under UTC and America/Toronto.
- `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /path/to/populated/repo` proves the registry still matches the real ignored artifacts.
- `npm run canonical-corpus-v1:fixture-smoke` exercises all 12 reconciliation states twice, checks exact hashes, and uses no credentials or network.
- `npm run canonical-corpus-v1:self-test` proves 72 negative lineage, path, summary, raw-provenance, alias, state, and flag cases, including coordinated refreshed-hash forgeries. `npm run canonical-corpus-v1:r2-sample:self-test` proves strict bounds and the expected 4-key fixture/54-key frozen-live plans without credentials or network.
- `npm run canonical-corpus-v1:collect -- --source all --env-file "$MTL_ARCHIVES_ENV_FILE"` captures local/D1/R2/both-Vectorize identity evidence without production writes. `canonical-corpus-v1:build` and `:check` produce and validate the ignored full reconciliation. Exact current counts and hashes live in the generated `docs/dataset-factory/canonical-corpus-v1-snapshot-summary.json`.
- `npm run dataset-factory:visual-family-self-test-v1` proves the v1 typed-edge authority, streaming pHash cap/resume identity, >250 aerial-run, component-supported recommendation, leakage-component, split, and mutable-snapshot contracts without network access. The full workflow uses bounded public thumbnails rather than transferring 169 GB of originals, gives every one of the 18,462 identities a group or explicit singleton status, and keeps similarity evidence separate from historical identity.

The lesson: if an important workflow depends on ignored files, either track the files, track a registry that proves what the files are, or track small fixtures that prove the code can still run. Here we do the last two.

## Verified Multimodal Intelligence Foundation

Issue #69 is the next, more ambitious archive-intelligence workflow: look at image regions, separate visible facts from metadata and inference, verify high-value claims against external sources, and derive benchmark/search tasks only from accepted evidence. The repo has a synthetic contract foundation plus a bounded canonical-real candidate-selection stage, but no verified historical output or final batch.

The foundation is synthetic and hermetic. Four tracked mock records exercise the two required lanes: ground OCR/entity/place and aerial land-use/georeference. They have no fictional archive URLs, no externally verified claims, and no benchmark tasks. The validator fails closed on boundary/collection mismatches, incomplete evidence or rights, exact geospatial claims without accepted structured external evidence, reviewer identity failures, and family/component split leakage. Run it with:

```bash
npm run dataset-factory:verified-multimodal-001
npm run dataset-factory:verified-multimodal-self-test-001
npm run dataset-factory:real-pilot-candidates-v1
npm run dataset-factory:real-pilot-candidates-verify-v1
npm run dataset-factory:real-pilot-candidates-integration-test-v1
npm run dataset-factory:real-pilot-promotion-v1
npm run dataset-factory:real-pilot-promotion-self-test-v1
npm run dataset-factory:real-pilot-promotion-verify-v1
npm run dataset-factory:real-pilot-promotion-integration-test-v1
npm run dataset-factory:real-pilot-independent-review-v1
npm run dataset-factory:real-pilot-independent-review-self-test-v1
npm run dataset-factory:real-pilot-independent-review-verify-v1
npm run dataset-factory:real-pilot-independent-review-integration-test-v1
```

The real-pilot selector yields 26 mechanically eligible candidates. A downstream hash-bound primary visual review selected 12 records (6 ground and 6 aerial/control) and retained 4 reserves from direct 256px review. A separate immutable independent review approved all 16 decisions with zero disagreements. Historical verification, completed dossiers, and derived benchmarks remain at zero.

## Important Boundaries

Reviewed Metrics v2 is deliberately still a sealed candidate, not a completed evaluation. A future authority-only commit may unlock one prediction only if Git proves it is the direct child of reviewed HEAD `8eb42713059622a5c94a092da5e5a2141463c85f`, changes only the fixed authority path, is otherwise clean, and carries byte-identical authority in `HEAD`, index, and worktree during a live UTC window. Completed metrics are recomputed from the exact raw prediction bytes pinned by the freeze and the exact gold bytes; task, matrix, and publication claims must validate their referenced artifacts rather than merely pin arbitrary files. Issue #97 still has to contribute at least one reviewed source-search place opportunity and an observed place result before the v2 final matrix or publication can close.

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
npm run canonical-corpus-v1:self-test
npm run canonical-corpus-v1:r2-sample:self-test
npm run canonical-corpus-v1:build
npm run canonical-corpus-v1:check
npm run dataset-factory:visual-family-self-test-v1
npm run dataset-factory:visual-family-check-v1
```

## Pitfalls To Avoid

- Silent empty outputs are dangerous. Dataset Factory scripts should fail clearly when required inputs are missing.
- A fixture smoke is not a benchmark. It protects contracts and clean-checkout reproducibility; it does not replace human-reviewed gold labels or live API evaluation.
- A registry without hashes is just a list. The SHA-256/count fields are what make the artifact contract auditable.
- A clean clone should not need a previous worker's generated report folder to run the focused smoke.
- Count equality is not snapshot equality. Visual Family Graph v1 gives its mutable public API acquisition a new content-derived ID and retains the issue-66 snapshot only as an explicit reference.
# Gold Label Batch 002

Issue #68 Gold Label Batch 002 is complete, reviewed, validated, and durably published. The ignored local evidence tree is `data/mtl_archives/reports/gold_label_batch_002`; the durable final tarball is the separate Cloudflare R2 object `r2://wiel-codex-worker-cache/artifacts/mtl-archives/gold-label-batch-002/11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd.tar.gz` with SHA-256 `11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd`. The original phase-1 packet boundary still matters for provenance: worker review used exactly 300 candidates, 12 stratified packets of 25, four orientation views per neutral row, disjoint primary/blind reviewer IDs, isolated paths, sealed pass sidecars, and trusted post-review identity mapping. Do not expose `batch/`, `inputs/`, hidden lineage, or another pass to workers.
