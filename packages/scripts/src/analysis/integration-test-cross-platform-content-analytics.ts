import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("../../../..", import.meta.url).pathname);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mtl-content-analytics-"));
const posts = path.join(temp, "posts.json");
const identity = path.join(temp, "identity.jsonl");
const manifest = path.join(temp, "manifest.ndjson");
const meta = path.join(temp, "meta", "instagram", "snapshot");
const metaSummary = path.join(temp, "meta-summary.csv");
const vercel = path.join(temp, "vercel");
const events = path.join(temp, "events.jsonl");
const output = path.join(temp, "output", "report");
fs.mkdirSync(meta, { recursive: true });
fs.mkdirSync(vercel, { recursive: true });
fs.writeFileSync(
  posts,
  JSON.stringify([
    {
      network: "instagram",
      surface: "carousel",
      id: "ig-1",
      timestamp: "2026-01-02T15:00:00Z",
      permalink: "https://example.test/p/ig-1",
      caption: "A Montreal archive",
      metrics: { views: 10 },
    },
  ]),
);
const packageId =
  "2026-01-02::theme::mtl_archives_metadata_1.json::mtl_archives_image_1.jpg";
fs.writeFileSync(
  identity,
  `${JSON.stringify({
    platform: "instagram",
    platform_post_id: "ig-1",
    canonical_record_id: "mtl_archives_metadata_1.json",
    visual_family_id: "family-1",
    package_id: packageId,
    source_asset: "mtl_archives_image_1.jpg",
    audience: "public",
    format: "carousel",
    theme: "theme",
    publish_status: "published",
    platform_permalink: "https://example.test/p/ig-1",
  })}\n`,
);
fs.writeFileSync(
  manifest,
  `${JSON.stringify({ metadata_filename: "mtl_archives_metadata_1.json", image_filename: "mtl_archives_image_1.jpg" })}\n`,
);
fs.writeFileSync(path.join(meta, "views.csv"), "date,primary\n2026-01-02,10\n");
fs.writeFileSync(
  metaSummary,
  "platform,metric,date,value\ninstagram,views,2026-01-02,10\n",
);
fs.writeFileSync(
  events,
  `${JSON.stringify({
    schema_version: "mtl_content_signal_v1",
    event_id: "outside-1",
    signal_class: "product_behavior",
    source_type: "product_analytics",
    event_name: "photo_viewed",
    captured_at: "2026-01-03T15:00:00Z",
    timezone: "America/Toronto",
    canonical_record_id: "mtl_archives_metadata_1.json",
    visual_family_id: "family-1",
    package_id: packageId,
    source_asset: "mtl_archives_image_1.jpg",
    platform: "web",
    surface: "photo",
    metric_name: "view",
    metric_value: 1,
    metric_definition: "one photo view",
    observation_window: {
      start: "2026-01-03T15:00:00Z",
      end: "2026-01-03T15:00:00Z",
    },
    source: "fixture",
    query: null,
    position: null,
    candidate_set: null,
    ranking_version: null,
    model_version: null,
    index_version: null,
    experiment_assignment: null,
    propensity: null,
    safety_budget_id: null,
    privacy_consent: "no_personal_data",
    ground_truth_boundary: "reward_not_fact",
    identity_basis: "declared_identity",
    package_family_verification: "not_independently_verified",
  })}\n`,
);

const script = path.join(
  root,
  "packages/scripts/src/analysis/cross-platform-content-analytics.ts",
);
const command = [
  path.join(root, "node_modules/tsx/dist/cli.mjs"),
  script,
  "--posts-input",
  posts,
  "--meta-root",
  path.join(temp, "meta"),
  "--meta-daily-summary",
  metaSummary,
  "--vercel-root",
  vercel,
  "--identity-map",
  identity,
  "--canonical-manifest",
  manifest,
  "--product-events",
  events,
  "--start",
  "2026-01-02",
  "--end",
  "2026-01-02",
  "--output-prefix",
  output,
];
const runReport = () =>
  execFileSync(process.execPath, command, { cwd: root, stdio: "pipe" });
let failure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  failure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(failure, /outside requested window/);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
const inWindowEvent = JSON.parse(fs.readFileSync(events, "utf8")) as Record<
  string,
  unknown
>;
inWindowEvent.event_id = "inside-1";
inWindowEvent.captured_at = "2026-01-02T15:00:00Z";
inWindowEvent.observation_window = {
  start: "2026-01-02T15:00:00Z",
  end: "2026-01-02T15:00:00Z",
};
fs.writeFileSync(events, `${JSON.stringify(inWindowEvent)}\n`);
const negativePosts = JSON.parse(fs.readFileSync(posts, "utf8")) as Array<{
  metrics: Record<string, number>;
}>;
negativePosts[0].metrics.views = -1;
fs.writeFileSync(posts, JSON.stringify(negativePosts));
let negativeFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  negativeFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(negativeFailure, /negative post metric views/);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
negativePosts[0].metrics.views = 10;
fs.writeFileSync(posts, JSON.stringify(negativePosts));

const duplicateSocialPosts = [...negativePosts, { ...negativePosts[0] }];
fs.writeFileSync(posts, JSON.stringify(duplicateSocialPosts));
let duplicateSocialFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  duplicateSocialFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(duplicateSocialFailure, /duplicate social post instagram:ig-1/);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
fs.writeFileSync(posts, JSON.stringify(negativePosts));

const viewsCsv = path.join(meta, "views.csv");
fs.writeFileSync(
  viewsCsv,
  "date,primary\n2026-01-02,10\n2026-01-02,10\n",
);
let duplicateMetaFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  duplicateMetaFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  duplicateMetaFailure,
  /duplicate Meta daily aggregate instagram:views:2026-01-02/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
fs.writeFileSync(viewsCsv, "date,primary\n2026-01-02,10\n");

fs.writeFileSync(
  metaSummary,
  "platform,metric,date,value\ninstagram,views,2026-01-02,11\n",
);
let conflictingMetaFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  conflictingMetaFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  conflictingMetaFailure,
  /conflicting Meta daily aggregate instagram:views:2026-01-02/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
fs.writeFileSync(
  metaSummary,
  "platform,metric,date,value\ninstagram,views,2026-01-02,10\n",
);

const vercelMonth = path.join(vercel, "2026-01");
fs.mkdirSync(vercelMonth, { recursive: true });
const topPagesA = path.join(vercelMonth, "Top Pages.csv");
const topPagesB = path.join(vercelMonth, "Top Pages duplicate.csv");
const topPagesCsv = "page,visitors,total\n/photo/mtl-1,1,1\n";
fs.writeFileSync(topPagesA, topPagesCsv);
fs.writeFileSync(topPagesB, topPagesCsv);
let duplicateWebsiteFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  duplicateWebsiteFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  duplicateWebsiteFailure,
  /duplicate website aggregate 2026-01:top_pages/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
assert.equal(fs.existsSync(`${output}.md`), false);
fs.unlinkSync(topPagesB);

runReport();
const report = JSON.parse(fs.readFileSync(`${output}.json`, "utf8")) as {
  inputs: Record<string, unknown>;
  product_signals: unknown[];
  monthly: Array<{ caveats: string[] }>;
};
const containsString = (value: unknown): boolean =>
  typeof value === "string"
    ? value.includes(temp)
    : Array.isArray(value)
      ? value.some(containsString)
      : value !== null && typeof value === "object"
        ? Object.values(value).some(containsString)
        : false;
assert.equal(report.product_signals.length, 1);
assert.equal(containsString(report), false);
assert.equal(fs.readFileSync(`${output}.md`, "utf8").includes(temp), false);
assert.equal(
  report.monthly[0]?.caveats.some((caveat) => caveat.includes("partial")),
  true,
);
assert.match(
  fs.readFileSync(`${output}-daily.csv`, "utf8"),
  /schema_version.*captured_at.*timezone/,
);
assert.match(
  fs.readFileSync(`${output}-product-signals.csv`, "utf8"),
  /schema_version.*captured_at.*timezone.*canonical_record_id.*platform/,
);
assert.match(
  fs.readFileSync(`${output}-monthly.csv`, "utf8"),
  /meta_timezone.*meta_platform.*vercel_timezone.*vercel_platform/,
);
console.log(
  JSON.stringify({
    status: "cross_platform_integration_fail_before_write_passed",
    cases: 7,
  }),
);
