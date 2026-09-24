# Architecture

```
Browser  →  Next.js (Vercel)  →  Cloudflare Worker
                                  ├─ D1          canonical records, game, newsletter, operator jobs, provenance packages
                                  ├─ Vectorize   CLIP + BGE indexes
                                  ├─ R2          original JPEGs (never overwritten)
                                  ├─ Workers AI  Mistral inspect
                                  └─ AI Gateway  GPT-5.4 inspect fallback + operator chat
```

## Product surfaces

- **Search** (`/`): visual (CLIP), text (captions), hybrid. Worker `/api/search` and `/api/photos`.
- **Photo + print**: Stripe checkout, Resend email, manual fulfillment.
- **Stories** (`/stories`, `/stories/[slug]`, `/links`): archive-led editorial pages served from the Stories D1 database. They use the same public navigation, cart, typography, and visual tokens as Search, Game, and Prints.
- **Game**: daily location guess; D1 `daily_challenge` / `daily_guess`.
- **Reading room** (`/research`): one typed tool per turn. Search fills a wall of up to 12 photographs; inspect labels objects without emptying the grid. Taste questions curate city prints. Pins share via `?c=` and print via `/print?ids=`. **Save as package** writes a D1 provenance package and opens `/package/{id}` — sources, claims, unknowns, assembler review. `client-ok` is not City certification. Details: [reading-room.md](reading-room.md).
- **Operator**: Eve (or curl) calls `/api/operator/v1/*`. Job state is D1, not the chat session. Publish flips an index *pointer*; it does not rewrite live captions.
- **Provenance packages**: `POST /api/packages` (secret) snapshots selected record ids + intended use. `GET /api/packages/:id` is the unguessable public handoff. Review is `POST /api/packages/:id/review`. Layers are assembled from live D1; captions are not rewritten.

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
| `apps/web` | Optional snapshot explorer with sparse vector-similarity webs and a device-local Collection sheet. Shared `/api/search` (`mode=smart` by default). Map proximity is model similarity, not geography. Versioned R2 snapshot refreshed from the canonical visual index and D1 on September 24, 2026 (13,499 records); Smart/Visual search remains live. See [explorer-modernization.md](explorer-modernization.md). |
| `apps/story-video` | Instagram / print stills |

Schema lives in `infrastructure/d1/migrations/`. Do not delete applied migrations.
