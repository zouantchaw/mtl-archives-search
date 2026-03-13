import { type NextRequest, NextResponse } from 'next/server';
import { resolveRuntimeConfig } from '@/lib/runtime-env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NEWSLETTER_TORONTO_SEND_HOUR = 7;

function getTorontoHour(date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'America/Toronto',
  });
  return Number(formatter.format(date));
}

function getTorontoDateKey(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  return request.headers.get('authorization') === `Bearer ${expectedSecret}`;
}

function getWorkerApiBase(): string {
  const config = resolveRuntimeConfig({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    API_BASE_URL: process.env.API_BASE_URL,
    NEXT_PUBLIC_R2_PUBLIC_DOMAIN: process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN,
    CLOUDFLARE_R2_PUBLIC_DOMAIN: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN,
  }, process.env.NODE_ENV, { strict: true });

  if (!config.apiBase) {
    throw new Error('NEXT_PUBLIC_API_URL or API_BASE_URL is required for newsletter cron.');
  }

  return config.apiBase;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET is not configured.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  const adminSecret = process.env.NEWSLETTER_ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { success: false, error: 'NEWSLETTER_ADMIN_SECRET is not configured.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get('force') === '1';
  const dateKey = request.nextUrl.searchParams.get('dateKey')?.trim() || getTorontoDateKey(now);
  const torontoHour = getTorontoHour(now);

  if (!force && torontoHour !== NEWSLETTER_TORONTO_SEND_HOUR) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'outside_send_hour',
      dateKey,
      torontoHour,
    }, {
      headers: { 'cache-control': 'no-store' },
    });
  }

  try {
    const response = await fetch(`${getWorkerApiBase()}/api/newsletter/admin/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-newsletter-admin-secret': adminSecret,
      },
      body: JSON.stringify({
        dateKey,
        source: 'vercel_cron',
      }),
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({
      success: false,
      error: 'Newsletter admin endpoint returned invalid JSON.',
    }));

    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('Newsletter cron trigger failed', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reach newsletter admin endpoint.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
