# Dataset Factory client closeout v1

This packet defines the safe handoff boundary for the Dataset Factory. It is
intentionally narrower than closing issue #69 or #92.

The client specimen lane is ready: the published Gate G evidence contains 60
canonical, provenance/visually processed records, 32 independently accepted
`fully_verified` dossiers, complete rights/attribution fields, bounded
whole-image image-mode claims, refusal/abstention controls, and 32 independently
accepted image-mode tasks. This is suitable as a source-linked dossier
specimen input for client conversations. It is not a finished historical
narrative, source-search answer, model scorecard, or City Memory study.

The research evaluation lane remains pending. Gate H2's visual prediction,
gold review, source-only task, private scoring, and publication have not run.
The Linux/builder artifacts owned by #101 are pre-launch contracts or synthetic
fixtures; they are not observed Linux conformance, D1 admission, provider/model
requests, or execution authority. Nothing in this packet activates that chain.

## Machine-readable packet

- Packet: `fixtures/client-closeout-v1/manifest-v1.json`
- Schema: `schemas/client-closeout-v1.schema.json`
- Registry entry: `dfv0_client_closeout_v1_20260831`
- Verification: `npm run dataset-factory:client-closeout-verify-v1`
- Tamper tests: `npm run dataset-factory:client-closeout-self-test-v1`

The validator remeasures every evidence pin, derives the 30/20/10 Phase D lane
counts, derives the 32/4 Gate G accepted/held counts, checks every accepted
dossier's rights, review, and whole-image boundary, checks the CASTROL
false-precision control, verifies the completed Gate H independent task-review
receipt (`independent-task-review-v1.json`) and published task bytes
(`published-benchmark-tasks-v1.json`), and rejects a changed H2 status or
publication flag. The blank `independent-task-review.template-v1.json` is not
used as authority.

## Acceptance-criterion truth table

`proven` means the literal criterion is satisfied by the cited bounded
publication. `proven_in_scope` means the existing evidence satisfies only the
explicitly stated subset and must not be generalized. `partial` and `pending`
are not close authority.

| Issue | Criterion | Status | Truthful result |
| --- | --- | --- | --- |
| #69 | 60 processed records | proven | 30 ground, 20 aerial, 10 controls |
| #69 | 25 deeply verified dossiers | proven | 32 accepted/`fully_verified`; 4 held |
| #69 | visual evidence boundaries | proven | all 32 accepted claims use reviewed whole-image evidence |
| #69 | external claim citations | proven_in_scope | zero external historical claims were promoted; future claims still need URL/evidence notes |
| #69 | unsupported identity/location controls | proven | unsupported identity, place, georef, scale, land-use, measurement, OCR, brand, and entity claims remain held/rejected/abstained |
| #69 | OCR/entity/place/aerial/abstention metrics | pending | no measured blind prediction/gold evaluation is client-ready |
| #69 | false precision examples | proven | CASTROL/CATELLI plus three additional controls are retained |
| #69 | rights/attribution | proven | all Gate G rows are rights-complete; accepted rows retain attribution authority |
| #69 | accepted-evidence tasks | proven_in_scope | 32 image-mode claims yielded 32 accepted image-mode tasks; no semantic/source-search task is promoted |
| #69 | schemas and artifact registry | proven | Gate G/H v1 publications and this packet are versioned and registry-bound |
| #69 | separate dossier review | proven | a separate reviewer accepted every fully verified dossier |
| #69 | parent issue close | pending | the required measured metrics and full Gate H v2 authority remain open |
| #92 | explicit metric denominators | proven_in_scope | Gate H v1 records numerator, denominator, exclusions, and unavailable/null policy |
| #92 | false precision/hallucination examples | proven | CASTROL and additional observed failure controls are recorded |
| #92 | cost/time | proven | unavailable values remain null; no estimate is presented |
| #92 | accepted tasks | partial | 32 image-mode tasks are accepted by the completed independent review receipt; #97 source-only task and H2 task review are pending |
| #92 | component leakage | proven_in_scope | component/split checks are proven for the 32 published image-mode tasks |
| #92 | run report and parent matrix | pending | v1 is historical and v2 still contains pending rows; templates do not satisfy close |
| #92 | schema/registry/replay | proven_in_scope | v1 publication and this packet pass focused checks; H2 v2 tracked verifier/self-test remain pending because registered control `8c97cfd0…` is unavailable |
| #92 | issue close | pending | blocked on #96 measured evidence and #97 superseding publication |

## Formal decoupling

The following can be shown or reused independently of the experimental chain:

- the 32 accepted dossier specimen records and their overlays/projections;
- per-record rights and required attribution;
- the explicit visual evidence boundary and abstention language;
- the 60-record selection and component-safe lineage;
- the CASTROL false-precision example and refusal controls;
- the 32 accepted image-mode benchmark tasks.

The following remain research-only and must not be represented as client
results:

- OCR/entity/place model quality, aerial land-use quality, geolocation error,
  or model hallucination rates;
- source-only `c0-rpcq` task completion and private answer scoring;
- Gate H2 live prediction, private retention, Cloudflare/D1 authority, or
  publication;
- real Linux/Podman builds, conformance, or admission under #101. The H2 v2
  tracked verifier and self-test have not passed: they stop on the missing
  registered control `8c97cfd0b01d8baefd3e122a3d630ef85d535878024f73113e53bdc9a5421ee0`;
- any autonomous agent/operator or public publishing workflow.

No production/search-index mutation, paid GPU, provider/model request, deploy,
publication, or City Memory output occurred while producing this packet.
