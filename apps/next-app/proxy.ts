import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

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

export default clerkMiddleware(async (auth, req) => {
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

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
