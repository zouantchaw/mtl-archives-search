import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
const root = process.cwd();
const cfRoot = path.dirname(
  path.dirname(
    await fs.realpath(
      execFileSync("which", ["cf"], { encoding: "utf8" }).trim(),
    ),
  ),
);
const utils = await import(
  path.join(
    cfRoot,
    "node_modules/@cloudflare/build-output-utils/dist/index.mjs",
  )
);
const { InputWorkerSchema } = await import(
  path.join(cfRoot, "node_modules/@cloudflare/config/dist/index.mjs")
);
const local = JSON.parse(await fs.readFile("wrangler.json", "utf8"));
if (
  local.name !== "mtl-archives-research-reviewer" ||
  local.d1_databases.length !== 1 ||
  local.d1_databases[0].database_id !== "00e31f70-f4b9-43cb-8b52-05ca2d28404a"
)
  throw Error("Unexpected review resource boundary");
const env = {
  REVIEW_DB: {
    type: "d1",
    name: local.d1_databases[0].database_name,
    id: local.d1_databases[0].database_id,
  },
  SOURCES: { type: "r2", name: "mtl-archives-research-sources" },
  DERIVED: { type: "r2", name: "mtl-archives-research-derived" },
  ASSETS: { type: "assets" },
  HELP_ARTIFACTS: { type: "r2", name: "mtl-archives-reviewer-assistance" },
  AI: { type: "ai" },
  IMAGES: { type: "images" },
  HELP_QUEUE: { type: "queue", name: "mtl-archives-reviewer-help" },
};
for (const [name, value] of Object.entries(local.vars))
  env[name] = { type: "text", value };
const config = InputWorkerSchema.parse({
  name: local.name,
  compatibilityDate: local.compatibility_date,
  workersDev: true,
  previewUrls: false,
  assets: { runWorkerFirst: true, notFoundHandling: "single-page-application" },
  env,
  observability: { enabled: true },
  triggers: [
    {
      type: "queue",
      name: "mtl-archives-reviewer-help",
      deadLetterQueue: "mtl-archives-reviewer-help-dlq",
      maxBatchSize: 1,
      maxConcurrency: 2,
      maxRetries: 2,
      retryDelay: 60,
    },
  ],
});
await utils.cleanBuildOutputDir(root);
await utils.writeRootConfig(root, undefined, { isPreview: false });
await utils.writeWorkerConfig({
  root,
  config,
  manifest: {
    type: "complete",
    mainModule: "worker.mjs",
    modules: { "worker.mjs": { type: "esm" } },
  },
});
await build({
  entryPoints: ["src/index.ts"],
  outfile: path.join(utils.getWorkerBundleDir(root), "worker.mjs"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
await utils.writeAssets({ root, sourceDirectory: path.join(root, "dist") });
console.log(
  "Built private reviewer with isolated D1 and research image bindings.",
);
