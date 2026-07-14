# Issue 91 Gate G Verified Dossiers v1

Gate G is a candidate, independent-review, and one-way publication contract. The tracked artifact is candidate-only: all 36 dossiers have `fully_verified=false`, the independent review template is blank, and no authoritative dossier publication or completed review receipt is committed.

The deterministic attrition cohort contains all 20 Phase D aerial records and the first 16 component-distinct Phase D ground records with `promoted` Gold authority, ordered by Phase D selection index. Gate F reserves `10153` and `9504` are excluded because they are not Phase D records. Pilot aerials `8132`, `8134`, `8139`, and `8143` are categorically ineligible in v1: a completed review may mark them only `held` or `rejected`, and they can never increment `fully_verified`.

Every packet binds the exact Phase D record, component, split, predecessor descriptors, fully decoded tracked inspection derivative, per-record rights, author identity/session, archive metadata report, conservative whole-image visual classification, empty external-claim list, alternatives, contradictions, uncertainty, and explicit identity/location/georef/scale/land-use/measurement abstentions. Ground rights bind the registered real-pilot source-acquisition descriptor plus exact official Montréal dataset/license and canonical CC BY 4.0 snapshots. Aerial rights bind each accepted Gate F receipt/ledger disposition, source family/body URL and hash, record-media proposition, license proposition, and credit proposition. These are rights-only authorities and do not promote identity, place, historical, OCR, entity, georef, scale, land-use, or measurement claims.

JSON, HTML, evidence overlays, and three contact sheets are deterministic projections verified as complete bytes against the renderers for the supplied candidate root. HTML embeds the exact packet and cannot add visible claims. The tracked candidate authorization and independent-review files are blank templates only. The production authorization pin is deliberately outside the candidate fixture at `docs/dataset-factory/authorities/verified-dossiers-v1/production-authorization-pin-v1.json`, so its later activation cannot change or circularly bind the candidate tree.

## Candidate verification

```bash
npm run dataset-factory:verified-dossiers-verify-v1
npm run dataset-factory:verified-dossiers-self-test-v1
npm run dataset-factory:verified-dossiers-integration-test-v1
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:artifacts:self-test --workspace=@mtl-archives/scripts
```

## Authorization, review, and publication

Gate G uses a reviewed two-commit authorization flow:

1. The candidate code, fixture, schemas, and unconfigured production pin are reviewed and committed. Normal production review validation and publication fail closed in this state.
2. A coordinator creates a completed authorization envelope from `reviewer-authorization.template-v1.json`. It exact-binds the candidate, packet manifest, review scope, one approved Sol High reviewer route, separate authorizing authority, and authorization time.
3. A separate pin-only repository edit changes the fixed production pin from `unconfigured` to `active`, binding the exact candidate descriptor, complete authorization file SHA-256 and bytes, reviewer route, authorizing-authority route, and authorization time. That edit must receive separate review and be committed before use. No Gate G CLI command can create, activate, or rewrite the pin.
4. The authorized reviewer starts from `independent-dossier-review.template-v1.json` and writes a completed receipt. The receipt binds the authorization SHA-256 and conforms to `completed-independent-review.schema.v1.json`.
5. Only then may the normal validation and publication commands run. They accept only the authorization whose complete bytes and route match the active pin committed at `HEAD`.

The reviewer must have no candidate-author, Gate E source-review, Gate F source-review, implementation, or authorizing-authority identity/session overlap. Acceptance requires positive approval of visual evidence, metadata labeling, rights/attribution, uncertainty, and projection fidelity for the exact hash-bound dossier.

```bash
npm run dataset-factory:verified-dossiers-validate-review-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --receipt /absolute/COMPLETED_REVIEW.json
npm run dataset-factory:verified-dossiers-publish-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --receipt /absolute/COMPLETED_REVIEW.json --output /absolute/NEW_PUBLICATION
npm run dataset-factory:verified-dossiers-verify-published-v1 -- --authorization /absolute/COORDINATOR_AUTHORIZATION.json --output /absolute/NEW_PUBLICATION
```

Until the separate pin-only activation commit exists, all three normal commands above are expected to fail with an unconfigured production authorization pin. Synthetic integration tests use an in-process symbol capability that is unavailable to the CLI and cannot establish production authority.

Publication refuses an existing destination, an unconfigured or uncommitted pin, authorization bytes or routes that differ from the pin, fewer than 25 eligible accepted dossiers, count drift, identity overlap, missing attestations, held/rejected rows counted as verified, source-acquisition-only packets, changed packet/projection/image hashes, or incomplete output without the final commit marker. It freshly derives the complete published aggregate from the verified candidate and exact receipt, then byte-compares every per-record JSON/HTML projection, reviewed contact sheet, status, descriptor, and commit. It exclusively reserves the destination, installs under an owner token, and writes the commit marker last. It retains held and rejected rows with rationale and sets `fully_verified=true` only for eligible accepted rows. It performs no production, benchmark, search, network, upload, deploy, or paid-GPU action.
