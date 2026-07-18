# Gate H2 Post-Begin Authority Enrollment v1

Issue #104 freezes an inactive, source-pinned enrollment contract for the future #100 supervisor. The only production admission entry point loads the shipped source descriptor and enrollment itself, then always returns `H2_ENROLLMENT_INACTIVE` for this synthetic fixture. It accepts no adapter, fetch function, D1 account/database/endpoint, credential, enrollment path, key, socket, journal, report channel, or caller-selected root. It performs no provider or D1 call.

The descriptor binds the exact enrollment bytes, JSON schema, and migration. The enrollment binds the relay pin; verifier SPKI; D1 account ID, database ID, API endpoint, namespace, and coordinator-capability digests; and the endpoint, replay journal, report channel, authority, launch, and completion-expectations identities. The migration is append-only, rejects malformed or uppercase digests/commit, requires canonical RFC3339 UTC millisecond timestamps, stores only canonical ASCII JSON plus LF, forbids every JSON string escape in v1, measures document bytes as BLOB bytes, and blocks both `INSERT OR REPLACE` and upsert updates. SQLite does not reorder JSON object members or normalize number spellings, so migration v1 explicitly freezes the exact current JCS field-order grammar and canonical decimal spelling for file-pin byte fields at its boundary. The canonical fixture contains no backslashes. It is not a generic future-field admission format: any future schema requiring escaped characters needs its own migration grammar, and any future production enrollment version needs its own schema and migration grammar.

Issue #104 also defines the exact #100 handoff: an actual request byte sequence plus a `gate_h2_native_retained_fd_attestation_v1` input whose endpoint, replay-journal, report-channel, and D1 identities include retained native descriptor identities. Grant verification recomputes `request_sha256` from the exact supplied request bytes. Public string labels, TypeScript brands, same-UID ownership, or arbitrary JavaScript objects are not capabilities and are not a trust boundary. The #104 contract checker rejects copied labels without the required descriptor evidence, but it cannot authenticate an arbitrary JavaScript object.

Therefore #100 must obtain the inherited FDs/descriptors in native Rust, validate them against the enrolled root, bind the actual endpoint/journal/report/D1 capability to the trusted grant, and call the composed admission only through that coordinator-owned boundary. Until an independently deployed exact D1 row, fixed coordinator credential/capability boundary, and #100 native attestation exist, production admission cannot succeed. #104 does not claim that #100 implementation, a D1 deployment, credentials, a signer, provider access, Podman/Linux conformance, or #101 independent evidence is complete.

A completion readback with no row remains indeterminate. The future supervisor must reconcile the exact immutable attempt; only its exact completion row succeeds, conflicting rows fail closed, and no-row results are never automatically rerun.

Run:

```bash
npm run dataset-factory:post-begin-authority-enrollment-self-test-v1
npm run dataset-factory:post-begin-authority-enrollment-integration-test-v1
```

The self-test covers source tamper, inactive admission, valid grant A versus request B, copied labels without descriptor evidence, endpoint/replay/report/D1 substitution, real-SQLite migration constraints including every nested object-order shape, all file-pin byte spellings, escaped ASCII/non-ASCII/slash strings, `INSERT OR REPLACE`, upsert, update/delete, and completion reconciliation. The integration test covers every exact readback field, missing/duplicate rows, and changed schema attestation without contacting Cloudflare.
