import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

function resolveCanonicalRepoRoot(currentRepoRoot: string): string | null {
  const configured = process.env.MTL_ARCHIVES_PRIMARY_REPO?.trim();
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

export function loadRepoEnv(currentRepoRoot: string): void {
  const roots = new Set<string>([path.resolve(currentRepoRoot)]);
  const canonical = resolveCanonicalRepoRoot(currentRepoRoot);
  if (canonical) roots.add(canonical);

  for (const root of roots) {
    for (const envName of [".env.local", ".env"]) {
      const envPath = path.join(root, envName);
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
      }
    }
  }
}

export function resolveApiBase(): string {
  const explicit =
    process.env.API_BASE?.trim() || process.env.MTL_API_BASE?.trim() || "";
  if (explicit) return explicit;

  const candidate = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1"
      ) {
        return "https://mtl-archives-worker.wiel.workers.dev";
      }
    } catch {
      return candidate;
    }
    return candidate;
  }

  return "https://mtl-archives-worker.wiel.workers.dev";
}
