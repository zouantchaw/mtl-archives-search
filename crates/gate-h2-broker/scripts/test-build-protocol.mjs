import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateImageOwnedRuntimeMembers, validateMuslRuntimeContract, validateRuntimeClosure, validateRuntimeDirectory } from "./runtime-closure-core.mjs";
import { validateElfReports } from "./verify-static-musl-elf.mjs";
import { boundarySetprivArgv, validateChildStatus, validateReadOnlyMounts, validateSupervisorStatus, verifyDescriptorDigest } from "./verify-rootless-boundary.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = resolve(scripts, "..");
const lockPath = join(crate, "oci", "toolchain-lock.v1.json");
const verifier = join(scripts, "verify-toolchain-lock.mjs");
const prepare = join(scripts, "prepare-trusted-build-inputs.mjs");
const digest = "a".repeat(64);
const image = `builder.invalid/gate-h2@sha256:${digest}`;
const root = mkdtempSync(join(tmpdir(), "gate-h2-build-protocol-"));

try {
  const lock = JSON.parse(readFileSync(lockPath));
  for (const [label, mutate] of [
    ["rust", (value) => { value.tool_versions.rustc = "1.82.0"; }],
    ["cargo", (value) => { value.tool_versions.cargo = "1.82.0"; }],
    ["node", (value) => { value.tool_versions.node = "22.21.0"; }],
  ]) {
    const candidate = structuredClone(lock); mutate(candidate);
    const path = join(root, `${label}.json`); writeFileSync(path, `${JSON.stringify(candidate)}\n`);
    if (spawnSync(process.execPath, [verifier, path, image, digest], { stdio: "pipe" }).status === 0) throw new Error(`toolchain lock accepted wrong ${label} version`);
  }
  for (const [label, mutate] of [
    ["ldd-path", (value) => { value.runtime_paths.ldd = "/usr/bin/ldd"; }],
    ["proof-core-path", (value) => { value.image_source_proof_core = "/tmp/verify-source-proof-core.mjs"; }],
    ["boundary-core-path", (value) => { value.image_rootless_boundary_verifier = "/tmp/verify-rootless-boundary.mjs"; }],
    ["musl-target", (value) => { value.musl_toolchain.compiler_target = "x86_64-linux-gnu"; }],
    ["musl-libc", (value) => { value.musl_toolchain.libc_archive = "/usr/lib/libc.a"; }],
    ["native-cmake", (value) => { value.runtime_paths.cmake = "/usr/bin/cmake"; }],
    ["runtime-directory-policy", (value) => { value.runtime_directory_policy = "group_writable_directories_allowed"; }],
    ["source-descriptor-continuity", (value) => { value.source_descriptor_continuity = "reopened_staged_path"; }],
  ]) {
    const candidate = structuredClone(lock); mutate(candidate); const path = join(root, `${label}.json`); writeFileSync(path, `${JSON.stringify(candidate)}\n`);
    if (spawnSync(process.execPath, [verifier, path, image, digest], { stdio: "pipe" }).status === 0) throw new Error(`toolchain lock accepted mismatched ${label} runtime contract`);
  }
  const duplicateLock = readFileSync(lockPath, "utf8").replace("\n}", ',\n  "target": "x86_64-unknown-linux-musl"\n}');
  const duplicateLockPath = join(root, "duplicate-lock.json"); writeFileSync(duplicateLockPath, duplicateLock);
  if (spawnSync(process.execPath, [verifier, duplicateLockPath, image, digest], { stdio: "pipe" }).status === 0) throw new Error("toolchain lock accepted a duplicate JSON field");
  const noCargoPath = join(root, "no-cargo-bin");
  const prepared = spawnSync(process.execPath, [prepare, resolve(crate, "..", "..")], { env: { ...process.env, PATH: noCargoPath }, encoding: "utf8" });
  const expectedLock = createHash("sha256").update(readFileSync(join(crate, "Cargo.lock"))).digest("hex");
  if (prepared.status !== 0 || prepared.stdout.trim() !== expectedLock) throw new Error(`host preparation depended on Cargo: ${prepared.stderr}`);
  const outer = readFileSync(join(scripts, "build-stage-oci-from-export.sh"), "utf8");
  if (outer.includes("cargo tree") || outer.includes("rustc ")) throw new Error("export-only orchestrator invokes a host Rust tool");
  const inner = readFileSync(join(scripts, "build-stage-oci-inner.sh"), "utf8");
  for (const required of ["--locked --offline", "CARGO_NET_OFFLINE=true", "CARGO_HOME=/opt/gate-h2/cargo-home", "0:0:444", "Cargo registry or Git cache is forbidden", "exact Cargo 1.85.0", "exact Rust 1.85.0", "exact Node 22.22.0", "Cargo configuration ancestor is forbidden", "verify-builder-runtime.mjs", "unexpected builder environment variable", "-dumpmachine", "-print-file-name=libc.a", "CC_x86_64_unknown_linux_musl", "CXX_x86_64_unknown_linux_musl", "AR_x86_64_unknown_linux_musl", "CMAKE_x86_64_unknown_linux_musl", "CMAKE_GENERATOR_x86_64_unknown_linux_musl=Ninja", "verify-static-musl-elf.mjs", "cd \"$CRATE_ROOT\""]) {
    if (!inner.includes(required)) throw new Error(`inner builder lost required protocol guard: ${required}`);
  }
  if (!readFileSync(join(scripts, "compare-trusted-sbom.mjs"), "utf8").includes("independent Cargo metadata SBOM differs")) throw new Error("SBOM comparison helper lost exact rejection");
  const snapshot = readFileSync(join(scripts, "verify-and-snapshot-source.sh"), "utf8");
  const proofCore = readFileSync(join(scripts, "verify-source-proof-core.mjs"), "utf8");
  const completeRuntimeConsumers = `${outer}\n${inner}\n${snapshot}`;
  for (const path of [...Object.values(lock.runtime_paths), lock.musl_toolchain.libc_archive, lock.image_source_snapshot_verifier, lock.image_source_proof_core, lock.image_rootless_boundary_verifier]) {
    if (!completeRuntimeConsumers.includes(path)) throw new Error(`toolchain lock runtime member has no exact protocol consumer: ${path}`);
  }
  const sixBinaries = "for binary in gate-h2-broker gate-h2-stage-runtime gate-h2-publish-noreplace gate-h2-secure-candidate-read gate-h2-podman-supervisor gate-h2-post-begin-handoff";
  if (!inner.includes(sixBinaries)) throw new Error("ELF validation no longer covers all six built binaries");
  for (const required of ["/opt/gate-h2/libexec/verify-source-proof-core.mjs", "\"$GIT\"", "\"$TAR\""]) {
    if (!snapshot.includes(required)) throw new Error(`image verifier lost canonical runtime member: ${required}`);
  }
  for (const required of ["mounted source descriptor differs from retained staging receipt", "source archive digest differs from descriptor", "duplicate JSON field", "mounted or archived source differs from exact Git blob"]) {
    if (!proofCore.includes(required)) throw new Error(`image-owned source proof core lost proof guard: ${required}`);
  }
  if (snapshot.includes('${CRATE_ROOT}') || outer.includes("verify-and-snapshot-source.sh\" >")) throw new Error("host can still supply a mutable source verifier");
  if (!outer.includes("--entrypoint /opt/gate-h2/bin/env") || !outer.includes("-w /workspace \"$GATE_H2_BUILDER_IMAGE\" -i\n  PATH=/opt/gate-h2/bin")) throw new Error("builder does not begin from the canonical clean environment");
  for (const required of ["podman info --format '{{.Host.Security.Rootless}}'", "--userns=keep-id:uid=65532,gid=65532", "--user 0:0", "--cap-drop=all", "--cap-add=SETUID", "--cap-add=SETGID", "--cap-add=SETPCAP", "--security-opt=no-new-privileges", "--tmpfs /tmp:rw,noexec,nosuid,nodev,mode=0700,uid=0,gid=0", "--tmpfs /gate-h2-work:rw,exec,nosuid,nodev,mode=0700,uid=65532,gid=65532", "/opt/gate-h2/libexec/verify-rootless-boundary.mjs", "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null"]) {
    if (!outer.includes(required)) throw new Error(`builder lost required clean user-namespace contract: ${required}`);
  }
  const expectedBoundaryDrop = ["--reuid", "65532", "--regid", "65532", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", "/opt/gate-h2/bin/node", "/opt/gate-h2/libexec/verify-rootless-boundary.mjs", "--child"];
  if (JSON.stringify(boundarySetprivArgv()) !== JSON.stringify(expectedBoundaryDrop)) throw new Error("rootless boundary verifier lost the exact setpriv drop contract");
  const supervisorStatus = "NoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t00000000000001c0\nCapEff:\t00000000000001c0\nCapBnd:\t00000000000001c0\nCapAmb:\t0000000000000000\n";
  const childStatus = supervisorStatus.replaceAll("00000000000001c0", "0000000000000000");
  validateSupervisorStatus(supervisorStatus);
  validateChildStatus(childStatus);
  for (const [label, status, validate] of [
    ["supervisor DAC capability", supervisorStatus.replace("00000000000001c0", "00000000000001c2"), validateSupervisorStatus],
    ["supervisor missing SETPCAP", supervisorStatus.replaceAll("00000000000001c0", "00000000000000c0"), validateSupervisorStatus],
    ["child retained capability", childStatus.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000080"), validateChildStatus],
    ["missing NNP", childStatus.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"), validateChildStatus],
  ]) {
    try { validate(status); throw new Error(`status contract accepted ${label}`); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  }
  const readOnlyMounts = ["/workspace", "/gate-h2-inputs/source-export.json", "/gate-h2-inputs/source-export.tar", "/gate-h2-inputs/source-proof.bundle", "/gate-h2-inputs/ca-certificates.crt"];
  const mountInfo = readOnlyMounts.map((path, index) => `${index + 20} 1 0:${index + 20} / ${path} ro,nosuid,nodev - bind fixture ro`).join("\n");
  validateReadOnlyMounts(mountInfo, readOnlyMounts);
  try { validateReadOnlyMounts(mountInfo.replace("/workspace ro", "/workspace rw"), readOnlyMounts); throw new Error("boundary mount evidence accepted a writable source"); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  try { validateReadOnlyMounts(mountInfo.replace(/^.*source-proof\.bundle.*\n?/m, ""), readOnlyMounts); throw new Error("boundary mount evidence accepted a missing proof mount"); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  const boundaryDescriptor = join(root, "boundary-source-descriptor.json");
  writeFileSync(boundaryDescriptor, "{\"fixture\":true}\n");
  const boundaryDescriptorSha256 = createHash("sha256").update(readFileSync(boundaryDescriptor)).digest("hex");
  verifyDescriptorDigest(boundaryDescriptor, boundaryDescriptorSha256);
  for (const [label, expected] of [["missing", undefined], ["malformed", "A".repeat(64)], ["mismatched", "0".repeat(64)]]) {
    try { verifyDescriptorDigest(boundaryDescriptor, expected); throw new Error(`boundary descriptor verification accepted ${label} digest`); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  }
  const fakeCargo = join(root, "fake-cargo");
  writeFileSync(fakeCargo, `#!/bin/sh
case "$1" in
  tree) printf 'gate-h2-broker v0.1.0\\tMIT\\n' ;;
  metadata) printf '%s\\n' '{"packages":[{"id":"gate-h2-broker 0.1.0 (path+file:///fixture)","name":"gate-h2-broker","version":"0.1.0","license":"MIT"}],"resolve":{"root":"gate-h2-broker 0.1.0 (path+file:///fixture)","nodes":[{"id":"gate-h2-broker 0.1.0 (path+file:///fixture)","deps":[]}]}}' ;;
  *) exit 64 ;;
esac
`);
  chmodSync(fakeCargo, 0o755);
  const metadataOutput = join(root, "metadata"); mkdirSync(metadataOutput);
  const hashes = Array(8).fill("a".repeat(64));
  const metadataRun = spawnSync(process.execPath, [join(scripts, "generate-metadata.mjs"), crate, metadataOutput, "x86_64-unknown-linux-musl", hashes[0], "b".repeat(40), "c".repeat(40), hashes[1], hashes[2], hashes[3], "1", "1", hashes[4], hashes[5], hashes[6], hashes[7], hashes[0], `sha256:${hashes[1]}`, image, digest, fakeCargo], { encoding: "utf8" });
  const expectedPath = join(root, "expected-sbom.json");
  const expectedRun = spawnSync(process.execPath, [join(scripts, "generate-trusted-sbom.mjs"), crate, expectedPath, "x86_64-unknown-linux-musl", fakeCargo], { encoding: "utf8" });
  if (metadataRun.status !== 0 || expectedRun.status !== 0 || !readFileSync(join(metadataOutput, "sbom.cdx.json")).equals(readFileSync(expectedPath))) throw new Error(`independent SBOM derivations did not agree: ${metadataRun.stderr}${expectedRun.stderr}`);
  const divergentCargo = join(root, "divergent-cargo");
  writeFileSync(divergentCargo, "#!/bin/sh\nprintf '%s\\n' '{\"packages\":[{\"id\":\"gate-h2-broker 0.1.0 (path+file:///fixture)\",\"name\":\"gate-h2-broker\",\"version\":\"0.1.0\",\"license\":\"MIT\"},{\"id\":\"extra 1.0.0 (registry+fixture)\",\"name\":\"extra\",\"version\":\"1.0.0\",\"license\":\"MIT\"}],\"resolve\":{\"root\":\"gate-h2-broker 0.1.0 (path+file:///fixture)\",\"nodes\":[{\"id\":\"gate-h2-broker 0.1.0 (path+file:///fixture)\",\"deps\":[{\"pkg\":\"extra 1.0.0 (registry+fixture)\",\"dep_kinds\":[{\"kind\":null}]}]},{\"id\":\"extra 1.0.0 (registry+fixture)\",\"deps\":[]}]}}'\n"); chmodSync(divergentCargo, 0o755);
  const divergentExpected = join(root, "divergent-expected-sbom.json");
  const divergentRun = spawnSync(process.execPath, [join(scripts, "generate-trusted-sbom.mjs"), crate, divergentExpected, "x86_64-unknown-linux-musl", divergentCargo], { encoding: "utf8" });
  const comparison = spawnSync(process.execPath, [join(scripts, "compare-trusted-sbom.mjs"), join(metadataOutput, "sbom.cdx.json"), divergentExpected], { encoding: "utf8" });
  if (divergentRun.status !== 0 || comparison.status === 0 || !comparison.stderr.includes("independent Cargo metadata SBOM differs")) throw new Error("independent SBOM comparison accepted divergent Cargo graphs");
  const runtimeRoot = join(root, "runtime"); mkdirSync(runtimeRoot); const escapedScript = join(runtimeRoot, "escaped-script"); const dynamicTool = join(runtimeRoot, "dynamic-tool"), fakeLdd = join(root, "fake-ldd");
  writeFileSync(escapedScript, "#!/bin/sh\nexit 0\n"); chmodSync(escapedScript, 0o755);
  try { validateRuntimeClosure(runtimeRoot, new Map([[escapedScript, { mode: 0o555 }]]), fakeLdd); throw new Error("runtime closure accepted an external script interpreter"); } catch (error) { if (!`${error}`.includes("interpreter escapes")) throw error; }
  writeFileSync(dynamicTool, Buffer.from([0x7f, 0x45, 0x4c, 0x46])); chmodSync(dynamicTool, 0o755);
  writeFileSync(fakeLdd, "#!/bin/sh\nprintf 'liboutside.so => /usr/lib/liboutside.so (0x0)\\n'\n"); chmodSync(fakeLdd, 0o755);
  try { validateRuntimeClosure(runtimeRoot, new Map([[dynamicTool, { mode: 0o555 }]]), fakeLdd); throw new Error("runtime closure accepted an external dynamic dependency"); } catch (error) { if (!`${error}`.includes("dependency escapes")) throw error; }
  const imageRuntime = new Map([[join(runtimeRoot, "libexec", "verify-and-snapshot-source.sh"), { mode: 0o555 }], [join(runtimeRoot, "libexec", "verify-source-proof-core.mjs"), { mode: 0o444 }], [join(runtimeRoot, "libexec", "verify-rootless-boundary.mjs"), { mode: 0o444 }]]);
  validateImageOwnedRuntimeMembers(runtimeRoot, imageRuntime);
  imageRuntime.set(join(runtimeRoot, "libexec", "verify-source-proof-core.mjs"), { mode: 0o555 });
  try { validateImageOwnedRuntimeMembers(runtimeRoot, imageRuntime); throw new Error("runtime contract accepted an executable no-shebang proof core"); } catch (error) { if (!`${error}`.includes("non-executable 0444")) throw error; }
  imageRuntime.set(join(runtimeRoot, "libexec", "verify-source-proof-core.mjs"), { mode: 0o444 });
  imageRuntime.set(join(runtimeRoot, "libexec", "verify-rootless-boundary.mjs"), { mode: 0o555 });
  try { validateImageOwnedRuntimeMembers(runtimeRoot, imageRuntime); throw new Error("runtime contract accepted an executable no-shebang boundary core"); } catch (error) { if (!`${error}`.includes("boundary verifier")) throw error; }
  const nativeRuntime = new Map();
  for (const name of ["cmake", "ninja", "x86_64-linux-musl-ar", "x86_64-linux-musl-g++", "x86_64-linux-musl-gcc", "x86_64-linux-musl-ranlib"]) nativeRuntime.set(join(runtimeRoot, "bin", name), { mode: 0o555 });
  const libc = join(runtimeRoot, "x86_64-linux-musl", "lib", "libc.a");
  nativeRuntime.set(libc, { mode: 0o444, bytes: 4096, sha256: "a".repeat(64) });
  validateMuslRuntimeContract(runtimeRoot, nativeRuntime);
  nativeRuntime.get(libc).sha256 = "not-a-digest";
  try { validateMuslRuntimeContract(runtimeRoot, nativeRuntime); throw new Error("runtime contract accepted an unmeasured musl libc.a"); } catch (error) { if (!`${error}`.includes("mode, bytes, and SHA-256")) throw error; }
  nativeRuntime.get(libc).sha256 = "a".repeat(64);
  nativeRuntime.delete(join(runtimeRoot, "bin", "cmake"));
  try { validateMuslRuntimeContract(runtimeRoot, nativeRuntime); throw new Error("runtime contract accepted a missing native build tool"); } catch (error) { if (!`${error}`.includes("native build tool")) throw error; }
  const directoryMetadata = (mode) => ({ uid: 0, gid: 0, mode, isDirectory: () => true, isSymbolicLink: () => false });
  validateRuntimeDirectory(runtimeRoot, runtimeRoot, directoryMetadata(0o40755));
  for (const [label, directory, mode] of [
    ["group-writable executable parent", join(runtimeRoot, "bin"), 0o40775],
    ["world-writable vendor parent", join(runtimeRoot, "cargo-home", "vendor"), 0o40757],
  ]) {
    try { validateRuntimeDirectory(runtimeRoot, directory, directoryMetadata(mode)); throw new Error(`runtime directory policy accepted ${label}`); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  }
  const validHeader = "  Class:                             ELF64\n  Data:                              2's complement, little endian\n  Machine:                           Advanced Micro Devices X86-64\n";
  validateElfReports(validHeader, "Program Headers:\n  LOAD\n", "There is no dynamic section in this file.\n");
  for (const [label, header, program, dynamic] of [
    ["ELF32", validHeader.replace("ELF64", "ELF32"), "", ""],
    ["big-endian", validHeader.replace("little endian", "big endian"), "", ""],
    ["wrong machine", validHeader.replace("Advanced Micro Devices X86-64", "AArch64"), "", ""],
    ["interpreter", validHeader, "  INTERP 0x1\n", ""],
    ["dynamic dependency", validHeader, "", " (NEEDED) Shared library: [libc.so]\n"],
  ]) {
    try { validateElfReports(header, program, dynamic); throw new Error(`ELF validator accepted ${label}`); } catch (error) { if (`${error}`.includes("accepted")) throw error; }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write("build protocol negative tests passed\n");
