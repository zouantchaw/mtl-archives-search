# Issue 69 Phase D Scale Selection v1

Phase D is published under the immutable fresh Sol High reviewer receipt `reviewer-selection-receipt-v1.json`, SHA-256 `12f5c0a6b97c04bf6acf2417bd4aac2358ef98385decd55b3b4a8d5a0fc65898` (3,224 bytes). It deterministically selects 60 component-safe records across 60 Visual Family Graph components: 30 ground, 20 aerial, and 10 controls. It retains all 12 pilots; 10 also carry exact Gold Label Batch 002 authority, while records `0` and `11118` remain pilot-independent-review-only. The other 48 records are deterministic Gold additions. Counts remain zero for newly externally verified claims, verified dossiers, and accepted tasks; the dossier shortfall remains 25. Issue #69 therefore remains open and incomplete.

`seal` verifies every descriptor member in the restored Gold, canonical recovery, pilot promotion, and pilot independent-review artifacts. It also reads the real-pilot-intelligence descriptor from its immutable predecessor Git blob, requires the tracked descriptor to be byte-identical, and verifies its complete 45-member tree, including all 12 JSON dossiers. The five archives contain 1,867 members and 606,895,475 member bytes. Every embedded row carries its exact artifact ID, descriptor member path/hash, one-based line number, and row hash. The archive manifest records descriptor/bundle/tree/member/byte bindings and explicitly does not describe a plain member SHA as a Merkle inclusion proof. Verification re-derives every record's mode, observed signal count, Gold rank, control predicate, primary stratum, selection basis, component exclusion, and final order from authenticated embedded source rows.

The source-membership receipt contract binds all 1,210 source-reference occurrences, including repeated selection and adjudication rows; it does not collapse them to a unique set. Every occurrence is checked against the archive manifest, conflicting member hashes for one logical row identity are rejected, and selected-record/replay duplicates must match on the complete artifact/member/member-hash/line/row-hash tuple.

Records `0` and `11118` embed their exact primary promotion and independent-review JSONL rows. Verification requires matching record/promotion IDs, selected dispositions, agreement, distinct reviewer identities, and the exact reviewed-image hash shared with the pending pilot dossier derivative. Each dossier pin must match the predecessor-authenticated descriptor member exactly. Pilot-only rights completeness is derived only after the predecessor-authorized license, attribution, license-evidence, attribution-evidence, and scope fields are present; pilot derivative bytes must match content authenticated by the canonical recovery descriptor. This is record-level visual-selection authority only; dossier-level review remains pending.

## Verification Commands

The canonical recovery descriptor also covers restored members outside its report directory, so `--recovery-root` is the restored repository root. `--gold-root` is the restored Gold report directory. `--pilot-root` contains `promotion/` and `independent-review/`.

```bash
npm run dataset-factory:phase-d-scale-verify-v1
npm run dataset-factory:phase-d-scale-verify-fresh-sources-v1 -- \
  --gold-root /fresh/data/mtl_archives/reports/gold_label_batch_002 \
  --recovery-root /fresh/repository-root \
  --pilot-root /fresh/data/mtl_archives/reports/verified_multimodal_batch_001_real_pilot
npm run dataset-factory:phase-d-scale-self-test-v1
npm run dataset-factory:phase-d-scale-integration-test-v1
```

The integration test separately reconstructs the five-file candidate state without a receipt, then publishes the exact tracked receipt into that temporary candidate and proves the resulting six files plus registry contract are byte-identical to the authoritative tracked state. It never invokes the ordinary candidate build against the published fixture. Ordinary build now fails closed before writing whenever the published receipt exists.

## Fresh Sol High Receipt

The reviewer starts from `docs/dataset-factory/fixtures/phase-d-scale-v1/reviewer-selection-receipt.template-v1.json` and must produce a separate file conforming to `docs/dataset-factory/schemas/phase-d-scale-v1/reviewer-selection-receipt.schema.v1.json`. Candidate sealing prepopulates immutable bindings for the selection, archive manifest, all 1,210 source-membership occurrences, all five archive descriptor/bundle/tree/member/byte summaries, and counts. The reviewer must freshly restore and reverify the four restored/reconstructed source artifacts and reverify the fifth real-pilot-intelligence artifact against its immutable predecessor Git descriptor/member tree, run fresh-source verification, independently recompute the 60-record selection and all joins/predicates, and preserve those exact prepopulated bindings. The reviewer changes only the receipt schema/status, reviewer identity and timestamp, attestations, and notes; publication rejects any binding drift. Do not edit or replace candidate selection bytes.

The authority was published with the following command contract. It validates all bindings, byte-preserves the supplied receipt, seals final status/descriptor/registry, and refuses a second receipt:

```bash
npm run dataset-factory:phase-d-scale-publish-receipt-v1 -- --receipt /path/to/fresh-sol-high-completed-receipt.json
```

The receipt is now published and immutable, so this command and ordinary build both refuse to overwrite it. Verify, self-test, and integration are read-only against the tracked fixture. There is no unrestricted registry reseal command. The registry classifies this reviewer-authored publication as canonical `review_assisted` generation with no `human_input_ids`; the exact receipt hash remains explicit in lineage and the descriptor rather than being represented as an artifact ID.
