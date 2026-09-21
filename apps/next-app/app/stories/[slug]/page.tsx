import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StoryEmailCapture } from '@/components/stories/StoryEmailCapture';
import { StoryGameLink, StoryPrintLink } from '@/components/stories/StoryLinks';
import { SiteHeader } from '@/components/SiteHeader';
import { formatStoryDate, getStoriesPage, getStoryBySlug, type StoryRecord } from '@/lib/stories';
import { SITE_URL } from '@/lib/seo';

function canUseNextImage(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    return host.endsWith('.r2.dev') || host.endsWith('.r2.cloudflarestorage.com') || host === 'depot.ville.montreal.qc.ca';
  } catch {
    return false;
  }
}

function StoryPhoto({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  if (!canUseNextImage(src)) {
    return <img src={src} alt={alt} className="h-full w-full object-cover" />;
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      sizes="(max-width: 768px) 100vw, 960px"
      className="object-cover"
    />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const story = await getStoryBySlug(slug);
  if (!story) {
    return { title: 'Histoire introuvable', robots: { index: false, follow: false } };
  }

  return {
    title: story.title,
    description: story.dek,
    alternates: { canonical: `/stories/${story.slug}` },
    openGraph: {
      title: story.title,
      description: story.dek,
      url: `${SITE_URL}/stories/${story.slug}`,
      type: 'article',
      images: story.photo_url ? [{ url: story.photo_url }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: story.title,
      description: story.dek,
      images: story.photo_url ? [story.photo_url] : undefined,
    },
  };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const story = await getStoryBySlug(slug);
  if (!story) notFound();

  const relatedPage = await getStoriesPage(4, null);
  const related = relatedPage.items.filter((item) => item.slug !== story.slug).slice(0, 3);
  const midpoint = Math.min(1, story.sections.length);

  return (
    <>
      <SiteHeader />
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <article className="mx-auto max-w-3xl pb-16">
        <div className="relative aspect-[3/4] w-full bg-muted sm:aspect-[16/10]">
          {story.photo_url ? <StoryPhoto src={story.photo_url} alt={story.title} priority /> : null}
        </div>

        <div className="px-5 pt-6 sm:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <Link href="/stories" className="hover:text-foreground">Histoires</Link>
            <span>{story.theme_label}</span>
            <span>{formatStoryDate(story.date, story.lang)}</span>
          </div>
          <h1 className="font-serif text-4xl leading-[1.05] text-foreground sm:text-5xl">{story.title}</h1>
          {story.dek ? <p className="mt-4 text-lg leading-8 text-muted-foreground">{story.dek}</p> : null}
          <p className="mt-4 text-sm text-muted-foreground">
            {[story.cote, story.photo_credit, formatStoryDate(story.date, story.lang)].filter(Boolean).join(' · ')}
          </p>

          <div className="mt-10 space-y-8">
            {story.sections.slice(0, midpoint).map((section) => (
              <section key={section.heading}>
                <h2 className="font-serif text-2xl text-foreground">{section.heading}</h2>
                <p className="mt-3 whitespace-pre-line text-base leading-8 text-foreground/90">{section.body}</p>
              </section>
            ))}
          </div>

          <div className="my-10">
            <StoryEmailCapture slug={story.slug} variant={story.email_capture_variant} lang={story.lang} />
          </div>

          <div className="space-y-8">
            {story.sections.slice(midpoint).map((section) => (
              <section key={section.heading}>
                <h2 className="font-serif text-2xl text-foreground">{section.heading}</h2>
                <p className="mt-3 whitespace-pre-line text-base leading-8 text-foreground/90">{section.body}</p>
              </section>
            ))}
          </div>

          <aside className="mt-10 rounded-3xl border border-border bg-card px-5 py-5">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Crédit photo</p>
            <p className="mt-2 text-sm leading-6 text-foreground">{story.photo_credit || story.title}</p>
            {story.cote ? <p className="text-sm text-muted-foreground">{story.cote}</p> : null}
            <Link href={`/photo/${encodeURIComponent(story.photo_id)}`} className="mt-4 inline-flex text-sm font-semibold text-brand-blue">
              Voir la fiche d&apos;archives
            </Link>
          </aside>

          <div className="mt-6 flex flex-wrap gap-3">
            <StoryPrintLink href="/print" slug={story.slug} photoId={story.photo_id}>
              Imprimer cette photo
            </StoryPrintLink>
          </div>

          {story.sponsor ? <SponsorSlot story={story} /> : null}

          {related.length > 0 ? (
            <section className="mt-12">
              <h2 className="font-serif text-2xl text-foreground">Autres histoires</h2>
              <div className="mt-4 space-y-3">
                {related.map((item) => (
                  <Link key={item.slug} href={`/stories/${item.slug}`} className="block rounded-2xl border border-border px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{formatStoryDate(item.date)}</p>
                    <p className="mt-1 font-serif text-xl text-foreground">{item.title}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <footer className="mt-12 space-y-6 border-t border-border pt-8">
            <StoryGameLink href="/game" slug={story.slug}>Jouer au jeu du jour</StoryGameLink>
            <StoryEmailCapture slug={story.slug} variant={story.email_capture_variant} lang={story.lang} compact />
          </footer>
        </div>
        </article>
        <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: story.title,
            description: story.dek,
            datePublished: story.published_at,
            inLanguage: story.lang === 'en' ? 'en-CA' : 'fr-CA',
            image: story.photo_url || undefined,
            mainEntityOfPage: `${SITE_URL}/stories/${story.slug}`,
          }),
        }}
        />
      </main>
    </>
  );
}

function SponsorSlot({ story }: { story: StoryRecord }) {
  if (!story.sponsor) return null;
  return (
    <p className="mt-8 text-sm text-muted-foreground">
      {story.sponsor.label || 'Présenté par'}{' '}
      <a href={story.sponsor.url} rel="sponsored noopener noreferrer" className="font-semibold text-foreground underline">
        {story.sponsor.name}
      </a>
    </p>
  );
}
