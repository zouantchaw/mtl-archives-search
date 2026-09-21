import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { formatStoryDate, getStoriesPage } from '@/lib/stories';

export const metadata: Metadata = {
  title: 'Histoires',
  description: "Chaque jour, une photo d'archives de Montréal et l'histoire qui va avec.",
  alternates: { canonical: '/stories' },
};

function canUseNextImage(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    return host.endsWith('.r2.dev') || host.endsWith('.r2.cloudflarestorage.com') || host === 'depot.ville.montreal.qc.ca';
  } catch {
    return false;
  }
}

export default async function StoriesIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cursor = typeof params.cursor === 'string' ? params.cursor : null;
  const page = await getStoriesPage(24, cursor);

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-3.5rem)] bg-background px-5 py-12 sm:px-12 sm:py-16">
        <div className="mx-auto max-w-[1900px]">
        <header className="mb-10 max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">MTL Archives</p>
          <h1 className="mt-3 font-serif text-5xl leading-[0.98] text-foreground sm:text-7xl">Histoires</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Chaque jour, une photo d&apos;archives et l&apos;histoire qui va avec.
          </p>
        </header>

        {page.items.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card px-6 py-8 text-sm text-muted-foreground">
            La prochaine histoire arrive bientôt.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {page.items.map((story) => (
              <Link
                key={story.slug}
                href={`/stories/${story.slug}`}
                className="group block overflow-hidden rounded-3xl border border-border bg-card transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[var(--shadow-card)]"
              >
                {story.photo_url ? (
                  <div className="relative aspect-[4/3] bg-muted">
                    {canUseNextImage(story.photo_url) ? (
                      <Image src={story.photo_url} alt="" fill sizes="(max-width: 768px) 100vw, 720px" className="object-cover" />
                    ) : (
                      <img src={story.photo_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                ) : null}
                <div className="px-5 py-5 sm:px-6 sm:py-6">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {story.theme_label} · {formatStoryDate(story.date)}
                  </p>
                  <h2 className="mt-2 font-serif text-2xl text-foreground transition-colors group-hover:text-primary">{story.title}</h2>
                  {story.dek ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{story.dek}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        )}

        {page.nextCursor ? (
          <Link
            href={`/stories?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-brand-blue"
          >
            Plus d&apos;histoires
          </Link>
        ) : null}
        </div>
      </main>
    </>
  );
}
