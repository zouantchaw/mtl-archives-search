import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { canRenderPortToCity } from '@/lib/port-to-city-access';

const isPublicRoute = createRouteMatcher([
  '/',
  '/search(.*)',
  '/print(.*)',
  '/checkout(.*)',
  '/order-confirmation(.*)',
  '/game(.*)',
  '/photo(.*)',
  '/api/(.*)',
  '/opengraph-image(.*)',
  '/twitter-image(.*)',
  '/photo/(.*)/opengraph-image(.*)',
  '/photo/(.*)/twitter-image(.*)',
  '/icon(.*)',
  '/apple-icon(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/pitch(.*)',
  '/sitemap.xml',
  '/robots.txt',
]);

const clerkProxy = clerkMiddleware(async (auth, req) => {
  const photoMatch = req.nextUrl.pathname.match(/^\/photo\/([^/]+)\.json$/i);
  if (photoMatch) {
    const normalizedId = photoMatch[1];
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = `/photo/${encodeURIComponent(normalizedId)}`;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname.startsWith('/port-to-city') && !canRenderPortToCity()) {
    return new NextResponse('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  return clerkProxy(req, event);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
