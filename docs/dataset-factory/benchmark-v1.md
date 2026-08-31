# MTL-CityMemory-Bench v1 candidate foundation

Issue: GitHub #70. This document describes the pre-lock candidate contract;
it does not claim that Benchmark v1 is locked or complete.

## Contract and command

The versioned report contract is
`docs/dataset-factory/benchmark-v1-candidate.schema.json`. Generate a
preflight/candidate report with:

```bash
npm run dataset-factory:benchmark-v1-candidate
```

The generator binds the candidate to exact input artifact IDs and hashes:

- `ccv1_reconciliation_20260710` for the Canonical Corpus v1 reconciliation;
- `ccv1_visual_family_graph_20260710` for the Visual Family Graph v1, with
  split rows consumed from its `record-leakage-map-v1.jsonl` materialization;
- `dfv0_gold_label_batch_002_phase_1` for the 300-row Gold Batch 002 local
  evidence; and
- `dfv0_reviewed_metrics_v1_publication` for the tracked 32-task reviewed
  intelligence predecessor (a partial task family, not the #70 minimum); and
- `dfv0_search_judgments_v0` for the existing 75 retrieval tasks.

The local Gold Batch 002 and Visual Family Graph v1 generated trees are
repo-ignored inputs. If either is absent, the command still writes a
`preflight_blocked` report naming the exact missing locator and expected hash;
it does not reconstruct or download those artifacts. The retrieval input may
be supplied explicitly with `--retrieval-tasks /absolute/path/...` when it
exists in another local checkout.

Present inputs are not trusted merely because their paths exist. Tracked files
must match their exact expected SHA-256. Gold Batch 002 is checked member by
member against the tracked descriptor (path, byte count, and SHA-256); missing,
extra, or changed members produce `hash_mismatch` and keep the preflight blocked.

## Candidate policy

When the graph map is present, splits are inherited only from complete
connected family components. Duplicate records and any component assigned to
more than one split fail closed, and a deterministic
`candidate-splits-v1.jsonl` is emitted beside the report. Silver and stress retrieval rows remain
separate from reviewed gold and cannot contribute to official scores.

The report summarizes class, slice, and support counts. It reports the exact
reviewed-gold retrieval shortfall against the minimum of 100. The existing
retrieval predecessor has 26 reviewed-gold and 49 silver rows, so its current
shortfall is 74. The generated acquisition queue contains unreviewed slots by
documented slice; each slot requires independent human review before it can
become gold. No query, label, positive set, or model result is fabricated.

Proposed promotion thresholds are frozen in the report before any candidate
model result is read. They are a review proposal, not an authorization or a
claim of baseline/model performance. This foundation records no production
baseline and runs no model, GPU, production, or external operation.

## Current gate boundary

Every report produced by this foundation sets:

```json
{
  "lock_authority": false,
  "issue_70_complete": false
}
```

`candidate_ready` can become true only after the required local inputs,
classification/retrieval support, split audit, and separate independent
benchmark review are present. It remains false for the current clean checkout
because Gold Batch 002 and the materialized graph are absent, only 26 reviewed
retrieval queries are available, no production baselines are recorded, and an
independent benchmark reviewer has not audited the candidate.

Run deterministic contract and adversarial tests with:

```bash
npm run dataset-factory:benchmark-v1-candidate:self-test
```
