/** Live integration eval: consumes bounded inference on the configured backend. */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
const module = await import("../lib/research/agent.ts");
const { createArchiveAgent } = module.default || module;
const out = process.env.RESEARCH_REPORT_DIR || "/tmp/mtl-reading-room-eval";
fs.mkdirSync(out, { recursive: true });
const cases = [
  {
    name: "women-helicopters",
    prompt: "Find photographs of women standing beside helicopters.",
  },
  { name: "trees-water", prompt: "Find photographs with trees beside water." },
  {
    name: "documented-dates",
    prompt:
      "Find photographs of churches dated before 1900. Exclude photographs without a documented date.",
  },
  {
    name: "historical-causality",
    prompt:
      "Show me how Montreal streets changed because tramways disappeared. What changed and why?",
  },
  {
    name: "selected-photo",
    prompt:
      "What can you actually see in photo mtl_archives_metadata_18557? What archival facts are documented?",
  },
];
let failed = 0;
for (const item of cases) {
  const start = Date.now();
  try {
    const result = await createArchiveAgent(undefined, item.prompt).generate({
      prompt: item.prompt,
    });
    const tools = result.steps
      .flatMap((s) => s.toolResults)
      .map((t) => ({ tool: t.toolName, input: t.input, output: t.output }));
    const data = {
      ...item,
      seconds: (Date.now() - start) / 1000,
      text: result.text,
      tools,
    };
    fs.writeFileSync(
      path.join(out, `${item.name}.json`),
      JSON.stringify(data, null, 2),
    );
    if (item.name === "women-helicopters") {
      const c = tools.find((t) => t.tool === "searchArchive")?.output;
      assert.ok(c?.checked >= 5);
      assert.ok(
        c.photos.some(
          (p) =>
            p.id === "mtl_archives_metadata_18557.json" &&
            p.visualCheck.status === "match",
        ),
      );
      assert.ok(
        !c.photos.some(
          (p) =>
            p.id === "mtl_archives_metadata_17933.json" &&
            p.visualCheck.status === "match",
        ),
      );
    }
    if (item.name === "trees-water")
      assert.ok(tools.some((t) => t.output.checked >= 5));
    if (item.name === "documented-dates") {
      const t = tools.find((t) => t.tool === "searchArchive");
      assert.ok(t);
      assert.ok(t.input.beforeYear <= 1900);
      assert.ok(t.output.photos.every((p) => p.date));
    }
    if (item.name === "historical-causality") {
      assert.ok(
        tools.some(
          (t) =>
            t.tool === "explainLimits" &&
            t.output.reason === "historical_change",
        ),
      );
      assert.equal(tools.filter((t) => t.tool === "searchArchive").length, 0);
    }
    if (item.name === "selected-photo") {
      assert.ok(
        tools.some(
          (t) =>
            t.tool === "explainPhoto" &&
            t.output.photo.id === "mtl_archives_metadata_18557.json" &&
            t.output.observation.length > 40 &&
            !t.output.observation.includes("could not be checked"),
        ),
      );
    }
    console.log(
      "PASS",
      item.name,
      `${data.seconds.toFixed(1)}s`,
      tools.map((t) => ({
        tool: t.tool,
        checked: t.output.checked,
        photos: t.output.photos?.length,
        observation: t.output.observation,
      })),
      result.text,
    );
  } catch (error) {
    failed++;
    console.log("FAIL", item.name, error.name, error.message.slice(0, 300));
  }
}
process.exitCode = failed ? 1 : 0;
