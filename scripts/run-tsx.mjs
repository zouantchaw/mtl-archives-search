import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function resolveCanonicalRepoRoot(currentRepoRoot) {
  const configured = (process.env.MTL_ARCHIVES_PRIMARY_REPO || "").trim();
  if (configured && fs.existsSync(configured)) {
    return path.resolve(configured);
  }

  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd: currentRepoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!commonDir) return null;
    const resolved = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(currentRepoRoot, commonDir);
    if (path.basename(resolved) === ".git") {
      return path.dirname(resolved);
    }
  } catch {
    return null;
  }

  return null;
}

function findTsxCli() {
  const candidates = [];
  const canonicalRoot = resolveCanonicalRepoRoot(repoRoot);
  for (const root of [repoRoot, canonicalRoot]) {
    if (!root) continue;
    candidates.push(path.join(root, "node_modules", "tsx", "dist", "cli.mjs"));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const cli = findTsxCli();
if (!cli) {
  console.error(
    "Could not find tsx CLI in the local or canonical repo node_modules. Run npm install in /Users/wiel/Development/mtl-archives-search."
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
