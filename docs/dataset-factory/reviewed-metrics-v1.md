# Reviewed Metrics v1

Gate H is a candidate metrics and benchmark-task contract. It reports available denominators and explicit unavailable results without coercing missing evidence to zero. Its only task candidates are the 32 independently accepted Gate G `image_mode` claims: 16 `ground_street`, five `aerial_vertical`, and 11 `aerial_oblique`. The four held pilots and the unmatched Gate E claim `c0-rpcq` emit no task.

The tracked candidate is `docs/dataset-factory/fixtures/reviewed-metrics-v1`. It contains deterministic metrics, false-precision controls, the Phase D component/split audit, historical stage/cost unavailability, criterion mapping, 32 pending task packets, and a blank hash-bound external review template. It has `issue_complete=false`, zero reviewed tasks, zero published tasks, and no production/search mutation. Candidate verification fully rederives every file from the exact Phase D and Gate E/F/G predecessors and checks an offline replay.

```bash
npm run dataset-factory:reviewed-metrics-verify-v1
npm run dataset-factory:reviewed-metrics-self-test-v1
npm run dataset-factory:reviewed-metrics-integration-test-v1
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:self-test --workspace=@mtl-archives/scripts
```

## External Task Review

A separate reviewer starts from `independent-task-review.template-v1.json`, independently inspects all exact task, pixel, claim, dossier, source, component, split, and rights bindings, and writes a completed receipt conforming to `task-review-receipt.schema.v1.json`. The task author, implementation session, and Gate G dossier reviewer are forbidden. This implementation does not create that receipt.

```bash
npm run dataset-factory:reviewed-metrics-validate-review-v1 -- --receipt /absolute/COMPLETED_TASK_REVIEW.json
npm run dataset-factory:reviewed-metrics-publish-v1 -- --receipt /absolute/COMPLETED_TASK_REVIEW.json --output /absolute/NEW_GATE_H_PUBLICATION
npm run dataset-factory:reviewed-metrics-verify-published-v1 -- --output /absolute/NEW_GATE_H_PUBLICATION
```

Publication is one-way to a new exclusively reserved directory. Accepted tasks alone are emitted in the published task set; held/rejected rows remain in the receipt. Validation rederives candidate and publication bytes, refuses changed task hashes and forbidden reviewers, and refuses a second publication. The commit marker is installed last. Publication still performs no network, paid-GPU, production search, or index operation.
