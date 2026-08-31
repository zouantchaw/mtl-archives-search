# Promotion challenge preflight v1

Issue: GitHub #71. This is a bounded, offline scaffold for the period before
MTL-CityMemory-Bench v1 is locked. It is not a reranker, benchmark runner, or
promotion decision.

## Command

Run the preflight against the #70 candidate report:

```bash
npm run dataset-factory:promotion-challenge-preflight-v1
npm run dataset-factory:promotion-challenge-preflight-self-test-v1
```

The output contract is
`docs/dataset-factory/promotion-challenge-preflight-v1.schema.json`. The
default output is an ignored report under
`docs/dataset-factory/fixtures/promotion-challenge-v1/`.

## Hard boundary

Every report is permanently `decision: "no_ship"` and
`ship_authority: false`. It records zero model, GPU, production, and consumed
results. A present #70 report is checked for its fail-closed pre-lock shape,
but that shape is not treated as Benchmark v1 lock authority. A missing or
malformed candidate report is itself a blocker.

The preflight only checks wiring and names the evidence still required for a
future challenge: locked family-safe benchmark inputs; independently reviewed
support; registered baselines and candidate runs; train/validation tuning;
report-only held-out test; mechanical threshold and critical-query guardrails;
leakage; latency/cost; and feature-flag, rollback, monitoring, and operational
approval evidence. It does not run models, call GPU infrastructure, read
production, tune thresholds, or infer a result from the current v0 reranker.

## No-ship interpretation

`pass` on an input-shape or already-recorded offline check does not authorize
promotion. `blocked` means the evidence is required and absent or explicitly
false; `not_provided` means this scaffold intentionally does not manufacture
that evidence. The only safe handoff from this command is the named blocker
list and next-step checklist.
