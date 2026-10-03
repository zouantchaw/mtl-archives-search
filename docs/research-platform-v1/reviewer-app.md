# MTL Archives research reviewer

Production app: **https://mtl-archives-research-reviewer.wiel.workers.dev**

This private Cloudflare app replaces the local HTML/CSV workflow for the October
3 caption-feedback pilot. It is for preparing image decisions, related-photo
families and independent bilingual development queries. It does not run models,
create retrieval relevance gold or change the customer app.

## Start here

1. Open the app and sign in with the owner account used for the PortMind reviewer.
   Cloudflare Access protects the entire app, API and image routes.
2. Read **Guide**. Review the first five images and use **Save & next**. Check those
   five decisions against the rules before continuing through all 100 candidates.
3. For each image, record image type, usable visual detail, readable text, quality
   issues and uncertainty. Use **Full image**, **Rotate**, **Fit**, zoom and drag to
   pan. Rotation records a recommended view; preserved bytes are unchanged.
4. In **Families**, select related images, name the group and explicitly choose a
   representative. Edit or separate a saved family when needed. After all 100
   image reviews, check the remaining single images and complete the family check.
5. **Queries** then opens: write 12 independent visual intents in French and
   English, define what must be visible to match, and record related intents and
   bilingual wording checks. These are development queries. Independent heldout
   queries, relevance judgments and adjudication remain later study tasks.
6. Use **Export** to download your saved decisions and full revision history. An
   export excludes unsaved drafts. It stays marked `pending_quality_review` and
   `benchmarkEligible: false`.

Saved decisions follow the authenticated account across devices. Unsaved drafts
are stored only in that browser, with a warning before leaving. If browser draft
storage is unavailable, the app warns you to save before closing. If a different
tab saved a newer version, the app rejects the overwrite; **Load saved version**
lets you discard the local draft and reload the persisted review.

## Exact study inputs

| Input | Frozen identity |
| --- | --- |
| Candidate snapshot | `cfc42de382d5e5a6f7abd0e2f46883cdfba5556113804f76d8617d0d008101f4` |
| Pilot packet SHA-256 | `39425012108d1c967902952b85d6e3ab9ec35acb3ee720119d30077db0f46287` |
| Delivery import | `c102d420bde265d585559cdbce4134f0db6a9bd7527392b6a4520fd0d269ac7b` |
| Snapshot study | `274739e12afd48893295826d62864b94875dca531df49fa5de9f69364212c29c` |
| Membership | 100 numbered candidates; immutable manifest bundled server-side |

The review screens hide archival titles, dates, record URLs, OCR, captions and
retrieval scores. Original labels physically printed in an image remain visible
pixels. The export includes record identities and byte references for traceability.
Changing the corpus requires a new versioned study selection and app manifest,
not replacing the images behind existing numbers.

Every small preview is hash- and size-checked when read. Full delivery images
stream from the exact allowlisted, previously verified content-addressed keys;
the Worker checks their size, rather than buffering and rehashing scans up to
roughly 60 MB on every request. Media and review responses use `no-store`.

## Resource boundary

| Resource | Purpose |
| --- | --- |
| Worker `mtl-archives-research-reviewer` | React assets, authenticated API, allowlisted media |
| D1 `mtl-archives-research-reviewer` | New append-only review database |
| D1 ID `00e31f70-f4b9-43cb-8b52-05ca2d28404a` | Exact deployment target |
| Existing private research sources/derived R2 | Read selected image blobs through `get`; no app write routes |
| Access application `5075e888-0d38-405b-a31f-fc325d63001d` | Owner-only allowlist copied from the PortMind reviewer policy |

The Worker has no production D1, production R2, Vectorize, Workers AI, queue or
scheduled-job binding. It has no model assistance. R2 bindings provide platform
capabilities; read-only behavior is implemented in these routes, not claimed as
an IAM restriction. Research acquisition and study catalog schemas are unchanged.
The normal root `npm run deploy` still targets `apps/api`; deploy this app from
its own directory only. The original product checkout was not edited.

Cloudflare Access gates all requests. The Worker also verifies the signed Access
JWT with RS256, issuer, audience and expiry. Identity is scoped to issuer+subject
and hashed before storage. Owner email is used for sign-in, not exported with
reviews. Saves require the same origin. Static assets run through the Worker
before delivery, with a restrictive CSP and locally hosted fonts.

## Persistence contract

A single atomic insert checks the expected revision and writes a new revision.
An idempotent save ID supports retries. Database triggers reject updates and
deletes. The latest view is derived from history; history remains available in
exports. Each account sees only its own records.

Family completion requires all selected image reviews and an explicit singleton
check. Members cannot overlap or fall outside the pilot. Each grouped family has
an explicit member representative. A family change reopens completion. Query
saves require a completed family review and retain its exact revision, including
an insert-time guard against a concurrent family change. Older saved queries
are flagged for rechecking after a family revision.

## Build and deploy

Work in the isolated research checkout on `codex/research-data-contract-v1`:

```bash
cd apps/research-reviewer
npm ci --workspaces=false
npm run typecheck
npm test
npm run test:import
npm run build
cf deploy --prebuilt --dry-run
cf deploy --prebuilt
```

`wrangler.json` records the isolated bindings. `scripts/build-worker.mjs` emits
Cloudflare Build Output API artifacts with `runWorkerFirst: true`, no preview
URLs and an exact D1 boundary check. The migration is
`migrations/0001.sql`; it was applied only to the new reviewer D1. Future schema
changes need separate, non-destructive migrations and must retain review history.
Never apply this migration to the serving, acquisition or study databases.

For local UI QA, use the dedicated loopback harness against an already verified
local blob cache:

```bash
node scripts/qa-server.mjs /absolute/path/to/verified/registry/blobs
```

It binds only `127.0.0.1:8796`, uses a temporary SQLite database and a clearly
synthetic actor, and removes that database on exit. It is not bundled or deployed.
Its exports have `reviewerType: synthetic_qa_actor` and are rejected by the ledger
importer. Regular Wrangler dev keeps JWT validation; it has no auth bypass.

## Retain an owner export in the study ledger

Run from the repo root with a downloaded owner response and the existing pilot
registry. The helper makes local immutable registrations only:

```bash
.venv-bulk/bin/python apps/research-reviewer/scripts/import-review.py \
  --root /absolute/path/to/existing/pilot/registry \
  --response /Users/wiel/Downloads/mtl-archives-pilot-review.json \
  --receipt /absolute/path/to/new/import-receipt.json
```

It validates the exact snapshot, packet, study/import identities and byte
references, preserves full history, and rejects synthetic exports and stale
query/family relationships before adding artifacts. Partial image reviews can
be retained as pending decisions. A completed review registers selected family
membership and development intents using `human_declared` provenance. It does
not declare the other records in the full import reviewed: selected families
retain `scope_snapshot` and global family coverage remains incomplete.

The downloaded JSON is an owner declaration, not an independently signed human
attestation. Quality checks still determine research eligibility. Local imports
do not publish to Cloudflare, freeze a representative corpus, generate models
or promote anything into the customer app. Those are separate recorded steps.

## Verification and current limits

October 3 deployment `845e3781-4ce7-4d44-828f-50ba2d6621d0`:

- TypeScript check, production build and 11 backend contract tests passed.
- Six in-memory importer checks passed; no human ledger rows created by testing.
- Playwright checked the actual Worker handlers and production-built React app
  locally with a synthetic actor: save/advance, reload/draft recovery, rotation,
  full-image loading, families, query gate/save, export and mobile overflow.
- Unauthenticated deployed root/state/media requests redirect to Cloudflare
  Access. The production reviewer D1 had zero revisions at handoff.
- Read-only before/after serving-resource comparison passed after deployment.
- Owner-authenticated end-to-end production sign-in/image/save was not exercised
  with a human credential. The owner first sign-in is the remaining operational
  check, distinct from the tested application flow.

Evidence and design fidelity review:
`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-research-reviewer-app-2026-10-03`.
The app uses the existing MTL radial-dot logo, paper/ink/blue palette, Figtree UI
and Spectral headings. Real frozen image bytes replace the illustrative concept
photo. A mobile toolbar wrapping bug and next-image scroll issue were repaired.

Architecture references: [Worker-first static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
[Cloudflare Access JWT verification](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
