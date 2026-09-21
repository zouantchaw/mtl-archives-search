'use client';

import Link from 'next/link';
import { events } from '@/lib/analytics';

type LinkChildren = React.ComponentProps<typeof Link>['children'];

export function StoryPrintLink({
  href,
  slug,
  photoId,
  children,
}: {
  href: string;
  slug: string;
  photoId: string;
  children: LinkChildren;
}) {
  return (
    <Link
      href={href}
      onClick={() => events.storyPrintClick(slug, photoId)}
      className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background"
    >
      {children}
    </Link>
  );
}

export function StoryGameLink({
  href,
  slug,
  children,
}: {
  href: string;
  slug: string;
  children: LinkChildren;
}) {
  return (
    <Link
      href={href}
      onClick={() => events.storyGameClick(slug)}
      className="inline-flex min-h-11 items-center rounded-full border border-foreground/15 px-4 text-sm font-semibold text-foreground"
    >
      {children}
    </Link>
  );
}

export function HubStoryLink({
  href,
  slug,
  children,
  className,
}: {
  href: string;
  slug: string;
  children: LinkChildren;
  className?: string;
}) {
  return (
    <Link href={href} onClick={() => events.hubStoryClick(slug)} className={className}>
      {children}
    </Link>
  );
}
