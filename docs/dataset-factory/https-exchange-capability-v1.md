# Gate H2 Exact HTTPS Exchange Contract v1

This contract authorizes a raw-network-isolated stage to request an exact, pre-reviewed HTTPS exchange from a host broker. It defines authority and evidence only. It does not implement networking, activate an authority, identify a provider, carry credentials, or authorize a model request.

## Boundary

- The stage network namespace remains deny-all. It has no DNS, TCP, UDP, proxy, or `CONNECT` surface.
- The host broker owns DNS, IP filtering, TLS, SNI, PKIX, auth injection, redirects, retries, compression handling, deadlines, and byte limits.
- The stage sees only an owner-bound Unix socket, a one-run token, opaque `h2h_` handles in exact order, its reviewed request artifact, and the raw-response output artifact.
- The full destination manifest and provider authentication material are authority-side inputs. They are forbidden from visual and source-search predictor bundles.
- The predictor cannot supply a URL, method, headers, auth, redirect/retry behavior, status/type allowlist, size limit, deadline, or exchange order. The UDS request schema has no fields for them.

## Versions and identifiers

The schemas are:

- `gate_h2_https_exchange_capability_v1.0.0`
- `gate_h2_https_exchange_manifest_v1.0.0`
- `gate_h2_https_exchange_uds_v1.0.0`
- `gate_h2_https_broker_event_v1.0.0`
- `gate_h2_https_broker_transcript_v1.0.0`
- `reviewed_metrics_execution_authorization_v2.5.0`
- `reviewed_metrics_stage_program_v2.2.0`
- `reviewed_metrics_executor_semantics_attestation_v2.2.0`
- `reviewed_metrics_executor_conformance_receipt_v2.2.0`
- `reviewed_metrics_linux_sandbox_attestation_v2.5.0`
- `reviewed_metrics_blind_instructions_v2.1.0`
- `reviewed_metrics_blind_bundle_descriptor_v2.1.0`
- `reviewed_metrics_source_search_bundle_v2.1.0`

Every ID-bearing object contains an exact byte pin for its own tracked schema. IDs are lowercase SHA-256 over a schema-bound ASCII domain separator, one NUL byte, and RFC 8785 JCS bytes of the object with only its own ID field removed. The self-schema pin remains in the hashed object:

```text
capability_id = SHA256("gate-h2-https-exchange-capability-v1-schema-bound" || 0x00 || JCS(capability without capability_id))
manifest_id   = SHA256("gate-h2-https-exchange-manifest-v1-schema-bound"   || 0x00 || JCS(manifest without manifest_id))
event_id      = SHA256("gate-h2-https-broker-event-v1-schema-bound"        || 0x00 || JCS(event without event_id))
transcript_id = SHA256("gate-h2-https-broker-transcript-v1-schema-bound"   || 0x00 || JCS(transcript without transcript_id))
```

The contract restricts all JSON numbers to safe integers. Parsing uses fatal shortest-form UTF-8, forbids a BOM, detects duplicate keys before object construction, rejects lone surrogates, and rejects floating-point, exponent, non-finite, and negative-zero representations. JCS object keys use ECMAScript UTF-16 code-unit ordering and strings use ECMAScript JSON escaping.

The provider-neutral oracle in `fixtures/https-exchange-contract-v1` fixes these values:

| Identifier | SHA-256 |
| --- | --- |
| capability | `359e701ebccd00c25252ea17f22f6b3a78e2d8798cd9537f7ab066bdbbcc6d59` |
| manifest | `c559f93254839a9866f92c201fe2745a9646d09be7b4fe4c63179d4f0b55e331` |
| event 0 | `49c75aaddadee7d6c375d83803555f86658cf5e88d35f7664d9bf10ffc8a74f0` |
| event 1 (DNS) | `f081033bb268955b31b8001fc4df3b8a4d8c1decb2f20a231f17a6e6c0412438` |
| event 2 (TLS) | `36a7ea39ba9d7394de6ba9ca7853dcbef7cda09b1186d7367f2eda9fc42d5905` |
| event 3 (request) | `4b5c8a92c964c330dd98909b051b689d08301b8f92524256ea863dc00aa2d7f6` |
| event 4 (response) | `8eeae5fc9edf91513505b4844feeeeda43fb8e24ca56309e0281a93450426fd8` |
| transcript | `cfdf7556c09a97e8f30720d232f150ce9afb14df051c5aabbcf917a1fae96809` |

## Canonical request authority

The hostname is an exact lowercase IDNA A-label name without a trailing dot. Unicode hostnames, noncanonical A-labels, IP literals, userinfo, alternate ports, absolute URLs, scheme-relative paths, fragments, spaces, controls, lowercase percent escapes, and percent-encoded unreserved characters are rejected. Query pairs are ordered, nonempty `key=value` values; their order is authority.

Fixed request headers use a closed typed object, not arbitrary field-name/value pairs. The only permitted fields are media-type-valued `Accept` and `Content-Type`; their exact wire form is fixed as lowercase `accept: SP value CRLF` followed by lowercase `content-type: SP value CRLF`. Every typed request and response media value, including an accepted UDS `output_artifact.media_type` and broker-event `response_media_type`, is exactly `application/json`; other subtypes, aliases, casing, parameters, secret-bearing text, and unlisted values are rejected by standalone schema validation. Unknown fields are rejected, including every Host, auth, method override, connection, framing, forwarding, original/rewrite URL, proxy, cookie, client-IP, and routing family or casing alias. Auth is a broker-side policy and credential capability ID; auth material never appears in the manifest, protocol, event, or transcript. Bearer auth fixes the broker-owned lowercase `authorization` name. API-key auth permits only the reviewed provider-neutral lowercase `x-api-key` name, binds it into the capability ID, inserts it after fixed headers and before transport-owned headers, serializes `lowercase-name: SP value CRLF`, and rejects collisions before serialization.

DNS resolves once per exchange, rejects the whole answer set if any address is forbidden, connects only to that set, and forbids re-resolution. This closes rebinding and mixed-answer fallback. TLS requires exact-host SNI and hostname verification, system PKIX, TLS 1.3 minimum, and no custom roots. Redirects and automatic retries are forbidden. `identity` is the only content encoding. The handle is consumed on every attempt, including failure, so deadline and partial-send failures cannot replay.

## Ordering and evidence

Manifest ordinals start at zero, are contiguous, and equal `exact_exchange_count`; every capability has a unique raw-response output role. The broker rejects an unknown, repeated, expired, or out-of-order handle before networking. The transcript is one global non-interleavable state machine: ordinal N must finish before any event for N+1. Every attempt consumes its handle and produces the exact ordered lifecycle `handle_consumed`, `dns_resolved`, `tls_verified`, `request_sent`, and `response_committed`, or a strict lifecycle prefix followed by `exchange_failed`. Events and transcript bounds use finite, calendar-valid canonical RFC 3339 UTC timestamps with exactly millisecond precision and no leap seconds. Standalone event validation checks that calendar validity before schema-pin and event-ID semantics, so re-IDing an invalid date, leap second, or offset form cannot make it valid. Event evidence is type-specific and joins the exact manifest capability, ordinal, request artifact, and response policy. Successful stage completion requires `final_outcome: complete` and joins every exchange's committed response SHA-256 and byte count to the retained raw-response snapshot under that capability's unique role before the D1 completion append. Missing, duplicate, substituted, incomplete, or mismatched evidence fails closed. The final transcript binds the manifest, candidate, stage, token commitment, socket identity, counts, chronology, final outcome, and exact event list.

## Migration

Execution authorization v2.3 and v2.4 retain their historical deny-all meaning. Any legacy authority, stage operation, sandbox attestation, route receipt, executor receipt, stage ledger, or downstream receipt that records `allow_capabilities_only` is invalid and cannot be relabeled or automatically migrated. A v2.5 authority must be freshly reviewed and must bind exact manifest and schema bytes, v2.2 stage programs, v2.2 executor semantics and conformance evidence, a v2.5 sandbox attestation, and new broker transcripts. Its authorization schema defines successor stage-entry, execution-boundary, executor-bundle, and sandbox-pin structures directly; it does not inherit the incompatible v2.0 executor bundle. Schema and runtime mutation tests reject both v2.0 semantics and v2.1 stage-program substitution. Existing deny-all v2.3/v2.4 evidence remains parseable and retains its original meaning.

Predictor isolation is structural. Actual visual instructions and descriptors validate under strict v2.1 allowlisted schemas and bind the exact instruction, descriptor-schema, instruction-schema, and output-schema bytes. Actual source-search bundles validate under a strict v2.1 allowlisted schema and bind their own schema plus output-schema bytes. Recursive alias/URL/encoding scans remain defense in depth, but unknown camelCase, nested, or encoded authority carriers are rejected by schema before those scans can be relevant.

## Threat model

The contract fails closed against stage-supplied destinations and request policy, DNS rebinding and forbidden-address access, TLS/SNI downgrade, credential disclosure, redirects, retries after ambiguous writes, decompression expansion, request/response overrun, deadline overrun, handle replay, exchange reordering, duplicate JSON keys, Unicode/IDNA aliases, header smuggling, and predictor leakage. It does not prove the future broker implementation, OS socket ownership, resolver behavior, IP classification, TLS library, credential store, or atomic artifact writes. Issue #99 must implement and independently attest those controls without changing these semantics.

Run `npm run dataset-factory:https-exchange-contract-self-test-v1` for the fixed oracle and deterministic adversarial cases.
