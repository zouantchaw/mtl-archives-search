import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getStoryBySlug } from '@/lib/story-pages';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mtlarchives.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const story = getStoryBySlug(slug);
  if (!story) {
    return {
      title: 'Story not found',
      robots: { index: false, follow: false },
    };
  }

  return {
    title: story.title,
    description: story.dek,
    alternates: {
      canonical: `/stories/${story.slug}`,
    },
    openGraph: {
      title: story.title,
      description: story.dek,
      url: `${SITE_URL}/stories/${story.slug}`,
      images: story.hero_image ? [{ url: story.hero_image }] : undefined,
    },
  };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const story = getStoryBySlug(slug);
  if (!story) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background px-5 py-10 lg:px-12">
      <article className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Link href="/stories" className="hover:text-foreground">
            Stories
          </Link>
          <span>{story.theme_label}</span>
          <span>{story.date}</span>
          {story.selected_photo?.cote ? <span>{story.selected_photo.cote}</span> : null}
        </div>

        <header className="mb-10">
          <h1 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">{story.title}</h1>
          {story.dek ? (
            <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg">
              {story.dek}
            </p>
          ) : null}
        </header>

        {story.hero_image ? (
          <div className="mb-10 overflow-hidden rounded-3xl border border-border bg-card">
            <div className="relative aspect-[4/3] w-full">
              <Image
                src={story.hero_image}
                alt={story.selected_photo?.name || story.title}
                fill
                sizes="(max-width: 1024px) 100vw, 900px"
                className="object-cover"
                priority
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-10">
            {story.sections.map((section) => (
              <section key={section.id}>
                <h2 className="mb-3 font-serif text-2xl text-foreground">{section.title}</h2>
                <p className="text-base leading-8 text-foreground/90">{section.body}</p>
              </section>
            ))}
          </div>

          <aside className="space-y-5 rounded-3xl border border-border bg-card px-5 py-5 h-fit">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Archive record</p>
              <p className="mt-2 text-sm leading-7 text-foreground">
                {story.selected_photo?.name || story.title}
              </p>
              {story.selected_photo?.date_value ? (
                <p className="text-sm text-muted-foreground">{story.selected_photo.date_value}</p>
              ) : null}
            </div>

            {story.photo_url ? (
              <Link
                href={story.photo_url.replace(SITE_URL, '')}
                className="inline-flex rounded-full border border-foreground/15 px-4 py-2 text-sm text-foreground hover:bg-accent/40"
              >
                View archive photo
              </Link>
            ) : null}

            {story.related_queries?.length ? (
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Related searches</p>
                <div className="flex flex-wrap gap-2">
                  {story.related_queries.map((query) => (
                    <Link
                      key={query}
                      href={`/search?q=${encodeURIComponent(query)}`}
                      className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {query}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </article>
    </main>
  );
}
