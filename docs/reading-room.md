# Archive reading room

Public route: `/research?lang=fr` (default) or `/research?lang=en`.

The interface pairs a conversation with a responsive photo collection. It supports natural-language retrieval, contextual refinements, dated-record filtering, local pins, and a source drawer separating archival metadata, fresh AI observations, and unverified legacy captions. Pins and the last 12 messages are stored in this browser only. Nothing is written into the canonical photo dataset.

## Architecture

- Next.js route `/api/research` validates a bounded text conversation, reserves a daily budget in D1, and uses Vercel AI SDK `ToolLoopAgent` plus `@ai-sdk/react`.
- Explicit photo selections bind the validated canonical ID to `explainPhoto`; the model cannot switch that button action to a different tool or record. For conversational requests, the model chooses one typed tool per turn: `searchArchive`, `explainPhoto`, or `explainLimits`. Tool output renders the collection and evidence UI. Search summaries, counts, citations and historical-evidence limitations are deterministic. We deliberately do not render unconstrained model prose: live tests caught incorrect recaps of uncertain/excluded candidates and unsupported historical claims.
- Default inference is Mistral Small 3.1 24B on the existing Workers AI binding. A private OpenAI-compatible adapter at `/api/research/v1/chat/completions` supports the SDK. No Cloudflare account token is copied to Vercel. The adapter forwards JSON-schema output constraints, restricts the model and output length, and translates complete tool calls into SSE events. Responses appear when an inference step completes; this is not token-by-token provider streaming.
- `RESEARCH_PROVIDER=gateway` optionally selects Vercel AI Gateway, with `RESEARCH_MODEL` defaulting to `mistral/mistral-large-3`. The initial live Gateway experiment hit free-tier 429s under image-inspection load; it is not the production default. No GPU rental, fine-tuning, or model training is involved.
- `searchArchive` calls the existing Cloudflare smart search: canonical BGE-M3 caption/text retrieval and multilingual CLIP visual retrieval remain the underlying search systems. It requests 36 candidates, keeps up to 12 for general browsing, or inspects up to 8 for compound visual criteria. Inspections run in groups of four with independent image evidence. At most two searches/10 image inspections are allowed in one agent invocation.
- Cheap visual checks stay on Mistral Small 3.1. GPT-5.4 is used only as a query-time inspect fallback when that cheap check failed, returned `uncertain`, or the record is a reviewed sideways/document flag (A44, F12). Confident cheap `no_match` is not escalated. Fallback is routed through the Worker AI Gateway binding so Vercel does not receive a Cloudflare account token. Captions and indexes are not rewritten.
- Definite visual non-matches are removed; ambiguous or failed checks remain visibly uncertain. Successful inspections are counted separately from failed attempts. AI visual assessments are not ground truth. A 36-candidate pool can miss relevant records; the system does not exhaustively review the archive.
- Date constraints require a documented date or whole interval within the requested inclusive bounds. Unknown dates are excluded when a date filter is requested. Date bounds are ignored unless the user conversation actually mentions a year or century; model-invented default bounds must not remove undated photos. An empty date-filtered candidate set is not evidence that no matching photograph exists in the archive.
- `/api/research/image?id=...` fetches only a canonical record and a fixed R2 object origin, bounds the download to 12 MB and 100 million decoded pixels, rotates/resizes to a 900 px JPEG, and sets CDN cache headers. Large originals are omitted from this interactive view. Image failures never become fabricated captions.

## Deployment and operation

1. Apply `infrastructure/d1/migrations/0013_research_usage.sql` to D1.
2. Configure the same random `RESEARCH_API_SECRET` as a Worker secret and a Vercel server environment variable (Production, Preview, Development). Never prefix it with `NEXT_PUBLIC_`.
3. Deploy the Worker budget/inference endpoints before deploying the Next.js frontend. Existing API and image origin environment variables are reused.
4. The public endpoint allows 30 turns per IP-derived HMAC per UTC day and 300 total turns per UTC day. D1 uses atomic conditional upserts. Blocked users cannot drain the global counter; expired buckets are removed after two days. No raw IP is stored. Rejected/failed inference may consume a turn, deliberately conservatively.
5. The Worker endpoints require the shared secret. Public requests never choose a model or an arbitrary URL. Keep the origin check and request limits in place. All conversation content and archive text are untrusted.
6. Provider limits or timeouts can still yield uncertain images or an explicit error. Check `research_visual_check_failed` and `research_visual_check_fallback_failed` error names in Next logs; never log credentials or full private request bodies. Inspect fallback uses prepaid AI Gateway credits; it must not recaption the corpus.

Rollback the frontend to the preceding Vercel deployment to remove the new entry point; the additive Worker routes and D1 table can remain without affecting ordinary search. Gateway switching requires another live evaluation before use.

## Validation

```sh
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api
npm run typecheck --workspace=apps/next-app
node --import tsx --test apps/next-app/lib/research/schema.test.ts apps/next-app/lib/research/inspect-fallback.test.ts
npm run build --workspace=apps/next-app
# Live: uses .env.local, existing inference, and archive production data.
node --import tsx apps/next-app/scripts/eval-research.mjs
node apps/next-app/scripts/smoke-research.mjs http://localhost:3001
```

Set `RESEARCH_REPORT_DIR` to preserve JSON/screenshots in a chosen directory. Live evals cover women/helicopters (known positive 18557, negative male-only 17933), trees/water, unknown-date exclusion, historical-causality limitations, and canonical selected-photo inspection. Browser checks cover real search, constraint preservation, pin/reload, source links, fresh observation, Escape/focus, injected quota failure, mobile overflow, language switching, and uncaught page errors. These are a small regression set, not a dataset-wide quality score.

For a demo: search for women beside helicopters, refine the selection, pin a photo, and open its record. Show that titles/dates can remain unknown while fresh image evidence is still useful. Do not claim this interface can explain why tramways disappeared or reconstruct historical change without additional sources.
