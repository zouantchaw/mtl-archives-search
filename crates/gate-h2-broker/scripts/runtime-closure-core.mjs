import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function validateRuntimeDirectory(root, directory, metadata) {
  if (directory !== root && !directory.startsWith(`${root}/`)) throw new Error(`runtime directory escapes the canonical root: ${directory}`);
  const uid = BigInt(metadata.uid);
  const gid = BigInt(metadata.gid);
  const mode = Number(BigInt(metadata.mode) & 0o7777n);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || uid !== 0n || gid !== 0n || mode !== 0o755) {
    throw new Error(`runtime directory must be root-owned, non-symlink, and exact 0755: ${directory}`);
  }
}

export function validateImageOwnedRuntimeMembers(root, declared) {
  const snapshotVerifier = `${root}/libexec/verify-and-snapshot-source.sh`;
  const proofCore = `${root}/libexec/verify-source-proof-core.mjs`;
  const boundaryVerifier = `${root}/libexec/verify-rootless-boundary.mjs`;
  if (declared.get(snapshotVerifier)?.mode !== 0o555) throw new Error("image source snapshot verifier must be an executable 0555 runtime member");
  if (declared.get(proofCore)?.mode !== 0o444) throw new Error("image source proof core must be a non-executable 0444 runtime data member");
  if (declared.get(boundaryVerifier)?.mode !== 0o444) throw new Error("image rootless boundary verifier must be a non-executable 0444 runtime data member");
}

export function validateMuslRuntimeContract(root, declared) {
  const tools = [
    `${root}/bin/cmake`,
    `${root}/bin/ninja`,
    `${root}/bin/x86_64-linux-musl-ar`,
    `${root}/bin/x86_64-linux-musl-g++`,
    `${root}/bin/x86_64-linux-musl-gcc`,
    `${root}/bin/x86_64-linux-musl-ranlib`,
  ];
  for (const tool of tools) if (declared.get(tool)?.mode !== 0o555) throw new Error(`musl native build tool must be an exact executable runtime member: ${tool}`);
  const libc = `${root}/x86_64-linux-musl/lib/libc.a`;
  const entry = declared.get(libc);
  if (entry?.mode !== 0o444 || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
    throw new Error("musl libc.a must have exact mode, bytes, and SHA-256 in the runtime inventory");
  }
}

export function validateRuntimeClosure(root, declared, ldd) {
  for (const [file, entry] of declared) {
    if (entry.mode !== 0o555) continue;
    const bytes = readFileSync(file);
    if (bytes.subarray(0, 2).equals(Buffer.from("#!"))) {
      const newline = bytes.indexOf(0x0a);
      const interpreter = bytes.toString("utf8", 2, newline === -1 ? bytes.length : newline).trim().split(/[ \t]+/, 1)[0];
      if (!interpreter.startsWith(`${root}/`) || !declared.has(interpreter)) throw new Error(`runtime script interpreter escapes the closed inventory: ${file}`);
      continue;
    }
    const output = execFileSync(ldd, [file], { encoding: "utf8", env: { PATH: `${root}/bin`, HOME: "/nonexistent", LC_ALL: "C", TZ: "UTC" } });
    for (const line of output.split("\n").map((value) => value.trim()).filter(Boolean)) {
      if (line.includes("not found")) throw new Error(`runtime dependency is unresolved: ${file}`);
      if (/^linux-vdso\.so/.test(line) || line === "statically linked") continue;
      const match = /(?:=>\s+)?(\/\S+)/.exec(line);
      if (!match || !match[1].startsWith(`${root}/`) || !declared.has(match[1])) throw new Error(`runtime dependency escapes the closed inventory: ${file}: ${line}`);
    }
  }
}
