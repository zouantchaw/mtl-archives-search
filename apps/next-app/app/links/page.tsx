import type { Metadata } from 'next';
import { HubStoryLink } from '@/components/stories/StoryLinks';
import { formatStoryDate, getLatestStory } from '@/lib/stories';

export const metadata: Metadata = {
  title: 'Liens',
  description: 'Histoire du jour, jeu, impressions et infolettre MTL Archives.',
  alternates: { canonical: '/links' },
  robots: { index: true, follow: true },
};

function withBioUtm(path: string, medium: string, campaign: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('utm_source', 'bio');
  params.set('utm_medium', medium === 'facebook' ? 'facebook' : 'instagram');
  params.set('utm_campaign', campaign);
  const next = params.toString();
  return next ? `${pathname}?${next}` : pathname;
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawMedium = Array.isArray(params.utm_medium) ? params.utm_medium[0] : params.utm_medium;
  const medium = rawMedium === 'facebook' ? 'facebook' : 'instagram';
  const story = await getLatestStory();
  const storyHref = story
    ? withBioUtm(`/stories/${story.slug}`, medium, story.slug)
    : withBioUtm('/stories', medium, 'bio_hub');

  const links = [
    { href: withBioUtm('/game', medium, 'bio_hub'), label: 'Jeu quotidien', detail: 'Devinez où la photo a été prise.' },
    { href: withBioUtm('/print', medium, 'bio_hub'), label: 'Impressions', detail: 'Une photo d’archives, sur papier d’art.' },
    { href: withBioUtm('/#newsletter', medium, 'bio_hub'), label: 'Infolettre', detail: 'La photo du matin, par courriel.' },
    { href: withBioUtm('/', medium, 'bio_hub'), label: 'Accueil', detail: 'Explorer les archives.' },
  ];

  return (
    <main className="min-h-screen bg-background px-5 py-8">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className="px-1 pb-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">MTL Archives</p>
          <h1 className="mt-2 font-serif text-4xl text-foreground">Aujourd&apos;hui</h1>
        </header>

        <HubStoryLink
          href={storyHref}
          slug={story?.slug || 'latest'}
          className="overflow-hidden rounded-3xl border border-border bg-card"
        >
          {story?.photo_url ? (
            <img src={story.photo_url} alt="" className="aspect-[4/5] w-full object-cover" />
          ) : (
            <div className="aspect-[4/5] bg-muted" />
          )}
          <div className="px-5 py-5">
            <p className="text-xs uppercase tracking-[0.16em] text-brand-blue">Histoire du jour</p>
            <h2 className="mt-2 font-serif text-2xl leading-tight text-foreground">
              {story?.title || 'La prochaine histoire arrive bientôt'}
            </h2>
            {story ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {formatStoryDate(story.date)} · {story.dek}
              </p>
            ) : null}
          </div>
        </HubStoryLink>

        {links.map((link) => (
          <a key={link.label} href={link.href} className="rounded-3xl border border-border bg-card px-5 py-4">
            <p className="text-lg font-semibold text-foreground">{link.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{link.detail}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
