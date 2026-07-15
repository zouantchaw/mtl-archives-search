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

A coordinator must first create a separate authorization from `reviewer-authorization.template-v1.json`, naming one exact reviewer route and the fixed production output `/tmp/issue92-gate-h-publication-v1`. A separately reviewed authority-only commit then adds that exact authorization at `docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json` and activates `production-authorization-pin-v1.json` with its complete byte hash, candidate hashes, reviewer/authority route, timestamp, forbidden principals, and output route. No normal Gate H command can create or activate those files. The current pin is unconfigured and normal validation/publication therefore fails closed.

Only the authorized reviewer may then inspect all exact task, pixel, claim, dossier, source, component, split, rights, and metric bindings and author a completed receipt. The receipt must bind the exact committed authorization bytes, match its reviewer route, and postdate authorization. This implementation creates neither a real authorization nor a receipt.

```bash
npm run dataset-factory:reviewed-metrics-validate-review-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --receipt /absolute/COMPLETED_TASK_REVIEW.json
npm run dataset-factory:reviewed-metrics-publish-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --receipt /absolute/COMPLETED_TASK_REVIEW.json --output /tmp/issue92-gate-h-publication-v1
npm run dataset-factory:reviewed-metrics-verify-published-v1 -- --authorization "$PWD/docs/dataset-factory/authorities/reviewed-metrics-v1/reviewer-authorization-v1.json" --output /tmp/issue92-gate-h-publication-v1
```

Authoritative v1 publication requires exactly 32 accepted, zero held, and zero rejected task rows. Any partial review is validatable evidence but cannot publish or set `issue_complete=true`. Publication rederives a complete final criterion matrix, hashes the exact supplied receipt bytes, and installs the commit marker last.

One-way refusal is enforced at the single authorized absolute route and basename. The same route cannot be published twice, and a different route cannot be substituted. The contract does not claim filesystem-global uniqueness outside that authorization boundary. Publication performs no network, paid-GPU, production search, or index operation.
