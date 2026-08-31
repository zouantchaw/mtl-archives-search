import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_SIGNAL_SCHEMA,
  assertCompletePostJoins,
  assertProductSignalsWithinDateRange,
  identityLookupKey,
  postLookupKey,
  validateIdentityMap,
  validateProductSignals,
  type ContentIdentity,
  type ProductSignal,
} from "./content-signal-contract.js";

type Platform = "instagram" | "facebook";
type Surface = "carousel" | "reels" | "feed" | "unknown";
type Metric =
  | "views"
  | "viewers"
  | "reach"
  | "interactions"
  | "profile_visits"
  | "page_visits"
  | "follows"
  | "link_clicks";

type Cell = string | number | null;
type CsvRow = Record<string, string>;

type CombinedPost = {
  network: Platform;
  surface: Surface;
  id: string;
  timestamp: string | null;
  permalink: string | null;
  caption: string | null;
  metrics?: Record<string, number | null>;
};

type DailyMetric = {
  platform: Platform;
  metric: Metric;
  date: string;
  value: number;
  source_path: string;
};

type WebsiteMonth = {
  month: string;
  page_visitors: number | null;
  page_views: number | null;
  event_visitors: number | null;
  event_total: number | null;
  photo_viewed: number | null;
  photo_dwelled: number | null;
  search_committed: number | null;
  print_cta_clicked: number | null;
  top_photo_routes: Array<{ route: string; total: number }>;
  source_files: string[];
  coverage: "raw_monthly_tables" | "normalized_summary" | "missing";
  signal_class: "product_behavior";
  join_scope: "month_aggregate";
  schema_version?: string;
  captured_at?: string;
  timezone?: "America/Toronto";
  observation_window?: { start: string; end: string };
  ground_truth_boundary?: "reward_not_fact";
  source_type?: "product_analytics";
  platform?: "web";
};

type AggregateEnvelope = {
  schema_version: typeof CONTENT_SIGNAL_SCHEMA;
  captured_at: string;
  timezone: "America/Toronto";
  observation_window: { start: string; end: string };
  ground_truth_boundary: "reward_not_fact";
  platform: "instagram" | "facebook" | "combined" | "web";
};

type MonthlyMetaFallback = {
  month: string;
  instagram: Record<string, number | null>;
  facebook: Record<string, number | null>;
};

type PostRow = {
  platform: Platform;
  post_id: string;
  post_date: string;
  month: string;
  surface: Surface;
  permalink: string | null;
  first_line: string;
  caption: string;
  caption_words: number;
  features: Record<string, boolean>;
  content_metrics: Record<string, number | null>;
  account_metrics_day: Record<string, number | null>;
  metric_basis: string;
  identity: ContentIdentity;
  signal_class: "social_behavior";
  source_type: "social_platform";
  ground_truth_boundary: "reward_not_fact";
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../");
const DEFAULT_OUTPUT = path.join(
  MONOREPO_ROOT,
  "data",
  "social",
  "cross-platform-content-analytics",
);
const FEATURE_KEYS = [
  "question_hook",
  "place_date_specific",
  "loss_or_erasure",
  "nostalgia_memory",
  "transit_infrastructure",
  "aerial_before_after",
  "bilingual_cue",
  "cta_link",
] as const;

function fail(message: string): never {
  console.error(`[cross-platform-content-analytics] ${message}`);
  process.exit(1);
}

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArg(flag: string): string {
  const value = arg(flag);
  if (!value) fail(`Missing ${flag}`);
  return value;
}

function validateDateRange(start: string, end: string): void {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  };
  if (!valid(start) || !valid(end))
    fail("--start and --end must be valid YYYY-MM-DD dates");
  if (start > end) fail("--start must not be after --end");
}

function aggregateEnvelope(start: string, end: string): AggregateEnvelope {
  // The report generation time is not the observation time. Use a stable
  // in-window capture instant for aggregate rows and retain generated_at
  // separately at the report level.
  return {
    schema_version: CONTENT_SIGNAL_SCHEMA,
    captured_at: `${end}T12:00:00.000Z`,
    timezone: "America/Toronto",
    platform: "combined",
    observation_window: {
      start: `${start}T00:00:00.000Z`,
      end: `${end}T23:59:59.999Z`,
    },
    ground_truth_boundary: "reward_not_fact",
  };
}

function safeDisplayPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(MONOREPO_ROOT, absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
    return relative;
  return "<external-input>";
}

function readText(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return bytes.toString("utf16le").replace(/^\uFEFF/, "");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes);
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const next = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = next;
    }
    return swapped.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

function readJsonRecords(filePath: string): unknown[] {
  const text = readText(filePath).trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    throw new Error("expected an object or array");
  } catch (error) {
    // Identity/event exports are also accepted as JSONL so they can be
    // appended locally without rewriting the full artifact.
    const rows = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new Error(
            `${filePath} is not valid JSON or JSONL (line ${index + 1})`,
          );
        }
      });
    if (rows.length) return rows;
    throw error;
  }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function parseCsv(filePath: string): CsvRow[] {
  const lines = readText(filePath)
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  let headerIndex = lines.findIndex((line) => {
    const cells = parseCsvLine(line).map((cell) => cell.toLowerCase());
    return (
      (cells.includes("date") && cells.includes("primary")) ||
      (cells.includes("page") &&
        cells.includes("visitors") &&
        cells.includes("total"))
    );
  });
  if (headerIndex < 0) {
    headerIndex = 0;
    while (headerIndex < lines.length && /^sep=/i.test(lines[headerIndex]))
      headerIndex += 1;
  }
  const headers = parseCsvLine(lines[headerIndex]);
  const rows: CsvRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = parseCsvLine(line);
    if (!cells.length || cells.every((cell) => !cell)) continue;
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header.toLowerCase()] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function numberValue(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  if (Number.isFinite(parsed) && parsed < 0)
    throw new Error("analytics metrics must be non-negative");
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMetric(fileName: string): Metric | null {
  const name = fileName.toLowerCase();
  if (name.includes("link-click")) return "link_clicks";
  if (name.includes("content-interactions") || name.includes("interactions"))
    return "interactions";
  if (name.includes("profile-visits")) return "profile_visits";
  if (name.includes("page-visits") || name.includes("visits"))
    return "page_visits";
  if (name.includes("viewers")) return "viewers";
  if (name.includes("reach")) return "reach";
  if (name.includes("follows")) return "follows";
  if (name.includes("views")) return "views";
  return null;
}

function normalizeDate(value: string): string | null {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function dateInToronto(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function firstLine(caption: string | null): string {
  return (
    (caption ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function words(caption: string): number {
  return (caption.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

function featureFlags(caption: string | null): Record<string, boolean> {
  const text = caption ?? "";
  const first = firstLine(text).toLowerCase();
  const lower = text.toLowerCase();
  return {
    question_hook:
      /\?/.test(first) ||
      /\b(quel|quelle|saviez|what do you|did you know)\b/.test(lower),
    place_date_specific:
      /\b(1[89]\d{2}|20\d{2})\b/.test(text) ||
      /\b(rue|avenue|boulevard|place|angle|coin|street|road|station|mont-royal|saint-|sainte-)\b/i.test(
        text,
      ),
    loss_or_erasure:
      /\b(demol|démol|disparu|dispar|détruit|destroy|lost|erased|disappear)\b/i.test(
        lower,
      ),
    nostalgia_memory:
      /\b(nostal|souvenir|mémoire|memory|remember|avant|past|archive|archiv)\b/i.test(
        lower,
      ),
    transit_infrastructure:
      /\b(métro|metro|tram|train|rail|bus|station|pont|bridge|tunnel|gare)\b/i.test(
        lower,
      ),
    aerial_before_after:
      /\b(aérien|aerial|vue d'ensemble|before|after|avant|après|apres|panoram)\b/i.test(
        lower,
      ),
    bilingual_cue:
      /\n\s*[-—]\s*\n/.test(text) ||
      /\b(montreal in|an archival|what changed|what survived|link in bio|lien en bio)\b/i.test(
        lower,
      ),
    cta_link:
      /\b(lien en bio|link in bio|mtlarchives\.com|explore more|explorer plus)\b/i.test(
        lower,
      ),
  };
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) result.push(filePath);
    }
  };
  walk(root);
  return result.sort();
}

function dailyMetricKey(
  row: Pick<DailyMetric, "platform" | "metric" | "date">,
): string {
  return `${row.platform}:${row.metric}:${row.date}`;
}

function rejectDuplicateDailyMetrics(
  rows: DailyMetric[],
  sourceLabel: string,
): DailyMetric[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = dailyMetricKey(row);
    if (seen.has(key))
      throw new Error(
        `duplicate Meta daily aggregate ${key} in ${sourceLabel}`,
      );
    seen.add(key);
  }
  return rows;
}

function readMetaDaily(
  metaRoot: string,
  startDate: string,
  endDate: string,
): DailyMetric[] {
  const rows: DailyMetric[] = [];
  for (const filePath of listFiles(metaRoot).filter((filePath) =>
    filePath.toLowerCase().endsWith(".csv"),
  )) {
    const parts = filePath.split(path.sep);
    const platformPart = parts.at(-3);
    const platform =
      platformPart === "instagram" || platformPart === "facebook"
        ? platformPart
        : null;
    const metric = normalizeMetric(path.basename(filePath));
    if (!platform || !metric) continue;
    for (const row of parseCsv(filePath)) {
      const date = normalizeDate(row.date ?? row.primary ?? "");
      const value = numberValue(row.primary ?? row.total ?? row.value);
      if (!date || date < startDate || date > endDate || value === null)
        continue;
      rows.push({ platform, metric, date, value, source_path: filePath });
    }
  }
  return rejectDuplicateDailyMetrics(rows, "raw exports");
}

function readNormalizedMetaDaily(
  summaryPath: string,
  startDate: string,
  endDate: string,
): DailyMetric[] {
  const rows: DailyMetric[] = [];
  for (const row of parseCsv(summaryPath)) {
    const platform =
      row.platform === "instagram" || row.platform === "facebook"
        ? row.platform
        : null;
    const metric = row.metric as Metric;
    const date = normalizeDate(row.date ?? "");
    const value = numberValue(row.value);
    if (
      !platform ||
      ![
        "views",
        "viewers",
        "reach",
        "interactions",
        "profile_visits",
        "page_visits",
        "follows",
        "link_clicks",
      ].includes(metric)
    )
      continue;
    if (!date || date < startDate || date > endDate || value === null) continue;
    rows.push({ platform, metric, date, value, source_path: summaryPath });
  }
  return rejectDuplicateDailyMetrics(rows, "normalized summary");
}

function readMonthlyMetaSummary(
  summaryPath: string,
  startDate: string,
  endDate: string,
): Map<string, MonthlyMetaFallback> {
  const result = new Map<string, MonthlyMetaFallback>();
  for (const row of parseCsv(summaryPath)) {
    const month = row.month;
    if (
      !/^\d{4}-\d{2}$/.test(month) ||
      `${month}-31` < startDate ||
      `${month}-01` > endDate
    )
      continue;
    const metric = (prefix: string, key: string) =>
      numberValue(row[`${prefix}_${key}`]);
    if (result.has(month))
      throw new Error(`duplicate Meta monthly aggregate ${month}`);
    result.set(month, {
      month,
      instagram: {
        views: metric("instagram", "views"),
        reach: metric("instagram", "reach"),
        interactions: metric("instagram", "interactions"),
        profile_visits: metric("instagram", "profile_visits"),
        follows: metric("instagram", "follows"),
        link_clicks: metric("instagram", "link_clicks"),
      },
      facebook: {
        views: metric("facebook", "views"),
        viewers: metric("facebook", "viewers"),
        interactions: metric("facebook", "interactions"),
        page_visits: metric("facebook", "visits"),
        follows: metric("facebook", "follows"),
        link_clicks: metric("facebook", "link_clicks"),
      },
    });
  }
  return result;
}

function mergeMetaDaily(
  summaryRows: DailyMetric[],
  rawRows: DailyMetric[],
): DailyMetric[] {
  const summary = new Map(
    rejectDuplicateDailyMetrics(summaryRows, "normalized summary").map(
      (row) => [dailyMetricKey(row), row],
    ),
  );
  const raw = new Map(
    rejectDuplicateDailyMetrics(rawRows, "raw exports").map((row) => [
      dailyMetricKey(row),
      row,
    ]),
  );
  const merged = new Map(summary);
  for (const [key, row] of raw) {
    const existing = merged.get(key);
    if (existing && existing.value !== row.value)
      throw new Error(
        `conflicting Meta daily aggregate ${key}: normalized=${existing.value}, raw=${row.value}`,
      );
    // Raw exports are the deterministic source of record when they agree
    // with a normalized summary. Conflicting values fail closed above.
    merged.set(key, row);
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.platform.localeCompare(b.platform) ||
      a.metric.localeCompare(b.metric),
  );
}

function readWebsiteMonths(
  vercelRoot: string,
  startDate: string,
  endDate: string,
): WebsiteMonth[] {
  const months = new Map<string, WebsiteMonth>();
  const seenTables = new Set<string>();
  const ensure = (month: string) => {
    const current = months.get(month);
    if (current) return current;
    const created: WebsiteMonth = {
      month,
      page_visitors: null,
      page_views: null,
      event_visitors: null,
      event_total: null,
      photo_viewed: null,
      photo_dwelled: null,
      search_committed: null,
      print_cta_clicked: null,
      top_photo_routes: [],
      source_files: [],
      coverage: "raw_monthly_tables",
      signal_class: "product_behavior",
      join_scope: "month_aggregate",
    };
    months.set(month, created);
    return created;
  };

  for (const filePath of listFiles(vercelRoot).filter((filePath) =>
    filePath.toLowerCase().endsWith(".csv"),
  )) {
    const month = path
      .basename(path.dirname(filePath))
      .match(/^\d{4}-\d{2}$/)?.[0];
    if (!month || `${month}-31` < startDate || `${month}-01` > endDate)
      continue;
    const rows = parseCsv(filePath);
    const base = path.basename(filePath).toLowerCase();
    const tableKind = base.startsWith("top pages")
      ? "top_pages"
      : base.startsWith("top events")
        ? "top_events"
        : null;
    if (tableKind) {
      const tableKey = `${month}:${tableKind}`;
      if (seenTables.has(tableKey))
        throw new Error(`duplicate website aggregate ${tableKey}`);
      seenTables.add(tableKey);
    }
    const target = ensure(month);
    target.source_files.push(filePath);
    if (base.startsWith("top pages")) {
      // Vercel's Top Pages `visitors` value is unique per route. The same
      // visitor can therefore occur in multiple rows, so summing it would
      // manufacture a monthly unique-visitor total. A normalized monthly
      // summary may provide this value in mergeWebsiteSummary below.
      target.page_visitors = null;
      target.page_views = rows.reduce(
        (sum, row) => sum + (numberValue(row.total) ?? 0),
        0,
      );
      target.top_photo_routes = rows
        .filter((row) => /^\/photo\//.test(row.page ?? row.route ?? ""))
        .map((row) => ({
          route: row.page ?? row.route,
          total: numberValue(row.total) ?? 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 20);
    } else if (base.startsWith("top events")) {
      // Event visitors are likewise unique per event, not additive across
      // event names. Keep this unknown unless a separate monthly summary
      // supplies a semantically valid aggregate.
      target.event_visitors = null;
      target.event_total = rows.reduce(
        (sum, row) => sum + (numberValue(row.total) ?? 0),
        0,
      );
      const seenEvents = new Set<string>();
      for (const row of rows) {
        const event = row.page ?? row.event ?? row.route;
        const total = numberValue(row.total);
        if (total === null) continue;
        if (
          event === "photo_viewed" ||
          event === "photo_dwelled" ||
          event === "search_committed" ||
          event === "print_cta_clicked"
        ) {
          if (seenEvents.has(event))
            throw new Error(
              `duplicate website event aggregate ${month}:${event}`,
            );
          seenEvents.add(event);
        }
        if (event === "photo_viewed") target.photo_viewed = total;
        if (event === "photo_dwelled") target.photo_dwelled = total;
        if (event === "search_committed") target.search_committed = total;
        if (event === "print_cta_clicked") target.print_cta_clicked = total;
      }
    }
  }

  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function mergeWebsiteSummary(
  website: WebsiteMonth[],
  summaryPath: string,
  startDate: string,
  endDate: string,
): WebsiteMonth[] {
  const byMonth = new Map<string, WebsiteMonth>();
  for (const item of website) {
    if (byMonth.has(item.month))
      throw new Error(`duplicate website month aggregate ${item.month}`);
    byMonth.set(item.month, item);
  }
  const seenSummaryMonths = new Set<string>();
  for (const row of parseCsv(summaryPath)) {
    const month = row.month;
    if (
      !/^\d{4}-\d{2}$/.test(month) ||
      `${month}-31` < startDate ||
      `${month}-01` > endDate
    )
      continue;
    if (seenSummaryMonths.has(month))
      throw new Error(`duplicate website summary aggregate ${month}`);
    seenSummaryMonths.add(month);
    const current = byMonth.get(month) ?? {
      month,
      page_visitors: null,
      page_views: null,
      event_visitors: null,
      event_total: null,
      photo_viewed: null,
      photo_dwelled: null,
      search_committed: null,
      print_cta_clicked: null,
      top_photo_routes: [],
      source_files: [],
      coverage: "normalized_summary" as const,
      signal_class: "product_behavior" as const,
      join_scope: "month_aggregate" as const,
    };
    // Top Pages totals repeat visitors across routes, so prefer the normalized
    // monthly visitor/page-view totals when they are available.
    if (numberValue(row.visitors) !== null)
      current.page_visitors = numberValue(row.visitors);
    if (numberValue(row.page_views) !== null)
      current.page_views = numberValue(row.page_views);
    current.source_files.push(summaryPath);
    if (current.coverage === "missing") current.coverage = "normalized_summary";
    byMonth.set(month, current);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function readPosts(
  postsPath: string,
  startDate: string,
  endDate: string,
  identities: Map<string, ContentIdentity>,
): PostRow[] {
  const posts = JSON.parse(readText(postsPath)) as CombinedPost[];
  const rows: PostRow[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    if (!post.timestamp) continue;
    const postDate = dateInToronto(post.timestamp);
    if (postDate < startDate || postDate > endDate) continue;
    const id = `${post.network}:${post.id}`;
    if (seen.has(id)) throw new Error(`duplicate social post ${id}`);
    seen.add(id);
    const identity = identities.get(postLookupKey(post.network, post.id));
    if (!identity)
      throw new Error(`missing explicit content identity join for ${id}`);
    if (identity.publish_status !== "published")
      throw new Error(`post ${id} is not marked published in the identity map`);
    if (
      identity.platform_permalink &&
      post.permalink &&
      identity.platform_permalink !== post.permalink
    ) {
      throw new Error(`platform permalink mismatch for ${id}`);
    }
    const caption = post.caption ?? "";
    for (const [metric, value] of Object.entries(post.metrics ?? {})) {
      if (value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`invalid post metric ${metric} for ${id}`);
      if (value < 0)
        throw new Error(`negative post metric ${metric} for ${id}`);
    }
    const metricBasis =
      post.network === "facebook" && post.surface === "reels"
        ? "Facebook current/lifetime reel metrics"
        : post.network === "instagram"
          ? "Instagram current per-post insights"
          : "Facebook post engagement; no consistent per-post views";
    rows.push({
      platform: post.network,
      post_id: post.id,
      post_date: postDate,
      month: postDate.slice(0, 7),
      surface: post.surface,
      permalink: post.permalink,
      first_line: firstLine(caption),
      caption,
      caption_words: words(caption),
      features: featureFlags(caption),
      content_metrics: post.metrics ?? {},
      account_metrics_day: {},
      metric_basis: metricBasis,
      identity,
      signal_class: "social_behavior",
      source_type: "social_platform",
      ground_truth_boundary: "reward_not_fact",
    });
  }
  return rows.sort(
    (a, b) =>
      a.post_date.localeCompare(b.post_date) ||
      a.platform.localeCompare(b.platform),
  );
}

function attachDailyAccountMetrics(
  rows: PostRow[],
  daily: DailyMetric[],
): PostRow[] {
  const byKey = new Map<string, Record<string, number>>();
  for (const row of daily) {
    const key = `${row.platform}:${row.date}`;
    const metrics = byKey.get(key) ?? {};
    metrics[row.metric] = row.value;
    byKey.set(key, metrics);
  }
  return rows.map((row) => ({
    ...row,
    account_metrics_day: byKey.get(`${row.platform}:${row.post_date}`) ?? {},
  }));
}

function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return present.length
    ? present.reduce((total, value) => total + value, 0)
    : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const total = sum(values);
  const count = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  ).length;
  return total === null || !count ? null : total / count;
}

function median(values: Array<number | null | undefined>): number | null {
  const present = values
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  if (!present.length) return null;
  const middle = Math.floor(present.length / 2);
  return present.length % 2
    ? present[middle]
    : (present[middle - 1] + present[middle]) / 2;
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(2));
}

function metricValue(row: PostRow, key: string): number | null {
  const value = row.content_metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaMonthSummary(
  daily: DailyMetric[],
  month: string,
  platform: Platform,
) {
  const rows = daily.filter(
    (row) => row.platform === platform && row.date.startsWith(month),
  );
  const metrics = {} as Record<string, number | null>;
  for (const metric of [
    "views",
    "viewers",
    "reach",
    "interactions",
    "profile_visits",
    "page_visits",
    "follows",
    "link_clicks",
  ] as Metric[]) {
    metrics[metric] = sum(
      rows.filter((row) => row.metric === metric).map((row) => row.value),
    );
  }
  const coverage: Record<
    string,
    { days: number; first: string | null; last: string | null }
  > = {};
  for (const metric of new Set(rows.map((row) => row.metric))) {
    const dates = rows
      .filter((row) => row.metric === metric)
      .map((row) => row.date)
      .sort();
    coverage[metric] = {
      days: dates.length,
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null,
    };
  }
  return { metrics, coverage };
}

function buildMonthly(
  rows: PostRow[],
  daily: DailyMetric[],
  website: WebsiteMonth[],
  metaFallback: Map<string, MonthlyMetaFallback>,
  startDate: string,
  endDate: string,
) {
  const months = new Set<string>();
  for (const day of dateRange(startDate, endDate)) months.add(day.slice(0, 7));
  const websiteByMonth = new Map(website.map((item) => [item.month, item]));
  return [...months].sort().map((month) => {
    const monthPosts = rows.filter((row) => row.month === month);
    const igPosts = monthPosts.filter((row) => row.platform === "instagram");
    const fbPosts = monthPosts.filter((row) => row.platform === "facebook");
    const fallback = metaFallback.get(month);
    const igMeta = metaMonthSummary(daily, month, "instagram");
    const fbMeta = metaMonthSummary(daily, month, "facebook");
    if (fallback) {
      for (const [key, value] of Object.entries(fallback.instagram))
        if (igMeta.metrics[key] === null && value !== null)
          igMeta.metrics[key] = value;
      for (const [key, value] of Object.entries(fallback.facebook))
        if (fbMeta.metrics[key] === null && value !== null)
          fbMeta.metrics[key] = value;
    }
    const site = websiteByMonth.get(month);
    return {
      month,
      content: {
        total_posts: monthPosts.length,
        instagram_posts: igPosts.length,
        facebook_posts: fbPosts.length,
        instagram_surfaces: countBy(igPosts, (row) => row.surface),
        facebook_surfaces: countBy(fbPosts, (row) => row.surface),
      },
      content_metrics: {
        instagram_current_views: round(
          sum(igPosts.map((row) => metricValue(row, "views"))),
        ),
        instagram_median_views: round(
          median(igPosts.map((row) => metricValue(row, "views"))),
        ),
        facebook_reel_current_views: round(
          sum(
            fbPosts
              .filter((row) => row.surface === "reels")
              .map((row) => metricValue(row, "views")),
          ),
        ),
        facebook_reel_median_views: round(
          median(
            fbPosts
              .filter((row) => row.surface === "reels")
              .map((row) => metricValue(row, "views")),
          ),
        ),
      },
      meta_account_metrics: {
        instagram: igMeta,
        facebook: fbMeta,
        combined_views: round(
          sum([igMeta.metrics.views, fbMeta.metrics.views]),
        ),
      },
      vercel: site ?? {
        month,
        coverage: "missing",
        signal_class: "product_behavior",
        join_scope: "month_aggregate",
      },
      caveats: [
        "Meta post metrics are current snapshot values, not publication-month accruals.",
        "Facebook reel views are lifetime/current values and must not be added to page-level daily Views.",
        "Vercel exports are monthly aggregate tables; they are not post-level attribution.",
        ...(isFullMonth(month, startDate, endDate)
          ? []
          : [
              "This month is partial for the requested window; do not compare its totals directly with full months.",
            ]),
      ],
    };
  });
}

function buildFeatureLifts(rows: PostRow[]) {
  const output: Array<Record<string, Cell>> = [];
  for (const platform of ["instagram", "facebook"] as const) {
    const platformRows = rows.filter(
      (row) =>
        row.platform === platform &&
        (platform === "instagram" || row.surface === "reels"),
    );
    const metric = platform === "instagram" ? "views" : "views";
    for (const feature of FEATURE_KEYS) {
      const withFeature = platformRows.filter((row) => row.features[feature]);
      const withoutFeature = platformRows.filter(
        (row) => !row.features[feature],
      );
      const withMedian = median(
        withFeature.map((row) => metricValue(row, metric)),
      );
      const withoutMedian = median(
        withoutFeature.map((row) => metricValue(row, metric)),
      );
      output.push({
        platform,
        surface: platform === "instagram" ? "all" : "reels",
        feature,
        with_n: withFeature.length,
        without_n: withoutFeature.length,
        with_mean_views: round(
          average(withFeature.map((row) => metricValue(row, metric))),
        ),
        without_mean_views: round(
          average(withoutFeature.map((row) => metricValue(row, metric))),
        ),
        with_median_views: round(withMedian),
        without_median_views: round(withoutMedian),
        median_lift_ratio:
          withMedian !== null && withoutMedian
            ? round(withMedian / withoutMedian)
            : null,
      });
    }
  }
  return output;
}

function countBy<T>(
  items: T[],
  key: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isFullMonth(month: string, start: string, end: string): boolean {
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  return (
    start <= `${month}-01` &&
    end >= `${month}-${String(lastDay).padStart(2, "0")}`
  );
}

function csvEscape(value: Cell): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath: string, rows: Array<Record<string, Cell>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? null)).join(","),
    ),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`,
    ),
  ].join("\n");
}

function format(value: Cell): string {
  if (value === null || value === undefined || value === "") return "n/a";
  if (typeof value === "number")
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
      value,
    );
  return String(value);
}

function buildMarkdown(params: {
  startDate: string;
  endDate: string;
  postsPath: string;
  metaRoot: string;
  vercelRoot: string;
  identityMapPath: string;
  canonicalManifestPath: string;
  productEventsPath?: string;
  metaSummaryPath?: string;
  websiteSummaryPath?: string;
  metaMonthlySummaryPath?: string;
  monthly: Array<Record<string, unknown>>;
  rows: PostRow[];
  featureLifts: Array<Record<string, Cell>>;
  productSignals: ProductSignal[];
}) {
  const {
    startDate,
    endDate,
    postsPath,
    metaRoot,
    vercelRoot,
    identityMapPath,
    canonicalManifestPath,
    productEventsPath,
    metaSummaryPath,
    websiteSummaryPath,
    metaMonthlySummaryPath,
    monthly,
    rows,
    featureLifts,
    productSignals,
  } = params;
  const topRows = [...rows]
    .filter((row) => row.platform === "instagram" || row.surface === "reels")
    .sort(
      (a, b) =>
        (metricValue(b, "views") ?? -1) - (metricValue(a, "views") ?? -1),
    )
    .slice(0, 15);
  const monthRows = monthly.map((month) => {
    const meta = month.meta_account_metrics as {
      instagram: { metrics: Record<string, number | null> };
      facebook: { metrics: Record<string, number | null> };
      combined_views: number | null;
    };
    const site = month.vercel as WebsiteMonth;
    const content = month.content as {
      total_posts: number;
      instagram_posts: number;
      facebook_posts: number;
    };
    return [
      String(month.month),
      format(content.total_posts),
      format(meta.instagram.metrics.views),
      format(meta.facebook.metrics.views),
      format(meta.combined_views),
      format(site?.page_views ?? null),
      format(site?.photo_viewed ?? null),
      String(site?.coverage ?? "missing"),
    ];
  });
  const liftRows = featureLifts.map((row) => [
    String(row.platform),
    String(row.feature),
    format(row.with_n),
    format(row.with_median_views),
    format(row.without_n),
    format(row.without_median_views),
    format(row.median_lift_ratio),
  ]);
  const topPostRows = topRows.map((row) => [
    row.post_date,
    row.platform,
    row.surface,
    format(metricValue(row, "views")),
    row.first_line,
    row.permalink ?? "",
  ]);

  return `# MTL Archives Cross-Platform Content Join

Window: ${startDate} to ${endDate}

Inputs:
- Meta content snapshot: \`${postsPath}\`
- Meta daily exports: \`${metaRoot}\`
- Vercel monthly exports: \`${vercelRoot}\`
- Content identity map: \`${identityMapPath}\`
- Canonical archive manifest: \`${canonicalManifestPath}\`
${productEventsPath ? `- Product signal export: \`${productEventsPath}\`` : ""}
${metaSummaryPath ? `- Normalized Meta daily summary: \`${metaSummaryPath}\`` : ""}
${metaMonthlySummaryPath ? `- Normalized Meta monthly scorecard: \`${metaMonthlySummaryPath}\`` : ""}
${websiteSummaryPath ? `- Normalized website monthly summary: \`${websiteSummaryPath}\`` : ""}

## What is joined

Each published Meta post is assigned to a Toronto calendar day and month. The report joins it to:

- current per-post Instagram insights or current/lifetime Facebook reel metrics;
- daily and monthly Meta account-level metrics from the downloaded exports;
- monthly Vercel page and event totals.

The generated per-post CSV and daily CSV also carry same-day account metrics beside the content created on that date.

Vercel is joined at month level only. The available Vercel exports do not contain a reliable visitor-level or post-level path from a social post to a specific archive image.

Each emitted post row carries an explicit declared platform-post identity map to a canonical archive record, visual family, content package, and source asset. The canonical manifest verifies record/source-asset existence; package and family are not independently verified here. Rows without an exact identity join are rejected. Product events, when supplied, use the same identity contract and remain \`product_behavior\` / \`reward_not_fact\` signals.

Product signals accepted: ${productSignals.length}. Social metrics and product behavior are outcomes, not factual archive labels. No randomized exploration is considered valid without an experiment assignment, propensity, and safety budget.

## Monthly scorecard

${markdownTable(["Month", "Posts", "IG account views", "FB account views", "Combined Meta views", "Vercel page views", "Photo viewed events", "Vercel coverage"], monthRows)}

## Caption feature diagnostics

These are descriptive median comparisons. They are not causal estimates. Facebook rows use unique reel records where available because Facebook published-post history can mirror the same reel.

${markdownTable(["Platform", "Feature", "With n", "With median views", "Without n", "Without median views", "Median lift"], liftRows)}

## Top current post metrics

${markdownTable(["Date", "Platform", "Surface", "Views", "First line", "Permalink"], topPostRows)}

## Caveats

- Meta account-level Views are daily aggregate metrics and cannot be attributed to one post without impression-level data.
- Instagram post insights and Facebook reel views are current snapshot values as of the content snapshot, not historical month-end values.
- Facebook feed posts do not consistently expose per-post views.
- Vercel Top Pages and Top Events are monthly aggregate exports. They support directional cross-platform comparison, not user-level attribution.
- Any first or last month truncated by the requested window is partial; compare its totals only with the same window shape.
- Small feature groups and imbalanced caption features should not be used as standalone strategy decisions.
`;
}

async function main() {
  const postsPath = path.resolve(requireArg("--posts-input"));
  const metaRoot = path.resolve(requireArg("--meta-root"));
  const vercelRoot = path.resolve(requireArg("--vercel-root"));
  const identityMapPath = path.resolve(requireArg("--identity-map"));
  const canonicalManifestPath = path.resolve(
    requireArg("--canonical-manifest"),
  );
  const productEventsPath = arg("--product-events")
    ? path.resolve(arg("--product-events") as string)
    : undefined;
  const metaSummaryPath = arg("--meta-daily-summary")
    ? path.resolve(arg("--meta-daily-summary") as string)
    : undefined;
  const metaMonthlySummaryPath = arg("--meta-monthly-summary")
    ? path.resolve(arg("--meta-monthly-summary") as string)
    : undefined;
  const websiteSummaryPath = arg("--website-summary")
    ? path.resolve(arg("--website-summary") as string)
    : undefined;
  const startDate = arg("--start") ?? "2026-01-01";
  const endDate = arg("--end") ?? "2026-07-31";
  validateDateRange(startDate, endDate);
  const outputPrefix = path.resolve(arg("--output-prefix") ?? DEFAULT_OUTPUT);
  for (const input of [
    postsPath,
    metaRoot,
    vercelRoot,
    identityMapPath,
    canonicalManifestPath,
    productEventsPath,
    metaSummaryPath,
    metaMonthlySummaryPath,
    websiteSummaryPath,
  ].filter(Boolean) as string[]) {
    if (!fs.existsSync(input))
      fail(`Input does not exist: ${safeDisplayPath(input)}`);
  }

  const identityValidation = validateIdentityMap(
    readJsonRecords(identityMapPath),
    readJsonRecords(canonicalManifestPath),
  );
  const identityByContent = new Map(
    [...identityValidation.byPost.values()].map((identity) => [
      identityLookupKey(identity),
      identity,
    ]),
  );

  const daily = mergeMetaDaily(
    metaSummaryPath
      ? readNormalizedMetaDaily(metaSummaryPath, startDate, endDate)
      : [],
    readMetaDaily(metaRoot, startDate, endDate),
  );
  const metaFallback = metaMonthlySummaryPath
    ? readMonthlyMetaSummary(metaMonthlySummaryPath, startDate, endDate)
    : new Map<string, MonthlyMetaFallback>();
  const website = (
    websiteSummaryPath
      ? mergeWebsiteSummary(
          readWebsiteMonths(vercelRoot, startDate, endDate),
          websiteSummaryPath,
          startDate,
          endDate,
        )
      : readWebsiteMonths(vercelRoot, startDate, endDate)
  ).map((item) => ({
    ...item,
    source_files: item.source_files.map(safeDisplayPath),
  }));
  const rows = attachDailyAccountMetrics(
    readPosts(postsPath, startDate, endDate, identityValidation.byPost),
    daily,
  );
  if (!rows.length) fail("No posts found in the requested date range");
  if (!daily.length) fail("No usable Meta daily export rows found");
  assertCompletePostJoins(
    rows.map((row) => postLookupKey(row.platform, row.post_id)),
    identityValidation.byPost,
  );
  const productSignals = productEventsPath
    ? validateProductSignals(
        readJsonRecords(productEventsPath),
        identityByContent,
      )
    : [];
  assertProductSignalsWithinDateRange(
    productSignals,
    startDate,
    endDate,
    dateInToronto,
  );
  const generatedAt = new Date().toISOString();
  const envelope = aggregateEnvelope(startDate, endDate);
  const monthly = buildMonthly(
    rows,
    daily,
    website,
    metaFallback,
    startDate,
    endDate,
  ).map((month) => ({
    ...month,
    meta_account_metrics: {
      ...month.meta_account_metrics,
      ...envelope,
      platform: "combined" as const,
      signal_class: "social_behavior" as const,
      source_type: "social_platform" as const,
    },
    vercel: {
      ...month.vercel,
      ...envelope,
      platform: "web" as const,
      signal_class: "product_behavior" as const,
      source_type: "product_analytics" as const,
      join_scope: "month_aggregate" as const,
    },
  }));
  const featureLifts = buildFeatureLifts(rows);
  const dailyContent = [
    ...new Set(rows.map((row) => `${row.platform}:${row.post_date}`)),
  ]
    .map((key) => {
      const [platform, date] = key.split(":");
      const dayRows = rows.filter(
        (row) => row.platform === platform && row.post_date === date,
      );
      return {
        schema_version: CONTENT_SIGNAL_SCHEMA,
        captured_at: envelope.captured_at,
        timezone: envelope.timezone,
        observation_window: envelope.observation_window,
        signal_class: "social_behavior" as const,
        source_type: "social_platform" as const,
        ground_truth_boundary: envelope.ground_truth_boundary,
        platform,
        date,
        post_count: dayRows.length,
        surfaces: countBy(dayRows, (row) => row.surface),
        posts: dayRows.map((row) => ({
          post_id: row.post_id,
          surface: row.surface,
          first_line: row.first_line,
          permalink: row.permalink,
        })),
        account_metrics: dayRows[0]?.account_metrics_day ?? {},
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform),
    );

  const output = {
    generated_at: generatedAt,
    timezone: "America/Toronto",
    start_date: startDate,
    end_date: endDate,
    inputs: {
      posts: safeDisplayPath(postsPath),
      meta_root: safeDisplayPath(metaRoot),
      vercel_root: safeDisplayPath(vercelRoot),
      identity_map: safeDisplayPath(identityMapPath),
      canonical_manifest: safeDisplayPath(canonicalManifestPath),
      product_events: productEventsPath
        ? safeDisplayPath(productEventsPath)
        : null,
      meta_daily_summary: metaSummaryPath
        ? safeDisplayPath(metaSummaryPath)
        : null,
      meta_monthly_summary: metaMonthlySummaryPath
        ? safeDisplayPath(metaMonthlySummaryPath)
        : null,
      website_summary: websiteSummaryPath
        ? safeDisplayPath(websiteSummaryPath)
        : null,
    },
    counts: {
      posts: rows.length,
      instagram_posts: rows.filter((row) => row.platform === "instagram")
        .length,
      facebook_posts: rows.filter((row) => row.platform === "facebook").length,
      meta_daily_rows: daily.length,
      vercel_months: website.length,
      product_signals: productSignals.length,
    },
    monthly,
    feature_lifts: featureLifts,
    daily_content: dailyContent,
    posts: rows,
    product_signals: productSignals,
  };

  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify(output, null, 2));
  writeCsv(
    `${outputPrefix}-posts.csv`,
    rows.map((row) => ({
      schema_version: CONTENT_SIGNAL_SCHEMA,
      captured_at: envelope.captured_at,
      timezone: envelope.timezone,
      observation_window_start: envelope.observation_window.start,
      observation_window_end: envelope.observation_window.end,
      platform: row.platform,
      post_id: row.post_id,
      post_date: row.post_date,
      month: row.month,
      surface: row.surface,
      permalink: row.permalink,
      canonical_record_id: row.identity.canonical_record_id,
      visual_family_id: row.identity.visual_family_id,
      package_id: row.identity.package_id,
      source_asset: row.identity.source_asset,
      audience: row.identity.audience,
      content_format: row.identity.format,
      theme: row.identity.theme,
      hook: row.identity.hook,
      caption_version: row.identity.caption_version,
      pipeline_version: row.identity.pipeline_version,
      model_version: row.identity.model_version,
      prompt_version: row.identity.prompt_version,
      renderer_version: row.identity.renderer_version,
      publish_status: row.identity.publish_status,
      signal_class: row.signal_class,
      source_type: row.source_type,
      ground_truth_boundary: row.ground_truth_boundary,
      identity_basis: row.identity.identity_basis,
      package_family_verification: row.identity.package_family_verification,
      first_line: row.first_line,
      caption_words: row.caption_words,
      views: metricValue(row, "views"),
      reach: metricValue(row, "reach"),
      interactions:
        metricValue(row, "total_interactions") ??
        metricValue(row, "interactions"),
      shares: metricValue(row, "shares"),
      saves: metricValue(row, "saved"),
      account_views_day: row.account_metrics_day.views ?? null,
      account_reach_day: row.account_metrics_day.reach ?? null,
      account_interactions_day: row.account_metrics_day.interactions ?? null,
      account_visits_day:
        row.account_metrics_day.profile_visits ??
        row.account_metrics_day.page_visits ??
        null,
      account_follows_day: row.account_metrics_day.follows ?? null,
      account_link_clicks_day: row.account_metrics_day.link_clicks ?? null,
      metric_basis: row.metric_basis,
      ...Object.fromEntries(
        FEATURE_KEYS.map((feature) => [feature, row.features[feature] ? 1 : 0]),
      ),
    })),
  );
  writeCsv(
    `${outputPrefix}-feature-lifts.csv`,
    featureLifts.map((row) => ({
      schema_version: CONTENT_SIGNAL_SCHEMA,
      captured_at: envelope.captured_at,
      timezone: envelope.timezone,
      observation_window_start: envelope.observation_window.start,
      observation_window_end: envelope.observation_window.end,
      signal_class: "social_behavior",
      source_type: "social_platform",
      ground_truth_boundary: envelope.ground_truth_boundary,
      ...row,
    })),
  );
  writeCsv(
    `${outputPrefix}-daily.csv`,
    dailyContent.map((row) => ({
      schema_version: row.schema_version,
      captured_at: row.captured_at,
      timezone: row.timezone,
      observation_window_start: row.observation_window.start,
      observation_window_end: row.observation_window.end,
      signal_class: row.signal_class,
      source_type: row.source_type,
      ground_truth_boundary: row.ground_truth_boundary,
      platform: row.platform,
      date: row.date,
      post_count: row.post_count,
      surfaces: JSON.stringify(row.surfaces),
      account_views: row.account_metrics.views ?? null,
      account_reach: row.account_metrics.reach ?? null,
      account_interactions: row.account_metrics.interactions ?? null,
      account_visits:
        row.account_metrics.profile_visits ??
        row.account_metrics.page_visits ??
        null,
      account_follows: row.account_metrics.follows ?? null,
      account_link_clicks: row.account_metrics.link_clicks ?? null,
      post_first_lines: row.posts.map((post) => post.first_line).join(" | "),
    })),
  );
  writeCsv(
    `${outputPrefix}-product-signals.csv`,
    productSignals.map((signal) => ({
      schema_version: signal.schema_version,
      event_id: signal.event_id,
      signal_class: signal.signal_class,
      source_type: signal.source_type,
      event_name: signal.event_name,
      captured_at: signal.captured_at,
      timezone: signal.timezone,
      canonical_record_id: signal.canonical_record_id,
      visual_family_id: signal.visual_family_id,
      package_id: signal.package_id,
      source_asset: signal.source_asset,
      platform: signal.platform,
      surface: signal.surface,
      metric_name: signal.metric_name,
      metric_value: signal.metric_value,
      metric_definition: signal.metric_definition,
      observation_window_start: signal.observation_window.start,
      observation_window_end: signal.observation_window.end,
      source: signal.source,
      query: signal.query,
      position: signal.position,
      candidate_set: signal.candidate_set
        ? JSON.stringify(signal.candidate_set)
        : null,
      ranking_version: signal.ranking_version,
      model_version: signal.model_version,
      index_version: signal.index_version,
      experiment_assignment: signal.experiment_assignment,
      propensity: signal.propensity,
      safety_budget_id: signal.safety_budget_id,
      privacy_consent: signal.privacy_consent,
      ground_truth_boundary: signal.ground_truth_boundary,
      identity_basis: signal.identity_basis,
      package_family_verification: signal.package_family_verification,
    })),
  );
  writeCsv(
    `${outputPrefix}-monthly.csv`,
    monthly.map((month) => {
      const meta = month.meta_account_metrics as {
        instagram: { metrics: Record<string, number | null> };
        facebook: { metrics: Record<string, number | null> };
        combined_views: number | null;
      };
      const site = month.vercel as WebsiteMonth;
      const metaEnvelope = month.meta_account_metrics as AggregateEnvelope & {
        signal_class: string;
        source_type: string;
      };
      const siteEnvelope = month.vercel as WebsiteMonth &
        AggregateEnvelope & { signal_class: string; source_type: string };
      return {
        month: month.month,
        meta_schema_version: metaEnvelope.schema_version,
        meta_captured_at: metaEnvelope.captured_at,
        meta_timezone: metaEnvelope.timezone,
        meta_observation_window_start: metaEnvelope.observation_window.start,
        meta_observation_window_end: metaEnvelope.observation_window.end,
        meta_signal_class: metaEnvelope.signal_class,
        meta_source_type: metaEnvelope.source_type,
        meta_ground_truth_boundary: metaEnvelope.ground_truth_boundary,
        meta_platform: metaEnvelope.platform,
        vercel_schema_version:
          siteEnvelope.schema_version ?? CONTENT_SIGNAL_SCHEMA,
        vercel_captured_at: siteEnvelope.captured_at ?? envelope.captured_at,
        vercel_timezone: siteEnvelope.timezone ?? envelope.timezone,
        vercel_observation_window_start:
          siteEnvelope.observation_window?.start ??
          envelope.observation_window.start,
        vercel_observation_window_end:
          siteEnvelope.observation_window?.end ??
          envelope.observation_window.end,
        vercel_ground_truth_boundary:
          siteEnvelope.ground_truth_boundary ?? envelope.ground_truth_boundary,
        vercel_platform: siteEnvelope.platform ?? "web",
        total_posts: (month.content as { total_posts: number }).total_posts,
        instagram_account_views: meta.instagram.metrics.views,
        facebook_account_views: meta.facebook.metrics.views,
        combined_meta_views: meta.combined_views,
        vercel_page_visitors: site?.page_visitors ?? null,
        vercel_page_views: site?.page_views ?? null,
        vercel_photo_viewed: site?.photo_viewed ?? null,
        vercel_photo_dwelled: site?.photo_dwelled ?? null,
        vercel_search_committed: site?.search_committed ?? null,
        vercel_print_cta_clicked: site?.print_cta_clicked ?? null,
        vercel_coverage: site?.coverage ?? "missing",
        vercel_signal_class: site?.signal_class ?? "product_behavior",
        vercel_source_type: siteEnvelope.source_type ?? "product_analytics",
        vercel_join_scope: site?.join_scope ?? "month_aggregate",
      };
    }),
  );
  fs.writeFileSync(
    `${outputPrefix}.md`,
    buildMarkdown({
      startDate,
      endDate,
      postsPath: safeDisplayPath(postsPath),
      metaRoot: safeDisplayPath(metaRoot),
      vercelRoot: safeDisplayPath(vercelRoot),
      identityMapPath: safeDisplayPath(identityMapPath),
      canonicalManifestPath: safeDisplayPath(canonicalManifestPath),
      productEventsPath: productEventsPath
        ? safeDisplayPath(productEventsPath)
        : undefined,
      metaSummaryPath: metaSummaryPath
        ? safeDisplayPath(metaSummaryPath)
        : undefined,
      metaMonthlySummaryPath: metaMonthlySummaryPath
        ? safeDisplayPath(metaMonthlySummaryPath)
        : undefined,
      websiteSummaryPath: websiteSummaryPath
        ? safeDisplayPath(websiteSummaryPath)
        : undefined,
      monthly,
      rows,
      featureLifts,
      productSignals,
    }),
  );

  console.log(
    JSON.stringify(
      {
        output_json: safeDisplayPath(`${outputPrefix}.json`),
        output_markdown: safeDisplayPath(`${outputPrefix}.md`),
        output_posts_csv: safeDisplayPath(`${outputPrefix}-posts.csv`),
        output_monthly_csv: safeDisplayPath(`${outputPrefix}-monthly.csv`),
        output_feature_lifts_csv: safeDisplayPath(
          `${outputPrefix}-feature-lifts.csv`,
        ),
        output_daily_csv: safeDisplayPath(`${outputPrefix}-daily.csv`),
        output_product_signals_csv: safeDisplayPath(
          `${outputPrefix}-product-signals.csv`,
        ),
        counts: output.counts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) =>
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error)),
);
