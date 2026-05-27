import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_TOKEN_STATE_PATH = path.join(MONOREPO_ROOT, 'data', 'social', 'meta-token-state.json');

dotenv.config({ path: path.join(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.join(MONOREPO_ROOT, '.env') });

type Json = Record<string, unknown>;

type GraphPage<T> = {
  data: T[];
  paging?: {
    next?: string;
  };
};

type PermissionRow = {
  permission: string;
  status: string;
};

type PageAccount = {
  id: string;
  name: string;
  access_token: string;
};

type IgProfile = {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
};

type IgMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

type InsightMetric = {
  name: string;
  period: string;
  values?: Array<{ value: number | string | boolean | null }>;
  title?: string;
  description?: string;
  id?: string;
};

type FbPost = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  status_type?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

type FbReel = {
  id: string;
  description?: string;
  created_time?: string;
  permalink_url?: string;
  views?: number;
};

type CombinedPost = {
  network: 'instagram' | 'facebook';
  surface: 'feed' | 'reels' | 'carousel' | 'unknown';
  id: string;
  timestamp: string | null;
  permalink: string | null;
  caption: string | null;
  metrics: Record<string, number | null>;
  raw: Json;
};

type IgMediaWithInsights = IgMedia & {
  insight_metrics: Record<string, number | null>;
};

type InsightError = {
  id: string;
  scope: 'instagram';
  message: string;
};

function fail(message: string): never {
  console.error(`[social-history] ${message}`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`Missing required env var ${name}`);
  return value;
}

function readTokenState(tokenStatePath: string) {
  if (!fs.existsSync(tokenStatePath)) {
    return undefined;
  }

  const raw = fs.readFileSync(tokenStatePath, 'utf8');
  const parsed = JSON.parse(raw) as {
    user_token?: { access_token?: string };
    page?: { id?: string; access_token?: string };
    instagram?: { id?: string };
  };

  return parsed;
}

function sanitizeTimestamp(value: string) {
  return value.replace(/[:.]/g, '-');
}

async function graph<T>(url: string): Promise<T> {
  const timeoutMs = Number(process.env.GRAPH_TIMEOUT_MS ?? '20000');
  const retries = Number(process.env.GRAPH_RETRIES ?? '3');

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Graph request failed (${response.status}) for ${url}\n${text}`);
      }

      const parsed = JSON.parse(text) as T & { error?: { message?: string } };
      if ((parsed as { error?: { message?: string } }).error) {
        throw new Error(`Graph error for ${url}\n${JSON.stringify(parsed, null, 2)}`);
      }

      return parsed;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      const delayMs = attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Unreachable graph retry exhaustion for ${url}`);
}

async function graphPath<T>(
  token: string,
  objectPath: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/v25.0/${objectPath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set('access_token', token);
  return graph<T>(url.toString());
}

async function paginate<T>(initialUrl: string): Promise<T[]> {
  const rows: T[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const graphPage: GraphPage<T> = await graph<GraphPage<T>>(nextUrl);
    rows.push(...graphPage.data);
    nextUrl = graphPage.paging?.next;
  }

  return rows;
}

function metricMap(metrics: InsightMetric[] | undefined) {
  const map: Record<string, number | null> = {};
  for (const metric of metrics ?? []) {
    const value = metric.values?.[0]?.value;
    map[metric.name] = typeof value === 'number' ? value : null;
  }
  return map;
}

function mediaSurface(item: IgMedia): CombinedPost['surface'] {
  if (item.media_product_type === 'REELS') return 'reels';
  if (item.media_type === 'CAROUSEL_ALBUM') return 'carousel';
  if (item.media_product_type === 'FEED') return 'feed';
  return 'unknown';
}

async function main() {
  const tokenStatePath = path.resolve(
    MONOREPO_ROOT,
    getArg('--token-state') ?? process.env.MTL_META_TOKEN_STATE ?? DEFAULT_TOKEN_STATE_PATH,
  );
  const tokenState = readTokenState(tokenStatePath);
  const userToken =
    getArg('--token')
    ?? process.env.META_USER_ACCESS_TOKEN
    ?? tokenState?.user_token?.access_token
    ?? requireEnv('META_USER_ACCESS_TOKEN');
  const outputRoot = path.resolve(
    MONOREPO_ROOT,
    getArg('--output-dir') ?? path.join('data', 'social', sanitizeTimestamp(new Date().toISOString())),
  );
  const maxInstagram = Number(getArg('--max-instagram') ?? process.env.META_MAX_INSTAGRAM ?? '0');

  fs.mkdirSync(outputRoot, { recursive: true });

  const permissions = await graphPath<GraphPage<PermissionRow>>(userToken, 'me/permissions');
  const granted = new Map(permissions.data.map((row) => [row.permission, row.status]));
  const requiredPermissions = [
    'pages_show_list',
    'business_management',
    'instagram_basic',
    'instagram_manage_insights',
    'pages_read_engagement',
    'pages_read_user_content',
    'read_insights',
  ];

  for (const permission of requiredPermissions) {
    if (granted.get(permission) !== 'granted') {
      fail(`Permission ${permission} is not granted`);
    }
  }

  const accounts = await graphPath<GraphPage<PageAccount>>(userToken, 'me/accounts', {
    fields: 'id,name,access_token',
  });

  if (!accounts.data.length) {
    fail('No Facebook Pages returned by /me/accounts');
  }

  const requestedPageId = getArg('--page-id') ?? process.env.META_PAGE_ID ?? tokenState?.page?.id;
  const page: PageAccount | undefined = requestedPageId
    ? accounts.data.find((row) => row.id === requestedPageId)
    : accounts.data[0];

  if (!page) {
    fail(`Requested page ${requestedPageId} not found in /me/accounts`);
  }

  const pageAccessToken = page.access_token;

  const pageInfo = await graphPath<{ id: string; name: string; instagram_business_account?: { id: string } }>(
    userToken,
    page.id,
    { fields: 'id,name,instagram_business_account' },
  );

  const igAccountId = getArg('--ig-account-id')
    ?? process.env.META_IG_ACCOUNT_ID
    ?? tokenState?.instagram?.id
    ?? pageInfo.instagram_business_account?.id;

  if (!igAccountId) {
    fail(`No instagram_business_account linked to page ${page.id}`);
  }

  const igProfile = await graphPath<IgProfile>(userToken, igAccountId, {
    fields: 'id,username,name,profile_picture_url,followers_count,media_count',
  });

  const igMediaUrl = new URL(`https://graph.facebook.com/v25.0/${igAccountId}/media`);
  igMediaUrl.searchParams.set(
    'fields',
    'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
  );
  igMediaUrl.searchParams.set('limit', '100');
  igMediaUrl.searchParams.set('access_token', userToken);
  const instagramMedia = await paginate<IgMedia>(igMediaUrl.toString());

  const instagramMediaWithInsights: IgMediaWithInsights[] = [];
  const insightErrors: InsightError[] = [];
  const mediaToProcess = maxInstagram > 0 ? instagramMedia.slice(0, maxInstagram) : instagramMedia;

  for (const [index, item] of mediaToProcess.entries()) {
    const metrics = [
      'reach',
      'likes',
      'comments',
      'shares',
      'saved',
      'total_interactions',
      'views',
    ];

    if (item.media_product_type === 'REELS') {
      metrics.push('ig_reels_avg_watch_time', 'ig_reels_video_view_total_time');
    }

    try {
      const insights = await graphPath<GraphPage<InsightMetric>>(userToken, `${item.id}/insights`, {
        metric: metrics.join(','),
      });

      instagramMediaWithInsights.push({
        ...item,
        insight_metrics: metricMap(insights.data),
      });
    } catch (error) {
      insightErrors.push({
        id: item.id,
        scope: 'instagram',
        message: error instanceof Error ? error.message : String(error),
      });
      instagramMediaWithInsights.push({
        ...item,
        insight_metrics: {},
      });
    }

    if ((index + 1) % 25 === 0) {
      console.log(`[social-history] Processed ${index + 1}/${mediaToProcess.length} Instagram items`);
    }
  }

  const fbPostsUrl = new URL(`https://graph.facebook.com/v25.0/${page.id}/published_posts`);
  fbPostsUrl.searchParams.set(
    'fields',
    'id,message,created_time,permalink_url,status_type,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)',
  );
  fbPostsUrl.searchParams.set('limit', '100');
  fbPostsUrl.searchParams.set('access_token', pageAccessToken);
  const facebookPosts = await paginate<FbPost>(fbPostsUrl.toString());

  const fbReelsUrl = new URL(`https://graph.facebook.com/v25.0/${page.id}/video_reels`);
  fbReelsUrl.searchParams.set('fields', 'id,description,created_time,permalink_url,views');
  fbReelsUrl.searchParams.set('limit', '100');
  fbReelsUrl.searchParams.set('access_token', pageAccessToken);
  const facebookReels = await paginate<FbReel>(fbReelsUrl.toString());

  const combined: CombinedPost[] = [];

  for (const item of instagramMediaWithInsights) {
    combined.push({
      network: 'instagram',
      surface: mediaSurface(item),
      id: item.id,
      timestamp: item.timestamp ?? null,
      permalink: item.permalink ?? null,
      caption: item.caption ?? null,
      metrics: {
        like_count: item.like_count ?? null,
        comments_count: item.comments_count ?? null,
        reach: item.insight_metrics.reach ?? null,
        shares: item.insight_metrics.shares ?? null,
        saved: item.insight_metrics.saved ?? null,
        total_interactions: item.insight_metrics.total_interactions ?? null,
        views: item.insight_metrics.views ?? null,
        ig_reels_avg_watch_time: item.insight_metrics.ig_reels_avg_watch_time ?? null,
        ig_reels_video_view_total_time: item.insight_metrics.ig_reels_video_view_total_time ?? null,
      },
      raw: item as unknown as Json,
    });
  }

  const fbReelPermalinks = new Set(
    facebookReels
      .map((row) => row.permalink_url)
      .filter(Boolean)
      .map((value) => `https://www.facebook.com${value}`),
  );

  for (const item of facebookPosts) {
    const permalink = item.permalink_url ?? null;
    const surface: CombinedPost['surface'] =
      item.status_type === 'added_video' || (permalink && fbReelPermalinks.has(permalink))
        ? 'reels'
        : 'feed';

    combined.push({
      network: 'facebook',
      surface,
      id: item.id,
      timestamp: item.created_time ?? null,
      permalink,
      caption: item.message ?? null,
      metrics: {
        shares: item.shares?.count ?? 0,
        reactions: item.reactions?.summary?.total_count ?? 0,
        comments: item.comments?.summary?.total_count ?? 0,
      },
      raw: item as unknown as Json,
    });
  }

  for (const item of facebookReels) {
    const permalink = item.permalink_url ? `https://www.facebook.com${item.permalink_url}` : null;
    const existing = combined.find((row) => row.network === 'facebook' && row.permalink === permalink);
    if (!existing) continue;
    existing.metrics.views = item.views ?? null;
    existing.raw = {
      ...existing.raw,
      facebook_reel: item as unknown as Json,
    };
  }

  const summary = {
    fetched_at: new Date().toISOString(),
    auth: {
      token_state_path: fs.existsSync(tokenStatePath) ? tokenStatePath : null,
      token_source:
        getArg('--token')
          ? 'cli'
          : process.env.META_USER_ACCESS_TOKEN
            ? 'env'
            : tokenState?.user_token?.access_token
              ? 'state'
              : 'missing',
    },
    page: {
      id: page.id,
      name: page.name,
    },
    instagram_profile: igProfile,
    counts: {
      instagram_media: instagramMediaWithInsights.length,
      facebook_posts: facebookPosts.length,
      facebook_reels: facebookReels.length,
      combined_posts: combined.length,
    },
  };

  fs.writeFileSync(path.join(outputRoot, 'permissions.json'), JSON.stringify(permissions, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'page.json'), JSON.stringify(pageInfo, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'instagram_profile.json'), JSON.stringify(igProfile, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'instagram_media.json'), JSON.stringify(instagramMediaWithInsights, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'facebook_posts.json'), JSON.stringify(facebookPosts, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'facebook_video_reels.json'), JSON.stringify(facebookReels, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'combined_posts.json'), JSON.stringify(combined, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'insight_errors.json'), JSON.stringify(insightErrors, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`[social-history] Wrote export to ${outputRoot}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
