import Link from 'next/link';
import { getAllStories } from '@/lib/story-pages';

export const metadata = {
  title: 'Stories',
  description: "Deeper archive-linked stories from MTL Archives, built from daily photo research and tied back to specific Montréal archive records.",
};

export default function StoriesIndexPage() {
  const stories = getAllStories();

  return (
    <main className="min-h-screen bg-background px-5 py-10 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            MTL Archives
          </p>
          <h1 className="font-serif text-4xl text-foreground sm:text-5xl">Stories</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Archive-linked dossiers built from the daily social pipeline, then expanded into deeper Montréal stories.
          </p>
        </header>

        {stories.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card px-6 py-8 text-sm text-muted-foreground">
            No story pages have been promoted yet.
          </div>
        ) : (
          <div className="space-y-4">
            {stories.map((story) => (
              <Link
                key={story.slug}
                href={`/stories/${story.slug}`}
                className="block rounded-3xl border border-border bg-card px-6 py-6 transition-colors hover:border-foreground/20 hover:bg-accent/30"
              >
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{story.theme_label}</span>
                  <span>{story.date}</span>
                  {story.selected_photo?.cote ? <span>{story.selected_photo.cote}</span> : null}
                </div>
                <h2 className="font-serif text-2xl text-foreground sm:text-3xl">{story.title}</h2>
                {story.dek ? <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">{story.dek}</p> : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
