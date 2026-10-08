# Cloudflare operations

The migration branch uses Node 24, Next 16.3.8, OpenNext 1.20.9 and Wrangler 4.148.0. Keep the framework and adapter compatible: a successful framework build alone does not establish SSR compatibility. Run commands from the repository root unless stated otherwise. Never deploy the unrelated, dirty local checkout over production.

## Resource map

| Surface | Worker | State and services |
|---|---|---|
| Site, game, prints, reading room, packages | `mtl-archives-site` | Assets, Images, `mtl-archives-site-cache` R2, `DOQueueHandler` / `DOShardedTagCache`, Analytics Engine `mtl_archives_site_events`, native `EMAIL`, `mtl-archives-mail` D1 |
| Public API, newsletter, operator jobs | `mtl-archives-worker` | Existing `mtl-archives` D1, `mtl-stories` D1, canonical CLIP/text Vectorize indexes, Workers AI, AI Gateway; native `EMAIL` and the same mail evidence D1 |
| Snapshot Explorer | `mtl-archives-explorer` | Static assets and fixed R2 snapshot/PDF proxy; existing API, browser-local collections and layouts |
| Private camera reviewer | `mtl-archives-research-reviewer` | Existing Cloudflare Access owner policy, research catalog, private source/derived R2, assistance queue, Images and AI |
| Private bulk camera transfer | `mtl-archives-research-transfer` | Existing bearer protection, catalog and private source/derived R2 |

The API origin is `https://api.mtlarchives.com`. The site uses its `ARCHIVE_API` service binding for same-origin proxies and server-side archive/research/newsletter requests; browser clients, video scripts and the daily-reel pipeline use the public API domain. Static build generation can fetch that same public origin outside the Worker request context. New newsletter unsubscribe/resubscribe links use the API domain.

The private reviewer uses `https://reviewer.mtlarchives.com`; transfer uses `https://transfer.mtlarchives.com`. These Custom Domains point to the existing Workers, retaining their bindings/state. The reviewer retains its Access application/audience and owner policy. Both private services have workers.dev and preview URLs disabled in live settings and generated deployment sources. Their deployment authority is the separate research-data checkout and runbooks; do not deploy them from this main site checkout or rewrite frozen execution evidence.

Clerk provides game identity; Stripe processes payments. MapLibre uses OpenFreeMap. These external services retain their existing product roles. R2 archive originals and canonical index identities are preserved.

## Deploy

```bash
npm ci
npm run build --workspace=packages/core
npm run test --workspace=apps/api
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/web
npm run build:cloudflare --workspace=apps/next-app
# Deploy an already-built site from the repository root:
npm run deploy:cloudflare:built --workspace=apps/next-app
```

The site `deploy:cloudflare` script builds and deploys in one command. Use `deploy:cloudflare:built` after a separate build, including Cloudflare Builds: OpenNext populates the remote R2 cache before deploying the Worker. Direct Wrangler deployment skips that cache preparation. Explorer `deploy:cloudflare` separately builds with the same-origin `/snapshot` base and deploys its own Worker. The root `deploy` command remains API-only. The root Wrangler is pinned to the same current version so the ordinary API and Explorer scripts support the native email binding. Do not put credentials in Git, shell command arguments, logs or ordinary notes.

Site secrets include Clerk, Stripe, research/admin and cron authentication values. Existing public API/R2 URLs are configured in Wrangler. Set secret values with Wrangler's secret store or a restricted temporary bulk JSON file; remove temporary files after rollback preparation. API secrets and private research surface credentials remain scoped to their existing Workers. `RESEND_SECRET_KEY` is obsolete once the migration's production acceptance and rollback steps finish.

The candidate domains are `migration.mtlarchives.com` and `explorer-migration.mtlarchives.com`. Public `www.mtlarchives.com`, apex and `explorer.mtlarchives.com` routing, newsletter activation, deployment automation and scoped Vercel retirement are gated on migration acceptance; consult the dated migration ledger for their actual state. The apex wrapper preserves the existing 307 redirect to www, including path and query. Main and Explorer workers.dev and preview URLs are explicitly disabled.

The API's old workers.dev hostname is a documented compatibility transition, with previews disabled. The old live Vercel frontend still calls it until frontend retirement. Previously sent newsletter action links also use it, and their signed tokens have no expiry. Do not silently break those links: the dated ledger records the user's pending choice of limited legacy redirects versus a deliberate cutoff. After all callers and this disposition are resolved, persist `workers_dev = false` in the API's production configuration and verify old ingress is disabled. No normal new caller should use the old hostname.

## Caching and images

R2 stores the incremental cache; the queue Durable Object handles time-based revalidation. Sharded tag caching uses one base shard and no regional cache. Preserve Durable Object migration history. Do not delete either class or cache bucket during routine deployment. `/api/revalidate` requires its dedicated secret when enabled; that secret was absent from the previous production environment.

Image rotation preserves original bytes for zero rotation and uses Images for other angles. Reading-room inspection fetches only canonical R2 keys, blocks redirects, caps originals at 12 MB and emits JPEG within 900×900. Archive originals are never rewritten. Non-2xx source responses fail closed. Generated Open Graph images run under the supported Node compatibility runtime.

## Analytics

The same-origin `/api/events` route records bounded event counters and approved dimensions in Analytics Engine. It omits search text, user identifiers, order IDs and cookies; package paths redact their identifier. Verify stored events through the Analytics SQL API using the dataset `events.analyticsEngine.mtl_archives_site_events`, an account scope and a lower time bound. For example, select `blob1 AS event, COUNT(*) AS samples`, group by `blob1` and limit the result. The migration acceptance query confirmed page views, search/photo interactions, print intent and game events in the dataset.

## Scheduled work

The site scheduled handler calls its own authenticated newsletter route. The intended cron is `5 * * * *`; the route retains the Toronto 07:00 gate and the API's D1 run lock. Disable the scoped Vercel newsletter cron before enabling the Cloudflare trigger, then verify the actual schedules. The existing API `0 13,14 * * *` stories watchdog is independent and must remain unchanged. A non-2xx scheduled response is logged as a failure.

## Mail acceptance, failures and replay

Native sending uses `support@support.mtlarchives.com`. Preserve existing inbound MX and root authentication records; Cloudflare sending has its own bounce, SPF and DKIM records under support. The sender binding restricts allowed sender addresses. Cloudflare Email Routing alone is not the transactional sender.

Apply `infrastructure/d1/mail-schema.sql` to the dedicated `mtl-archives-mail` database before deploying consumers. `mail_delivery` stores keys, payload digests, acceptance IDs and attempt state, with no recipients or message bodies. Order customer/admin keys are independent; newsletter keys identify subscription episode or issue date. HTML and plain text use the existing template functions. Historical `newsletter_email_log.resend_email_id` is retained as a schema field and now stores the native acceptance ID; historical rows are not rewritten.

- `accepted`: provider accepted the message; replay returns the recorded ID without another send.
- `sending`: a bounded lease owns the attempt. Concurrent requests do not submit another message.
- `rejected`: a definite provider rejection permits a bounded retry, up to three attempts.
- `review_required`: unknown provider outcome, expired lease or uncertain acceptance persistence. Reconcile with provider evidence before any retry; never fall back blindly to another sender.

Keep provider acceptance distinct from delivered/bounced status. The current account dashboard's activity and actual inbox evidence are the operational checks; this app did not previously consume Resend delivery webhooks. Six durable-delivery tests cover concurrent sends, accepted replay, rejected retry limits, unknown outcomes, expired leases and persistence failure after acceptance. Print webhook session metadata is marked complete only after both messages succeed.

## Rollback and retirement

The production source before migration is `d53cfbbe6ff69feae615cddb3095b734df4563f2`; the dated ledger records its immutable Vercel deployments and original DNS export. Keep a recoverable source/build and restricted credential backup before removing scoped deployments. During rollback, use one newsletter scheduler and one outbound sender per flow. Reconcile native acceptance evidence before replaying order events through an older provider.

Validate main journeys, image processing, authenticated/private boundaries, mobile layout, owned-inbox delivery, redirects, sitemap/robots, custom-domain TLS and schedules before recording completion. Retire the isolated email acceptance Worker after proof is captured. Remove only owned obsolete Vercel projects, bindings and provider integrations; do not cancel shared accounts or revoke credentials used by unrelated projects.
