# Gate H2 HTTPS broker runtime

This package is the issue #99 implementation surface for the reviewed issue #98 exact-exchange contract. It is inactive infrastructure: it grants no destination, credential, execution, provider, Cloudflare, D1, R2, prediction, publication, or deployment authority.

## Implemented local contract

- A fresh `0700` directory and `0600` Unix socket, peer-UID admission, HTTP/1.1 `POST /v1/exchange/<capability_id>` framing, and cleanup guard.
- Exact schema-bound manifest/capability admission, ordered single-use handles, one-run token commitment checks, request body/hash/byte checks, and typed auth insertion from inherited descriptors.
- Full forbidden IPv4/IPv6 and IPv4-mapped classification, whole-answer-set rejection, connected-peer pinning, strict observed TLS 1.3/ALPN policy, no redirect/retry/compression/chunked framing, status/media/byte/deadline failure codes, and deterministic injectable fixture transport.
- Fsynced raw outputs, schema-compatible hash-only events and transcript, and a detached HMAC-SHA-256 transcript signature. Provider credential bytes are zeroed on drop and never enter errors or evidence.
- A fixed-path static stage runtime that can access only the owner-bound UDS protocol and reviewed input/output paths.

The production network constructor is deliberately non-injectable and fail-closed in this commit. The no-network macOS environment did not contain pinned `rustls`, `webpki`, signature, test-certificate, or Linux musl sources. Fetching them would violate the issue run boundary, and substituting a subprocess or custom TLS/cryptography would violate the architecture.

## Local verification

```bash
./crates/gate-h2-broker/scripts/check-local.sh
npm run dataset-factory:https-exchange-contract-self-test-v1
```

All Cargo commands use `--locked --offline`. Tests use scripted observations only; they do not perform DNS, TCP, TLS, proxy, provider, or internet access.

## Retained issue #101 gates

Run `scripts/build-stage-oci.sh` only on a clean Linux worker with the reviewed trust-root bytes and hash. It hard-requires Linux, a musl target, Podman, two byte-identical clean static builds, two identical `FROM scratch` OCI image IDs, an exact rootfs inventory, SBOM, and provenance. Until that succeeds, do not claim Linux static linkage, real TLS/SNI/PKIX/connect pinning, sealed-memfd enforcement, OCI reproducibility, sandbox flags, or production readiness.

The production launcher remains disabled until those gates are proven and the merged transcript contract has an approved successor binding the D1 attempt/begin hash plus broker/runtime/trust pins. No existing v2.5 authority is activated by these files.
