# Gate H2 Builder Receipts v1

Issue #101 Packet 2 is a local, synthetic, pending, nonproduction reproducibility contract. It is not real Linux/Podman evidence, does not admit anything to production, and does not prove a real build.

## Frozen Contract

The tracked fixture is `dfv0_gate_h2_builder_receipts_v1_20260806`: exactly 4 files, 17,539 bytes, and sorted-tree-manifest SHA-256 `c9e2b0764b1070b479836abae1c7bd2fa362ad95710e3bd02f74c23c535a6688`. Its 81 ordered adversarial cases protect the fixture, recipe, receipt, comparison, registry, and Packet 1 dependency boundaries.

Immutable source identity is read from pinned Git objects at commit `4ddf00e812610e3e029059f25ad3d951577f667d`. The tracked recipe deliberately leaves the external builder image, vendor tree, trust roots, and tool-artifact pins pending/null. The synthetic two-build receipts and comparison exercise the future contract only; they do not establish independent observed builds or reproducibility.

## Commands

```bash
npm run gate-h2:builder-receipts-fixture-verify
npm run gate-h2:builder-receipts-self-test
npm run gate-h2:builder-receipts -- <mode> <args...>
```

Packet 2 performed no paid-host use, Podman execution, D1 access or mutation, credential use, provider/model call, activation, publication, or deploy. The next boundary is explicit approval to choose and pin external build inputs, run real independent Linux/Podman builds, and then perform real conformance/D1 admission.
