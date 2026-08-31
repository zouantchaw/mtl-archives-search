# Gate H2 Builder Packet 3A v1

Issue #101 Packet 3A is a local, no-secrets, pre-launch implementation contract. It is not real Linux evidence and is not a completed Issue #101 build. The candidate received an independent APPROVE with P0/P1/P2/P3 all zero; that review does not change this boundary.

## Historical Packet Boundary

Packet 1 and Packet 2 remain merged historical synthetic/local contracts. The frozen Packet 2 four-file fixture, `dfv0_gate_h2_builder_receipts_v1_20260806`, and its pending recipe remain byte-for-byte historical evidence. The fixture is exactly 4 files, 17,539 bytes, with sorted-tree-manifest SHA-256 `c9e2b0764b1070b479836abae1c7bd2fa362ad95710e3bd02f74c23c535a6688`; its 81 ordered adversarial cases bind source identity to Git commit `4ddf00e812610e3e029059f25ad3d951577f667d`. Packet 2's old pending tool-floor statements are historical and are not the future runtime floor. No Packet 2 fixture or recipe bytes are changed by Packet 3A.

## Future Builder Floor

The future builder must use Rust/Cargo `1.85.0` for the Rust 2024 crate and Node `22.22.0`. These are the actual future runtime requirements for Packet 3A's implementation contract; they do not turn the local contract into a real build result.

The image-owned runtime closure must prove exact root-owned, non-symlink `0755` directories, an exact runtime inventory, offline Cargo vendor/config and isolated Git configuration, the musl compiler and linker subtools plus the inventoried `libc.a`, CMake, Ninja, and all other absolute tool paths. The build target is static ELF64 little-endian x86-64 for `x86_64-unknown-linux-musl`; ELF linkage and interpreter checks are part of the contract.

## Source Proof And Snapshot

The retained staging receipt carries the SHA-256 measured from the original source-descriptor file descriptor. That digest is passed into both image verification and host admission, so post-staging pathname substitution cannot be hidden by replacing the descriptor path.

The image-owned proof binds the descriptor to the claimed Git commit and tree, the exact source archive, the sorted allowlist, and exact Git tree/blob bytes and modes. It compares the mounted source and archive members to `git cat-file blob` bytes and rejects `.gitattributes` or any other transformed archive/source bytes. It then creates a measured source snapshot, seals executable members to `0555` and other members to `0444`, seals directories to `0555`, and remeasures the snapshot before the unprivileged build. Both build passes consume that same measured snapshot.

## Rootless Build Boundary

The host contract requires rootless Podman with `keep-id` mapping to `65532:65532`. Inputs are read-only. The container starts a root proof supervisor with no-new-privileges and only `SETUID`, `SETGID`, and `SETPCAP`; it must prove the exact drop to uid/gid `65532` with no child capabilities. Writes are confined to the dedicated candidate, helper, expected-SBOM, and unprivileged work/output locations. Root-only temporary and measured-snapshot locations have the reviewed modes and mount flags; the network is disabled.

## Outputs And Admission

The builder derives the expected SBOM from `cargo tree`; the candidate SBOM is independently derived from Cargo metadata. Their exact bytes must agree or the build fails. Exactly two host helper families, `gate-h2-publish-noreplace` and `gate-h2-secure-candidate-read`, are independently rebuilt in the two target trees, compared byte-for-byte, emitted with pass-specific digests, and host-admitted from verified retained descriptors. Host code does not compile these helpers.

The candidate outputs include static binaries, deterministic rootfs and OCI bytes, provenance, and SBOM material. Host admission remeasures the candidate and joins source, toolchain, image, helper, binary, rootfs, OCI, trust-root, Cargo lock, and SBOM identities before any future publication authority could exist. This Packet 3A document describes the contract only; it is not an admission receipt.

## Local Verification

The full local gate is `npm run gate-h2:broker-self-test`: it covers 145 Rust tests plus the protocol, module-graph, verified-helper, host-helper, OCI, and rootless staging tests. The frozen Packet 2 verification remains unchanged:

```bash
npm run gate-h2:broker-self-test
npm run gate-h2:builder-receipts-fixture-verify
npm run gate-h2:builder-receipts-self-test
```

These checks are local and no-secrets. They do not provide real Linux/Podman evidence.

## Remaining Work

The approved next boundary is to select and review immutable external builder-image, base, vendor, and trust/tool pins; materialize the offline image; run two independent real x86 Linux builds; compare their receipts; and terminate the workers. Later Issue #101 Podman, network, lifecycle, broker, D1, and admission packets still remain.

No paid host, real Podman build, D1 access or mutation, provider/model call, activation, publication, production deploy, or production authority occurred in Packet 3A.
