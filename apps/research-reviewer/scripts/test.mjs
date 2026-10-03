import { build } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mtl-reviewer-test-"));
try {
  await build({
    entryPoints: ["test/worker.test.ts"],
    outfile: path.join(temp, "test.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  execFileSync(process.execPath, ["--test", path.join(temp, "test.mjs")], {
    stdio: "inherit",
  });
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
