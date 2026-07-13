# Ground Claim Adjudication v1

This Issue #69 Gate C artifact binds exactly seven Gate B pending ground claims to immutable predecessor files, a source-family graph, a sealed Sol Medium primary review, and a completed independent Sol High adjudication. The independent adjudication is authoritative for the seven dispositions in this artifact. It is not promotion authority.

The final authority member is `independent-adjudication-v1.json`. It is the exact 7,724-byte reviewer-authored file with SHA-256 `d97fafe4095dcbcdf80a19353af67728d3e85f5d5a5a7dd9c5bd5992ccd79fdf`. Its adjudicator identity and review session are both `019f5cea-fa84-7da0-be11-29d272f96521`. Verification pins all three values. A different identity, session, or merely schema-valid replacement file is rejected and requires an explicit new version and review.

`independent-adjudication-template-v1.json` remains in the bundle as blank `not_started` pre-review provenance. It is not final authority and cannot replace the completed member.

## Final dispositions

- Accepted: 0
- Held at medium confidence: `c0-rpcq`, `c10-spelling`, `c100-date`, `c102-date-address`
- Rejected at medium confidence: `c101-laphkas`
- Abstained at low confidence: `c0-lovell`, `c105-tilden`
- Promotion eligible: 0
- Verified claims, verified dossiers, benchmark tasks, and search tasks: 0

The reviewer retained unresolved source observations without turning marker matches, unreviewed manual transcriptions, predecessor metadata, or multiple unreviewed families into accepted facts. The `c101-laphkas` negative claim was rejected because its 1927 locator cannot establish the later scene's "not Osborne" proposition. For `c105-tilden`, whole-scene wording does not establish the exact directory address, a corporate join, an operator attribution, or scene linkage.

Issue #69 remains open. Independent adjudication is complete, but there are no accepted or promoted claims, no verified dossiers, and the issue-wide 60-record / 25-dossier target is unmet.

## Validation boundary

Verification compares the seven canonical predecessor paths and bytes to Git commit `eead4a62e519373e736a3914cd755fc41c3ece14` with `git show`. It regenerates the complete claim-packet projection from Gate B and checks claim order, source relationships, family derivation, URLs, propositions, evidence state, limitations, and rights exactly.

Every authority row must cover one sealed packet claim, preserve the packet's complete supporting and opposing source lists, and name exactly the supporting families derived from those sources. Sources cannot change roles, cross claim packets, or disappear; families cannot be fabricated, omitted, or duplicated. `held` permits low or medium confidence, `rejected` permits medium or high, and `abstained` requires low. Gate C added no newly pinned independently reviewed external evidence, so `accepted` is forbidden, `promotion_eligible` is always `false`, and `promotion_contract` is always `null`.

Status counts derive from the completed authority, not the primary review. The status records completed disposition authority, false promotion authority, the exact adjudicator/session and file SHA, zero downstream outputs, no production mutation, and the still-open issue. The descriptor enumerates the exact seven non-descriptor members and their bytes and hashes. Registry verification binds the full eight-file tree count, byte count, digest, lineage, authority semantics, rights boundary, and publication command.

## Publication and replay

The publication command validates an external completed adjudication against the schema, sealed inputs, primary-review seal, exact packet evidence, no-promotion rule, approved reviewer/session ID, and approved SHA. It copies the authority bytes without parsing and rewriting them, derives status and descriptor, and reseals the registry row.

The build command treats the tracked authority member as immutable external input. It rebuilds the primary candidate and derived members around those exact bytes. The integration test performs two clean rebuilds and requires every rebuilt member, including the authority file, to match the tracked final artifact byte for byte. Code never generates reviewer decisions.

```bash
npm run dataset-factory:ground-claim-adjudication-validate-independent-v1 -- /path/to/approved-independent-adjudication.json
npm run dataset-factory:ground-claim-adjudication-publish-v1 -- /path/to/approved-independent-adjudication.json
npm run dataset-factory:ground-claim-adjudication-build-v1
npm run dataset-factory:ground-claim-adjudication-verify-v1
npm run dataset-factory:ground-claim-adjudication-self-test-v1
npm run dataset-factory:ground-claim-adjudication-integration-test-v1
```

The self-test preserves the original 76 adversarial cases and adds authority-specific rejection cases for byte/SHA replacement, reviewer identity/session substitution, disposition/source/family changes, missing or fake final authority, status drift, and final member omission/addition. No command creates accepted-claim, dossier, benchmark, search, or production outputs.
