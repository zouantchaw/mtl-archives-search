# Budgeted GPU jobs (#142)

GPU is an optional JobStore tool. It is **not** on by default. A real Lambda box does not boot until the owner puts a key on Cloudflare **and** authorizes a named workload.

## Where the API key goes

**Cloudflare Worker secret**, not Vercel, not Eve, not git:

```sh
cd apps/api
npx wrangler secret put LAMBDA_API_KEY
```

The Worker is the job owner (see [runtime-v1 ADR](../runtime-v1/ADR.md)). Eve only calls tools. If the key lived on Vercel/Eve, a replayed agent step could launch a second box.

## CPU vs GPU

| Workload | Prefer | Why |
|---|---|---|
| Reading-room inspect | Workers AI + AI Gateway | Already in production |
| CLIP gap (~40 images) | Existing CPU CLIP ingest | `compareAlternatives` refuses GPU |
| Heavy vision / large backfill | Lambda `gpu_1x_a10` after admit | Only if CPU/Workers AI cannot finish |

## Launch gates

1. Versioned spec (`gpu-job-v1`): inputs, image, outputs, GPU count, budget, max duration
2. `admit()` — cheaper alternative or over-budget without owner auth → no launch
3. `live: true` requires `owner_authorized` **and** `LAMBDA_API_KEY`
4. This deploy still throws `live GPU run is not enabled` so a secret alone cannot spend
5. Sweep kills mock/live instances not owned by a `running` job (crash / timeout / lost callback)
6. Complete requires artifacts + metrics, then terminate

No paid run is recorded in this PR.
