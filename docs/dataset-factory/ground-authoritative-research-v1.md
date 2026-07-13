# Ground Authoritative Research v1

`ground-authoritative-research-v1` is Issue #69 Gate B for ground records `0`, `10`, `100`, `101`, `102`, and `105`. It captures bounded public-source observations and drafts pending claims. It does not promote historical, entity, place, or external claims; create verified dossiers; generate benchmark/search tasks; or mutate production.

## Commands

```bash
npm run dataset-factory:ground-authoritative-research-acquire-v1
npm run dataset-factory:ground-authoritative-research-build-v1
npm run dataset-factory:ground-authoritative-research-verify-v1
npm run dataset-factory:ground-authoritative-research-self-test-v1
npm run dataset-factory:ground-authoritative-research-integration-test-v1
```

Only acquisition uses the network. It accepts public `GET` requests to exact allowlisted URLs, rejects credentials, fragments, secret/signed queries, non-HTTPS URLs, and bodies over 4 MiB. Redirects are never followed: every observed 3xx is `redirect_rejected`, retains its status and a rejection reason, and may record only the `https` scheme, origin SHA-256, hostname-label count, normalized path segment count, path SHA-256, and sorted syntax-only query parameter names. Raw Location hostnames, origins, paths, and query values are never serialized. Sensitive detection canonicalizes Unicode/case and removes separators before checking specific stems such as `accessToken`, `authorizationCode`, `sessionId`, `cookieId`, `passwordReset`, `signatureVersion`, `xAmzSignature`, and API-key variants; exact `key` and `auth` are also sensitive while `monkey` is not. Sensitive query names are omitted, and sensitive hostnames retain no structural Location object. Acquisition validates every classifier and receipt semantically and against the standalone capture-input schema before writing. Build, verification, self-test, and integration replay are offline and deterministic from the independently pinned inputs.

## Evidence And Rights

BAnQ observations retain the stable catalogue URL, corrected edition family, exact printed/viewer locator, researcher/manual provenance, bounded transcription, pending-review status, and a transcription-only policy. HTTP success never validates a manual transcription. No BAnQ scan, viewer PDF, or newspaper bytes are tracked. Exactly four online sources use `markers_required`; each requires at least three independent concepts covering record/page identity, entity identity, and proposition-specific facts after a 2xx response with the declared media type. Marker matching uses exact contiguous Unicode-normalized, accent-folded, case-folded alphanumeric token sequences; numeric tokens and phrase boundaries are exact, while punctuation and hyphen variants normalize safely. Marker-required pages with none/partial matches use `marker_incomplete`, never generic transport-only. The other 21 online sources are transport-only and cannot become proposition evidence. Strict superstrings, concatenated phrases, generic/login pages, 404 bodies, and wrong-media bodies cannot become evidence. Raw response bodies are not tracked, and no observation is promotion-eligible.

The source graph treats Ville de Montreal VM94 finding aids, predecessor CSV rows, and item pages as one family; each Lovell edition is one family; and three CIPO records are one register family. Lovell record 10 sources are 1932 and the `529178*` directory sources are 1948. Distinct La Presse dossier and Armour Landry catalogue records are independent nodes without self-edges. Claim rows remain `pending_claim_review`, include per-source evidence status and limitations, require separate review, are explicitly ineligible for promotion, and have a null promotion target.

## Artifact

The tracked fixture is `docs/dataset-factory/fixtures/ground-authoritative-research-v1/`. Strict schemas are under `docs/dataset-factory/schemas/ground-authoritative-research-v1/`. Every receipt binds immutable `source_mode`, `source_policy`, expected marker count/digest, matched count, and `none|partial|complete` state. Both capture schemas enforce the same source/outcome matrix and complete ten-way contract: the previous nine outcomes plus `marker_incomplete`. Lead/predecessor sources are never requested; manual sources never become transport/marker evidence; context sources can only produce context transport success; marker-required sources can only produce incomplete or complete marker success. Source-aware semantic verification re-derives every classifier field and enforces classifier precedence, accepted media, exact effective URL, and exact marker ordering. Independent pins protect canonical authoring semantics and accepted retrieval receipts even when the outer descriptor is bypassed.

Record 10's `Perreault` spelling is bound to the exact predecessor City archive CSV row and never to the avenue-des-Pins toponymy dataset. For record 102, RPCQ supports annex `1947-1948` and `1001`, Parks exposes `1101/1001`, City metadata alone supplies `25 April 1947` and `1086 Osborne`, and `A17-VM-05` is restricted to street reconfiguration/history context.

Current counts are six research records, seven pending claims, seven explicit contradiction/unresolved rows, zero promoted claims, zero verified dossiers, zero benchmark tasks, and zero search tasks.

RPCQ document `105269` is represented by two bounded observations for records 100 and 102 under one family-limited document family. Duplicate URLs or duplicate captured-body hashes cannot count as independent corroboration. Record 102 City metadata is derived from and hash-bound to numeric row `102` in `selected-ground-rows-v1.json`, including that row's exact authoritative `source_url` and CSV-row hash. The source-acquisition artifact and ground originals are therefore both direct registry dependencies.
