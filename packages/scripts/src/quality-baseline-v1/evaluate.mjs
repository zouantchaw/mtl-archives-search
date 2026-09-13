import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const out = process.argv[2];
if (!out) throw Error("Usage: node evaluate.mjs PRIVATE_OUTPUT_DIR");
const read = (p) => JSON.parse(fs.readFileSync(path.join(out, p)));
const jsonl = (p) =>
  fs.readFileSync(path.join(out, p), "utf8").trim().split("\n").map(JSON.parse);
const write = (p, d) =>
  fs.writeFileSync(path.join(out, p), JSON.stringify(d, null, 2));
const audit = read("assistant-audit.json");
const families = jsonl(
  "recovered-family/data/mtl_archives/reports/canonical_image_recovery_v1/graph-after/record-leakage-map-v1.jsonl",
);
const fmap = new Map(families.map((r) => [r.record_id, r]));
const seeds = [
  [
    "street-original",
    "street view images with businesses and brands",
    "commercial_ground",
  ],
  [
    "street-concrete",
    "street level storefronts shop signs",
    "commercial_ground",
  ],
  [
    "street-fr",
    "Des photographies prises depuis le trottoir, au niveau du sol, avec des commerces et des enseignes. Pas de vues aériennes.",
    "commercial_ground",
  ],
  ["street-fr-short", "rue commerces enseignes", "commercial_ground"],
  [
    "street-corrected",
    "ground-level street photographs with businesses and signs, not aerial views",
    "commercial_ground",
  ],
  [
    "church-interior",
    "Inside a church, looking toward the altar. No exterior facades.",
    "church_interior",
  ],
  [
    "church-exterior",
    "church facade viewed from the ground",
    "church_exterior",
  ],
  ["church-fr", "église vue de la rue, façade extérieure", "church_exterior"],
  [
    "nadir",
    "Aerial photographs looking straight down on city streets and buildings.",
    "nadir_urban",
  ],
  ["helicopter", "women beside a helicopter", "people_helicopter"],
  [
    "helicopter-fr",
    "personnes debout à côté d’un hélicoptère",
    "people_helicopter",
  ],
  [
    "flying-helicopter",
    "helicopter flying above the ground",
    "flying_helicopter",
  ],
  [
    "trees-water",
    "Trees beside water, photographed from the ground, not aerial views.",
    "ground_water",
  ],
  [
    "absent-target",
    "A purple elephant standing beside a helicopter.",
    "purple_elephant",
  ],
];
let cases = seeds.map(([id, query, tag]) => ({
  id,
  query,
  tag,
  split: "stress_tuning",
  judgment_class: "assistant_provisional",
  positive_ids: audit
    .filter((r) => r.tags.includes(tag))
    .map((r) => r.record_id),
  reviewed_pool_ids: audit
    .filter((r) => !["unavailable", "uncertain"].includes(r.viewpoint))
    .map((r) => r.record_id),
}));
const hist = jsonl(
  "recovered-gold/data/mtl_archives/reports/gold_label_batch_002/search/search-silver-dispositions-v1.jsonl",
)
  .filter((r) => r.disposition === "reviewed_gold" && r.split === "test")
  .slice(0, 10);
for (const r of hist)
  cases.push({
    id: r.task_id,
    query: r.query,
    split: "historical_test_report_only",
    judgment_class: "historical_agent_reviewed",
    positive_ids: r.positive_record_ids,
    reviewed_pool_ids: r.positive_record_ids,
    component_id: r.component_id,
  });
for (const c of cases)
  c.positive_families = c.positive_ids.map((id) => ({
    id,
    component: fmap.get(id)?.component_id ?? null,
    historical_split: fmap.get(id)?.benchmark_split ?? null,
  }));
const caseHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(cases, null, 2))
  .digest("hex");
if (
  fs.existsSync(path.join(out, "evaluation-freeze.json")) &&
  read("evaluation-freeze.json").sha256 !== caseHash
)
  throw Error(
    "Frozen cases changed; use a new output directory and explicit new protocol version",
  );
write("evaluation-cases.json", cases);
if (!fs.existsSync(path.join(out, "evaluation-freeze.json")))
  write("evaluation-freeze.json", {
    sha256: caseHash,
    frozen_at: new Date().toISOString(),
    no_training: true,
    no_tuning: true,
    heldout_rule:
      "Historical test queries are report-only. Stress queries are not a disjoint held-out benchmark. Family-crossing checks must precede any later fitting.",
  });
fs.mkdirSync(path.join(out, "search-responses"), { recursive: true });
const jobs = cases.flatMap((c) =>
  ["smart", "semantic", "visual"].map((mode) => ({ c, mode, repeat: 0 })),
);
for (let repeat = 1; repeat <= 2; repeat++)
  for (const c of cases.slice(0, 6)) jobs.push({ c, mode: "smart", repeat });
let next = 0;
const results = [];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < jobs.length) {
      const { c, mode, repeat } = jobs[next++];
      const file = `search-responses/${c.id}-${mode}-${repeat}.json`;
      if (fs.existsSync(path.join(out, file))) {
        results.push(read(file));
        continue;
      }
      const url = new URL("https://www.mtlarchives.com/api/search");
      for (const [k, v] of Object.entries({
        q: c.query,
        mode,
        limit: 36,
        maxSize: 12000000,
      }))
        url.searchParams.set(k, String(v));
      const start = performance.now();
      let row;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
        const body = await res.json();
        if (res.ok && !Array.isArray(body.items))
          throw Error("Invalid search response shape");
        row = {
          id: c.id,
          mode,
          repeat,
          status: res.status,
          elapsed_ms: performance.now() - start,
          body,
        };
      } catch (e) {
        row = {
          id: c.id,
          mode,
          repeat,
          status: "error",
          elapsed_ms: performance.now() - start,
          error: e.message,
        };
      }
      write(file, row);
      results.push(row);
    }
  }),
);
write("search-run-summary.json", {
  cases: cases.length,
  requests: results.length,
  status_counts: results.reduce(
    (a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a),
    {},
  ),
  concurrency: 3,
  cost_usd: null,
  cost_reason:
    "Search response does not expose attributable inference billing; network/API operation counts recorded, no zero-cost claim.",
});
console.log("cases", cases.length, "requests", results.length);
