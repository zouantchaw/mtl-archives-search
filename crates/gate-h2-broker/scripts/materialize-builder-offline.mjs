import { lstatSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseAndValidateInputLock } from "./verify-external-input-lock.mjs";

export const NOT_YET_MATERIALIZED = 73;
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
export function sanitizeOfflineEnvironment() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, { HOME: "/nonexistent", PATH: "", LANG: "C", LC_ALL: "C", NO_PROXY: "*", http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" });
  process.umask(0o077);
}
export function requireEmptyOutput(outputDirectory) {
  const output = resolve(outputDirectory); const metadata = lstatSync(output, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== BigInt(process.geteuid()) || Number(metadata.mode & 0o7777n) !== 0o700 || readdirSync(output).length !== 0) fail("E_OFFLINE_OUTPUT", "output must be an existing empty owner-only directory");
}
export function materializeOffline(lockPath, acquiredDirectory, outputDirectory, trustedContext) {
  sanitizeOfflineEnvironment();
  const lock = parseAndValidateInputLock(lockPath, acquiredDirectory, trustedContext); requireEmptyOutput(outputDirectory);
  return lock;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const [lockPath, acquiredDirectory, outputDirectory, sourceCommit, sourceTree] = process.argv.slice(2);
  if (!lockPath || !acquiredDirectory || !outputDirectory || !sourceCommit || !sourceTree) fail("E_USAGE", "lock, acquired directory, output directory, and trusted materializer commit/tree are required");
  materializeOffline(lockPath, acquiredDirectory, outputDirectory, { source_commit: sourceCommit, source_tree_sha256: sourceTree });
  process.exitCode = NOT_YET_MATERIALIZED;
}
