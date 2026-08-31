import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = resolve(scripts, "..");
const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-h2-build-orchestration-")));
const unlock = (path) => { const metadata = lstatSync(path); if (metadata.isDirectory() && !metadata.isSymbolicLink()) { for (const entry of readdirSync(path)) unlock(join(path, entry)); chmodSync(path, 0o700); } else if (!metadata.isSymbolicLink()) chmodSync(path, 0o600); };
try {
  const repository = join(root, "repository");
  const nested = join(repository, "crates", "gate-h2-broker");
  const allowlistPath = join(crate, "oci", "source-allowlist.v1.txt");
  const allowlist = readFileSync(allowlistPath, "utf8").trimEnd().split("\n").map((line) => { const [mode, path] = line.split(" "); return { mode: Number.parseInt(mode.slice(-3), 8), path }; });
  for (const { mode, path } of allowlist) { const output = join(repository, path); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, "allowlisted fixture\n"); chmodSync(output, mode); }
  cpSync(allowlistPath, join(repository, "crates", "gate-h2-broker", "oci", "source-allowlist.v1.txt"));
  for (const name of ["Cargo.toml", "Cargo.lock"]) cpSync(join(crate, name), join(nested, name));
  writeFileSync(join(nested, "src", "lib.rs"), "pub fn fixture() {}\n");
  writeFileSync(join(repository, "Cargo.lock"), "wrong root lock sentinel\n");
  writeFileSync(join(repository, ".gitignore"), "ignored-input\n");
  writeFileSync(join(repository, "unrelated-tracked.txt"), "unrelated tracked sentinel\n");
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "gate-h2@example.invalid"], { cwd: repository });
  execFileSync("git", ["config", "user.name", "gate-h2-fixture"], { cwd: repository });
  execFileSync("git", ["add", "."], { cwd: repository });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repository });
  const attributesRepository = join(root, "attributes-repository");
  execFileSync("git", ["clone", "-q", repository, attributesRepository]);
  execFileSync("git", ["config", "user.email", "gate-h2@example.invalid"], { cwd: attributesRepository });
  execFileSync("git", ["config", "user.name", "gate-h2-fixture"], { cwd: attributesRepository });
  writeFileSync(join(repository, "ignored-input"), "ignored sentinel\n");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  const exported = join(root, "exported");
  execFileSync("bash", ["-c", 'umask 077; exec "$@"', "gate-h2-export", join(scripts, "export-tracked-source.sh"), repository, exported, join(root, "source.json"), commit, tree]);
  for (const expectedMode of [0o644, 0o755]) {
    const member = allowlist.find(({ mode }) => mode === expectedMode);
    if (!member || (statSync(join(exported, member.path)).mode & 0o7777) !== expectedMode) throw new Error(`source export did not preserve exact ${expectedMode.toString(8)} mode under umask 077`);
  }
  if (existsSync(join(exported, "unrelated-tracked.txt")) || existsSync(join(exported, ".gitignore")) || existsSync(join(exported, "ignored-input"))) throw new Error("non-allowlisted tracked or ignored file leaked into source export");
  const descriptor = JSON.parse(readFileSync(join(root, "source.json")));
  if (descriptor.source_file_count !== allowlist.length || descriptor.source_allowlist_sha256 !== createHash("sha256").update(readFileSync(allowlistPath)).digest("hex")) throw new Error("source export allowlist count/hash mismatch");
  const proofCore = join(scripts, "verify-source-proof-core.mjs");
  const git = realpathSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim());
  const tar = realpathSync(execFileSync("which", ["tar"], { encoding: "utf8" }).trim());
  const proofDropper = join(root, "proof-setpriv"); writeFileSync(proofDropper, "#!/bin/sh\nif [ -n \"${GATE_H2_TEST_DROPPER_LOG:-}\" ]; then printf '%s\\n' \"$@\" > \"$GATE_H2_TEST_DROPPER_LOG\"; fi\nwhile [ \"$1\" != -- ]; do shift; done\nshift\nexec \"$@\"\n"); chmodSync(proofDropper, 0o755);
  const proofInner = join(root, "proof-inner"); writeFileSync(proofInner, "#!/bin/sh\nexit 0\n"); chmodSync(proofInner, 0o755);
  const hostilePath = join(root, "hostile-path"); mkdirSync(hostilePath); writeFileSync(join(hostilePath, "git"), "#!/bin/sh\nexit 99\n"); writeFileSync(join(hostilePath, "tar"), "#!/bin/sh\nexit 99\n"); chmodSync(join(hostilePath, "git"), 0o755); chmodSync(join(hostilePath, "tar"), 0o755);
  const bundle = join(root, "source-proof.bundle"); execFileSync("git", ["bundle", "create", bundle, "--all"], { cwd: repository });
  const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const runProof = (label, source = exported, descriptorPath = join(root, "source.json"), env = process.env, inner = proofInner, expectedDescriptorSha256 = undefined) => {
    const proofEnvironment = { ...env };
    if (expectedDescriptorSha256 === null) delete proofEnvironment.GATE_H2_SOURCE_DESCRIPTOR_SHA256;
    else proofEnvironment.GATE_H2_SOURCE_DESCRIPTOR_SHA256 = expectedDescriptorSha256 ?? sha256File(descriptorPath);
    return spawnSync(process.execPath, [proofCore, source, descriptorPath, `${exported}.git-archive.tar`, bundle, join(root, `snapshot-${label}`), git, tar, proofDropper, "--", inner], { env: proofEnvironment, encoding: "utf8" });
  };
  const hostile = runProof("hostile-path", exported, join(root, "source.json"), { ...process.env, PATH: hostilePath, RUSTUP_HOME: "/hostile-rustup", CARGO_REGISTRY_PROTOCOL: "git", GIT_CONFIG_NOSYSTEM: "0", GIT_CONFIG_GLOBAL: "/hostile-gitconfig" });
  if (hostile.status !== 0) throw new Error(`explicit image-proof tools were influenced by hostile ambient PATH: ${hostile.stderr}`);
  const dropperLog = join(root, "setpriv.argv");
  const dropper = runProof("setpriv-contract", exported, join(root, "source.json"), { ...process.env, GATE_H2_TEST_DROPPER_LOG: dropperLog });
  const expectedDropperArgv = ["--reuid", "65532", "--regid", "65532", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", proofInner].join("\n");
  if (dropper.status !== 0 || readFileSync(dropperLog, "utf8").trimEnd() !== expectedDropperArgv) throw new Error("source proof did not invoke the exact closed setpriv contract");
  for (const [label, expectedDescriptorSha256, expectedError] of [
    ["missing-descriptor-digest", null, "missing or malformed"],
    ["malformed-descriptor-digest", "A".repeat(64), "missing or malformed"],
    ["mismatched-descriptor-digest", "0".repeat(64), "differs from retained staging receipt"],
  ]) {
    const rejected = runProof(label, exported, join(root, "source.json"), process.env, proofInner, expectedDescriptorSha256);
    if (rejected.status === 0 || !rejected.stderr.includes(expectedError)) throw new Error(`image source proof accepted ${label}: ${rejected.stderr}`);
  }
  for (const [label, mutate] of [
    ["false-commit", (value) => { value.source_commit = "0".repeat(40); }],
    ["false-tree", (value) => { value.source_tree = "0".repeat(40); }],
    ["false-archive", (value) => { value.source_archive_sha256 = "0".repeat(64); }],
  ]) {
    const falseDescriptor = structuredClone(descriptor); mutate(falseDescriptor); const path = join(root, `${label}.json`); writeFileSync(path, `${JSON.stringify(falseDescriptor)}\n`);
    if (runProof(label, exported, path).status === 0) throw new Error(`source proof accepted ${label} with an otherwise valid measured manifest`);
  }
  const duplicateDescriptor = join(root, "duplicate-source.json"); writeFileSync(duplicateDescriptor, `${readFileSync(join(root, "source.json"), "utf8").trimEnd().slice(0, -1)},"source_tree":"${descriptor.source_tree}"}\n`);
  if (runProof("duplicate", exported, duplicateDescriptor).status === 0) throw new Error("source proof accepted a duplicate descriptor key");
  const mutatedSource = join(root, "mutated-source"); cpSync(exported, mutatedSource, { recursive: true }); writeFileSync(join(mutatedSource, "crates", "gate-h2-broker", "src", "lib.rs"), "pub fn substituted() {}\n");
  if (runProof("member-mutation", mutatedSource).status === 0) throw new Error("source proof accepted a mounted member mutation");
  const modeMutatedSource = join(root, "mode-mutated-source"); cpSync(exported, modeMutatedSource, { recursive: true }); const regularMember = allowlist.find(({ mode }) => mode === 0o644); chmodSync(join(modeMutatedSource, regularMember.path), 0o600);
  if (runProof("mode-mutation", modeMutatedSource).status === 0) throw new Error("source proof accepted a mounted member mode mutation");
  const proofMutator = join(root, "proof-mutator"); writeFileSync(proofMutator, "#!/bin/sh\nmember=\"$GATE_H2_MEASURED_SOURCE/crates/gate-h2-broker/src/lib.rs\"\nchmod 0644 \"$member\"\nprintf 'pub fn mutated_after_build() {}\\n' > \"$member\"\nexit 0\n"); chmodSync(proofMutator, 0o755);
  const postBuildMutation = runProof("post-build-mutation", exported, join(root, "source.json"), process.env, proofMutator);
  if (postBuildMutation.status === 0 || !/(snapshot member seal mode changed|measured snapshot differs from original source manifest)/.test(postBuildMutation.stderr)) throw new Error(`source proof accepted post-build snapshot mutation: ${postBuildMutation.stderr}`);
  const proofSignal = join(root, "proof-signal"); writeFileSync(proofSignal, "#!/bin/sh\nkill -TERM $$\n"); chmodSync(proofSignal, 0o755);
  if (runProof("signal", exported, join(root, "source.json"), process.env, proofSignal).signal !== "SIGTERM") throw new Error("source proof did not propagate an inner signal truthfully");
  const expected = createHash("sha256").update(readFileSync(join(exported, "crates", "gate-h2-broker", "Cargo.lock"))).digest("hex");
  const digest = execFileSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), exported], { encoding: "utf8" }).trim();
  if (digest !== expected || existsSync(join(exported, "Cargo.lock"))) throw new Error("orchestration did not bind only the allowlisted crate Cargo.lock");
  const metadata = join(root, "metadata"); mkdirSync(metadata);
  const hashes = Array(8).fill("a".repeat(64));
  const cargo = execFileSync("which", ["cargo"], { encoding: "utf8" }).trim();
  execFileSync(process.execPath, [join(scripts, "generate-metadata.mjs"), join(exported, "crates", "gate-h2-broker"), metadata, "x86_64-unknown-linux-musl", hashes[0], commit, tree, hashes[1], hashes[2], hashes[3], "4", "5", hashes[4], hashes[5], hashes[6], hashes[7], hashes[0], `sha256:${hashes[1]}`, `builder.invalid/image@sha256:${hashes[2]}`, hashes[2], cargo]);
  const provenance = JSON.parse(readFileSync(join(metadata, "provenance.json")));
  if (provenance.cargo_lock_sha256 !== digest) throw new Error("metadata did not receive the exported crate lock digest");
  const missing = join(root, "missing"); cpSync(exported, missing, { recursive: true }); rmSync(join(missing, "crates", "gate-h2-broker", "Cargo.lock"));
  if (spawnSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), missing]).status === 0) throw new Error("missing crate lock was accepted");
  if (spawnSync(process.execPath, [join(scripts, "prepare-trusted-build-inputs.mjs"), join(exported, "crates", "gate-h2-broker")]).status === 0) throw new Error("crate path was accepted as exported repository root");
  const nonemptyDestination = join(root, "nonempty-destination"); mkdirSync(nonemptyDestination); writeFileSync(join(nonemptyDestination, "sentinel"), "sentinel\n");
  const trustRoots = join(root, "trust-roots.pem"); writeFileSync(trustRoots, "test trust roots\n"); chmodSync(trustRoots, 0o600); const trustRootsSha256 = createHash("sha256").update(readFileSync(trustRoots)).digest("hex");
  const replacementRepository = join(root, "replacement-repository");
  execFileSync("git", ["clone", "-q", repository, replacementRepository]);
  execFileSync("git", ["config", "user.email", "gate-h2@example.invalid"], { cwd: replacementRepository });
  execFileSync("git", ["config", "user.name", "gate-h2-replacement-fixture"], { cwd: replacementRepository });
  const replacementMember = allowlist.find(({ mode }) => mode === 0o644).path;
  writeFileSync(join(replacementRepository, replacementMember), "coherent post-staging replacement\n");
  execFileSync("git", ["add", replacementMember], { cwd: replacementRepository });
  execFileSync("git", ["commit", "-qm", "coherent replacement"], { cwd: replacementRepository });
  const replacementCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: replacementRepository, encoding: "utf8" }).trim();
  const replacementTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: replacementRepository, encoding: "utf8" }).trim();
  const replacementExport = join(root, "replacement-export"), replacementDescriptor = join(root, "replacement-source.json"), replacementBundle = join(root, "replacement.bundle");
  execFileSync("bash", [join(scripts, "export-tracked-source.sh"), replacementRepository, replacementExport, replacementDescriptor, replacementCommit, replacementTree]);
  execFileSync("git", ["bundle", "create", replacementBundle, "--all"], { cwd: replacementRepository });
  const replacementProof = spawnSync(process.execPath, [proofCore, replacementExport, replacementDescriptor, `${replacementExport}.git-archive.tar`, replacementBundle, join(root, "replacement-snapshot"), git, tar, proofDropper, "--", proofInner], { env: { ...process.env, GATE_H2_SOURCE_DESCRIPTOR_SHA256: sha256File(replacementDescriptor) }, encoding: "utf8" });
  if (replacementProof.status !== 0) throw new Error(`coherent replacement fixture does not satisfy the image source proof: ${replacementProof.stderr}`);
  const exportEntrypoint = join(scripts, "build-stage-oci-from-export.sh");
  const builderInputs = { GATE_H2_BUILDER_IMAGE: `builder.invalid/gate-h2@sha256:${"a".repeat(64)}`, GATE_H2_BUILDER_IMAGE_DIGEST: "a".repeat(64), GATE_H2_TRUST_ROOTS: trustRoots, GATE_H2_TRUST_ROOTS_SHA256: trustRootsSha256, GATE_H2_SOURCE_ARCHIVE: `${exported}.git-archive.tar`, GATE_H2_SOURCE_GIT_BUNDLE: bundle };
  const podmanBin = join(root, "podman-bin"); mkdirSync(podmanBin);
  const podmanArgv = join(root, "podman.argv");
  writeFileSync(join(podmanBin, "node"), [
    "#!/bin/sh",
    "if [ \"$1\" = \"$GATE_H2_TEST_STAGE_SCRIPT\" ]; then",
    "  shift",
    "  receipt=\"$(\"$GATE_H2_TEST_REAL_NODE\" \"$GATE_H2_TEST_STAGE_ADAPTER\" --stage-adapter \"$@\")\"",
    "  status=$?",
    "  [ \"$status\" -eq 0 ] || exit \"$status\"",
    "  case \"${GATE_H2_TEST_STAGE_MODE:-}\" in",
    "    replacement-set)",
    "      printf '%s\\n' \"$receipt\"",
    "      destination=\"$6\"",
    "      rm -rf \"$destination/source\"",
    "      cp -R \"$GATE_H2_TEST_REPLACEMENT_SOURCE\" \"$destination/source\"",
    "      rm -f \"$destination/source-export.json\" \"$destination/source-export.tar\" \"$destination/source-proof.bundle\"",
    "      cp \"$GATE_H2_TEST_REPLACEMENT_DESCRIPTOR\" \"$destination/source-export.json\"",
    "      cp \"$GATE_H2_TEST_REPLACEMENT_ARCHIVE\" \"$destination/source-export.tar\"",
    "      cp \"$GATE_H2_TEST_REPLACEMENT_BUNDLE\" \"$destination/source-proof.bundle\"",
    "      chmod 0444 \"$destination/source-export.json\" \"$destination/source-export.tar\" \"$destination/source-proof.bundle\"",
    "      exit 0",
    "      ;;",
    "    missing-receipt) receipt=\"\" ;;",
    "    malformed-receipt) receipt=\"malformed staging receipt\" ;;",
    "    extra-field-receipt) receipt=\"$receipt extra=unexpected\" ;;",
    "    trailing-line-receipt) receipt=\"$receipt",
    "unexpected trailing line\" ;;",
    "    non-hex-receipt) receipt=\"GATEH2_STAGED_INPUTS_V1 source_descriptor_sha256=gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg\" ;;",
    "  esac",
    "  printf '%s\\n' \"$receipt\"",
    "  exit 0",
    "fi",
    "exec \"$GATE_H2_TEST_REAL_NODE\" \"$@\"",
  ].join("\n") + "\n");
  writeFileSync(join(podmanBin, "uname"), "#!/bin/sh\nprintf '%s\\n' Linux\n");
  writeFileSync(join(podmanBin, "podman"), [
    "#!/usr/bin/env node",
    'const crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path");',
    "const args = process.argv.slice(2);",
    "const capture = process.env.GATE_H2_TEST_PODMAN_ARGV;",
    "if (args[0] === \"info\") { fs.appendFileSync(capture, JSON.stringify({ kind: \"info\", args }) + \"\\n\"); process.stdout.write(\"true\\n\"); process.exit(0); }",
    "const mounts = [];",
    "for (let index = 0; index < args.length; index += 1) if (args[index] === \"-v\") { const [host, container, access] = args[index + 1].split(\":\"); const metadata = fs.lstatSync(host); mounts.push({ host, container, access, mode: metadata.mode & 0o7777, uid: metadata.uid, gid: metadata.gid, type: metadata.isDirectory() ? \"directory\" : \"file\" }); index += 1; }",
    "const source = mounts.find((mount) => mount.container === \"/workspace\");",
    "const sourceEntries = [];",
    "const visit = (directory) => { const metadata = fs.lstatSync(directory); sourceEntries.push({ relative: path.relative(source.host, directory) || \".\", mode: metadata.mode & 0o7777, uid: metadata.uid, gid: metadata.gid, type: \"directory\" }); for (const name of fs.readdirSync(directory).sort()) { const member = path.join(directory, name), child = fs.lstatSync(member); if (child.isDirectory()) visit(member); else sourceEntries.push({ relative: path.relative(source.host, member), mode: child.mode & 0o7777, uid: child.uid, gid: child.gid, type: \"file\" }); } };",
    "visit(source.host);",
    "const boundary = args.includes(\"/opt/gate-h2/libexec/verify-rootless-boundary.mjs\");",
    "fs.appendFileSync(capture, JSON.stringify({ kind: \"run\", boundary, args, mounts, sourceEntries }) + \"\\n\");",
    "if (boundary) { if (process.env.GATE_H2_TEST_MUTATE_PREFLIGHT === \"1\") { const output = mounts.find((mount) => mount.container === \"/gate-h2-output\"); fs.writeFileSync(path.join(output.host, \"preflight-mutated\"), \"mutation\\n\"); } if (process.env.GATE_H2_TEST_REJECT_DESCRIPTOR_MISMATCH === \"1\") { const descriptor = mounts.find((mount) => mount.container === \"/gate-h2-inputs/source-export.json\"); const expected = args.find((entry) => entry.startsWith(\"GATE_H2_SOURCE_DESCRIPTOR_SHA256=\"))?.slice(\"GATE_H2_SOURCE_DESCRIPTOR_SHA256=\".length); const actual = crypto.createHash(\"sha256\").update(fs.readFileSync(descriptor.host)).digest(\"hex\"); if (actual !== expected) { process.stderr.write(`mounted source descriptor differs from retained staging receipt actual=${actual} expected=${expected}\\n`); process.exit(65); } } process.stdout.write(\"GATEH2_ROOTLESS_BOUNDARY_V1 supervisor=0:0 supervisor_nnp=true supervisor_caps=setgid,setuid,setpcap supervisor_inputs=ro child=65532:65532 child_nnp=true child_caps=none child_inputs=ro outputs=rw work=rw tmp=root-only snapshot=ro\\n\"); }",
    "else process.stdout.write(\"GATEH2_HELPER_MANIFEST_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\nGATEH2_TOOLCHAIN_LOCK_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\nGATEH2_CARGO_LOCK_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n\");",
  ].join("\n"));
  chmodSync(join(podmanBin, "node"), 0o755); chmodSync(join(podmanBin, "uname"), 0o755); chmodSync(join(podmanBin, "podman"), 0o755);
  const capturedEnvironment = { ...process.env, ...builderInputs, PATH: `${podmanBin}:${process.env.PATH}`, GATE_H2_TEST_PODMAN_ARGV: podmanArgv, GATE_H2_TEST_REAL_NODE: process.execPath, GATE_H2_TEST_STAGE_SCRIPT: join(scripts, "stage-rootless-build-inputs.mjs"), GATE_H2_TEST_STAGE_ADAPTER: join(scripts, "test-stage-rootless-build-inputs.mjs"), GATE_H2_TEST_REPLACEMENT_SOURCE: replacementExport, GATE_H2_TEST_REPLACEMENT_DESCRIPTOR: replacementDescriptor, GATE_H2_TEST_REPLACEMENT_ARCHIVE: `${replacementExport}.git-archive.tar`, GATE_H2_TEST_REPLACEMENT_BUNDLE: replacementBundle };
  const capturedRun = spawnSync("bash", [exportEntrypoint, exported, join(root, "source.json"), join(root, "captured-output")], {
    env: capturedEnvironment, encoding: "utf8"
  });
  if (capturedRun.status === 0 || !existsSync(podmanArgv)) throw new Error(`outer protocol did not reach the captured Podman invocation: ${capturedRun.stderr}`);
  if (!capturedRun.stderr.includes("GATEH2_PODMAN_ROOTLESS=true") || !capturedRun.stderr.includes("GATEH2_ROOTLESS_BOUNDARY_V1")) throw new Error("outer protocol did not emit both host and container boundary evidence");
  const podmanEvents = readFileSync(podmanArgv, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const infoEvents = podmanEvents.filter(({ kind }) => kind === "info"), runEvents = podmanEvents.filter(({ kind }) => kind === "run");
  if (infoEvents.length !== 1 || JSON.stringify(infoEvents[0].args) !== JSON.stringify(["info", "--format", "{{.Host.Security.Rootless}}"])) throw new Error("outer protocol did not make the exact rootless Podman info query");
  if (runEvents.length !== 2 || !runEvents[0].boundary || runEvents[1].boundary) throw new Error("outer protocol did not make exactly one boundary run followed by one build run");
  const boundaryCommand = runEvents[0].args.indexOf("/opt/gate-h2/bin/node"), buildCommand = runEvents[1].args.indexOf("/opt/gate-h2/libexec/verify-and-snapshot-source.sh");
  if (boundaryCommand < 1 || buildCommand < 1 || JSON.stringify(runEvents[0].args.slice(0, boundaryCommand)) !== JSON.stringify(runEvents[1].args.slice(0, buildCommand))) throw new Error("boundary and build runs did not share the exact pinned image, mapping, mounts, and clean environment");
  const requireExactPodmanPair = (argv, flag, value) => {
    const positions = argv.flatMap((entry, index) => entry === flag ? [index] : []);
    if (positions.length !== 1 || argv[positions[0] + 1] !== value) throw new Error(`outer Podman invocation must contain exactly ${flag} ${value}`);
  };
  const assertRootSupervisorContract = (argv) => {
    if (argv[0] !== "run") throw new Error("outer command did not invoke podman run");
    requireExactPodmanPair(argv, "--user", "0:0");
    if (argv.filter((entry) => entry === "--userns=keep-id:uid=65532,gid=65532").length !== 1) throw new Error("outer Podman invocation must retain the exact keep-id output mapping");
    if (argv.filter((entry) => entry === "--cap-drop=all").length !== 1) throw new Error("outer Podman invocation must drop the default capability set");
    const capAdds = argv.filter((entry) => entry.startsWith("--cap-add="));
    if (JSON.stringify(capAdds) !== JSON.stringify(["--cap-add=SETUID", "--cap-add=SETGID", "--cap-add=SETPCAP"])) throw new Error("outer Podman invocation must add only SETUID, SETGID, and SETPCAP");
    if (argv.filter((entry) => entry === "--security-opt=no-new-privileges").length !== 1) throw new Error("outer Podman invocation must set container no-new-privileges");
    for (const mount of ["/workspace", "/gate-h2-inputs/source-export.json", "/gate-h2-inputs/source-export.tar", "/gate-h2-inputs/source-proof.bundle", "/gate-h2-inputs/ca-certificates.crt"]) {
      const binding = argv.find((entry, index) => argv[index - 1] === "-v" && entry.includes(`:${mount}:`));
      if (!binding?.endsWith(":ro")) throw new Error(`outer Podman invocation must mount ${mount} read-only`);
    }
  };
  for (const event of runEvents) assertRootSupervisorContract(event.args);
  const stagedModes = new Map(runEvents[0].mounts.map((mount) => [mount.container, mount]));
  const expectedMounts = ["/workspace", "/gate-h2-inputs/source-export.json", "/gate-h2-inputs/source-export.tar", "/gate-h2-inputs/source-proof.bundle", "/gate-h2-inputs/ca-certificates.crt", "/gate-h2-output", "/gate-h2-host-helpers", "/gate-h2-expected-sbom"].sort();
  if (JSON.stringify([...stagedModes.keys()].sort()) !== JSON.stringify(expectedMounts)) throw new Error("rootless invocation exposes an unexpected host bind mount");
  for (const container of ["/gate-h2-inputs/source-export.json", "/gate-h2-inputs/source-export.tar", "/gate-h2-inputs/source-proof.bundle", "/gate-h2-inputs/ca-certificates.crt"]) {
    const mount = stagedModes.get(container);
    if (!mount || mount.type !== "file" || mount.mode !== 0o444 || mount.access !== "ro") throw new Error(`rootless staged input mode differs: ${container}`);
  }
  if (stagedModes.get("/workspace")?.mode !== 0o755 || stagedModes.get("/workspace")?.access !== "ro") throw new Error("rootless staged source mount is not readable and read-only");
  for (const container of ["/gate-h2-output", "/gate-h2-host-helpers", "/gate-h2-expected-sbom"]) {
    const mount = stagedModes.get(container);
    if (!mount || mount.type !== "directory" || mount.mode !== 0o700 || mount.access !== "rw") throw new Error(`mapped child output mode differs: ${container}`);
  }
  for (const entry of runEvents[0].sourceEntries) {
    const expectedMode = entry.type === "directory" ? 0o755 : allowlist.find(({ path }) => path === entry.relative)?.mode;
    if (entry.uid !== process.geteuid() || entry.gid !== process.getegid() || entry.mode !== expectedMode) throw new Error(`staged source identity or mode differs: ${entry.relative}`);
  }
  if ((lstatSync(trustRoots).mode & 0o7777) !== 0o600 || readFileSync(trustRoots, "utf8") !== "test trust roots\n") throw new Error("caller-owned trust roots were mutated during staging");
  for (const mount of runEvents[0].mounts) if (mount.host.includes(".gate-h2-host-") && existsSync(mount.host)) throw new Error("staged rootless input/output survived outer cleanup");
  const originalDescriptorSha256 = sha256File(join(root, "source.json"));
  const replacementCapture = join(root, "podman-replacement.argv");
  const replacementRun = spawnSync("bash", [exportEntrypoint, exported, join(root, "source.json"), join(root, "replacement-output")], {
    env: { ...capturedEnvironment, GATE_H2_TEST_PODMAN_ARGV: replacementCapture, GATE_H2_TEST_STAGE_MODE: "replacement-set", GATE_H2_TEST_REJECT_DESCRIPTOR_MISMATCH: "1" }, encoding: "utf8"
  });
  const replacementDescriptorSha256 = sha256File(replacementDescriptor);
  if (replacementDescriptorSha256 === originalDescriptorSha256) throw new Error("coherent replacement fixture reused the retained descriptor digest");
  if (replacementRun.status !== 65 || !replacementRun.stderr.includes("mounted source descriptor differs from retained staging receipt") || !replacementRun.stderr.includes(`actual=${replacementDescriptorSha256}`) || !replacementRun.stderr.includes(`expected=${originalDescriptorSha256}`) || !existsSync(replacementCapture)) {
    throw new Error(`coherent staged replacement was not rejected at the boundary: ${replacementRun.stderr}`);
  }
  const replacementEvents = readFileSync(replacementCapture, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const replacementRuns = replacementEvents.filter(({ kind }) => kind === "run");
  if (replacementRuns.length !== 1 || !replacementRuns[0].boundary || replacementRuns.some(({ args }) => args.includes("/opt/gate-h2/libexec/verify-and-snapshot-source.sh"))) throw new Error("coherent staged replacement reached the build Podman invocation");
  for (const [label, mode] of [
    ["missing-staging-receipt", "missing-receipt"],
    ["malformed-staging-receipt", "malformed-receipt"],
    ["extra-field-staging-receipt", "extra-field-receipt"],
    ["trailing-line-staging-receipt", "trailing-line-receipt"],
    ["non-hex-staging-receipt", "non-hex-receipt"],
  ]) {
    const capture = join(root, `podman-${mode}.argv`);
    const rejected = spawnSync("bash", [exportEntrypoint, exported, join(root, "source.json"), join(root, `${mode}-output`)], {
      env: { ...capturedEnvironment, GATE_H2_TEST_PODMAN_ARGV: capture, GATE_H2_TEST_STAGE_MODE: mode }, encoding: "utf8"
    });
    if (rejected.status !== 65 || !rejected.stderr.includes("invalid retained staging receipt") || existsSync(capture)) throw new Error(`outer script accepted ${label} or reached Podman: ${rejected.stderr}`);
  }
  const rejectRootSupervisorMutation = (label, mutate) => {
    const candidate = [...runEvents[0].args]; mutate(candidate);
    try { assertRootSupervisorContract(candidate); } catch { return; }
    throw new Error(`outer Podman contract accepted ${label}`);
  };
  rejectRootSupervisorMutation("a missing root user", (argv) => argv.splice(argv.indexOf("--user"), 2));
  rejectRootSupervisorMutation("an altered root user", (argv) => { argv[argv.indexOf("--user") + 1] = "65532:65532"; });
  rejectRootSupervisorMutation("a missing keep-id mapping", (argv) => argv.splice(argv.indexOf("--userns=keep-id:uid=65532,gid=65532"), 1));
  rejectRootSupervisorMutation("an altered keep-id mapping", (argv) => { argv[argv.indexOf("--userns=keep-id:uid=65532,gid=65532")] = "--userns=keep-id:uid=0,gid=0"; });
  rejectRootSupervisorMutation("a missing capability drop", (argv) => argv.splice(argv.indexOf("--cap-drop=all"), 1));
  rejectRootSupervisorMutation("a missing SETUID capability", (argv) => argv.splice(argv.indexOf("--cap-add=SETUID"), 1));
  rejectRootSupervisorMutation("an added DAC capability", (argv) => argv.push("--cap-add=DAC_OVERRIDE"));
  rejectRootSupervisorMutation("missing container no-new-privileges", (argv) => argv.splice(argv.indexOf("--security-opt=no-new-privileges"), 1));
  rejectRootSupervisorMutation("a writable source bind", (argv) => { const index = argv.findIndex((entry) => entry.includes(":/workspace:ro")); argv[index] = argv[index].replace(/:ro$/, ":rw"); });
  rejectRootSupervisorMutation("a writable proof bind", (argv) => { const index = argv.findIndex((entry) => entry.includes(":/gate-h2-inputs/source-proof.bundle:ro")); argv[index] = argv[index].replace(/:ro$/, ":rw"); });
  const mutatingCapture = join(root, "podman-mutating.argv");
  const mutatingPreflight = spawnSync("bash", [exportEntrypoint, exported, join(root, "source.json"), join(root, "mutating-output")], {
    env: { ...capturedEnvironment, GATE_H2_TEST_PODMAN_ARGV: mutatingCapture, GATE_H2_TEST_MUTATE_PREFLIGHT: "1" }, encoding: "utf8"
  });
  const mutatingEvents = readFileSync(mutatingCapture, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  if (mutatingPreflight.status === 0 || !mutatingPreflight.stderr.includes("preflight left mutable output state") || mutatingEvents.filter(({ kind }) => kind === "run").length !== 1) throw new Error("mutating boundary preflight reached the build invocation");
  const nonempty = spawnSync("bash", [exportEntrypoint, exported, join(root, "source.json"), nonemptyDestination], { env: { ...process.env, ...builderInputs }, encoding: "utf8" });
  if (nonempty.status === 0 || !nonempty.stderr.includes("publication destination must be empty")) throw new Error(`nonempty publication destination was accepted before builder execution: ${nonempty.stderr}`);
  const sourceCargoConfig = join(root, "source-cargo-config"); cpSync(exported, sourceCargoConfig, { recursive: true }); mkdirSync(join(sourceCargoConfig, ".cargo")); writeFileSync(join(sourceCargoConfig, ".cargo", "config.toml"), "[net]\noffline = false\n");
  const cargoConfig = spawnSync("bash", [exportEntrypoint, sourceCargoConfig, join(root, "source.json"), join(root, "cargo-config-output")], { env: { ...process.env, ...builderInputs }, encoding: "utf8" });
  if (cargoConfig.status === 0 || !cargoConfig.stderr.includes("must not contain Cargo configuration")) throw new Error("source-side Cargo config reached the builder");
  const sourceSymlink = join(root, "source-symlink"); cpSync(exported, sourceSymlink, { recursive: true }); const symlinkMember = allowlist.find(({ mode }) => mode === 0o644); rmSync(join(sourceSymlink, symlinkMember.path)); writeFileSync(join(root, "substitute"), "substitute\n"); symlinkSync(join(root, "substitute"), join(sourceSymlink, symlinkMember.path));
  const symlink = spawnSync("bash", [exportEntrypoint, sourceSymlink, join(root, "source.json"), join(root, "symlink-output")], { env: { ...process.env, ...builderInputs }, encoding: "utf8" });
  if (symlink.status === 0 || !symlink.stderr.includes("must not contain symlinks")) throw new Error("source symlink reached the builder");
  writeFileSync(join(repository, "untracked-input"), "untracked sentinel\n");
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "untracked-export"), join(root, "untracked.json"), commit, tree]).status === 0) throw new Error("untracked source input was accepted");
  rmSync(join(repository, "untracked-input"));
  const executable = allowlist.find(({ mode }) => mode === 0o755); chmodSync(join(repository, executable.path), 0o644); execFileSync("git", ["add", executable.path], { cwd: repository }); execFileSync("git", ["commit", "-qm", "mode drift"], { cwd: repository });
  const modeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(); const modeTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "mode-export"), join(root, "mode.json"), modeCommit, modeTree]).status === 0) throw new Error("allowlisted source mode drift was accepted");
  chmodSync(join(repository, executable.path), 0o755); execFileSync("git", ["add", executable.path], { cwd: repository }); execFileSync("git", ["commit", "-qm", "restore mode"], { cwd: repository });
  const missingPath = join(repository, allowlist[0].path); rmSync(missingPath); execFileSync("git", ["add", "-u"], { cwd: repository }); execFileSync("git", ["commit", "-qm", "missing allowlisted input"], { cwd: repository });
  const missingCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(); const missingTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository, encoding: "utf8" }).trim();
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), repository, join(root, "missing-export"), join(root, "missing.json"), missingCommit, missingTree]).status === 0) throw new Error("missing allowlisted source input was accepted");
  if (allowlist.some(({ path }) => path === ".gitattributes")) throw new Error("Git attributes must remain outside the accepted source allowlist");
  const substitutedMember = "crates/gate-h2-broker/src/lib.rs";
  writeFileSync(join(attributesRepository, substitutedMember), "$Format:%H$\n");
  writeFileSync(join(attributesRepository, ".gitattributes"), `${substitutedMember} export-subst\n`);
  execFileSync("git", ["add", substitutedMember, ".gitattributes"], { cwd: attributesRepository });
  execFileSync("git", ["commit", "-qm", "attribute substitution fixture"], { cwd: attributesRepository });
  const attributeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: attributesRepository, encoding: "utf8" }).trim();
  const attributeTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: attributesRepository, encoding: "utf8" }).trim();
  const attributeExport = join(root, "attribute-export"), attributeDescriptor = join(root, "attribute-source.json"), attributeBundle = join(root, "attribute.bundle");
  execFileSync("bash", [join(scripts, "export-tracked-source.sh"), attributesRepository, attributeExport, attributeDescriptor, attributeCommit, attributeTree]);
  execFileSync("git", ["bundle", "create", attributeBundle, "HEAD"], { cwd: attributesRepository });
  const attributeProof = spawnSync(process.execPath, [proofCore, attributeExport, attributeDescriptor, `${attributeExport}.git-archive.tar`, attributeBundle, join(root, "attribute-snapshot"), git, tar, proofDropper, "--", proofInner], { env: { ...process.env, GATE_H2_SOURCE_DESCRIPTOR_SHA256: sha256File(attributeDescriptor) }, encoding: "utf8" });
  if (attributeProof.status === 0 || !attributeProof.stderr.includes("differs from exact Git blob")) throw new Error(`export-subst transformed bytes were admitted: ${attributeProof.stderr}`);
  writeFileSync(join(attributesRepository, ".gitattributes"), `${substitutedMember} export-subst\ncrates/gate-h2-broker/Cargo.lock export-ignore\n`);
  execFileSync("git", ["add", ".gitattributes"], { cwd: attributesRepository });
  execFileSync("git", ["commit", "-qm", "attribute exclusion fixture"], { cwd: attributesRepository });
  const ignoredCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: attributesRepository, encoding: "utf8" }).trim();
  const ignoredTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: attributesRepository, encoding: "utf8" }).trim();
  if (spawnSync("bash", [join(scripts, "export-tracked-source.sh"), attributesRepository, join(root, "attribute-ignore-export"), join(root, "attribute-ignore.json"), ignoredCommit, ignoredTree], { encoding: "utf8" }).status === 0) throw new Error("export-ignore removed an allowlisted Git blob without rejection");
} finally {
  unlock(root);
  rmSync(root, { recursive: true, force: true });
}
