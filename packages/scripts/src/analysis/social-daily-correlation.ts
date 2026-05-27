import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Network = 'instagram' | 'facebook';
type Surface = 'feed' | 'reels' | 'carousel' | 'unknown';
type MetricKey =
  | 'views'
  | 'viewers'
  | 'reach'
  | 'interactions'
  | 'follows'
  | 'visits'
  | 'link_clicks';

type CombinedPost = {
  network: Network;
  surface: Surface;
  id: string;
  timestamp: string | null;
  permalink: string | null;
  caption: string | null;
  metrics: Record<string, number | null>;
};

type RawMetricFile = {
  source_path: string;
  source_label: string;
  platform: Network;
  metric: MetricKey;
  start_date: string;
  end_date: string;
  window_days: number;
  priority: number;
  rows: Array<{ date: string; value: number }>;
};

type SelectedMetricRow = {
  date: string;
  value: number;
  source_path: string;
  source_label: string;
  priority: number;
  window_days: number;
};

type DailyRecord = {
  date: string;
  platform: Network;
  metrics: Partial<Record<MetricKey, number>>;
  metric_sources: Partial<Record<MetricKey, string>>;
  posts: Array<{
    surface: Surface;
    first_line: string;
    permalink: string | null;
  }>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_TOKEN_STATE_PATH = path.join(MONOREPO_ROOT, 'data', 'social', 'meta-token-state.json');

function fail(message: string): never {
  console.error(`[social-daily-correlation] ${message}`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getArgs(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function readCombinedPosts(inputPath: string) {
  return JSON.parse(fs.readFileSync(inputPath, 'utf8')) as CombinedPost[];
}

function firstLine(caption: string | null) {
  if (!caption) return '';
  return caption
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function dateRange(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function addDays(date: string, count: number) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + count);
  return cursor.toISOString().slice(0, 10);
}

function inferMetric(title: string): MetricKey | null {
  const normalized = title.toLowerCase();
  if (normalized === 'views') return 'views';
  if (normalized === 'viewers') return 'viewers';
  if (normalized === 'reach') return 'reach';
  if (normalized === 'content interactions') return 'interactions';
  if (normalized.includes('follows')) return 'follows';
  if (normalized.includes('visits')) return 'visits';
  if (normalized.includes('link clicks')) return 'link_clicks';
  return null;
}

function inferPlatform(filePath: string, title: string): Network | null {
  const dir = path.basename(path.dirname(filePath));
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  const titleLower = title.toLowerCase();

  if (lower.startsWith('ig') || titleLower.includes('instagram')) return 'instagram';
  if (lower.startsWith('fb') || titleLower.includes('facebook')) return 'facebook';
  if (titleLower === 'reach') return 'instagram';
  if (titleLower === 'viewers') return 'facebook';

  if (dir === 'marchstats') {
    if (base === 'Viewers.csv' || /\(1\)\.csv$/i.test(base)) return 'facebook';
    return 'instagram';
  }

  if (dir === 'Recents') {
    const genericJanuaryFiles = new Set([
      'Views.csv',
      'Reach.csv',
      'Interactions.csv',
      'Follows.csv',
      'Visits.csv',
      'Link clicks.csv',
    ]);
    if (genericJanuaryFiles.has(base)) return 'instagram';
  }

  return null;
}

function parseUtf16MetricFile(filePath: string): RawMetricFile | null {
  const text = fs.readFileSync(filePath, 'utf16le').replace(/^\uFEFF/, '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, '').trim())
    .filter(Boolean);

  if (lines.length < 4) return null;
  const title = lines[1].replace(/^"|"$/g, '');
  const metric = inferMetric(title);
  const platform = inferPlatform(filePath, title);
  if (!metric || !platform) return null;

  const rows: Array<{ date: string; value: number }> = [];
  for (const line of lines.slice(3)) {
    const match = line.match(/^"([^"]+)","([^"]+)"$/);
    if (!match) continue;
    const date = match[1].slice(0, 10);
    const value = Number(match[2].replace(/,/g, ''));
    if (!date || Number.isNaN(value)) continue;
    rows.push({ date, value });
  }

  if (!rows.length) return null;

  const startDate = rows[0].date;
  const endDate = rows[rows.length - 1].date;
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  const exactMonth = startMonth === endMonth && rows.length >= 27;
  const dir = path.basename(path.dirname(filePath));
  const base = path.basename(filePath);
  let priority = 0;
  if (exactMonth) priority += 100;
  if (dir === 'marchstats') priority += 40;
  if (/^(ig|fb)/i.test(base)) priority += 20;
  if (base === 'Viewers.csv') priority += 10;

  const startCursor = new Date(`${startDate}T00:00:00Z`);
  const endCursor = new Date(`${endDate}T00:00:00Z`);
  const windowDays = Math.max(
    1,
    Math.round((endCursor.getTime() - startCursor.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  priority -= Math.floor(windowDays / 14);

  return {
    source_path: filePath,
    source_label: `${platform}:${metric}:${path.basename(filePath)}`,
    platform,
    metric,
    start_date: startDate,
    end_date: endDate,
    window_days: windowDays,
    priority,
    rows,
  };
}

function discoverMetricFiles(exportDirs: string[]) {
  const files: RawMetricFile[] = [];
  for (const dir of exportDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csv')) continue;
      const filePath = path.join(dir, entry.name);
      try {
        const parsed = parseUtf16MetricFile(filePath);
        if (parsed) files.push(parsed);
      } catch {
        continue;
      }
    }
  }
  return files;
}

function chooseRows(files: RawMetricFile[], startDate: string, endDate: string) {
  const selected = new Map<string, SelectedMetricRow>();

  for (const file of files) {
    for (const row of file.rows) {
      if (row.date < startDate || row.date > endDate) continue;
      const key = `${file.platform}:${file.metric}:${row.date}`;
      const current = selected.get(key);
      const candidate: SelectedMetricRow = {
        date: row.date,
        value: row.value,
        source_path: file.source_path,
        source_label: file.source_label,
        priority: file.priority,
        window_days: file.window_days,
      };
      if (!current) {
        selected.set(key, candidate);
        continue;
      }
      if (
        candidate.priority > current.priority
        || (candidate.priority === current.priority && candidate.window_days < current.window_days)
      ) {
        selected.set(key, candidate);
      }
    }
  }

  return selected;
}

async function graph(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Graph request failed (${response.status}) for ${url}\n${text}`);
  }
  return JSON.parse(text) as { data?: Array<{ name: string; values?: Array<{ value: number; end_time: string }> }> };
}

async function fetchFacebookDailyInsights(params: {
  tokenStatePath: string;
  startDate: string;
  endDate: string;
}) {
  const tokenState = JSON.parse(fs.readFileSync(params.tokenStatePath, 'utf8')) as {
    page?: { id?: string; access_token?: string };
  };
  const pageId = tokenState.page?.id;
  const pageToken = tokenState.page?.access_token;
  if (!pageId || !pageToken) {
    fail(`Missing page id/access token in ${params.tokenStatePath}`);
  }

  const metricMap: Record<string, MetricKey> = {
    page_media_view: 'views',
    page_daily_follows: 'follows',
  };

  const rows: Array<RawMetricFile> = [];
  for (const [graphMetric, metricKey] of Object.entries(metricMap)) {
    const url = new URL(`https://graph.facebook.com/v25.0/${pageId}/insights`);
    url.searchParams.set('metric', graphMetric);
    url.searchParams.set('period', 'day');
    url.searchParams.set('since', params.startDate);
    url.searchParams.set('until', params.endDate);
    url.searchParams.set('access_token', pageToken);
    const payload = await graph(url.toString());
    const values = payload.data?.[0]?.values ?? [];
    const parsedRows = values.map((value) => ({
      date: addDays(value.end_time.slice(0, 10), -1),
      value: value.value,
    }));
    rows.push({
      source_path: `graph:${graphMetric}`,
      source_label: `facebook:${metricKey}:graph:${graphMetric}`,
      platform: 'facebook',
      metric: metricKey,
      start_date: params.startDate,
      end_date: params.endDate,
      window_days: dateRange(params.startDate, params.endDate).length,
      priority: 1000,
      rows: parsedRows,
    });
  }
  return rows;
}

function summarizeByDayType(records: DailyRecord[]) {
  const groups = new Map<string, DailyRecord[]>();

  for (const record of records) {
    const surfaces = [...new Set(record.posts.map((post) => post.surface))];
    const key =
      surfaces.length === 0
        ? 'no_post'
        : surfaces.length === 1
          ? `${surfaces[0]}_only`
          : 'mixed';
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.entries()]
    .map(([dayType, rows]) => {
      const metricAverage = (key: MetricKey) => {
        const values = rows
          .map((row) => row.metrics[key])
          .filter((value): value is number => typeof value === 'number');
        if (!values.length) return null;
        return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
      };
      return {
        day_type: dayType,
        days: rows.length,
        avg_views: metricAverage('views'),
        avg_follows: metricAverage('follows'),
        avg_interactions: metricAverage('interactions'),
        avg_visits: metricAverage('visits'),
      };
    })
    .sort((a, b) => b.days - a.days);
}

function topDays(records: DailyRecord[], metric: MetricKey, limit = 10) {
  return [...records]
    .filter((record) => typeof record.metrics[metric] === 'number')
    .sort((a, b) => (b.metrics[metric] ?? 0) - (a.metrics[metric] ?? 0))
    .slice(0, limit)
    .map((record) => ({
      date: record.date,
      value: record.metrics[metric] ?? null,
      surfaces: [...new Set(record.posts.map((post) => post.surface))],
      posts: record.posts.map((post) => post.first_line),
    }));
}

function topPostWindows(posts: CombinedPost[], recordsByKey: Map<string, DailyRecord>, metric: MetricKey, limit = 10) {
  const rows = posts
    .filter((post) => post.timestamp)
    .map((post) => {
      const day = post.timestamp?.slice(0, 10) ?? '';
      const nextDay = addDays(day, 1);
      const record = recordsByKey.get(`${post.network}:${day}`);
      const recordNext = recordsByKey.get(`${post.network}:${nextDay}`);
      const day0 = record?.metrics[metric] ?? 0;
      const day1 = recordNext?.metrics[metric] ?? 0;
      return {
        date: day,
        network: post.network,
        surface: post.surface,
        first_line: firstLine(post.caption),
        day0,
        day1,
        window_2d: day0 + day1,
      };
    })
    .sort((a, b) => b.window_2d - a.window_2d);

  return rows.slice(0, limit);
}

function markdownTable(headers: string[], rows: string[][]) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number') return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function renderMarkdown(params: {
  startDate: string;
  endDate: string;
  exportDirs: string[];
  usedFacebookLive: boolean;
  dailyRecords: DailyRecord[];
  byPlatformDayType: Record<Network, ReturnType<typeof summarizeByDayType>>;
  topViewDays: Record<Network, ReturnType<typeof topDays>>;
  topFollowDays: Record<Network, ReturnType<typeof topDays>>;
  topViewWindows: Record<Network, ReturnType<typeof topPostWindows>>;
}) {
  const { startDate, endDate, exportDirs, usedFacebookLive, dailyRecords, byPlatformDayType, topViewDays, topFollowDays, topViewWindows } = params;

  const sourceLines = exportDirs.map((dir) => `- \`${dir}\``).join('\n');
  const topDayRows = (items: ReturnType<typeof topDays>) =>
    items.map((item) => [
      item.date,
      formatNumber(item.value),
      item.surfaces.join(', ') || 'none',
      (item.posts.join(' / ') || 'none').replace(/\|/g, '\\|'),
    ]);
  const dayTypeRows = (items: ReturnType<typeof summarizeByDayType>) =>
    items.map((item) => [
      item.day_type,
      String(item.days),
      formatNumber(item.avg_views),
      formatNumber(item.avg_follows),
      formatNumber(item.avg_interactions),
      formatNumber(item.avg_visits),
    ]);
  const postWindowRows = (items: ReturnType<typeof topPostWindows>) =>
    items.map((item) => [
      item.date,
      item.surface,
      formatNumber(item.day0),
      formatNumber(item.day1),
      formatNumber(item.window_2d),
      item.first_line.replace(/\|/g, '\\|'),
    ]);

  return `# Social Daily Correlation — Q1 2026

Window:
- ${startDate} → ${endDate}

Daily export roots:
${sourceLines || '- none'}

Facebook live API supplement:
- ${usedFacebookLive ? 'enabled (`page_media_view`, `page_daily_follows`)' : 'disabled'}

## Metric mapping note

- The March Facebook Business Suite daily **Views** export matches the live Page Insights metric \`page_media_view\` exactly.
- Per-post Facebook reel views are still available from the \`/${'page-id'}/video_reels\` edge, but those do **not** equal page-level monthly/daily Views totals.

## Daily response by publish-day content mix

### Instagram

${markdownTable(
  ['Day type', 'Days', 'Avg views', 'Avg follows', 'Avg interactions', 'Avg visits'],
  dayTypeRows(byPlatformDayType.instagram),
)}

### Facebook

${markdownTable(
  ['Day type', 'Days', 'Avg views', 'Avg follows', 'Avg interactions', 'Avg visits'],
  dayTypeRows(byPlatformDayType.facebook),
)}

## Top daily view spikes

### Instagram

${markdownTable(['Date', 'Views', 'Surfaces posted', 'Posts'], topDayRows(topViewDays.instagram))}

### Facebook

${markdownTable(['Date', 'Views', 'Surfaces posted', 'Posts'], topDayRows(topViewDays.facebook))}

## Top daily follow spikes

### Instagram

${markdownTable(['Date', 'Follows', 'Surfaces posted', 'Posts'], topDayRows(topFollowDays.instagram))}

### Facebook

${markdownTable(['Date', 'Follows', 'Surfaces posted', 'Posts'], topDayRows(topFollowDays.facebook))}

## Strongest two-day windows by post

### Instagram by platform views

${markdownTable(['Date', 'Surface', 'Day 0 views', 'Day 1 views', '2-day total', 'First line'], postWindowRows(topViewWindows.instagram))}

### Facebook by platform views

${markdownTable(['Date', 'Surface', 'Day 0 views', 'Day 1 views', '2-day total', 'First line'], postWindowRows(topViewWindows.facebook))}

## Caveats

- This is still a correlation model, not causal attribution.
- Some Facebook January non-view metrics come from overlapping rolling export windows, so early-January coverage is thinner than February/March.
- Website daily traffic is not included here because the available Vercel exports in local storage are aggregate tables, not clean day-by-day series.
`;
}

async function main() {
  const postsInput = getArg('--posts-input') ?? getArg('--input');
  if (!postsInput) {
    fail('Pass --posts-input with a combined_posts.json snapshot');
  }
  const postsPath = path.resolve(postsInput);
  const startDate = getArg('--start') ?? '2026-01-01';
  const endDate = getArg('--end') ?? '2026-03-31';
  const outputPrefix = path.resolve(
    MONOREPO_ROOT,
    getArg('--output-prefix') ?? path.join('data', 'social', '2026-03-31-analysis-q1-daily-correlation'),
  );

  const exportDirs = getArgs('--export-dir');
  if (!exportDirs.length) {
    fail('Pass one or more --export-dir paths with the downloaded Meta CSV exports');
  }

  const combinedPosts = readCombinedPosts(postsPath).filter((post) => {
    const day = post.timestamp?.slice(0, 10);
    return Boolean(day && day >= startDate && day <= endDate);
  });

  const metricFiles = discoverMetricFiles(exportDirs.map((dir) => path.resolve(dir)));
  if (!metricFiles.length) {
    fail('No usable daily metric CSVs found in the provided export directories');
  }

  if (hasFlag('--fetch-facebook-live')) {
    const tokenStatePath = path.resolve(
      MONOREPO_ROOT,
      getArg('--facebook-token-state') ?? DEFAULT_TOKEN_STATE_PATH,
    );
    const liveFiles = await fetchFacebookDailyInsights({
      tokenStatePath,
      startDate,
      endDate,
    });
    metricFiles.push(...liveFiles);
  }

  const selectedRows = chooseRows(metricFiles, startDate, endDate);
  const dailyRecords: DailyRecord[] = [];
  const recordsByKey = new Map<string, DailyRecord>();

  for (const platform of ['instagram', 'facebook'] as const) {
    for (const day of dateRange(startDate, endDate)) {
      const key = `${platform}:${day}`;
      const record: DailyRecord = {
        date: day,
        platform,
        metrics: {},
        metric_sources: {},
        posts: combinedPosts
          .filter((post) => post.network === platform && post.timestamp?.slice(0, 10) === day)
          .map((post) => ({
            surface: post.surface,
            first_line: firstLine(post.caption),
            permalink: post.permalink,
          })),
      };

      for (const metric of ['views', 'viewers', 'reach', 'interactions', 'follows', 'visits', 'link_clicks'] as MetricKey[]) {
        const selected = selectedRows.get(`${platform}:${metric}:${day}`);
        if (!selected) continue;
        record.metrics[metric] = selected.value;
        record.metric_sources[metric] = selected.source_label;
      }

      dailyRecords.push(record);
      recordsByKey.set(key, record);
    }
  }

  const byPlatformDayType = {
    instagram: summarizeByDayType(dailyRecords.filter((row) => row.platform === 'instagram')),
    facebook: summarizeByDayType(dailyRecords.filter((row) => row.platform === 'facebook')),
  };

  const topViewDays = {
    instagram: topDays(dailyRecords.filter((row) => row.platform === 'instagram'), 'views'),
    facebook: topDays(dailyRecords.filter((row) => row.platform === 'facebook'), 'views'),
  };

  const topFollowDays = {
    instagram: topDays(dailyRecords.filter((row) => row.platform === 'instagram'), 'follows'),
    facebook: topDays(dailyRecords.filter((row) => row.platform === 'facebook'), 'follows'),
  };

  const topViewWindows = {
    instagram: topPostWindows(combinedPosts.filter((row) => row.network === 'instagram'), recordsByKey, 'views'),
    facebook: topPostWindows(combinedPosts.filter((row) => row.network === 'facebook'), recordsByKey, 'views'),
  };

  const output = {
    start_date: startDate,
    end_date: endDate,
    export_dirs: exportDirs.map((dir) => path.resolve(dir)),
    facebook_live_enabled: hasFlag('--fetch-facebook-live'),
    counts: {
      posts: combinedPosts.length,
      metric_files: metricFiles.length,
      daily_records: dailyRecords.length,
    },
    by_platform_day_type: byPlatformDayType,
    top_days: {
      instagram_views: topViewDays.instagram,
      facebook_views: topViewDays.facebook,
      instagram_follows: topFollowDays.instagram,
      facebook_follows: topFollowDays.facebook,
    },
    top_post_windows: topViewWindows,
    daily_records: dailyRecords,
  };

  const markdown = renderMarkdown({
    startDate,
    endDate,
    exportDirs: exportDirs.map((dir) => path.resolve(dir)),
    usedFacebookLive: hasFlag('--fetch-facebook-live'),
    dailyRecords,
    byPlatformDayType,
    topViewDays,
    topFollowDays,
    topViewWindows,
  });

  fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify(output, null, 2));
  fs.writeFileSync(`${outputPrefix}.md`, markdown);

  console.log(JSON.stringify({
    output_json: `${outputPrefix}.json`,
    output_markdown: `${outputPrefix}.md`,
    posts_analyzed: combinedPosts.length,
    facebook_live_enabled: hasFlag('--fetch-facebook-live'),
  }, null, 2));
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
