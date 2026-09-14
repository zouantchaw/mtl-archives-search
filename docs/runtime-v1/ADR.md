# ADR: Eve.dev vs Cloudflare for archive operations (#140)

**Status:** accepted for the spike. Not a production migration.  
**Date:** 2026-09-14  
**Parent:** Archive Platform v2 (#135). Depends on ingest-v1 (#138). Historical #110 stays closed.

**Decision:** Cloudflare owns durable **job** state for ingest (target: Workflows + D1 receipts + existing D1/R2/Vectorize). Eve.dev owns the **operator conversation**: choosing typed tools, budgets, and human approval UX. ingest-v1 receipts are the source of truth. Do not run two orchestrators.

> Agent chooses work; tested jobs execute it; durable records hold truth.

## Current support (cited)

### Eve.dev (operator loop)

| Need | Support | Limit / caveat | Source |
|---|---|---|---|
| Agent tools | Typed `defineTool` files; approval helpers `never/once/always` | Default is `never()` — publish tools must set `always()` | [Tools](https://eve.dev/docs/tools), [HITL](https://eve.dev/docs/human-in-the-loop) |
| Durable execution | Session/turn/step; each turn is a Workflow SDK run | Completed steps do not re-run; a step interrupted mid-execution **does** re-run | [Execution model](https://eve.dev/docs/concepts/execution-model-and-durability) |
| Checkpoints | Step boundaries; experimental `modelCallsPerStep` batches replay as one unit | Batching can repeat earlier tool calls in the same step | same |
| Review pauses | Tool `approval` parks the turn with no compute | Pending approval is not an approve | [HITL](https://eve.dev/docs/human-in-the-loop) |
| Cancellation | `POST /eve/v1/session/:id/cancel`; `task_cancel` | Cancel is async; in-flight tool side effects are not rolled back | [eve channel](https://eve.dev/docs/channels/eve), [execution model](https://eve.dev/docs/concepts/execution-model-and-durability) |
| Credentials | Stay in app runtime; sandbox has no secrets | Brokering injects at the network edge | [Sandbox](https://eve.dev/docs/sandbox), [execution model](https://eve.dev/docs/concepts/execution-model-and-durability) |
| Events | Stream envelopes; duplicate delivery is not a FIFO queue | `turnPolicy: steer` cancels the active turn; completed side effects remain | [execution model](https://eve.dev/docs/concepts/execution-model-and-durability) |
| External compute | Per-session sandbox (`/workspace`) | Not a substitute for archive job orchestration or R2/D1 | [Sandbox](https://eve.dev/docs/sandbox) |
| Budgets | `limits.maxTokenCostUsdPerSession` etc. | Token cost only, not tool/infra spend | [agent config](https://eve.dev/docs/agent-config) |

Eve is a good **control surface**. It is a bad second owner of ingest checkpoints, because a replayed step can re-invoke a tool.

### Cloudflare (data plane + durable jobs)

| Primitive | Use here | Limit (Workers Paid, cited) | Not for |
|---|---|---|---|
| Workers | Existing `/api/search`, `/api/research` | CPU 5 min; 10k subrequests default | Multi-hour ingest without Workflows |
| [Workflows](https://developers.cloudflare.com/workflows/) | Long ingest: snapshot → enrich → index → wait for approval | 50k concurrent instances; 10k steps default; wait/sleep up to 1 year; step CPU 30s default / 5 min; 1 GiB instance state | Chat UX |
| Queues | Optional fan-out of per-record work | Consumer wall 15 min | Source of truth |
| D1 | Canonical records, receipts, job rows | 10 GB/db; 30s query; 2 MB row | Original images |
| R2 | Originals + derived objects | 5 TiB/object; 1 write/s per key | Job state |
| Vectorize | Candidate then live indexes | 20M vectors/index; 1536 dims | Canonical facts |
| Workers AI / AI Gateway | Cheap inspect + measured GPT-5.4 fallback | Already in production reading room | Unbounded recaption |
| Durable Objects / Agents SDK | Optional later for a live operator agent | Complements Workflows; does not replace D1/R2 | Replacing ingest-v1 receipts |

Sources: [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/), [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/), [Agents vs Workflows](https://developers.cloudflare.com/agents/concepts/workflows/).

## One authoritative owner

| Concern | Owner | Must not own |
|---|---|---|
| Job state, retries, stage receipts | **ingest-v1 JobStore** (later: Cloudflare Workflows + D1) | Eve session memory |
| Scheduling of ingest | JobStore / Workflows | Eve cron as a second scheduler |
| Approvals for publication | JobStore approval records; Eve only *collects* the human yes/no | Tool default `never()` |
| Canonical facts, originals, live indexes | Cloudflare D1 / R2 / Vectorize as today | Eve sandbox disk |
| Which tool to call next | Eve (or a human CLI) | — |

Competing orchestration is a bug: if Eve and Workflows both retry `run_pilot`, embeddings and R2 writes duplicate. The spike rejects a second orchestrator.

## Typed tools (scoped)

| Tool | Scope | Approval |
|---|---|---|
| `inspect_source` | read | no |
| `plan_import` | read | no |
| `run_pilot` | write candidate only | no |
| `validate_index` | read | no |
| `request_review` | write review | no |
| `publish` | flip local/live pointer | **yes** |

These wrap ingest-v1. They do not talk to production Vectorize unless a later, explicit publish path is added.

## Idempotency rules (tested)

- Same `(tool, job_id, idempotency_key)` returns the stored result; it does not re-run expensive work.
- Agent restart with a new session id must pass the same job idempotency key.
- Duplicate delivery while `running` returns `in_progress`.
- Replay after `completed` is a no-op.
- `publish` without an approval for that job+plan hash is denied.
- Interrupted (pending) approval is not an approve.
- `cancelled` jobs cannot publish.

These exist because Eve will re-run an interrupted step, and because cancel does not roll back side effects ([Eve execution model](https://eve.dev/docs/concepts/execution-model-and-durability)).

## Incremental migration (no wholesale replacement)

1. **Now (this spike):** JobStore + typed tools on top of local ingest-v1. Production search/game/print unchanged.
2. **Next (#141):** Eve (or CLI) calls those tools to onboard a second *fixture* source. Publish still local and approval-gated.
3. **Later:** Promote JobStore to a Cloudflare Workflow that writes D1 receipts. Keep Eve as the chat/approval UI only.
4. **Never in this ADR:** move canonical photos off R2, replace D1, recaption 14k, or run Eve as the ingest orchestrator.

Rollback: ingest-v1 already keeps prior candidate index versions. A failed Workflow step must not activate an index. Production aliases stay on the last validated Worker/Vercel pair.

Observability: `status()` JSON from ingest-v1 (costs, timings, receipts, failed queue). Eve traces are conversation telemetry, not job truth.

## Alternatives rejected

- **Eve-only jobs:** step replay can duplicate R2/Vectorize writes; sandbox is the wrong store for originals.
- **Cloudflare Agents SDK as the operator UI now:** extra surface; Eve already matches HITL/tools; revisit if we drop Eve.
- **Queues as source of truth:** at-least-once delivery; receipts still required. Queues may fan out records *inside* a Workflow.
- **Replace Vercel Next.js / Clerk / Stripe:** out of scope; they are the public site, not ingest.
