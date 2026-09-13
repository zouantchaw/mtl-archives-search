import fs from "node:fs";
import path from "node:path";
import { scorePool, percentile, leakageComponents } from "./metrics.mjs";
const out = process.argv[2],
  read = (f) => JSON.parse(fs.readFileSync(path.join(out, f)));
const cases = read("evaluation-cases.json"),
  responses = fs
    .readdirSync(path.join(out, "search-responses"))
    .map((f) => read("search-responses/" + f));
const metrics = responses
  .filter((r) => r.repeat === 0)
  .map((r) => {
    const c = cases.find((c) => c.id === r.id);
    return {
      id: r.id,
      mode: r.mode,
      split: c.split,
      ...scorePool(
        (r.body?.items ?? []).map((x) => x.metadataFilename),
        c.positive_ids,
        c.reviewed_pool_ids,
      ),
      latency_ms: r.elapsed_ms,
    };
  });
const familyRows = cases.flatMap((c) =>
  c.positive_families.map((f) => ({
    component_id: f.component,
    split: c.split,
  })),
);
const crossings = leakageComponents(familyRows);
const affected = cases
  .filter((c) =>
    c.positive_families.some((f) => crossings.includes(f.component)),
  )
  .map((c) => c.id);
const audit = read("assistant-audit.json");
const summaries = {};
for (const lane of ["random", "targeted"]) {
  const a = audit.filter((r) => r.lane === lane),
    visible = a.filter((r) => r.viewpoint !== "unavailable");
  summaries[lane] = {
    sampled: a.length,
    visually_reviewed: visible.length,
    unavailable: a.length - visible.length,
    caption_unsupported_or_wrong: visible.filter(
      (r) => r.caption_unsupported_or_wrong_detail,
    ).length,
    caption_missing_viewpoint: visible.filter(
      (r) => r.caption_missing_viewpoint,
    ).length,
    authority: "assistant provisional; not human gold",
  };
}
const latency = {};
for (const mode of ["smart", "semantic", "visual"]) {
  const a = responses
    .filter((r) => r.mode === mode && r.status === 200)
    .map((r) => r.elapsed_ms);
  latency[mode] = {
    n: a.length,
    p50_ms: percentile(a, 0.5),
    p95_ms: percentile(a, 0.95),
    protocol:
      "client elapsed, concurrency 3, mixes first and repeated requests; not a load-test or pure server latency",
  };
}
const result = {
  version: "issue136-baseline-v1",
  metrics,
  latency,
  audit: summaries,
  split_audit: {
    crossing_components: crossings,
    affected_cases: affected,
    policy:
      "Overlapping stress and historical test cases are diagnostic only. No disjoint held-out headline or training authorized. Inherited historical family splits themselves are separately checked.",
  },
  cost: {
    usd: null,
    search_requests: responses.length,
    reason:
      "No attributable billed usage in search responses; monetary baseline remains unknown, not zero.",
  },
  promotion: false,
};
fs.writeFileSync(
  path.join(out, "metrics.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    { latency, audit: summaries, crossings: crossings.length },
    null,
    2,
  ),
);
