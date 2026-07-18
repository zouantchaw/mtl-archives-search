import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const crate = resolve(scripts, "..");
const target = mkdtempSync(join(tmpdir(), "gate-h2-publication-helper-"));
const build = spawnSync("cargo", ["build", "--manifest-path", join(crate, "Cargo.toml"), "--locked", "--offline", "--features", "test-fault-injection", "--target-dir", target, "--bin", "gate-h2-publish-noreplace"], { encoding: "utf8" });
if (build.status !== 0) throw new Error(`publication test helper build failed: ${build.stderr}`);
const helper = join(target, "debug", "gate-h2-publish-noreplace");
const root = mkdtempSync(join(tmpdir(), "gate-h2-publication-test-"));
const members = ["gate-h2-broker", "gate-h2-stage.oci.tar", "provenance.json", "reproducibility.env", "rootfs.tar", "sbom.cdx.json"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const statePath = (name, parent = root) => join(parent, `.${name}.publication-state`);
const state = (name, parent = root) => existsSync(statePath(name, parent)) ? JSON.parse(readFileSync(statePath(name, parent), "utf8")).state : "absent";

function createLinkedFixture(label, parent = root, options = {}) {
  const source = join(root, `${label}-source`); mkdirSync(source); chmodSync(source, 0o700);
  const memberPaths = [];
  for (const name of members) {
    const path = join(source, name); memberPaths.push(path);
    const bytes = name === "gate-h2-broker" ? Buffer.from("#!/bin/sh\nexit 23\n") : Buffer.from(`${name} fixture\n`);
    writeFileSync(path, bytes); chmodSync(path, options.memberMode?.[name] ?? (name === "gate-h2-broker" ? 0o555 : 0o444));
  }
  const parentIdentity = statSync(parent, { bigint: true }); const sourceIdentity = statSync(source, { bigint: true });
  const descriptor = join(root, `${label}.admission.json`);
  const descriptorBytes = Buffer.from(`${JSON.stringify({ schema: "gate_h2_oci_admission_descriptor_v1", source_dev: Number(sourceIdentity.dev), source_ino: Number(sourceIdentity.ino), parent_dev: Number(parentIdentity.dev), parent_ino: Number(parentIdentity.ino), members: members.map((name, index) => { const bytes = readFileSync(memberPaths[index]); return { name, mode: name === "gate-h2-broker" ? 0o555 : 0o444, bytes: bytes.length, sha256: sha256(bytes) }; }) })}\n`);
  writeFileSync(descriptor, descriptorBytes); chmodSync(descriptor, options.descriptorMode ?? 0o444);
  return { source, memberPaths, descriptor, descriptorBytes, parent };
}

function retain(fixture, unlink = true) {
  const descriptorFd = openSync(fixture.descriptor, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  const parentFd = openSync(fixture.parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  const memberFds = fixture.memberPaths.map((path) => openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC));
  if (unlink) { for (const path of fixture.memberPaths) unlinkSync(path); unlinkSync(fixture.descriptor); }
  return { descriptorFd, parentFd, memberFds, descriptorSha256: sha256(fixture.descriptorBytes) };
}

function closeCapability(capability) {
  for (const fd of capability.memberFds) closeSync(fd);
  closeSync(capability.descriptorFd); closeSync(capability.parentFd);
}

function run(capability, destination, env = {}) {
  return spawnSync(helper, [destination, capability.descriptorSha256], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe", "ignore", capability.descriptorFd, capability.parentFd, ...capability.memberFds], encoding: "utf8" });
}

try {
  for (const mask of [0o077, 0o002]) {
    const capability = retain(createLinkedFixture(`umask-${mask}`));
    try {
      const previous = process.umask(mask); const result = run(capability, `published-${mask}`); process.umask(previous);
      if (result.status !== 0 || state(`published-${mask}`) !== "published") throw new Error(`publication under umask ${mask.toString(8)} failed: ${result.stderr}`);
      const receipt = JSON.parse(result.stdout); if (!receipt.destination_ino || !receipt.parent_ino) throw new Error("identity-bound publication receipt missing");
      for (const member of members) if ((statSync(join(root, `published-${mask}`, member)).mode & 0o7777) !== (member === "gate-h2-broker" ? 0o555 : 0o444)) throw new Error(`published mode mismatch: ${member}`);
    } finally { closeCapability(capability); }
  }

  const linked = createLinkedFixture("same-uid-linked"); const linkedCapability = retain(linked, false);
  try {
    const substitutedBroker = Buffer.from("#!/bin/sh\nexit 99\n");
    chmodSync(linked.memberPaths[0], 0o755); writeFileSync(linked.memberPaths[0], substitutedBroker); chmodSync(linked.memberPaths[0], 0o555);
    const forged = JSON.parse(linked.descriptorBytes); forged.members[0].sha256 = sha256(substitutedBroker);
    chmodSync(linked.descriptor, 0o644); writeFileSync(linked.descriptor, `${JSON.stringify(forged)}\n`); chmodSync(linked.descriptor, 0o444);
    if (run(linkedCapability, "same-uid-substituted").status === 0) throw new Error("same-UID in-place descriptor/member substitution was published");
  } finally { closeCapability(linkedCapability); }

  const replaced = createLinkedFixture("unlinked-replacement"); const replacedCapability = retain(replaced);
  try {
    writeFileSync(replaced.descriptor, "forged descriptor pathname\n"); chmodSync(replaced.descriptor, 0o444);
    for (const [index, path] of replaced.memberPaths.entries()) { writeFileSync(path, "forged member pathname\n"); chmodSync(path, index === 0 ? 0o555 : 0o444); }
    const result = run(replacedCapability, "unlinked-replacement-published");
    if (result.status !== 0 || readFileSync(join(root, "unlinked-replacement-published", "gate-h2-broker"), "utf8") !== "#!/bin/sh\nexit 23\n") throw new Error(`replacement pathnames influenced retained publication: ${result.stderr}`);
  } finally { closeCapability(replacedCapability); }

  const linkedRejected = retain(createLinkedFixture("linked-rejected"), false);
  try { if (run(linkedRejected, "linked-rejected-out").status === 0) throw new Error("linked descriptor/member capability was accepted"); } finally { closeCapability(linkedRejected); }

  for (const mode of [0o4700, 0o2700, 0o1700]) {
    const parent = join(root, `parent-${mode.toString(8)}`); mkdirSync(parent); chmodSync(parent, mode);
    const capability = retain(createLinkedFixture(`parent-fixture-${mode.toString(8)}`, parent));
    try { if (run(capability, "out").status === 0) throw new Error(`unsafe publication parent ${mode.toString(8)} was accepted`); } finally { closeCapability(capability); }
  }

  for (const [label, mode, targetName] of [["descriptor-special", 0o4444, null], ["member-setuid", 0o4444, "sbom.cdx.json"], ["member-setgid", 0o2444, "provenance.json"], ["member-sticky", 0o1444, "rootfs.tar"]]) {
    const fixture = createLinkedFixture(label, root, targetName ? { memberMode: { [targetName]: mode } } : { descriptorMode: mode }); const capability = retain(fixture);
    try { if (run(capability, `${label}-out`).status === 0) throw new Error(`${label} was accepted`); } finally { closeCapability(capability); }
  }

  const durable = retain(createLinkedFixture("durable"));
  try {
    mkdirSync(join(root, "conflict")); if (run(durable, "conflict").status === 0 || state("conflict") !== "conflict_not_published") throw new Error("EEXIST conflict was not durably classified");
    if (run(durable, "unknown", { GATE_H2_TEST_RENAME_UNKNOWN: "1" }).status === 0 || state("unknown") !== "rename_failed_unknown") throw new Error("unknown rename failure was not durable");
    if (run(durable, "interrupt", { GATE_H2_TEST_INTERRUPT_BEFORE_RENAME: "1" }).status === 0 || state("interrupt") !== "prepared") throw new Error("prepared interruption state missing");
    if (run(durable, "published-fsync-fault", { GATE_H2_TEST_FAIL_FSYNC_STAGE: "published-state-parent-fsync" }).status === 0 || state("published-fsync-fault") !== "published") throw new Error("published fsync failure collapsed terminal state");
    for (const index of [0, 3, 8]) if (run(durable, `readdir-${index}`, { GATE_H2_TEST_READDIR_ERROR: String(index) }).status === 0) throw new Error(`readdir error ${index} was treated as EOF`);
  } finally { closeCapability(durable); }

  const normalBuild = mkdtempSync(join(tmpdir(), "gate-h2-normal-helper-"));
  const normal = spawnSync("cargo", ["build", "--manifest-path", join(crate, "Cargo.toml"), "--locked", "--offline", "--release", "--target-dir", normalBuild, "--bin", "gate-h2-publish-noreplace", "--bin", "gate-h2-secure-candidate-read"], { encoding: "utf8" });
  if (normal.status !== 0) throw new Error(`normal helper build failed: ${normal.stderr}`);
  for (const binary of ["gate-h2-publish-noreplace", "gate-h2-secure-candidate-read"]) if (readFileSync(join(normalBuild, "release", binary)).includes(Buffer.from("GATE_H2_TEST_"))) throw new Error(`production helper contains activatable test branch: ${binary}`);
  rmSync(normalBuild, { recursive: true, force: true });
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
}
