# Architecture

```
Browser  →  Next.js (Vercel)  →  Cloudflare Worker
                                  ├─ D1          canonical records, game, newsletter, operator jobs
                                  ├─ Vectorize   CLIP + BGE indexes
                                  ├─ R2          original JPEGs (never overwritten)
                                  ├─ Workers AI  Mistral inspect
                                  └─ AI Gateway  GPT-5.4 inspect fallback + operator chat
```

## Product surfaces

- **Search** (`/`): visual (CLIP), text (captions), hybrid. Worker `/api/search` and `/api/photos`.
- **Photo + print**: Stripe checkout, Resend email, manual fulfillment.
- **Game**: daily location guess; D1 `daily_challenge` / `daily_guess`.
- **Reading room** (`/research`): one typed tool per turn (`searchArchive`, `explainPhoto`, `explainLimits`). Cheap inspect first; GPT-5.4 only on failed, uncertain, or flagged records. Print/taste questions browse and filter instead of object-matching. Quotas in D1. Details: [reading-room.md](reading-room.md).
- **Operator**: Eve (or curl) calls `/api/operator/v1/*`. Job state is D1, not the chat session. Publish flips an index *pointer*; it does not rewrite live captions.

## Invariants

- Archive originals stay in R2 as uploaded.
- Canonical metadata and AI observations stay separate.
- Eve does not retry ingest; the Worker JobStore does.
- GPU is optional and admitted only when CPU / Workers AI cannot do the job.

## Apps

| Path | Role |
|---|---|
| `apps/next-app` | Public site |
| `apps/api` | Worker |
| `apps/operator-agent` | Eve config (Gateway base URL) |
| `apps/web` | Optional CLIP 3D explorer (not the main product) |
| `apps/story-video` | Instagram / print stills |

Schema lives in `infrastructure/d1/migrations/`. Do not delete applied migrations.
