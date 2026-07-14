# Issue 91 Gate G Verified Dossiers v1

Gate G is a candidate, independent-review, and one-way publication contract. The tracked artifact is candidate-only: all 36 dossiers have `fully_verified=false`, the independent review template is blank, and no authoritative dossier publication or completed review receipt is committed.

The deterministic attrition cohort contains all 20 Phase D aerial records and the first 16 component-distinct Phase D ground records with `promoted` Gold authority, ordered by Phase D selection index. Gate F reserves `10153` and `9504` are excluded because they are not Phase D records. Pilot aerials `8132`, `8134`, `8139`, and `8143` are categorically ineligible in v1: a completed review may mark them only `held` or `rejected`, and they can never increment `fully_verified`.

Every packet binds the exact Phase D record, component, split, predecessor descriptors, fully decoded tracked inspection derivative, per-record rights, author identity/session, archive metadata report, conservative whole-image visual classification, empty external-claim list, alternatives, contradictions, uncertainty, and explicit identity/location/georef/scale/land-use/measurement abstentions. Ground rights bind the registered real-pilot source-acquisition descriptor plus exact official Montréal dataset/license and canonical CC BY 4.0 snapshots. Aerial rights bind each accepted Gate F receipt/ledger disposition, source family/body URL and hash, record-media proposition, license proposition, and credit proposition. These are rights-only authorities and do not promote identity, place, historical, OCR, entity, georef, scale, land-use, or measurement claims.

JSON, HTML, evidence overlays, and three contact sheets are deterministic projections verified as complete bytes against the renderers for the supplied candidate root. HTML embeds the exact packet and cannot add visible claims. The tracked authorization and independent-review files are blank templates only.

## Candidate verification

```bash
npm run dataset-factory:verified-dossiers-verify-v1
npm run dataset-factory:verified-dossiers-self-test-v1
npm run dataset-factory:verified-dossiers-integration-test-v1
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:self-test --workspace=@mtl-archives/scripts
```

## Independent review and publication

A coordinator first creates a completed authorization envelope from `reviewer-authorization.template-v1.json`. It exact-binds the candidate, packet manifest, review scope, one approved Sol High reviewer route, separate authorizing authority, and authorization time. The authorized reviewer then starts from `independent-dossier-review.template-v1.json` and writes a completed receipt outside this implementation session. The receipt binds the authorization SHA-256 and conforms to `completed-independent-review.schema.v1.json`. The reviewer must have no candidate-author, Gate E source-review, Gate F source-review, implementation, or authorizing-authority identity/session overlap. Acceptance requires positive approval of visual evidence, metadata labeling, rights/attribution, uncertainty, and projection fidelity for the exact hash-bound dossier.

```bash
npm run dataset-factory:verified-dossiers-validate-review-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --receipt /absolute/COMPLETED_REVIEW.json
npm run dataset-factory:verified-dossiers-publish-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --receipt /absolute/COMPLETED_REVIEW.json --output /absolute/NEW_PUBLICATION
npm run dataset-factory:verified-dossiers-verify-published-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --output /absolute/NEW_PUBLICATION
```

Publication refuses an existing destination, fewer than 25 eligible accepted dossiers, count drift, authorization/reviewer mismatch, identity overlap, synthetic production principals, missing attestations, held/rejected rows counted as verified, source-acquisition-only packets, changed packet/projection/image hashes, or incomplete output without the final commit marker. It exclusively reserves the destination, installs under an owner token, and writes the commit marker last. It emits reviewed per-dossier JSON/HTML and contact sheets where accepted, held, and rejected states exactly match the aggregate publication. It retains held and rejected rows with rationale and sets `fully_verified=true` only for eligible accepted rows. It performs no production, benchmark, search, network, upload, deploy, or paid-GPU action.
