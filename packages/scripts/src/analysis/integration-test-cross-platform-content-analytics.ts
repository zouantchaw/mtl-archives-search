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
      caption: '=HYPERLINK("https://example.test/")',
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
    capture_time_basis: "source_event",
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
    evidence_kind: "synthetic_fixture",
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
  "--evidence-kind",
  "synthetic_fixture",
];
const runReport = () =>
  execFileSync(process.execPath, command, { cwd: root, stdio: "pipe" });
const missingProvenanceCommand = command.slice(0, -2);
let missingProvenanceFailure = "";
try {
  execFileSync(process.execPath, missingProvenanceCommand, {
    cwd: root,
    stdio: "pipe",
  });
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  missingProvenanceFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(missingProvenanceFailure, /Missing --evidence-kind/);
assert.equal(fs.existsSync(`${output}.json`), false);
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
const personalEvent = {
  ...inWindowEvent,
  event_id: "personal-data-1",
  query: "private visitor query",
  candidate_set: ["mtl_archives_metadata_1.json"],
};
fs.writeFileSync(events, `${JSON.stringify(personalEvent)}\n`);
let personalDataFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  personalDataFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  personalDataFailure,
  /no_personal_data signals must not contain raw query or candidate_set/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
fs.writeFileSync(events, `${JSON.stringify(inWindowEvent)}\n`);
const provenanceMismatchEvent = {
  ...inWindowEvent,
  event_id: "provenance-mismatch-1",
  evidence_kind: "real_export",
};
fs.writeFileSync(events, `${JSON.stringify(provenanceMismatchEvent)}\n`);
let provenanceMismatchFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  provenanceMismatchFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  provenanceMismatchFailure,
  /product event evidence_kind must match --evidence-kind/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
fs.writeFileSync(events, `${JSON.stringify(inWindowEvent)}\n`);
const negativePosts = JSON.parse(fs.readFileSync(posts, "utf8")) as Array<{
  metrics: Record<string, number>;
  permalink: string | null;
}>;
negativePosts[0].metrics.views = -1;
fs.writeFileSync(posts, JSON.stringify(negativePosts));

negativePosts[0].permalink = null;
fs.writeFileSync(posts, JSON.stringify(negativePosts));
let missingPermalinkFailure = "";
try {
  runReport();
} catch (error) {
  const result = error as { stderr?: Buffer; message?: string };
  missingPermalinkFailure = `${result.stderr?.toString() ?? ""}\n${result.message ?? ""}`;
}
assert.match(
  missingPermalinkFailure,
  /published post instagram:ig-1 requires permalink/,
);
assert.equal(fs.existsSync(`${output}.json`), false);
negativePosts[0].permalink = "https://example.test/p/ig-1";
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
fs.writeFileSync(viewsCsv, "date,primary\n2026-01-02,10\n2026-01-02,10\n");
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
const topEvents = path.join(vercelMonth, "Top Events.csv");
const topPagesCsv =
  "page,visitors,total\n/photo/mtl-1,10,1\n/photo/mtl-2,10,2\n";
fs.writeFileSync(topPagesA, topPagesCsv);
fs.writeFileSync(topPagesB, topPagesCsv);
fs.writeFileSync(
  topEvents,
  "event,visitors,total\nphoto_viewed,10,4\nsearch_committed,10,2\n",
);
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
  generated_at: string;
  evidence_kind: string;
  capture_time_basis: string;
  product_signals: unknown[];
  monthly: Array<{
    caveats: string[];
    meta_account_metrics: {
      captured_at: string;
      capture_time_basis: string;
      evidence_kind: string;
    };
    vercel?: {
      page_visitors: number | null;
      page_views: number | null;
      event_visitors: number | null;
      event_total: number | null;
    };
  }>;
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
assert.equal(report.evidence_kind, "synthetic_fixture");
assert.equal(report.capture_time_basis, "report_generation");
assert.equal(
  report.monthly[0]?.meta_account_metrics.capture_time_basis,
  "report_generation",
);
assert.equal(
  report.monthly[0]?.meta_account_metrics.captured_at,
  report.generated_at,
);
assert.notEqual(
  report.monthly[0]?.meta_account_metrics.captured_at,
  "2026-01-02T12:00:00.000Z",
);
assert.equal(
  report.monthly[0]?.meta_account_metrics.evidence_kind,
  "synthetic_fixture",
);
assert.equal(
  report.product_signals[0] &&
    (report.product_signals[0] as { evidence_kind: string }).evidence_kind,
  "synthetic_fixture",
);
assert.equal(
  report.product_signals[0] &&
    (report.product_signals[0] as { capture_time_basis: string })
      .capture_time_basis,
  "source_event",
);
assert.match(
  fs.readFileSync(`${output}.md`, "utf8"),
  /Evidence kind: `synthetic_fixture`[\s\S]*Aggregate capture-time basis: `report_generation`/,
);
assert.equal(report.monthly[0]?.vercel?.page_visitors, null);
assert.equal(report.monthly[0]?.vercel?.page_views, 3);
assert.equal(report.monthly[0]?.vercel?.event_visitors, null);
assert.equal(report.monthly[0]?.vercel?.event_total, 6);
assert.match(
  fs.readFileSync(`${output}-posts.csv`, "utf8"),
  /'=HYPERLINK\(""https:\/\/example\.test\//,
);
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
