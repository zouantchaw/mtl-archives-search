# Issue 91 Gate G Verified Dossiers v1

Gate G is a candidate, independent-review, and one-way publication contract. The tracked artifact is candidate-only: all 36 dossiers have `fully_verified=false`, the independent review template is blank, and no authoritative dossier publication or completed review receipt is committed.

The deterministic attrition cohort contains all 20 Phase D aerial records and the first 16 component-distinct Phase D ground records with `promoted` Gold authority, ordered by Phase D selection index. Gate F reserves `10153` and `9504` are excluded because they are not Phase D records. Pilot aerials `8132`, `8134`, `8139`, and `8143` are expected holds and cannot count unless a later independent dossier reviewer accepts each exact bounded dossier with all five approvals.

Every packet binds the exact Phase D record, component, split, predecessor descriptors, fully decoded tracked inspection derivative, per-record rights, author identity/session, archive metadata report, conservative whole-image visual classification, empty external-claim list, alternatives, contradictions, uncertainty, and explicit identity/location/georef/scale/land-use/measurement abstentions. JSON, HTML, evidence overlays, and three contact sheets are deterministic projections. HTML embeds the exact packet and cannot add claims.

## Candidate verification

```bash
npm run dataset-factory:verified-dossiers-verify-v1
npm run dataset-factory:verified-dossiers-self-test-v1
npm run dataset-factory:verified-dossiers-integration-test-v1
npm run typecheck --workspace=@mtl-archives/scripts
npm run dataset-factory:registry:validate
```

## Independent review and publication

An independent reviewer starts from `docs/dataset-factory/fixtures/verified-dossiers-v1/independent-dossier-review.template-v1.json`, writes a completed receipt outside this implementation session, and conforms it to `completed-independent-review.schema.v1.json`. The reviewer must have no candidate-author, Gate E source-review, Gate F source-review, or implementation identity/session overlap. Acceptance requires positive approval of visual evidence, metadata labeling, rights/attribution, uncertainty, and projection fidelity for the exact hash-bound dossier.

```bash
npm run dataset-factory:verified-dossiers-validate-review-v1 -- --receipt /absolute/COMPLETED_REVIEW.json
npm run dataset-factory:verified-dossiers-publish-v1 -- --receipt /absolute/COMPLETED_REVIEW.json --output /absolute/NEW_PUBLICATION
npm run dataset-factory:verified-dossiers-verify-published-v1 -- --output /absolute/NEW_PUBLICATION
```

Publication refuses an existing destination, fewer than 25 accepted dossiers, count drift, identity overlap, missing attestations, held/rejected rows counted as verified, source-acquisition-only packets, changed packet/projection/image hashes, or incomplete output without the final commit marker. It retains held and rejected rows with rationale and sets `fully_verified=true` only for accepted rows. It performs no production, benchmark, search, network, upload, deploy, or paid-GPU action.
