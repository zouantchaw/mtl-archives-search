import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Network = 'instagram' | 'facebook';
type Surface = 'feed' | 'reels' | 'carousel' | 'unknown';

type CombinedPost = {
  network: Network;
  surface: Surface;
  id: string;
  timestamp: string | null;
  permalink: string | null;
  caption: string | null;
  metrics: Record<string, number | null>;
};

type FeatureKey =
  | 'question_led'
  | 'place_date_first'
  | 'loss_or_erasure'
  | 'context_scaffold'
  | 'site_cta'
  | 'bilingual'
  | 'parenthetical_place';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_SOCIAL_ROOT = path.join(MONOREPO_ROOT, 'data', 'social');

function fail(message: string): never {
  console.error(`[social-content-correlation] ${message}`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function listSocialSnapshots(root: string) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'combined_posts.json')))
    .sort();
}

function resolveInputPath() {
  const explicit = getArg('--input');
  if (explicit) {
    return path.resolve(MONOREPO_ROOT, explicit);
  }

  const snapshots = listSocialSnapshots(DEFAULT_SOCIAL_ROOT);
  if (!snapshots.length) {
    fail(`No social snapshots with combined_posts.json found under ${DEFAULT_SOCIAL_ROOT}`);
  }

  return path.join(DEFAULT_SOCIAL_ROOT, snapshots[snapshots.length - 1], 'combined_posts.json');
}

function readPosts(inputPath: string): CombinedPost[] {
  return JSON.parse(fs.readFileSync(inputPath, 'utf8')) as CombinedPost[];
}

function firstLine(caption: string | null) {
  if (!caption) return '';
  return caption
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function monthKey(timestamp: string | null) {
  return timestamp?.slice(0, 7) ?? 'unknown';
}

function featureFlags(post: CombinedPost) {
  const line = firstLine(post.caption);
  const caption = post.caption ?? '';
  const normalizedLine = line.toLowerCase();
  const normalizedCaption = caption.toLowerCase();

  const flags: Record<FeatureKey, boolean> = {
    question_led: /\?/.test(line),
    place_date_first:
      /^(vers|ann[ée]es|circa|c\.)/i.test(line)
      || /^\d{4}/.test(line)
      || /^(\d{1,2}\s+\w+\s+\d{4})/i.test(line),
    loss_or_erasure:
      /(secret|cach|fant[oô]me|sacrifi|dispar|effac|erase|hidden|ghost|mort|dead|lost|destroyed|erased)/i.test(
        normalizedLine,
      ),
    context_scaffold:
      /(le détail le plus marquant|most striking detail|ce qui a chang[ée]|what changed|ce qui a surv[ée]cu|what survived)/i.test(
        normalizedCaption,
      ),
    site_cta: /(mtlarchives\.com|link in bio|lien en bio)/i.test(normalizedCaption),
    bilingual: /\n\s*—\s*\n/.test(caption) || (/link in bio/i.test(caption) && /lien en bio/i.test(caption)),
    parenthetical_place: /[()]/.test(line),
  };

  return flags;
}

function numericMetric(post: CombinedPost, key: string) {
  const value = post.metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function topPosts(posts: CombinedPost[], scorer: (post: CombinedPost) => number, limit = 10) {
  return [...posts]
    .sort((a, b) => scorer(b) - scorer(a))
    .slice(0, limit)
    .map((post) => ({
      date: post.timestamp?.slice(0, 10) ?? null,
      network: post.network,
      surface: post.surface,
      permalink: post.permalink,
      first_line: firstLine(post.caption),
      metrics: post.metrics,
    }));
}

function metricSetFor(network: Network, surface: Surface) {
  if (network === 'instagram') {
    return ['views', 'reach', 'total_interactions', 'shares', 'saved', 'like_count', 'comments_count'];
  }
  if (surface === 'reels') {
    return ['views', 'shares', 'reactions', 'comments'];
  }
  return ['shares', 'reactions', 'comments'];
}

function summarizePosts(posts: CombinedPost[]) {
  const metrics = new Set<string>();
  for (const post of posts) {
    for (const key of metricSetFor(post.network, post.surface)) {
      metrics.add(key);
    }
  }

  const summary: Record<string, number> = { count: posts.length };
  for (const key of metrics) {
    const values = posts.map((post) => numericMetric(post, key));
    summary[`avg_${key}`] = Number(average(values).toFixed(1));
    summary[`sum_${key}`] = Number(values.reduce((sum, value) => sum + value, 0).toFixed(1));
  }
  return summary;
}

function buildFeatureComparisons(posts: CombinedPost[]) {
  const byFeature: Record<string, { with_feature: Record<string, number>; without_feature: Record<string, number> }> = {};
  const flagsList = posts.map((post) => ({ post, flags: featureFlags(post) }));

  for (const feature of [
    'question_led',
    'place_date_first',
    'loss_or_erasure',
    'context_scaffold',
    'site_cta',
    'bilingual',
    'parenthetical_place',
  ] as FeatureKey[]) {
    const withFeature = flagsList.filter((row) => row.flags[feature]).map((row) => row.post);
    const withoutFeature = flagsList.filter((row) => !row.flags[feature]).map((row) => row.post);
    byFeature[feature] = {
      with_feature: summarizePosts(withFeature),
      without_feature: summarizePosts(withoutFeature),
    };
  }

  return byFeature;
}

function markdownTable(headers: string[], rows: string[][]) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function toMarkdown(params: {
  inputPath: string;
  startDate: string;
  endDate: string;
  posts: CombinedPost[];
  byMonthSurface: Record<string, Record<string, number>>;
  ig: CombinedPost[];
  fb: CombinedPost[];
  igFeatureComparisons: ReturnType<typeof buildFeatureComparisons>;
  fbReelsFeatureComparisons: ReturnType<typeof buildFeatureComparisons>;
  topIg: ReturnType<typeof topPosts>;
  topFbReels: ReturnType<typeof topPosts>;
  topFbFeed: ReturnType<typeof topPosts>;
}) {
  const { inputPath, startDate, endDate, posts, byMonthSurface, ig, fb, igFeatureComparisons, fbReelsFeatureComparisons, topIg, topFbReels, topFbFeed } = params;

  const igCarousels = ig.filter((post) => post.surface === 'carousel');
  const igReels = ig.filter((post) => post.surface === 'reels');
  const fbFeed = fb.filter((post) => post.surface === 'feed');
  const fbReels = fb.filter((post) => post.surface === 'reels');

  const monthRows = Object.entries(byMonthSurface)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => [
      month,
      String(counts['instagram:carousel'] ?? 0),
      String(counts['instagram:reels'] ?? 0),
      String(counts['facebook:feed'] ?? 0),
      String(counts['facebook:reels'] ?? 0),
    ]);

  const featureRows = (comparisons: ReturnType<typeof buildFeatureComparisons>, metricKey: string) =>
    Object.entries(comparisons).map(([feature, values]) => [
      feature,
      String(values.with_feature.count ?? 0),
      formatNumber(values.with_feature[`avg_${metricKey}`] ?? 0),
      String(values.without_feature.count ?? 0),
      formatNumber(values.without_feature[`avg_${metricKey}`] ?? 0),
    ]);

  const topRows = (items: ReturnType<typeof topPosts>, metric: string) =>
    items.map((item) => [
      item.date ?? 'unknown',
      item.surface,
      formatNumber(typeof item.metrics[metric] === 'number' ? item.metrics[metric] as number : 0),
      (item.first_line || '').replace(/\|/g, '\\|'),
    ]);

  return `# Social Content Correlation — Q1 2026

Source snapshot:
- \`${inputPath}\`
- Window: ${startDate} → ${endDate}
- Posts analyzed: ${posts.length}

## Posting mix by month

${markdownTable(['Month', 'IG carousels', 'IG reels', 'FB feed', 'FB reels'], monthRows)}

## Instagram

### Format summary

${markdownTable(
  ['Surface', 'Count', 'Avg views', 'Avg reach', 'Avg interactions', 'Avg shares', 'Avg saves'],
  [
    ['carousel', String(igCarousels.length), formatNumber(average(igCarousels.map((post) => numericMetric(post, 'views')))), formatNumber(average(igCarousels.map((post) => numericMetric(post, 'reach')))), formatNumber(average(igCarousels.map((post) => numericMetric(post, 'total_interactions')))), formatNumber(average(igCarousels.map((post) => numericMetric(post, 'shares')))), formatNumber(average(igCarousels.map((post) => numericMetric(post, 'saved'))))],
    ['reels', String(igReels.length), formatNumber(average(igReels.map((post) => numericMetric(post, 'views')))), formatNumber(average(igReels.map((post) => numericMetric(post, 'reach')))), formatNumber(average(igReels.map((post) => numericMetric(post, 'total_interactions')))), formatNumber(average(igReels.map((post) => numericMetric(post, 'shares')))), formatNumber(average(igReels.map((post) => numericMetric(post, 'saved'))))],
  ],
)}

### Feature correlation on Instagram

${markdownTable(['Feature', 'With feature', 'Avg views', 'Without feature', 'Avg views'], featureRows(igFeatureComparisons, 'views'))}

### Top Instagram posts by views

${markdownTable(['Date', 'Surface', 'Views', 'First line'], topRows(topIg, 'views'))}

## Facebook

### Format summary

${markdownTable(
  ['Surface', 'Count', 'Avg views', 'Avg shares', 'Avg reactions', 'Avg comments'],
  [
    ['feed', String(fbFeed.length), 'n/a', formatNumber(average(fbFeed.map((post) => numericMetric(post, 'shares')))), formatNumber(average(fbFeed.map((post) => numericMetric(post, 'reactions')))), formatNumber(average(fbFeed.map((post) => numericMetric(post, 'comments'))))],
    ['reels', String(fbReels.length), formatNumber(average(fbReels.map((post) => numericMetric(post, 'views')))), formatNumber(average(fbReels.map((post) => numericMetric(post, 'shares')))), formatNumber(average(fbReels.map((post) => numericMetric(post, 'reactions')))), formatNumber(average(fbReels.map((post) => numericMetric(post, 'comments'))))],
  ],
)}

### Feature correlation on Facebook reels

${markdownTable(['Feature', 'With feature', 'Avg reel views', 'Without feature', 'Avg reel views'], featureRows(fbReelsFeatureComparisons, 'views'))}

### Top Facebook reels by views

${markdownTable(['Date', 'Surface', 'Views', 'First line'], topRows(topFbReels, 'views'))}

### Top Facebook feed posts by shares

${markdownTable(['Date', 'Surface', 'Shares', 'First line'], topRows(topFbFeed, 'shares'))}
`;
}

function main() {
  const inputPath = resolveInputPath();
  const startDate = getArg('--start') ?? '2026-01-01';
  const endDate = getArg('--end') ?? '2026-03-31';
  const outputPrefix = path.resolve(
    MONOREPO_ROOT,
    getArg('--output-prefix') ?? path.join('data', 'social', '2026-03-31-analysis-q1-content'),
  );

  const posts = readPosts(inputPath).filter((post) => {
    const day = post.timestamp?.slice(0, 10);
    return Boolean(day && day >= startDate && day <= endDate);
  });

  const byMonthSurface: Record<string, Record<string, number>> = {};
  for (const post of posts) {
    const month = monthKey(post.timestamp);
    byMonthSurface[month] ??= {};
    const key = `${post.network}:${post.surface}`;
    byMonthSurface[month][key] = (byMonthSurface[month][key] ?? 0) + 1;
  }

  const ig = posts.filter((post) => post.network === 'instagram' && (post.surface === 'carousel' || post.surface === 'reels'));
  const fb = posts.filter((post) => post.network === 'facebook' && (post.surface === 'feed' || post.surface === 'reels'));
  const fbReels = fb.filter((post) => post.surface === 'reels');
  const fbFeed = fb.filter((post) => post.surface === 'feed');

  const output = {
    source: inputPath,
    start_date: startDate,
    end_date: endDate,
    counts: {
      posts: posts.length,
      instagram: ig.length,
      facebook: fb.length,
    },
    by_month_surface: byMonthSurface,
    summaries: {
      instagram: {
        carousel: summarizePosts(ig.filter((post) => post.surface === 'carousel')),
        reels: summarizePosts(ig.filter((post) => post.surface === 'reels')),
      },
      facebook: {
        feed: summarizePosts(fbFeed),
        reels: summarizePosts(fbReels),
      },
    },
    feature_correlations: {
      instagram: buildFeatureComparisons(ig),
      facebook_reels: buildFeatureComparisons(fbReels),
    },
    top_posts: {
      instagram_by_views: topPosts(ig, (post) => numericMetric(post, 'views')),
      facebook_reels_by_views: topPosts(fbReels, (post) => numericMetric(post, 'views')),
      facebook_feed_by_shares: topPosts(fbFeed, (post) => numericMetric(post, 'shares')),
    },
  };

  const markdown = toMarkdown({
    inputPath,
    startDate,
    endDate,
    posts,
    byMonthSurface,
    ig,
    fb,
    igFeatureComparisons: output.feature_correlations.instagram,
    fbReelsFeatureComparisons: output.feature_correlations.facebook_reels,
    topIg: output.top_posts.instagram_by_views,
    topFbReels: output.top_posts.facebook_reels_by_views,
    topFbFeed: output.top_posts.facebook_feed_by_shares,
  });

  fs.writeFileSync(`${outputPrefix}.json`, JSON.stringify(output, null, 2));
  fs.writeFileSync(`${outputPrefix}.md`, markdown);

  console.log(JSON.stringify({
    output_json: `${outputPrefix}.json`,
    output_markdown: `${outputPrefix}.md`,
    posts_analyzed: posts.length,
    source: inputPath,
  }, null, 2));
}

main();
