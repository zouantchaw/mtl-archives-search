# Second-source onboarding demo (#141)

Point ingest-v1 at a **non-MTL** collection (`item_id` / `caption` / `license` / `file`). Eve/CLI chooses tools; JobStore owns jobs. The candidate index stays private until review scopes are approved. Production D1/R2/Vectorize are not written.

| Acceptance | How |
|---|---|
| Bounded source access + evidence | Adapter reads `records.jsonl` + `images/<basename>` only. `agent_permissions` / `instructions` are stripped. Path escape uses the basename inside `images/`. |
| Preview | Scope, field mapping, missing license/file, stages, estimated USD |
| Frozen policy | Missing rights, conflicts, quality failures, over-budget → review. `POLICY` is a `MappingProxyType`; the agent cannot rewrite it. |
| Review reuse | Same reason+record may reuse an allow. A new reason (conflict vs rights) does not inherit. |
| Private publish | Pilot never activates production. Publish requires JobStore approval after reviews are clear. |
| Interrupt / failures | ingest-v1 checkpoints; failed queue is visible |
| Update / remove | Same stages; tombstones for removed IDs |
| Report | Interventions, time, cost, candidate retrieval note, adapter-specific leftovers |

```sh
cd packages/scripts/src/onboard-v1
python3 -m unittest test_onboard
python3 run.py preview --input ../../../docs/onboard-v1/fixtures --out /tmp/onboard-v1
```
