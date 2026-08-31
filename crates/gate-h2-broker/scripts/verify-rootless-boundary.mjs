import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE = "/opt/gate-h2/bin/node";
const SETPRIV = "/opt/gate-h2/bin/setpriv";
const CORE = "/opt/gate-h2/libexec/verify-rootless-boundary.mjs";
const SOURCE = "/workspace";
const INPUTS = [
  "/gate-h2-inputs/source-export.json",
  "/gate-h2-inputs/source-export.tar",
  "/gate-h2-inputs/source-proof.bundle",
  "/gate-h2-inputs/ca-certificates.crt",
];
const OUTPUTS = ["/gate-h2-output", "/gate-h2-host-helpers", "/gate-h2-expected-sbom"];
const WORK = "/gate-h2-work";
const SNAPSHOT = "/gate-h2-build/preflight-snapshot";
const SNAPSHOT_MEMBER = `${SNAPSHOT}/sealed`;
const RECEIPT = "GATEH2_ROOTLESS_BOUNDARY_V1 supervisor=0:0 supervisor_nnp=true supervisor_caps=setgid,setuid,setpcap supervisor_inputs=ro child=65532:65532 child_nnp=true child_caps=none child_inputs=ro outputs=rw work=rw tmp=root-only snapshot=ro";
const SUPERVISOR_CAPS = 0x1c0n;

export function boundarySetprivArgv(node = NODE, core = CORE) {
  return [
    "--reuid", "65532", "--regid", "65532", "--clear-groups",
    "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all",
    "--no-new-privs", "--", node, core, "--child",
  ];
}

function exactRegular(path, mode, uid, gid) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== mode) {
    throw new Error(`boundary regular-file contract differs: ${path}`);
  }
  return metadata;
}

function exactDirectory(path, mode, uid, gid) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== mode) {
    throw new Error(`boundary directory contract differs: ${path}`);
  }
}

function proveReadable(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile()) throw new Error(`boundary input is not readable as a regular file: ${path}`);
    if (metadata.size > 0 && readSync(fd, Buffer.alloc(1), 0, 1, 0) !== 1) throw new Error(`boundary input read failed: ${path}`);
  } finally {
    closeSync(fd);
  }
}

export function verifyDescriptorDigest(path, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) throw new Error("boundary expected source-descriptor digest is missing or malformed");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 1024n * 1024n) throw new Error("boundary source descriptor is not a bounded single-link regular file");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) throw new Error("boundary source descriptor produced a short read");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw new Error("boundary source descriptor grew during verification");
    const after = fstatSync(fd, { bigint: true });
    for (const field of ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"]) {
      if (before[field] !== after[field]) throw new Error("boundary source descriptor changed during verification");
    }
    if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("boundary source descriptor digest mismatch");
  } finally {
    closeSync(fd);
  }
}

function readSource(directory = SOURCE) {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== 65532 || metadata.gid !== 65532 || (metadata.mode & 0o7777) !== 0o755) throw new Error(`staged source directory identity or mode differs: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) readSource(path);
    else {
      const member = lstatSync(path);
      if (!member.isFile() || member.isSymbolicLink() || member.nlink !== 1 || member.uid !== 65532 || member.gid !== 65532 || ![0o644, 0o755].includes(member.mode & 0o7777)) throw new Error(`staged source member identity or mode differs: ${path}`);
      proveReadable(path);
    }
  }
}

function expectWriteDenied(path, directory = false, actor = "boundary process") {
  const candidate = directory ? join(path, ".gate-h2-boundary-denied") : path;
  let fd;
  try {
    fd = openSync(candidate, directory ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL : constants.O_WRONLY | constants.O_APPEND, 0o600);
  } catch (error) {
    if (["EACCES", "EPERM", "EROFS"].includes(error.code)) return;
    throw error;
  }
  closeSync(fd);
  if (directory) unlinkSync(candidate);
  throw new Error(`${actor} unexpectedly wrote ${path}`);
}

function statusFields(status) {
  return (name) => new RegExp(`^${name}:\\s+([^\\s]+)$`, "m").exec(status)?.[1];
}

function exactCapability(field, expected, label) {
  if (!/^[a-fA-F0-9]+$/.test(field ?? "") || BigInt(`0x${field}`) !== expected) throw new Error(label);
}

export function validateSupervisorStatus(status) {
  const field = statusFields(status);
  if (field("NoNewPrivs") !== "1") throw new Error("boundary supervisor does not observe no-new-privs");
  exactCapability(field("CapInh"), 0n, "boundary supervisor retains inheritable capabilities");
  exactCapability(field("CapPrm"), SUPERVISOR_CAPS, "boundary supervisor permitted capabilities differ");
  exactCapability(field("CapEff"), SUPERVISOR_CAPS, "boundary supervisor effective capabilities differ");
  exactCapability(field("CapBnd"), SUPERVISOR_CAPS, "boundary supervisor bounding capabilities differ");
  exactCapability(field("CapAmb"), 0n, "boundary supervisor retains ambient capabilities");
}

export function validateChildStatus(status) {
  const field = statusFields(status);
  if (field("NoNewPrivs") !== "1") throw new Error("boundary child does not observe no-new-privs");
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) exactCapability(field(name), 0n, `boundary child retains ${name}`);
}

export function validateReadOnlyMounts(mountInfo, expectedPaths) {
  if (typeof mountInfo !== "string" || !Array.isArray(expectedPaths) || expectedPaths.length === 0) throw new Error("boundary mount evidence is invalid");
  const entries = mountInfo.split("\n").filter(Boolean).map((line) => {
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    if (separator < 6) throw new Error("boundary mountinfo is malformed");
    return { mountPoint: fields[4], options: fields[5].split(",") };
  });
  for (const path of expectedPaths) {
    const matching = entries.filter(({ mountPoint }) => mountPoint === path);
    if (matching.length === 0 || matching.some(({ options }) => !options.includes("ro"))) throw new Error(`boundary mount is not proven read-only: ${path}`);
  }
}

function collectSourceMembers(directory = SOURCE, members = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectSourceMembers(path, members);
    else members.push(path);
  }
  return members;
}

function proveInputsReadOnly(actor) {
  const sourceMembers = collectSourceMembers();
  if (sourceMembers.length === 0) throw new Error("boundary source fixture is empty");
  for (const member of sourceMembers) expectWriteDenied(member, false, actor);
  expectWriteDenied(SOURCE, true, actor);
  for (const input of INPUTS) expectWriteDenied(input, false, actor);
  expectWriteDenied(dirname(INPUTS[0]), true, actor);
}

function proveWritable(directory) {
  const path = join(directory, ".gate-h2-boundary-write");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    const bytes = Buffer.from("boundary\n");
    if (writeSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error(`short boundary write: ${directory}`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  unlinkSync(path);
}

function child() {
  if (process.getuid() !== 65532 || process.getgid() !== 65532) throw new Error("boundary child identity is not 65532:65532");
  for (const directory of [...OUTPUTS, WORK]) {
    exactDirectory(directory, 0o700, 65532, 65532);
    proveWritable(directory);
  }
  proveInputsReadOnly("boundary child");
  expectWriteDenied(SNAPSHOT_MEMBER);
  expectWriteDenied(SNAPSHOT, true);
  expectWriteDenied("/tmp", true);
  expectWriteDenied("/", true);
  validateChildStatus(readFileSync("/proc/self/status", "utf8"));
}

function supervisor() {
  if (process.getuid() !== 0 || process.getgid() !== 0) throw new Error("boundary supervisor identity is not container 0:0");
  if (process.execPath !== NODE || fileURLToPath(import.meta.url) !== CORE) throw new Error("boundary verifier is not running from canonical image-owned paths");
  exactRegular(CORE, 0o444, 0, 0);
  for (const executable of [NODE, SETPRIV]) {
    const metadata = lstatSync(executable);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o111) === 0) throw new Error(`boundary runtime executable is unsafe: ${executable}`);
  }
  readSource();
  for (const input of INPUTS) {
    exactRegular(input, 0o444, 65532, 65532);
    proveReadable(input);
  }
  verifyDescriptorDigest(INPUTS[0], process.env.GATE_H2_SOURCE_DESCRIPTOR_SHA256);
  exactDirectory("/tmp", 0o700, 0, 0);
  exactDirectory("/gate-h2-build", 0o700, 0, 0);
  for (const output of OUTPUTS) exactDirectory(output, 0o700, 65532, 65532);
  exactDirectory(WORK, 0o700, 65532, 65532);
  validateSupervisorStatus(readFileSync("/proc/self/status", "utf8"));
  validateReadOnlyMounts(readFileSync("/proc/self/mountinfo", "utf8"), [SOURCE, ...INPUTS]);
  proveInputsReadOnly("boundary supervisor");
  mkdirSync(SNAPSHOT, { mode: 0o700 });
  writeFileSync(SNAPSHOT_MEMBER, "sealed\n", { flag: "wx", mode: 0o400 });
  chmodSync(SNAPSHOT_MEMBER, 0o444);
  chmodSync(SNAPSHOT, 0o555);
  let result;
  try {
    result = spawnSync(SETPRIV, boundarySetprivArgv(), {
      stdio: "inherit",
      env: { PATH: "/opt/gate-h2/bin", HOME: "/nonexistent", LC_ALL: "C", TZ: "UTC" },
    });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) throw new Error(`boundary child failed: ${result.signal ?? result.status}`);
    exactRegular(SNAPSHOT_MEMBER, 0o444, 0, 0);
    exactDirectory(SNAPSHOT, 0o555, 0, 0);
  } finally {
    chmodSync(SNAPSHOT, 0o700);
    chmodSync(SNAPSHOT_MEMBER, 0o600);
    rmSync(SNAPSHOT, { recursive: true });
  }
  process.stdout.write(`${RECEIPT}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length === 3 && process.argv[2] === "--child") child();
  else if (process.argv.length === 2) supervisor();
  else throw new Error("rootless boundary verifier accepts no caller arguments");
}
