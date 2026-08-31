import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_DIRECTORIES = 256;
const MAX_SOURCE_FILES = 256;
const BUFFER_BYTES = 64 * 1024;
const RECEIPT_PREFIX = "GATEH2_STAGED_INPUTS_V1 source_descriptor_sha256=";
const IDENTITY_FIELDS = ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"];
// Directory entry churn changes nlink, size, mtime, and ctime without changing
// the retained object or its parent/name binding. Keep those checks for files
// and copied source directories, whose state is bounded and enumerated.
const DIRECTORY_IDENTITY_FIELDS = ["dev", "ino", "mode", "uid", "gid"];

function sameIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

function sameDirectoryIdentity(left, right) {
  return DIRECTORY_IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

function snapshot(fd, label) {
  const metadata = fstatSync(fd, { bigint: true });
  if (metadata.isSymbolicLink()) throw new Error(`${label} resolved to a symlink`);
  return metadata;
}

function validateComponent(component) {
  if (!component || component === "." || component === ".." || component.includes("/") || component.includes("\0")) throw new Error("unsafe path component");
}

function splitPath(argument) {
  if (typeof argument !== "string" || argument.length === 0 || argument.endsWith("/") || argument.includes("//")) throw new Error("input paths must be canonical nonempty paths without trailing or repeated separators");
  const absolute = argument.startsWith("/");
  const components = argument.split("/").filter(Boolean);
  for (const component of components) validateComponent(component);
  if (components.length === 0) throw new Error("root itself is not a valid build input");
  return { absolute, components };
}

export function createLinuxDescriptorTraversal() {
  if (process.platform !== "linux") throw new Error("retained-descriptor source staging requires Linux /proc/self/fd");
  const procFd = openSync("/proc/self/fd", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const procMetadata = snapshot(procFd, "/proc/self/fd");
  if (!procMetadata.isDirectory() || procMetadata.uid !== BigInt(process.geteuid()) || procMetadata.gid !== BigInt(process.getegid()) || (procMetadata.mode & 0o022n) !== 0n) throw new Error("unsafe /proc/self/fd descriptor authority");
  closeSync(procFd);
  const reference = (fd, component) => {
    if (component !== undefined) validateComponent(component);
    return `/proc/self/fd/${fd}${component === undefined ? "" : `/${component}`}`;
  };
  const validateReference = (fd, expected) => {
    const observed = statSync(reference(fd), { bigint: true });
    if (!sameDirectoryIdentity(observed, expected)) throw new Error("/proc/self/fd did not retain the expected directory identity");
  };
  return {
    openStart(absolute) {
      const fd = openSync(absolute ? "/" : ".", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const metadata = snapshot(fd, absolute ? "/" : "retained cwd");
      if (!metadata.isDirectory()) throw new Error("path authority is not a directory");
      validateReference(fd, metadata);
      return fd;
    },
    openDirectoryAt(parentFd, component) {
      return openSync(reference(parentFd, component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    },
    openRegularAt(parentFd, component) {
      return openSync(reference(parentFd, component), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    },
    lstatAt(parentFd, component) {
      return lstatSync(reference(parentFd, component), { bigint: true });
    },
    readDirectory(fd) {
      return readdirSync(reference(fd), { encoding: "utf8" });
    },
    makeDirectoryAt(parentFd, component, mode) {
      mkdirSync(reference(parentFd, component), { mode });
      const fd = this.openDirectoryAt(parentFd, component);
      chmodSync(reference(fd), mode);
      return fd;
    },
    createRegularAt(parentFd, component, mode) {
      return openSync(reference(parentFd, component), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    },
    close(fd) { closeSync(fd); },
  };
}

function retainDirectory(fd, label, retained, parent = undefined, name = undefined) {
  const metadata = snapshot(fd, label);
  if (!metadata.isDirectory()) throw new Error(`${label} is not a directory`);
  const handle = { fd, label, metadata, parent, name };
  retained.push(handle);
  return handle;
}

function openDirectoryPath(argument, traversal, label) {
  const { absolute, components } = splitPath(argument);
  const retained = [];
  let current = retainDirectory(traversal.openStart(absolute), `${label} path authority`, retained);
  try {
    for (const component of components) current = retainDirectory(traversal.openDirectoryAt(current.fd, component), `${label} component ${component}`, retained, current, component);
    return { directory: current, retained };
  } catch (error) {
    for (const handle of retained.reverse()) traversal.close(handle.fd);
    throw error;
  }
}

function openParentPath(argument, traversal, label) {
  const { absolute, components } = splitPath(argument);
  const name = components.pop();
  const retained = [];
  let current = retainDirectory(traversal.openStart(absolute), `${label} path authority`, retained);
  try {
    for (const component of components) current = retainDirectory(traversal.openDirectoryAt(current.fd, component), `${label} parent ${component}`, retained, current, component);
    return { parent: current, name, retained };
  } catch (error) {
    for (const handle of retained.reverse()) traversal.close(handle.fd);
    throw error;
  }
}

function revalidateHandle(handle, traversal) {
  const after = snapshot(handle.fd, handle.label);
  if (!sameDirectoryIdentity(after, handle.metadata)) throw new Error(`retained directory identity changed during staging: ${handle.label}`);
  if (handle.parent) {
    const edge = traversal.lstatAt(handle.parent.fd, handle.name);
    if (edge.isSymbolicLink() || !sameDirectoryIdentity(edge, handle.metadata)) throw new Error(`retained parent/name edge changed during staging: ${handle.label}`);
  }
}

function revalidateRetained(retained, traversal) {
  for (const handle of retained) {
    revalidateHandle(handle, traversal);
  }
}

function closeRetained(retained, traversal) {
  for (const handle of [...retained].reverse()) traversal.close(handle.fd);
}

function validateOutputDirectory(fd, mode, traversal, label, parent = undefined, name = undefined) {
  const metadata = snapshot(fd, label);
  if (!metadata.isDirectory() || metadata.uid !== BigInt(process.geteuid()) || metadata.gid !== BigInt(process.getegid()) || Number(metadata.mode & 0o7777n) !== mode) {
    traversal.close(fd);
    throw new Error(`failed to create exact staged directory: ${label}`);
  }
  const handle = { fd, label, metadata, parent, name, mode };
  if (parent) {
    const edge = traversal.lstatAt(parent.fd, name);
    if (edge.isSymbolicLink() || !sameDirectoryIdentity(edge, metadata)) throw new Error(`staged directory edge differs: ${label}`);
  }
  return handle;
}

function validateOutputDirectoryCurrent(handle, traversal) {
  const metadata = snapshot(handle.fd, handle.label);
  if (!metadata.isDirectory() || metadata.uid !== BigInt(process.geteuid()) || metadata.gid !== BigInt(process.getegid()) || Number(metadata.mode & 0o7777n) !== handle.mode) throw new Error(`staged directory identity or mode changed: ${handle.label}`);
  if (handle.parent) {
    const edge = traversal.lstatAt(handle.parent.fd, handle.name);
    if (edge.isSymbolicLink() || !sameDirectoryIdentity(edge, metadata)) throw new Error(`staged directory edge changed: ${handle.label}`);
  }
}

function copyRegularFd(inputFd, inputParent, inputName, outputParentFd, outputName, mode, cap, label, traversal, digest = undefined) {
  const before = snapshot(inputFd, label);
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(cap)) throw new Error(`${label} must be a bounded single-link regular file`);
  const inputEdgeBefore = traversal.lstatAt(inputParent.fd, inputName);
  if (inputEdgeBefore.isSymbolicLink() || !sameIdentity(inputEdgeBefore, before)) throw new Error(`${label} parent/name edge differs before staging`);
  const outputFd = traversal.createRegularAt(outputParentFd, outputName, mode);
  try {
    const buffer = Buffer.alloc(BUFFER_BYTES);
    let offset = 0;
    while (offset < Number(before.size)) {
      const count = readSync(inputFd, buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`${label} produced invalid read progress`);
      digest?.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) {
        const progress = writeSync(outputFd, buffer, written, count - written, offset + written);
        if (!Number.isSafeInteger(progress) || progress <= 0 || progress > count - written) throw new Error(`${label} produced invalid write progress`);
        written += progress;
      }
      offset += count;
    }
    if (readSync(inputFd, buffer, 0, 1, offset) !== 0) throw new Error(`${label} grew while staging`);
    const after = snapshot(inputFd, label);
    if (!sameIdentity(after, before)) throw new Error(`${label} changed while staging`);
    const inputEdgeAfter = traversal.lstatAt(inputParent.fd, inputName);
    if (inputEdgeAfter.isSymbolicLink() || !sameIdentity(inputEdgeAfter, before)) throw new Error(`${label} parent/name edge changed while staging`);
    fchmodSync(outputFd, mode);
    fsyncSync(outputFd);
    const staged = snapshot(outputFd, `staged ${label}`);
    if (!staged.isFile() || staged.nlink !== 1n || staged.uid !== BigInt(process.geteuid()) || staged.gid !== BigInt(process.getegid()) || Number(staged.mode & 0o7777n) !== mode || staged.size !== before.size) {
      throw new Error(`staged ${label} mode, size, or identity differs`);
    }
    const stagedEdge = traversal.lstatAt(outputParentFd, outputName);
    if (stagedEdge.isSymbolicLink() || !sameIdentity(stagedEdge, staged)) throw new Error(`staged ${label} parent/name edge differs`);
    return Number(before.size);
  } finally {
    traversal.close(outputFd);
  }
}

function openInputRegular(argument, traversal, label) {
  const resolved = openParentPath(argument, traversal, label);
  let fd;
  try {
    fd = traversal.openRegularAt(resolved.parent.fd, resolved.name);
    const metadata = snapshot(fd, label);
    if (!metadata.isFile() || metadata.nlink !== 1n) {
      traversal.close(fd);
      fd = undefined;
      throw new Error(`${label} is not a single-link regular file`);
    }
    return { ...resolved, file: { fd, label, metadata } };
  } catch (error) {
    if (fd !== undefined) traversal.close(fd);
    closeRetained(resolved.retained, traversal);
    throw error;
  }
}

export function stageRootlessBuildInputs(arguments_, traversal, observe = () => {}) {
  if (!Array.isArray(arguments_) || arguments_.length !== 6) throw new Error("usage: stage-rootless-build-inputs.mjs <source> <descriptor> <archive> <bundle> <trust-roots> <destination>");
  const [source, descriptor, archive, bundle, trustRoots, destination] = arguments_;
  const destinationParent = openParentPath(destination, traversal, "staging destination");
  let destinationDirectory;
  try {
    destinationDirectory = validateOutputDirectory(traversal.makeDirectoryAt(destinationParent.parent.fd, destinationParent.name, 0o755), 0o755, traversal, "staging destination", destinationParent.parent, destinationParent.name);
    destinationParent.parent.metadata = snapshot(destinationParent.parent.fd, destinationParent.parent.label);
  } catch (error) {
    closeRetained(destinationParent.retained, traversal);
    throw error;
  }
  const sourceOutput = validateOutputDirectory(traversal.makeDirectoryAt(destinationDirectory.fd, "source", 0o755), 0o755, traversal, "staged source root", destinationDirectory, "source");
  const sourceInput = openDirectoryPath(source, traversal, "source input");
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceDirectories = 0;
  let sourceDescriptorSha256;
  const copySourceDirectory = (input, output, relative) => {
    sourceDirectories += 1;
    if (sourceDirectories > MAX_SOURCE_DIRECTORIES) throw new Error("source staging directory-count bound exceeded");
    const before = snapshot(input.fd, input.label);
    observe({ phase: "source-directory-retained", relative, source });
    const names = traversal.readDirectory(input.fd).sort();
    if (names.some((name, index) => !name || (index > 0 && names[index - 1] === name))) throw new Error("source staging encountered duplicate or empty directory members");
    for (const name of names) {
      validateComponent(name);
      let childDirectoryFd;
      try {
        childDirectoryFd = traversal.openDirectoryAt(input.fd, name);
      } catch (error) {
        if (error.code !== "ENOTDIR") throw error;
      }
      if (childDirectoryFd !== undefined) {
        const childInput = { fd: childDirectoryFd, label: `${input.label}/${name}`, metadata: snapshot(childDirectoryFd, `${input.label}/${name}`), parent: input, name };
        if (!childInput.metadata.isDirectory()) throw new Error("source staging encountered a non-directory component");
        const childEdge = traversal.lstatAt(input.fd, name);
        if (childEdge.isSymbolicLink() || !sameDirectoryIdentity(childEdge, childInput.metadata)) throw new Error(`source directory edge differs: ${relative}${name}`);
        const childOutput = validateOutputDirectory(traversal.makeDirectoryAt(output.fd, name, 0o755), 0o755, traversal, `staged source directory ${relative}${name}`, output, name);
        try {
          copySourceDirectory(childInput, childOutput, `${relative}${name}/`);
          revalidateHandle(childInput, traversal);
          validateOutputDirectoryCurrent(childOutput, traversal);
        } finally { traversal.close(childInput.fd); traversal.close(childOutput.fd); }
        continue;
      }
      const inputFd = traversal.openRegularAt(input.fd, name);
      try {
        const metadata = snapshot(inputFd, `source member ${relative}${name}`);
        if (!metadata.isFile() || metadata.nlink !== 1n) throw new Error("source staging encountered a non-regular member");
        const mode = Number(metadata.mode & 0o7777n);
        if (![0o644, 0o755].includes(mode)) throw new Error(`source staging encountered an invalid member mode: ${relative}${name}`);
        sourceFiles += 1;
        if (sourceFiles > MAX_SOURCE_FILES) throw new Error("source staging file-count bound exceeded");
        sourceBytes += copyRegularFd(inputFd, input, name, output.fd, name, mode, MAX_SOURCE_FILE_BYTES, `source member ${relative}${name}`, traversal);
        if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("source staging aggregate bound exceeded");
      } finally {
        traversal.close(inputFd);
      }
    }
    // The directory being copied has a deterministic member list, so its full
    // state remains strict; retained ancestors only need stable object/edge checks.
    if (JSON.stringify(traversal.readDirectory(input.fd).sort()) !== JSON.stringify(names) || !sameIdentity(snapshot(input.fd, input.label), before)) {
      throw new Error(`source directory changed during staging: ${input.label}`);
    }
  };
  try {
    copySourceDirectory(sourceInput.directory, sourceOutput, "");
    revalidateRetained(sourceInput.retained, traversal);
    validateOutputDirectoryCurrent(sourceOutput, traversal);
    for (const [input, outputName, mode, cap, label] of [
      [descriptor, "source-export.json", 0o444, 1024 * 1024, "source descriptor"],
      [archive, "source-export.tar", 0o444, 128 * 1024 * 1024, "source archive"],
      [bundle, "source-proof.bundle", 0o444, 512 * 1024 * 1024, "source Git bundle"],
      [trustRoots, "ca-certificates.crt", 0o444, 16 * 1024 * 1024, "trust roots"],
    ]) {
      const resolved = openInputRegular(input, traversal, label);
      try {
        observe({ phase: "input-parent-retained", label, input });
        const digest = label === "source descriptor" ? createHash("sha256") : undefined;
        copyRegularFd(resolved.file.fd, resolved.parent, resolved.name, destinationDirectory.fd, outputName, mode, cap, label, traversal, digest);
        if (!sameIdentity(snapshot(resolved.file.fd, label), resolved.file.metadata)) throw new Error(`${label} identity changed after staging`);
        revalidateRetained(resolved.retained, traversal);
        if (digest) sourceDescriptorSha256 = digest.digest("hex");
      } finally {
        traversal.close(resolved.file.fd);
        closeRetained(resolved.retained, traversal);
      }
    }
    revalidateRetained(destinationParent.retained, traversal);
    validateOutputDirectoryCurrent(sourceOutput, traversal);
    validateOutputDirectoryCurrent(destinationDirectory, traversal);
    if (!/^[a-f0-9]{64}$/.test(sourceDescriptorSha256 ?? "")) throw new Error("retained source descriptor digest is unavailable");
    return `${RECEIPT_PREFIX}${sourceDescriptorSha256}`;
  } finally {
    closeRetained(sourceInput.retained, traversal);
    traversal.close(sourceOutput.fd);
    traversal.close(destinationDirectory.fd);
    closeRetained(destinationParent.retained, traversal);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${stageRootlessBuildInputs(process.argv.slice(2), createLinuxDescriptorTraversal())}\n`);
}
