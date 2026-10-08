# MTL Archives research reviewer

Production app: **https://reviewer.mtlarchives.com**

October 8 domain cutover retains the existing Access application/audience and owner-only allow policy. Both the Wrangler source and generated build configuration disable workers.dev and preview URLs, so future deployments preserve the protected project domain.

This private Cloudflare app replaces the local HTML/CSV workflow for the October
3 caption-feedback pilot. It is for preparing image decisions, related-photo
families and human-authored bilingual development queries. On-demand reviewer
help is available; it does not run the caption-feedback experiment, create
retrieval relevance gold or change the customer app.

## Start here

1. Open the app and sign in with the owner account used for the PortMind reviewer.
   Cloudflare Access protects the entire app, API and image routes.
2. Read **Guide**. Review the first five images and use **Save & next**. Check those
   five decisions against the rules before continuing through all 100 candidates.
3. Use **Photograph** to judge image type, describable scene features and
   serious defects. Use **Text check** before deciding whether writing is visible.
   Nine overlapping regions cover the EXIF-normalized inspection scan. Their names
   refer to the overview orientation, independently of your preferred photo view.
   Open a region, use **Rotate detail** or **Actual pixels**, and **Mark checked**
   after inspecting it. This is a human check, not an AI coverage claim.
   Optional **Check all regions with AI** queues nine Gemma text reads. Results
   attach to their exact region/orientation; candidate badges help you find regions
   to inspect. **Ask a second reader** uses Qwen and displays both readings.
   Nothing detected in a region does not prove absence of text. A new No answer
   requires the reviewer to confirm checking pixels for writing/numbers/watermarks.
   Candidate wording is editable; select its kind and explicitly check it against
   pixels before **Add verified note**. Labels stay manual. Previous requests,
   including legacy Moondream descriptions, remain readable without rewriting them.
   **Full image**, photo rotation, zoom, pan and display-only adjustments remain.
   Selecting a custom area or edge opens it in Text check. Detail rotation is separate
   from the recorded photo rotation. Source bytes and model inputs are never enhanced.
   Words or numbers count, including margins and watermarks. Note archive watermarks
   separately. Normal camera edges, gray padding and scan notches alone are not crop
   defects. The Guide provides rules, examples and practice.
4. In **Families**, select related images, name the group and explicitly choose a
   representative. **Compare selected** opens two views with independent zoom
   and rotation. Edit or separate a saved family when needed. After all 100
   image reviews, check the remaining single images and complete the family check.
5. **Queries** then opens: write 12 independent visual intents in French and
   English, define what must be visible to match, and record related intents and
   bilingual wording checks. These are development queries. Independent heldout
   queries, relevance judgments and adjudication remain later study tasks.
   Query wording is human-authored; the app supplies no AI query-writing help.
   Prior image assistance is recorded alongside development queries because it
   can influence later choices. These are not independent heldout references.
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
| R2 `mtl-archives-reviewer-assistance` | Separate verified inspection inputs, native crops and raw model outputs |
| Queue `mtl-archives-reviewer-help` + `-dlq` | Durable on-demand inference; batch 1, concurrency 2, infrastructure retries 2 |
| Workers AI + Images bindings | Moondream inspection and private image transformations |
| AI Gateway `mtl-archives-reviewer-help` | Separate 30/minute gateway; logs disabled; inference cache bypassed |
| Access application `5075e888-0d38-405b-a31f-fc325d63001d` | Owner-only allowlist copied from the PortMind reviewer policy |

The Worker has no production D1, production R2, Vectorize or scheduled-job
binding. Assistance uses only the new reviewer resources. R2 bindings provide platform
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

## Assistance provenance and cost boundaries

The server allows help only for this exact `assisted_preparation_only` manifest
and snapshot. Unknown images, snapshots, tasks, rotations and outside crops are
rejected. It must not be enabled for blind/heldout packets. The 100 inspection
JPEGs were rendered from verified delivery bytes with a pinned Pillow 12.1.0
recipe, EXIF orientation normalized, maximum edge 6,000 px and JPEG quality 92.
All are below the native Images 20 MB input limit; 11 originals exceeded it.
`src/inspection.json` records source/render hashes, dimensions and the recipe.
Original preview/full image routes still use the frozen pilot references.

Native crops are cached under a hash of the render/crop/rotation/recipe, verified
on retrieval, then sent as private data URIs. Each model run retains the exact
input hash, raw output hash/key, model ID, prompt version, tokens and latency.
Exact model inputs are copied to separate byte-addressed R2 keys before inference,
so later inspection-cache changes cannot replace an earlier input.
Text reads use `@cf/google/gemma-4-26b-a4b-it`; a second reader uses
`@cf/qwen/qwen3.8-27b`. Both use `mtl-text-regions-v1` with strict parsed status,
bounded candidate text, location descriptions and writing kinds. A candidate
is always unverified, regardless of the model's uncertainty declaration. No
model coordinates or confidence percentages are shown as measured evidence.
The new recipe/model/reader is included in the replay hash. Legacy Moondream
`mtl-reviewer-help-v2` rows keep their original identities, output and processing
recipe. Truncated, invalid or repetitive responses are retained privately and
withheld as failed results. Small regression probes found image 003's marginal
writing and image 002's 28; readings of handwritten digits differed, and one
watermark crop was missed. These are engineering checks, not OCR accuracy estimates.

Each run requests at most 500 output tokens. Atomic quotas allow 12 pending,
40 lifetime requests per actor/image and 600 per UTC day; failed attempts count.
This supports nine-region checks plus manual rotations and second readings.
Queue concurrency remains 2, with a DLQ; inference is only started by reviewer
requests. Gateway raw logging is disabled; per-call cache is skipped because
R2/D1 replay binds the exact pixels and versioned recipe. Human checked regions
and explicit No confirmation are persisted in new image revisions as optional
`inspection` metadata, preserving compatibility with earlier reviews. An
`accepted_note` event now records the reviewer's edited wording, writing kind,
source rectangle and orientation. This is acceptance provenance, not gold.

Shadcn/Base UI handles forms, choice groups, tabs, controls and the Guide dialog.
The theme retains MTL brand assets and colors. The source viewer and text check
have separate responsibilities; the long generic caption helper is no longer
the primary image review tool.

Migrations `0002_assistance.sql` and `0003_external_guidance.sql` add run,
append-only event and external-guidance tables without
editing `review_revision`. `output_delivered`, `accepted_note` and `dismissed`
events distinguish exposure from adoption. New image saves conservatively carry
all delivered run IDs for that image; new query saves carry prior image-assistance
run IDs. Export v2 includes full runs/events/byte references and a truthful
`aiAssistance` flag. It records the known first-five conversation calibration in an actor-scoped
external-guidance entry with a preserved receipt hash/key. `aiAssistance` includes
both delivered in-app outputs and recorded external AI guidance; earlier
unrecorded exposure remains unknown. Original historical payloads are preserved.
The importer accepts legacy unassisted v1 and explicitly assisted preparation v2,
checks input/exposure associations, and retains pending, non-benchmark provenance.
Raw output references are owner declarations until independently verified; they
are not promoted to research truth. No bulk OCR/caption run is authorized by a
review save or a help request.

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
URLs and an exact D1 boundary check. The migrations are
`migrations/0001.sql`, `0002_assistance.sql` and `0003_external_guidance.sql`;
all were applied only to the
reviewer D1. The initial schema was applied directly (no migrations bookkeeping);
apply new files exactly once with `cf d1 query <reviewer-id> --body` using the SQL
file content as a structured JSON argument, rather than replaying the initial file.
Future schema
changes need separate, non-destructive migrations and must retain review history.
Never apply this migration to the serving, acquisition or study databases.

For local UI QA, use the dedicated loopback harness against an already verified
local blob cache:

```bash
node scripts/qa-server.mjs /absolute/path/to/verified/registry/blobs \
  /absolute/path/to/inspection-cache
```

It binds only `127.0.0.1:8796`, uses a temporary SQLite database and a clearly
synthetic actor and model responses, and removes that database on exit. Its
inspection transforms use local Pillow and are not the live native binding. It is
not bundled or deployed. Live native inference is checked separately with a
synthetic actor in assistance tables only, never by inserting human reviews.
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

## October 4 assistance update

The existing five saved reviews (six immutable revisions) are preserved. The
upgrade added resources only in the reviewer boundary, using `cf` CLI for
provisioning, migration, uploads, deployment and native queue smoke checks.
The original app, acquisition runners and frozen pilot inputs are unchanged.

- 18 backend contract checks and 8 importer checks pass.
- Desktop and phone Playwright exercise selection/crops, independent detail
  rotation, help acceptance/dismissal, failure/retry, draft recovery, save/export,
  guide practice, family comparison and query gates using synthetic responses.
- Live native queue/Images/Workers AI checks are synthetic assistance jobs only.
  They reveal real limits: image 002's “28” was read; sideways margin text on 003
  generated repetitive output before crop rotation/shorter prompting. Such output
  is now withheld. Even short responses can misread characters; verify pixels.
- Owner authentication is unchanged; new authenticated UI/API operations are
  verified locally with actual handlers. Live native bindings are checked through
  account-authorized CLI jobs. A human sign-in/save is not fabricated by QA.

Update evidence:
`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-reviewer-assistance-2026-10-04`.

## Original October 3 verification

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

Cloudflare implementation references: [Images binding and input limits](https://developers.cloudflare.com/images/optimization/binding/), [Queue consumers](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [R2 conditional writes](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).

## Cloudflare capability choices for this review

| Capability | Decision for this task |
| --- | --- |
| [Images binding](https://developers.cloudflare.com/images/optimization/binding/) | Private source-backed crops and rotations; exact input bytes retained. Nine regions cover the normalized inspection image, not all original-resolution pixels of originals exceeding 6,000 px. Full image remains available. |
| [Workers AI catalog](https://developers.cloudflare.com/workers-ai/models/) | Evaluate text-specific Gemma and Qwen region reads. Generic whole-image captions are poor tiny-text absence checks. These are vision readers, not a validated specialized OCR pipeline. |
| [Queues](https://developers.cloudflare.com/queues/) + D1 | Short independent jobs, bounded concurrency, retry state, replay identities, explicit exposure and decision history. Existing isolated resources suffice. |
| [R2](https://developers.cloudflare.com/r2/) + [AI Gateway](https://developers.cloudflare.com/ai-gateway/) | Private input/output retention, byte hashes and inference rate control. No model inputs are made public. |
| [Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/) + Worker static assets | Owner-only review and locally hosted shadcn UI/fonts. |
| [Workflows](https://developers.cloudflare.com/workflows/) | Evaluated. Long ingestion/OCR experiments with dependent stages may benefit later. These independent bounded region reads already have queue/replay state; an extra orchestration service adds no current reviewer benefit. |
| [Containers](https://developers.cloudflare.com/containers/) | Evaluated for specialized OCR engines. Useful if a measured OCR study justifies it; new runtime/model artifacts and cold starts would need comparison against marginal handwriting. No container is provisioned for an unvalidated OCR promise. |
| [Vectorize](https://developers.cloudflare.com/vectorize/) | Future isolated similarity candidates for Families, after scene grouping/evaluation controls. Reusing serving embeddings or old captions during this preparation could bias grouping. Current side-by-side pixel comparison stays available. |
| [AI Search](https://developers.cloudflare.com/ai-search/) / [toMarkdown](https://developers.cloudflare.com/workers-ai/markdown-conversion/) | Managed retrieval/description ingestion does not provide the tiny-text coverage or explicit reviewer provenance needed here. No new index or generated corpus is created. |
| [Browser Rendering](https://developers.cloudflare.com/browser-rendering/), KV, Durable Objects, Workers analytics | Not required for these frozen image inputs. D1 gives atomic review history; R2 holds blobs. A browser renderer or agent conversation would not recover source pixels absent from a small model input. |

This rollout uses the already isolated Cloudflare primitives. There is no new
source ingestion, bulk OCR/caption experiment, serving index replacement or
automatic promotion. The live application has no dependency on these changes.

## October 4 text inspection rollout verification

- Deployment `34eb0672-9bc1-42dc-b405-059655dd96bc` via `cf deploy --prebuilt`
  from the isolated reviewer app directory.
- Typecheck, 20 backend/contract tests and 8 import tests passed.
- Playwright tested the production build and Worker handlers through a loopback
  synthetic actor, at 1505 × 1045 and 390 × 844. Region selection, both readers,
  verified note adoption, nine-job completion, No confirmation, save/next,
  draft recovery, failure/retry and keyboard focus were exercised. Console was clean.
- Axe found zero WCAG A/AA violations in tested desktop photograph/text,
  phone text and phone Guide states. This is not certification across all users,
  browser combinations or assistive technologies. Manual review confirmed Guide
  focus trapping/return and its description contrast of 6.35:1.
- Eleven native Queue → Images → Workers AI/Gateway → R2/D1 checks completed:
  all nine image 003 regions, image 002 top-left and an independently rotated
  Qwen reading. Exact raw output hashes and both margin input byte hashes were
  verified from R2. All records used a distinct synthetic validation actor and
  did not create human review revisions.
- The writing was surfaced at image 003's lower-left margin and 28 was detected
  in image 002. Gemma read one digit differently from Qwen. A top-right region
  produced a questionable Archives candidate. These examples demonstrate the
  need for pixel verification, not general OCR recall or accuracy.
- All six prior human revisions, the seven prior model runs, the prior assistance
  event and the external-guidance receipt remain unchanged. Public app/API/media/
  inspection routes still redirect to Access. Serving resource metadata, Worker
  deployment and Vectorize info passed the unchanged guard. Owner-authenticated
  production UI sign-in was not automated; local handler/UI tests and native
  Cloudflare inference tests cover separate layers.

Durable receipts, screenshots, concept and limitations:
`/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-reviewer-text-inspection-2026-10-04`.
