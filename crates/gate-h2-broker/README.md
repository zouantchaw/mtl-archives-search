# Gate H2 HTTPS broker runtime

This crate is the inactive issue #99 production implementation of the merged issue #98 exact-exchange contract. It adds no destination manifest, provider credential, admitted launch configuration, or Cloudflare/D1/R2/prediction/publication authority.

## Implemented boundary

- `ProductionNetworkClient` resolves exactly once, rejects the complete answer set if any address is special-use, pins one allowed IPv4/IPv6 socket, verifies the connected peer, and performs exact-host rustls TLS 1.3 SNI/PKIX with byte-pinned native roots.
- Upstream HTTP/1.1 uses exact origin-form target, Host, fixed/auth/transport header order, one content length, identity encoding, connection close, monotonic connect/exchange budgets, streaming caps, and no proxy environment, redirect, retry, decompression, transfer encoding, or ambiguous trailing bytes.
- The launcher accepts only a domain-separated config whose ID exactly matches the build-time `GATE_H2_ADMITTED_CONFIG_ID` pin, verifies its own and stage-runtime bytes, and requires unique fully sealed inherited Linux memfds for the one-run token, every credential, and the base64url Ed25519 seed. Normal builds carry no admitted config pin.
- A fresh owner-only UDS authenticates the peer UID and exact one-use token/handle/order. Required request/response headers, lengths, EOF, read/write/accept deadlines, owner/mode/parent checks, and terminal failure sealing are enforced.
- The stage runtime validates every v2.2 field and schema pin, binds exact program bytes to a host authority, joins inputs/handles/capability IDs/output indexes, and uses fixed-root descriptor-relative `O_NOFOLLOW` reads with regular-file and single-link checks.
- Every consumed handle produces a valid v1 lifecycle ending in `response_committed` or `exchange_failed`. The unchanged v1 transcript is validated by the #98 TypeScript oracle. A closed v2 envelope signs the exact v1 bytes with Ed25519 and binds D1 begin/attempt, session, broker/runtime/root pins, socket/token commitments, manifest, signer trust entry, and outcome.

## Local verification

```bash
npm run gate-h2:broker-self-test
npm run dataset-factory:https-exchange-contract-self-test-v1
```

Tests use Unix sockets and local loopback TCP/rustls fixtures only. They do not contact DNS resolvers, proxies, providers, the internet, Cloudflare, R2, or D1.

## Issue #101 evidence gates

Run `scripts/build-stage-oci.sh` only from a clean reviewed Linux checkout with the pinned trust-root file. It creates two independent `git archive` source copies, isolated Cargo homes and target trees, verifies static ELF/no interpreter/no dynamic dependencies, compares exact binary and normalized rootfs bytes, builds two network-disabled OCI archives, compares their exact bytes and IDs, and writes provenance only after success.

Issue #101 must independently retain Linux evidence for `SO_PEERCRED`, sealed memfds, static linkage, sandbox flags, and byte-identical binary/rootfs/OCI outputs. That evidence is not claimed by this macOS change. Production remains inactive until an external authority admits the exact launcher config and all referenced pins.
