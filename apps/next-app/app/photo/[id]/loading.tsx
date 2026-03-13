export default function Loading() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/60 px-5 py-4 sm:px-12">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="h-5 w-24 rounded-full skeleton" />
          <div className="h-5 w-16 rounded-full skeleton" />
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-5 py-6 sm:px-12 lg:grid-cols-[minmax(0,1.1fr)_24rem]">
        <div className="overflow-hidden rounded-[2rem] bg-muted">
          <div className="aspect-[4/5] skeleton lg:aspect-[4/3]" />
        </div>

        <div className="space-y-5">
          <div className="h-5 w-28 rounded-full skeleton" />
          <div className="h-14 w-full rounded-[1.2rem] skeleton" />
          <div className="h-24 w-full rounded-[1.4rem] skeleton" />
          <div className="h-32 w-full rounded-[1.4rem] skeleton" />
          <div className="h-12 w-full rounded-full skeleton" />
        </div>
      </section>
    </main>
  );
}
