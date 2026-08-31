import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageRootlessBuildInputs } from "./stage-rootless-build-inputs.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const stageScript = join(scripts, "stage-rootless-build-inputs.mjs");

// This adapter exists only to execute the descriptor-retention state machine on
// hosts without Linux /proc/self/fd. Production never imports or selects it.
function createPortableTestTraversal() {
  const handles = new Map();
  const sameLocation = (left, right) => ["dev", "ino", "mode", "uid", "gid"].every((field) => left[field] === right[field]);
  const retain = (path, flags) => {
    const fd = openSync(path, flags);
    handles.set(fd, { path, metadata: fstatSync(fd, { bigint: true }) });
    return fd;
  };
  const pathFor = (fd, component) => {
    const retained = handles.get(fd);
    if (!retained || !sameLocation(fstatSync(fd, { bigint: true }), retained.metadata) || !sameLocation(lstatSync(retained.path, { bigint: true }), retained.metadata)) {
      throw new Error("portable test traversal detected a replaced retained directory");
    }
    return component === undefined ? retained.path : join(retained.path, component);
  };
  const rejectSymlink = (path) => {
    if (lstatSync(path).isSymbolicLink()) {
      const error = new Error("portable test traversal rejected a symlink");
      error.code = "ELOOP";
      throw error;
    }
  };
  return {
    openStart(absolute) { return retain(absolute ? "/" : ".", constants.O_RDONLY); },
    openDirectoryAt(parentFd, component) {
      const path = pathFor(parentFd, component);
      rejectSymlink(path);
      const metadata = lstatSync(path);
      if (!metadata.isDirectory()) {
        const error = new Error("not a directory");
        error.code = "ENOTDIR";
        throw error;
      }
      return retain(path, constants.O_RDONLY);
    },
    openRegularAt(parentFd, component) {
      const path = pathFor(parentFd, component);
      rejectSymlink(path);
      return retain(path, constants.O_RDONLY | constants.O_NONBLOCK);
    },
    lstatAt(parentFd, component) { return lstatSync(pathFor(parentFd, component), { bigint: true }); },
    readDirectory(fd) { return readdirSync(pathFor(fd), { encoding: "utf8" }); },
    makeDirectoryAt(parentFd, component, mode) {
      const path = pathFor(parentFd, component);
      mkdirSync(path, { mode });
      chmodSync(path, mode);
      return retain(path, constants.O_RDONLY);
    },
    createRegularAt(parentFd, component, mode) {
      return retain(pathFor(parentFd, component), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    },
    close(fd) { handles.delete(fd); closeSync(fd); },
  };
}

function runStage(arguments_, observe = () => {}) {
  return stageRootlessBuildInputs(arguments_, createPortableTestTraversal(), observe);
}

if (process.argv[2] === "--stage-adapter") {
  process.stdout.write(`${runStage(process.argv.slice(3))}\n`);
} else {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-h2-stage-retained-")));
  try {
    const source = join(root, "inputs", "source");
    const sourceParent = dirname(source);
    mkdirSync(join(source, "nested"), { recursive: true });
    writeFileSync(join(source, "nested", "member"), "measured source\n");
    chmodSync(join(source, "nested", "member"), 0o644);
    const inputs = ["descriptor.json", "archive.tar", "proof.bundle", "trust.pem"].map((name) => join(sourceParent, name));
    for (const [index, path] of inputs.entries()) writeFileSync(path, `input ${index}\n`);
    chmodSync(inputs[3], 0o600);
    const args = [source, ...inputs, join(root, "staged")];
    let churnedSharedTemporaryParent = false;
    const receipt = runStage(args, (event) => {
      if (churnedSharedTemporaryParent || event.phase !== "source-directory-retained" || event.relative !== "") return;
      churnedSharedTemporaryParent = true;
      const unrelated = mkdtempSync(join(tmpdir(), "gate-h2-stage-unrelated-"));
      rmSync(unrelated, { recursive: true, force: true });
    });
    const expectedReceipt = `GATEH2_STAGED_INPUTS_V1 source_descriptor_sha256=${createHash("sha256").update(readFileSync(inputs[0])).digest("hex")}`;
    if (receipt !== expectedReceipt) throw new Error("staging receipt did not bind the retained source descriptor bytes exactly");
    if (!churnedSharedTemporaryParent) throw new Error("shared temporary-directory churn was not exercised");
    if ((lstatSync(join(root, "staged")).mode & 0o7777) !== 0o755 || (lstatSync(join(root, "staged", "source", "nested", "member")).mode & 0o7777) !== 0o644) throw new Error("portable staging did not preserve exact staged modes");
    if ((lstatSync(inputs[3]).mode & 0o7777) !== 0o600 || readFileSync(inputs[3], "utf8") !== "input 3\n") throw new Error("staging mutated caller-owned trust bytes or mode");

    const exerciseSourcePathSwap = (label, restoreImmediately) => {
      const fixture = join(root, label);
      const fixtureSource = join(fixture, "source");
      const parked = join(fixture, `${label}-parked`);
      mkdirSync(join(fixtureSource, "nested"), { recursive: true });
      writeFileSync(join(fixtureSource, "nested", "member"), "original\n");
      const localInputs = ["descriptor.json", "archive.tar", "proof.bundle", "trust.pem"].map((name) => join(fixture, name));
      for (const path of localInputs) writeFileSync(path, "proof\n");
      let attacked = false;
      try {
        runStage([fixtureSource, ...localInputs, join(root, `${label}-output`)], (event) => {
          if (attacked || event.phase !== "source-directory-retained" || event.relative !== "") return;
          attacked = true;
          renameSync(fixtureSource, parked);
          symlinkSync(parked, fixtureSource);
          if (restoreImmediately) {
            unlinkSync(fixtureSource);
            renameSync(parked, fixtureSource);
          }
        });
      } catch (error) {
        if (!attacked || !/replaced retained directory|identity changed|changed during staging/.test(error.message)) throw error;
        return;
      } finally {
        if (lstatSync(fixtureSource, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(fixtureSource);
        if (lstatSync(parked, { throwIfNoEntry: false })) renameSync(parked, fixtureSource);
      }
      throw new Error(`retained-descriptor staging accepted ${label}`);
    };
    exerciseSourcePathSwap("source-persistent-symlink-substitution", false);
    exerciseSourcePathSwap("source-replacement-and-restore", true);

    const inputCasePaths = new Set();
    const reserveInputCasePath = (path) => {
      if (inputCasePaths.has(path)) throw new Error(`duplicate standalone-input attack path: ${path}`);
      inputCasePaths.add(path);
      return path;
    };
    const exerciseInputParentSymlink = (inputLabel, inputSlug) => {
      const caseId = `${inputSlug}-persistent-symlink`;
      const fixture = reserveInputCasePath(join(root, `input-parent-${caseId}-fixture`));
      const fixtureSource = join(fixture, "source");
      const parked = reserveInputCasePath(join(root, `input-parent-${caseId}-parked`));
      const output = reserveInputCasePath(join(root, `input-parent-${caseId}-output`));
      mkdirSync(fixtureSource, { recursive: true });
      writeFileSync(join(fixtureSource, "member"), "source\n");
      const localInputs = ["descriptor.json", "archive.tar", "proof.bundle", "trust.pem"].map((name) => join(fixture, name));
      for (const path of localInputs) writeFileSync(path, "proof\n");
      let attacked = false;
      try {
        runStage([fixtureSource, ...localInputs, output], (event) => {
          if (attacked || event.phase !== "input-parent-retained" || event.label !== inputLabel) return;
          attacked = true;
          renameSync(fixture, parked);
          symlinkSync(parked, fixture);
        });
      } catch (error) {
        if (!attacked || !/replaced retained directory|identity changed|parent\/name edge changed/.test(error.message)) throw error;
        return;
      } finally {
        if (lstatSync(fixture, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(fixture);
        if (lstatSync(parked, { throwIfNoEntry: false })) renameSync(parked, fixture);
      }
      throw new Error(`retained input-parent staging accepted ${inputLabel}`);
    };
    const exerciseInputPathReplacementAndRestore = (inputLabel, inputSlug, inputIndex) => {
      const fixture = reserveInputCasePath(join(root, `input-path-${inputSlug}-replace-restore-fixture`));
      const fixtureSource = join(fixture, "source");
      const output = reserveInputCasePath(join(root, `input-path-${inputSlug}-replace-restore-output`));
      mkdirSync(fixtureSource, { recursive: true });
      writeFileSync(join(fixtureSource, "member"), "source\n");
      const localInputs = ["descriptor.json", "archive.tar", "proof.bundle", "trust.pem"].map((name) => join(fixture, name));
      for (const path of localInputs) writeFileSync(path, "proof\n");
      const target = localInputs[inputIndex];
      const parked = reserveInputCasePath(`${target}.parked`);
      let attacked = false;
      try {
        runStage([fixtureSource, ...localInputs, output], (event) => {
          if (attacked || event.phase !== "input-parent-retained" || event.label !== inputLabel) return;
          attacked = true;
          renameSync(target, parked);
          symlinkSync(parked, target);
          unlinkSync(target);
          renameSync(parked, target);
        });
      } catch (error) {
        if (!attacked || !/identity changed|changed while staging|parent\/name edge changed/.test(error.message)) throw error;
        return;
      } finally {
        if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(target);
        if (lstatSync(parked, { throwIfNoEntry: false })) renameSync(parked, target);
      }
      throw new Error(`retained-descriptor staging accepted replacement-and-restore for ${inputLabel}`);
    };
    for (const [inputLabel, inputSlug, inputIndex] of [
      ["source descriptor", "source-descriptor", 0],
      ["source archive", "source-archive", 1],
      ["source Git bundle", "source-git-bundle", 2],
      ["trust roots", "trust-roots", 3],
    ]) {
      exerciseInputParentSymlink(inputLabel, inputSlug);
      exerciseInputPathReplacementAndRestore(inputLabel, inputSlug, inputIndex);
    }

    if (process.platform !== "linux") {
      const direct = spawnSync(process.execPath, [stageScript, ...args.slice(0, -1), join(root, "direct-output")], { encoding: "utf8" });
      if (direct.status === 0 || !direct.stderr.includes("requires Linux /proc/self/fd")) throw new Error("production staging selected a non-Linux fallback");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
