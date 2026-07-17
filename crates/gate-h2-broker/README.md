# Gate H2 HTTPS broker runtime

This crate is the inactive issue #99 production implementation of the merged issue #98 exact-exchange contract. It adds no destination manifest, provider credential, admitted launch configuration, or Cloudflare/D1/R2/prediction/publication authority.

## Implemented boundary

- `ProductionNetworkClient` resolves exactly once, rejects the complete answer set if any address is special-use, pins one allowed IPv4/IPv6 socket, verifies the connected peer, and performs exact-host rustls TLS 1.3 SNI/PKIX with byte-pinned native roots.
- Upstream HTTP/1.1 uses exact origin-form target, Host, fixed/auth/transport header order, one content length, identity encoding, connection close, monotonic connect/exchange budgets, streaming caps, and no proxy environment, redirect, retry, decompression, transfer encoding, or ambiguous trailing bytes.
- The launcher requires a detached Ed25519 authorization over the complete strict canonical launch config. `GATE_H2_ADMITTED_CODE_ID` embeds the reviewed code identity, while `GATE_H2_LAUNCH_AUTHORITY_TRUST_JSON` independently embeds the authority public key identity, minimum sequence, and owner-only replay-state directory. The signed config includes the measured final broker `FilePin`; bounded validity, rollback, wrong-key, unsigned, tamper, and durable one-use replay checks avoid both self-attestation and an executable-hash cycle. Normal builds carry neither trust input.
- A fresh owner-only UDS authenticates the peer UID and exact one-use token/handle/order. Required request/response headers, safe-integer JSON, lengths, EOF, read/write/accept deadlines, owner/mode/parent checks, and terminal failure sealing are enforced. Any evidence append/fsync fault after consumption permanently closes the broker; no response bytes are released unless its terminal evidence is durable, and invalid or nonterminal lifecycles cannot be sealed. A nonterminal response-delivery failure consumes the next capability and durably seals a failed lifecycle.
- The stage runtime validates every v2.2 field and schema pin, binds exact program bytes to a host authority, joins inputs/handles/capability IDs/output roles/statuses/indexes, and re-hashes the retained raw-response bytes before writing a receipt. Raw `.bin` outputs preserve exact arbitrary bytes, including zero bytes, newline endings, and empty bodies; JSON evidence is committed separately. It uses fixed-root descriptor-relative `O_NOFOLLOW` reads with regular-file and single-link checks.
- Every consumed handle produces a valid v1 lifecycle ending in `response_committed` or `exchange_failed`. The unchanged v1 semantics and IDs are validated by the #98 TypeScript oracle. Runtime transcript files have one exact representation—JCS UTF-8 plus one LF—and the v2 envelope hashes those retained bytes. Validation rejects reformatting and joins the envelope signer ID and key to an exact, schema-pinned trust-entry artifact before checking Ed25519.

## Local verification

```bash
npm run gate-h2:broker-self-test
npm run dataset-factory:https-exchange-contract-self-test-v1
```

Tests use Unix sockets and local loopback TCP/rustls fixtures only. They do not contact DNS resolvers, proxies, providers, the internet, Cloudflare, R2, or D1.

## Issue #101 evidence gates

Run `scripts/build-stage-oci.sh` only from a clean reviewed Linux checkout with the pinned trust-root file and an issue-#101-reviewed builder image supplied as both `name@sha256:<digest>` and a separate matching digest input. The host Podman process only starts that network-disabled, read-only builder; the single immutable image supplies every output-affecting compiler, linker, package cache, shell/coreutils, inspection, and OCI-assembly tool. Inside it, the script creates two clean `git archive` source copies and target trees, verifies static ELF/no interpreter/no dynamic dependencies, normalizes every archived mode under a fixed umask, constructs deterministic uncompressed-layer OCI layouts, compares exact binary/rootfs/archive/manifest bytes, and retains the builder reference, digest, lock, SBOM, and success-only provenance. The local check also compares synthetic OCI assembly launched under two caller umasks; the complete Linux build proof remains issue #101.

Issue #101 must independently retain Linux evidence for `SO_PEERCRED`, sealed memfds, static linkage, sandbox flags, and byte-identical binary/rootfs/OCI outputs. That evidence is not claimed by this macOS change. Production remains inactive until an external authority admits the exact launcher config and all referenced pins.
