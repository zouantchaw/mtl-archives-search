# Reviewed Metrics v1

Gate H is a candidate metrics and benchmark-task contract. It reports available denominators and explicit unavailable results without coercing missing evidence to zero. Its only task candidates are the 32 independently accepted Gate G `image_mode` claims: 16 `ground_street`, five `aerial_vertical`, and 11 `aerial_oblique`. The four held pilots and the unmatched Gate E claim `c0-rpcq` emit no task.

The tracked candidate is `docs/dataset-factory/fixtures/reviewed-metrics-v1`. It contains deterministic metrics, false-precision controls, the Phase D component/split audit, historical stage/cost unavailability, criterion mapping, 32 pending task packets, and blank hash-bound task-review and coordinator-authorization templates. Every metric binds the exact relevant authority files, deterministic selection predicate, universe, included, numerator, denominator, and excluded member identities. It has `issue_complete=false`, zero reviewed tasks, zero published tasks, and no production/search mutation. Candidate verification fully rederives every file and subset from exact predecessors and checks an offline replay.

```bash
npm run dataset-factory:reviewed-metrics-verify-v1
npm run dataset-factory:reviewed-metrics-self-test-v1
npm run dataset-factory:reviewed-metrics-integration-test-v1
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:self-test --workspace=@mtl-archives/scripts
```

## External Task Review

A separately reviewed authority-only commit has added the exact coordinator authorization at `docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json` and activated `production-authorization-pin-v1.json`. The committed authorization is 3,265 bytes with SHA-256 `d66a969563878b6e02f46d965ab374cf7e186d8c518c8d62aa1e275adcd96dbc`. It permits only reviewer `sol-high-gate-h-task-reviewer:019f63c9-b9ff-7460-b541-b8b331c31021`, session `019f63c9-b9ff-7460-b541-b8b331c31021`, model `gpt-5.6-sol` at `high` reasoning effort, and output `/tmp/issue92-gate-h-publication-v1`. Coordinator `codex-gate-h-coordinator` authorized that route at `2026-07-15T03:19:01Z`. No normal Gate H command can create or alter the authorization or pin.

The designated reviewer must inspect all exact task, pixel, claim, dossier, source, component, split, rights, and metric bindings and independently author the completed receipt from `independent-task-review.template-v1.json`. The receipt must bind the exact committed authorization bytes, match the authorized reviewer route, postdate authorization, and accept all 32 tasks before publication is permitted. The candidate implementation authored neither the coordinator authorization nor a receipt, and no authoritative Gate H publication exists yet.

```bash
npm run dataset-factory:reviewed-metrics-validate-review-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --receipt /absolute/COMPLETED_TASK_REVIEW.json
npm run dataset-factory:reviewed-metrics-publish-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --receipt /absolute/COMPLETED_TASK_REVIEW.json --output /tmp/issue92-gate-h-publication-v1
npm run dataset-factory:reviewed-metrics-verify-published-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --output /tmp/issue92-gate-h-publication-v1
```

Authoritative v1 publication requires exactly 32 accepted, zero held, and zero rejected task rows. Any partial review is validatable evidence but cannot publish or set `issue_complete=true`. Publication rederives a complete final criterion matrix, hashes the exact supplied receipt bytes, and installs the commit marker last.

One-way refusal is enforced at the single authorized absolute route and basename. The same route cannot be published twice, and a different route cannot be substituted. The contract does not claim filesystem-global uniqueness outside that authorization boundary. Publication performs no network, paid-GPU, production search, or index operation.

## Tracked Publication

`docs/dataset-factory/fixtures/reviewed-metrics-publication-v1` is the byte-identical tracked import of the independently reviewed publication. Its 19-file tree is 1,005,718 bytes with SHA-256 `1e61ba2d92b6ee59f6eb6221b8274ef9a6bcbf56299274da7a5525b1e14974a1`. The final descriptor SHA-256 is `e44ca758c7d17d2256b974e714b15795a637d634eb29253a7f7ecee6347c0b93`, the completed task-review receipt SHA-256 is `422cd4d3faab3e233af0241ca11dd82cc9a26e75c0af08961698bc342b97552a`, and the authorization SHA-256 is `d66a969563878b6e02f46d965ab374cf7e186d8c518c8d62aa1e275adcd96dbc`. All 32 tasks are accepted, none are held or rejected, and `issue_complete=true`; production, search-index, and paid-GPU mutation remain false.

The tracked verifier replays the complete publication derivation against the committed authorization and receipt, checks the exact file set and bytes, and then enforces the fixed tracked envelope. It is read-only and does not relax the authorized `/tmp/issue92-gate-h-publication-v1` route used by normal review and publication commands.

```bash
npm run dataset-factory:reviewed-metrics-verify-tracked-v1
```
