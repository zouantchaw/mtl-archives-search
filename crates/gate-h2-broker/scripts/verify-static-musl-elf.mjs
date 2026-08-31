import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateElfReports(header, programHeaders, dynamicSection) {
  const field = (name) => new RegExp(`^\\s*${name}:\\s+(.+?)\\s*$`, "m").exec(header)?.[1];
  if (field("Class") !== "ELF64") throw new Error("ELF class must be ELF64");
  if (field("Data") !== "2's complement, little endian") throw new Error("ELF data encoding must be little-endian");
  if (field("Machine") !== "Advanced Micro Devices X86-64") throw new Error("ELF machine must be x86-64");
  if (/\bINTERP\b/.test(programHeaders)) throw new Error("ELF interpreter is forbidden");
  if (/\bNEEDED\b/.test(dynamicSection)) throw new Error("ELF dynamic dependency is forbidden");
}

function main() {
  const [binary, readelf] = process.argv.slice(2);
  if (!binary || !readelf || process.argv.length !== 4 || readelf !== "/opt/gate-h2/bin/readelf") throw new Error("usage: verify-static-musl-elf.mjs <binary> /opt/gate-h2/bin/readelf");
  for (const [path, label, executable] of [[binary, "ELF candidate", false], [readelf, "readelf", true]]) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (executable && (metadata.mode & 0o111) === 0)) throw new Error(`${label} is not a safe regular file`);
  }
  const options = { encoding: "utf8", env: { PATH: "/opt/gate-h2/bin", HOME: "/nonexistent", LC_ALL: "C", TZ: "UTC" } };
  validateElfReports(
    execFileSync(readelf, ["-hW", binary], options),
    execFileSync(readelf, ["-lW", binary], options),
    execFileSync(readelf, ["-dW", binary], options),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
