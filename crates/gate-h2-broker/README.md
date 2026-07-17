# Gate H2 HTTPS broker runtime

This crate is the inactive issue #99 production implementation of the merged issue #98 exact-exchange contract. It adds no destination manifest, provider credential, admitted launch configuration, or Cloudflare/D1/R2/prediction/publication authority.

## Implemented boundary

- `ProductionNetworkClient` resolves exactly once, rejects the complete answer set if any address is special-use, pins one allowed IPv4/IPv6 socket, verifies the connected peer, and performs exact-host rustls TLS 1.3 SNI/PKIX with byte-pinned native roots.
- Upstream HTTP/1.1 uses exact origin-form target, Host, fixed/auth/transport header order, one content length, identity encoding, connection close, monotonic connect/exchange budgets, streaming caps, and no proxy environment, redirect, retry, decompression, transfer encoding, or ambiguous trailing bytes.
- The launcher uses a constructible two-part admission. `GATE_H2_ADMITTED_CODE_ID` embeds a reviewed source/build identity that is independent of the final executable bytes; the domain-separated config ID then binds every exact config field, including that identity and the measured broker binary `FilePin`. This removes the executable SHA fixed point while preserving exact code and config admission. Normal builds carry no admitted code identity.
- A fresh owner-only UDS authenticates the peer UID and exact one-use token/handle/order. Required request/response headers, safe-integer JSON, lengths, EOF, read/write/accept deadlines, owner/mode/parent checks, and terminal failure sealing are enforced. A final accepted response is released only after both transcript files and the Ed25519 envelope are fsynced.
- The stage runtime validates every v2.2 field and schema pin, binds exact program bytes to a host authority, joins inputs/handles/capability IDs/output roles/statuses/indexes, and re-hashes the retained raw-response bytes before writing a receipt. It uses fixed-root descriptor-relative `O_NOFOLLOW` reads with regular-file and single-link checks.
- Every consumed handle produces a valid v1 lifecycle ending in `response_committed` or `exchange_failed`. The unchanged v1 transcript is validated by the #98 TypeScript oracle. A closed v2 envelope signs the exact v1 bytes with Ed25519 and binds D1 begin/attempt, session, broker/runtime/root pins, socket/token commitments, manifest, signer trust entry, and outcome.

## Local verification

```bash
npm run gate-h2:broker-self-test
npm run dataset-factory:https-exchange-contract-self-test-v1
```

Tests use Unix sockets and local loopback TCP/rustls fixtures only. They do not contact DNS resolvers, proxies, providers, the internet, Cloudflare, R2, or D1.

## Issue #101 evidence gates

Run `scripts/build-stage-oci.sh` only from a clean reviewed Linux checkout with the pinned trust-root file. It first enforces every exact version-output identity and digest in `oci/toolchain-lock.v1.json`, including Rust/Cargo, musl GCC, Podman, GNU tar/readelf/coreutils, Git, rustup, and Node. It then creates two independent `git archive` source copies, isolated Cargo homes and target trees, verifies static ELF/no interpreter/no dynamic dependencies, compares exact binary and normalized rootfs bytes, builds two network-disabled OCI archives, compares their exact bytes and IDs, and writes the complete toolchain lock plus its SHA-256 into provenance only after success.

Issue #101 must independently retain Linux evidence for `SO_PEERCRED`, sealed memfds, static linkage, sandbox flags, and byte-identical binary/rootfs/OCI outputs. That evidence is not claimed by this macOS change. Production remains inactive until an external authority admits the exact launcher config and all referenced pins.
