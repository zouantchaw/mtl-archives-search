# Reviewed Source Evidence v1

`reviewed-source-evidence-v1` is the published Issue #89 Gate E source-body review authority for all seven Gate B claims. Publication byte-preserved the approved Sol High receipt with SHA-256 `edfb27f4044812e9cf7b98f91b1b49921e98006053257f7192360b547ce508ef` and derived 1 accepted claim (`c0-rpcq`), 3 held, 1 rejected, and 2 abstained. Gate C and Phase D retain their separate authority boundaries; verified dossiers, tasks, and production mutations remain zero.

## Rights and storage boundary

Exact RPCQ and Parks Canada HTML bodies are captured under `/Users/wiel/pkm/0xPKM_Lab/04_outputs/mtl-archives/issue89-source-bodies/candidate-v1`. Their rights pages do not establish commercial redistribution permission, so all five bodies use `private_review_snapshot` and no raw HTML is tracked in Git. The tracked fixture contains only body hashes and byte counts, exact URLs, short factual passages, structured locators, and rights evidence.

The deterministic sanitized archive `reviewed-source-evidence-v1-private-snapshot.tar.gz` contains exactly five HTML bodies and five canonical `acquisition_transport_receipt_v1` JSON members. Each receipt is parsed from the adjacent curl metadata and final response-header block, retains only effective URL, status, Date, Content-Type, and optional Content-Length, and binds the body path/hash/bytes plus raw metadata byte/hash audit digests. Raw headers and cookie/auth values are never archived. The original request URL was not separately retained; the manifest truthfully labels it as configured generator input and requires it to equal the independently retained curl effective URL.

The 53,451-byte archive with SHA-256 `d94857447ad48178cf42c5baa17e54f7e2f430f1141e47dedfde2a24ade424c1` is durably stored in the private Cloudflare R2 bucket `wiel-codex-worker-cache` at object key `artifacts/mtl-archives/issue89-reviewed-source-evidence/d94857447ad48178cf42c5baa17e54f7e2f430f1141e47dedfde2a24ade424c1.tar.gz`. Direct readback was byte-identical at `2026-07-14T03:58:13Z`. The tracked receipt derives the durable `r2://` locator from that bucket/key and stores no presigned URL. This storage event is bound into the blank future reviewer template but does not create claim, dossier, task, registry, or production authority. The exact private `rpcq-105269` HTML still contains one origin-published Mapbox client token, bounded to that body only, while all sanitized acquisition metadata has zero unclassified credential-like occurrences.

Existing City predecessor metadata retains its previously established CC BY 4.0 boundary but remains one dependent City archive family; it cannot become independent external corroboration. Six BAnQ manual transcriptions/leads remain `citation_only_not_promotion_eligible`, and no scans are captured.

## Verification commands

```bash
npm run dataset-factory:reviewed-source-evidence-build-v1
npm run dataset-factory:reviewed-source-evidence-verify-v1
npm run dataset-factory:reviewed-source-evidence-verify-snapshot-v1
npm run dataset-factory:reviewed-source-evidence-self-test-v1
npm run dataset-factory:reviewed-source-evidence-integration-test-v1
```

Ordinary build refuses to overwrite published authority. Verification is offline and checks the exact ten-member archive, body/receipt/manifest transport bindings, raw metadata audit digests, strict header sanitization, credential classifications, rights boundaries, preserved candidate descriptor, reviewer receipt, published queue states, promotion ledger, final descriptor tree, and registry authority. Published counts are one accepted claim, zero verified dossiers, and zero tasks.

## Independent review and publication

A fresh Sol High reviewer starts from `independent-source-body-review-receipt.template-v1.json`, inspects the exact hash-bound private bundle and tracked bounded representations, and authors a new completed receipt. The receipt binds every claim, exact wording, body, representation, proposition, source family, rights record, predecessor pin, reviewer identity/session, and independence attestation. URL availability, marker matches, same-family repetition, body hashes, and City metadata laundering are never proposition support. An accepted composite claim requires explicit support for its complete wording.

The blank template deliberately records `null` for `candidate_descriptor_sha256` and `candidate_tree_sha256`, avoiding circular self-reference through the template member. The reviewer must replace exactly those two binding values with the SHA-256 of the validated candidate `descriptor-v1.json` bytes and its independently recomputed exact-member tree SHA-256. Receipt validation rederives every top-level and detailed binding directly from current artifacts and predecessor files; it does not trust the template as evidence. Publication preserves the exact pre-publication descriptor bytes as `candidate-descriptor-v1.json`, allowing published verification to continue rederiving the receipt's original candidate seal while the final descriptor separately binds the authority receipt and derived files.

Implementation code cannot author final dispositions. The publication command validates a fresh external receipt, byte-preserves it, derives the promotion ledger, status, descriptor, and canonical registry row, and refuses a second publication:

```bash
npm run dataset-factory:reviewed-source-evidence-validate-receipt-v1 -- --receipt /path/to/fresh-sol-high-receipt.json
npm run dataset-factory:reviewed-source-evidence-publish-v1 -- --receipt /path/to/fresh-sol-high-receipt.json
```

The approved receipt was published once; subsequent publication attempts are rejected before mutation. No production search, index, D1, Vectorize, Worker, website, deployment, issue, or PR state is changed by this artifact.
