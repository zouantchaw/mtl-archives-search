# MTL Archives Search, In Plain Language

MTL Archives Search turns a large municipal photo archive into a product people can explore, play with, learn from, and eventually buy from. The public app is the visible part: search, maps, photo pages, the daily game, newsletter signup, and print ordering. Under that is a data system that cleans archive metadata, enriches records with vision/OCR signals, builds search indexes, and now keeps evaluation/training data reproducible through Dataset Factory v0.

## The Product Direction Now

Provenance Activation is the product and service: take a visual, cultural,
archival, or historically significant collection and turn it into trusted,
usable assets. Dataset Factory is the internal engine that handles identity,
enrichment, evidence, review, and reproducibility. MTL Archives proves the
method on a real collection. City Memory is the first client-facing
application.

There are two commercial paths over the same method. Institutions buy a fit
review or archive activation pilot for collections they control. Art,
built-environment, and hospitality partners buy a City Memory Concept Study
for one real place. Both paths move through four zones: client collection,
private processing, human review, and approved client/public output. Paid
delivery must earn any later recurring software or automation.

The active roadmap is issues #123–#127: define the product, bound Dataset
Factory Core, specify a portable Provenance Package, build one client-sendable
City Memory pilot, and only then test it with approved buyer outreach. The old
research issues are preserved as technical history under the closed #128
index; they are not current delivery commitments. Agent-platform work is not
an active dependency and should only return after repeated delivery reveals a
measured automation bottleneck. See `docs/product/provenance-activation-v1.md`.

## How The Pieces Fit

- `apps/api` is the Cloudflare Worker. It serves `/api/photos`, `/api/search`, game routes, newsletter routes, and talks to D1, Vectorize, Workers AI, and R2.
- `apps/city-memory` is the standalone client presentation for the Hôtel Nelligan reference concept, **The Street Within**: narrative chapters, reviewed records, full-frame archive-object studies, hotel approval decisions, and a conceptual interactive hotel section.
- `apps/next-app` is the customer-facing site: landing, search, photo detail, print checkout, auth, and game UI.
- `packages/scripts` is the workshop. It contains ETL, vector ingestion, audits, autoresearch, and Dataset Factory scripts.
- `pipelines/` holds Python-heavy workflows such as OCR, CLIP experiments, and daily social packaging.
- `docs/` explains the system and now includes Dataset Factory schemas, registry, and smoke fixtures.
- `data/` is local and ignored. It can contain large manifests, reports, generated packets, and experiment outputs. Do not assume a clean clone has it.

## City Memory client pilot and buyer validation (#126–#127)

The current sequence begins with an internally approved City Memory reference
concept based on Hôtel Nelligan (#126), not outreach. The hotel is not presumed to be the
first recipient; an approved warm partner or institution path may be stronger.
The working reference package now lives in `apps/city-memory`, with its release
and evidence boundary documented in `docs/city-memory-nelligan-reference/`.
It is an uncommissioned, static-hosted HTML presentation titled **The Street
Within** with an original conceptual Three.js scene. Its four historical images
are reviewed local archive files shown as full-frame objects in a coded atrium
elevation, room study, and concierge folio. It contains no current hotel
photography and labels the spatial model as conceptual massing rather than a
measured property model.
The predecessor issue #109 left a useful
privacy-preserving operating kit in `docs/city-memory-validation-v1/`: the
exact paid diagnostic proposal, interview order, consent/follow-up language,
categorical five-slot ledger, and a TypeScript/AJV validator. Its empty ledger
proves only that the kit runs; it does not prove demand. Its $3,500 proposal is
an optional credited discovery step, not the default Provenance offer. Issue
#127 starts only after the pilot passes release review and the owner approves the prospect,
message, sender, channel, and follow-up boundary. Keep names, recordings, raw
notes, and commercial details in an approved private system and retain only
opaque reference tokens here.

The key engineering idea is separation of durable code from bulky generated evidence. Code, schemas, small fixtures, and reproducibility manifests are tracked. Large generated report trees stay local and ignored.

## Dataset Factory v0: internal engine

Dataset Factory is the offline layer for making search quality measurable. It builds review packets, calibration labels, benchmark tasks, active-learning queues, quality-repair queues, visual-family graphs, research-enrichment packets, search judgments, and reward-data rows.

MTL-CityMemory-Bench v1 is currently only a pre-lock candidate/preflight
foundation. Its report binds available artifact IDs and hashes, keeps silver
retrieval rows separate, and emits a human-review acquisition queue; it does
not claim a locked benchmark or issue #70 completion.

The cross-platform content loop is also offline and diagnostic: reports require
an explicit platform-post/package/canonical identity join, exact permalinks for
published joins, and an explicit `real_export` versus `synthetic_fixture`
provenance declaration. Product and social behavior remain separate from
factual archive truth; aggregate `captured_at` means report-generation time,
not source-capture time, and this local slice has no durable cross-export event
deduplication.

Issues #65 and #66 made this durable and identity-explicit:

- `docs/dataset-factory/artifact-registry.v0.jsonl` records the artifact graph, including the tracked Issue 69 candidate, visual-review, source-research, and ground-research descriptors. Use the registry checker for the current count instead of copying a volatile number into this guide.
- `docs/dataset-factory/fixtures/v0-smoke/` has tiny tracked fixture rows that let the workflow run in a clean checkout.
- `npm run dataset-factory:smoke-v0` runs the v0 chain against those fixtures and a local mock search API. It fixes the fixture clock, asserts exact rows/content, and checks a committed output hash; it proves deterministic contract wiring, not live search quality.
- `npm run dataset-factory:artifacts:self-test` exercises 14 contract/adversarial cases, including a valid in-root file, path-component symlinks, and overlapping members.
- `npm run dataset-factory:clock:self-test` proves strict timezone-qualified fixed-clock parsing under UTC and America/Toronto.
- `npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /path/to/populated/repo` proves the registry still matches the real ignored artifacts.
- `npm run canonical-corpus-v1:fixture-smoke` exercises all 12 reconciliation states twice, checks exact hashes, and uses no credentials or network.
- `npm run canonical-corpus-v1:self-test` proves 72 negative lineage, path, summary, raw-provenance, alias, state, and flag cases, including coordinated refreshed-hash forgeries. `npm run canonical-corpus-v1:r2-sample:self-test` proves strict bounds and the expected 4-key fixture/54-key frozen-live plans without credentials or network.
- `npm run canonical-corpus-v1:collect -- --source all --env-file "$MTL_ARCHIVES_ENV_FILE"` captures local/D1/R2/both-Vectorize identity evidence without production writes. `canonical-corpus-v1:build` and `:check` produce and validate the ignored full reconciliation. Exact current counts and hashes live in the generated `docs/dataset-factory/canonical-corpus-v1-snapshot-summary.json`.
- `npm run dataset-factory:visual-family-self-test-v1` proves the v1 typed-edge authority, streaming pHash cap/resume identity, >250 aerial-run, component-supported recommendation, leakage-component, split, and mutable-snapshot contracts without network access. The full workflow uses bounded public thumbnails rather than transferring 169 GB of originals, gives every one of the 18,462 identities a group or explicit singleton status, and keeps similarity evidence separate from historical identity.
- `npm run dataset-factory:promotion-challenge-preflight-v1` emits the Issue #71 pre-lock no-ship scaffold. It binds to the #70 candidate report shape, lists missing benchmark/challenge/operational evidence, and records zero model/GPU/production runs; it cannot authorize promotion.

The lesson: if an important workflow depends on ignored files, either track the files, track a registry that proves what the files are, or track small fixtures that prove the code can still run. Here we do the last two.

## Deferred Verified Multimodal Intelligence Foundation

Historical issue #69 explored a more ambitious archive-intelligence workflow:
look at image regions, separate visible facts from metadata and inference,
verify high-value claims against external sources, and derive benchmark/search
tasks only from accepted evidence. The repo has a synthetic contract foundation
plus a bounded canonical-real candidate-selection stage, but no verified
historical output or final batch. This work is preserved but deferred under
#128; it is not the active product roadmap.

The foundation is synthetic and hermetic. Four tracked mock records exercise the two required lanes: ground OCR/entity/place and aerial land-use/georeference. They have no fictional archive URLs, no externally verified claims, and no benchmark tasks. The validator fails closed on boundary/collection mismatches, incomplete evidence or rights, exact geospatial claims without accepted structured external evidence, reviewer identity failures, and family/component split leakage. Run it with:

```bash
npm run dataset-factory:verified-multimodal-001
npm run dataset-factory:verified-multimodal-self-test-001
npm run dataset-factory:real-pilot-candidates-v1
npm run dataset-factory:real-pilot-candidates-verify-v1
npm run dataset-factory:real-pilot-candidates-integration-test-v1
npm run dataset-factory:real-pilot-promotion-v1
npm run dataset-factory:real-pilot-promotion-self-test-v1
npm run dataset-factory:real-pilot-promotion-verify-v1
npm run dataset-factory:real-pilot-promotion-integration-test-v1
npm run dataset-factory:real-pilot-independent-review-v1
npm run dataset-factory:real-pilot-independent-review-self-test-v1
npm run dataset-factory:real-pilot-independent-review-verify-v1
npm run dataset-factory:real-pilot-independent-review-integration-test-v1
```

The real-pilot selector yields 26 mechanically eligible candidates. A downstream hash-bound primary visual review selected 12 records (6 ground and 6 aerial/control) and retained 4 reserves from direct 256px review. A separate immutable independent review approved all 16 decisions with zero disagreements. Historical verification, completed dossiers, and derived benchmarks remain at zero.

## Important Boundaries

Reviewed Metrics v2 remains candidate-only for issue #96. Activation still requires the authority-only direct-child commit and exact clean-parent controls. Each consequential command uses a fresh stage-specific coordinator receipt, actual wall-clock validation, and an `O_EXCL`, fsynced durable start/completion marker pair that rejects cross-process replay before side effects.

Private retention requires exact account/endpoint identity, a dedicated bucket, secret HMAC-keyed opaque addresses, exact metadata, conditional ETag/version readback, stable HEAD, and complete pre/post domain plus Worker-binding enumeration. Receipt issue occurs only after postflight and semantic validation. Security executables use verified absolute root-owned paths, never `PATH`.

Place precision and coverage use only the opaque official-source-search task joined through Gate E acceptance, frozen source prediction, private retention, and signed finalization. Visual rows must contain zero place opportunities or links, preserve `no_pixel_identity_claim`, and cannot turn Gate E into scene support. Entity arrays are capped at 12 per row, reject quantized/IoU-near duplicates at `0.98`, and use deterministic polynomial min-cost assignment maximizing match count then integerized IoU with stable ties. Mask/geolocation remain prerequisite N/A; model/tool cost remains explicitly unavailable because no real usage receipt exists. No real trust/evaluator key, authority, route receipt, prediction, gold/private evidence, R2 write, score, publication, push, deploy, or production mutation exists.

- No generated report tree should be committed just because a script produced it.
- No `.env`, tokens, private keys, credentials, or signed URLs belong in docs, registries, fixtures, commits, or PR text.
- Dataset Factory smoke does not deploy, publish, mutate D1/R2/Vectorize, call paid compute, or prove production ranking quality.
- A populated local artifact root is still needed for full artifact hash verification.

## Useful Commands

```bash
npm install
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:check
npm run dataset-factory:artifacts:self-test
npm run dataset-factory:clock:self-test
npm run dataset-factory:artifacts:check -- --verify-files --artifact-root /absolute/path/to/populated/repo
npm run dataset-factory:smoke-v0
npm run canonical-corpus-v1:fixture-smoke
npm run canonical-corpus-v1:self-test
npm run canonical-corpus-v1:r2-sample:self-test
npm run canonical-corpus-v1:build
npm run canonical-corpus-v1:check
npm run dataset-factory:visual-family-self-test-v1
npm run dataset-factory:visual-family-check-v1
```

## Pitfalls To Avoid

- Silent empty outputs are dangerous. Dataset Factory scripts should fail clearly when required inputs are missing.
- A fixture smoke is not a benchmark. It protects contracts and clean-checkout reproducibility; it does not replace human-reviewed gold labels or live API evaluation.
- A registry without hashes is just a list. The SHA-256/count fields are what make the artifact contract auditable.
- A clean clone should not need a previous worker's generated report folder to run the focused smoke.
- Count equality is not snapshot equality. Visual Family Graph v1 gives its mutable public API acquisition a new content-derived ID and retains the issue-66 snapshot only as an explicit reference.
# Gold Label Batch 002

Issue #68 Gold Label Batch 002 is complete, reviewed, validated, and durably published. The ignored local evidence tree is `data/mtl_archives/reports/gold_label_batch_002`; the durable final tarball is the separate Cloudflare R2 object `r2://wiel-codex-worker-cache/artifacts/mtl-archives/gold-label-batch-002/11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd.tar.gz` with SHA-256 `11c4577c5fa2b0393d2c83a9c9a75effcf7c97252febc646fa8ceca4e6789fcd`. The original phase-1 packet boundary still matters for provenance: worker review used exactly 300 candidates, 12 stratified packets of 25, four orientation views per neutral row, disjoint primary/blind reviewer IDs, isolated paths, sealed pass sidecars, and trusted post-review identity mapping. Do not expose `batch/`, `inputs/`, hidden lineage, or another pass to workers.
# Gate H2 broker runtime

Issue #99 adds the inactive implementation layer behind the reviewed exact-HTTPS contract. Issue #100 adds the inactive combined retained relay/supervisor executable. Its fixed inherited inputs are request, authorizer, and liveness; verifier trust is source-pinned and compiled, while the replay journal arrives inside the signed SCM_RIGHTS grant; the finite cap is handshake-only. Rust authenticates and journals every post-begin grant before creating a run child. The config identifies a no-follow base root and single invocation ID; the supervisor exclusively creates and may only remove that child. The signed raw-response path must exact-join the typed output transition and retained broker evidence, and TypeScript validates the same exact expectation descriptor bytes Rust reports. Read-only inputs become fsynced supervisor-owned immutable snapshots, and only snapshot FDs reach Podman. Exact 12-stage config/report joins remain synthetic and production-ineligible; issue #101 owns real-Linux/Podman admission.

Issue #100 and Issue #101 Packets 1 and 2 remain merged inactive synthetic/local contracts. Packet 3A is the approved local, no-secrets, pre-launch builder implementation contract, documented canonically in [`gate-h2-builder-packet-3a-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3a-v1.md). It sets the actual future floor at Rust/Cargo `1.85.0` for Rust 2024 and Node `22.22.0`, and defines image-owned source proof, sealed measured snapshots, the rootless keep-id boundary, dual host-helper rebuilds, independent SBOM derivation, and host admission. Packet 3B adds strict external-input-lock and builder-receipt validators and a Linux-only descriptor-anchored offline stop boundary; see [`gate-h2-builder-packet-3b-input-lock-v1.md`](docs/dataset-factory/gate-h2-builder-packet-3b-input-lock-v1.md). It has not produced an actual lock, image, build, or receipt. The frozen Packet 2 four-file fixture and pending recipe remain byte-for-byte historical evidence; their old pending tool-floor statements are not the future runtime floor.

The broker no longer trusts a fixture to report that DNS and TLS were safe after bytes were sent. The production transport resolves once, rejects a mixed or special-use answer set before serialization, pins one exact socket address, verifies the connected peer, and performs rustls TLS 1.3 hostname/SNI/PKIX validation against byte-pinned native roots. Only then can credential-bearing request bytes leave. Tests use a local certificate and loopback resolver inside the same production code path; they never call a provider or the internet.

Issue #104 adds a source-pinned inactive post-begin authority enrollment contract. Its single production entry point derives the pinned root itself and always fails closed for the synthetic fixture; no caller can select an adapter, transport, D1 account/database/endpoint, credential, or enrollment. It freezes future verifier/D1/request-byte/endpoint/replay/report identities and rejects copied labels without native descriptor evidence, but JavaScript cannot authenticate that evidence. #100 must implement retained-FD validation and coordinator-owned capability use; #104 does not deploy D1, activate authority, add signer material, or provide Podman/Linux evidence. See `docs/dataset-factory/gate-h2-post-begin-authority-enrollment-v1.md`.

Evidence keeps the merged #98 v1 exchange/transcript bytes, semantics, and IDs unchanged so the production TypeScript validator remains the oracle. Runtime transcript bytes are exactly JCS UTF-8 plus LF, and the v2 envelope hashes those retained bytes. The terminal ACK authenticates the owner/token and proves the stage already accepted the exact response, output/status/role/order joins, and durable receipt; the post-seal 204 is optional. Initial delivery or ACK failure signs a failed lifecycle. UDS reads share one monotonic absolute deadline. Evidence/output directory creation validates the owner, no-follow type, and mode and fsyncs the parent; injected failure cannot produce completion evidence.

The Packet 3A builder contract uses an image-owned verifier to bind the retained source-descriptor digest, Git commit/tree/archive/exact blob bytes, and a sealed measured snapshot; transformed `.gitattributes` bytes are rejected. Its runtime closure is an exact root-owned `0755` directory tree and inventory with offline Cargo vendor/config, Git config, musl compiler/subtools/libc, CMake, Ninja, and static ELF64 little-endian x86-64 output checks. Rootless Podman uses keep-id mapping, a no-new-privileges root proof supervisor with only `SETUID`, `SETGID`, and `SETPCAP`, and an exact drop to `65532:65532` with zero child capabilities. Exactly two host helper families are independently rebuilt and host-admitted. Expected and candidate SBOMs are derived independently from Cargo tree and metadata and disagreement fails. The retained staging receipt carries the original descriptor SHA-256 into both container verification and host admission. The contract is inactive here; Issue #101 still requires reviewed external pins, two real x86 Linux builds, receipt comparison, worker termination, and later Podman/network/lifecycle/broker/D1/admission packets.
Packet 3C local machinery is now implemented for synthetic fixtures: digest-pinned acquisition, deterministic offline materialization, exact receipt emission, and two-bundle byte comparison. This does not claim a final real lock, x86 Linux build, signed host-independence evidence, D1 action, or production admission.
