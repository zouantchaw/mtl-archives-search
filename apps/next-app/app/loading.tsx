export default function Loading() {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/60 px-5 py-4 sm:px-12">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="h-5 w-28 rounded-full skeleton" />
          <div className="hidden h-11 w-[32rem] rounded-full skeleton sm:block" />
          <div className="h-5 w-16 rounded-full skeleton" />
        </div>
      </header>

      <section className="px-5 py-8 sm:px-12">
        <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-[minmax(0,31rem)_minmax(0,1fr)] sm:items-start">
          <div className="space-y-5">
            <div className="h-[4.5rem] w-full max-w-[22rem] rounded-[1.5rem] skeleton sm:h-24 sm:max-w-[28rem]" />
            <div className="h-8 w-full rounded-full skeleton" />
            <div className="flex gap-2">
              <div className="h-10 w-24 rounded-full skeleton" />
              <div className="h-10 w-24 rounded-full skeleton" />
              <div className="h-10 w-24 rounded-full skeleton" />
            </div>
          </div>

          <div className="hidden gap-3 sm:flex">
            {Array.from({ length: 3 }).map((_, column) => (
              <div key={column} className="flex flex-1 flex-col gap-3">
                <div className="h-48 rounded-[1.4rem] skeleton" />
                <div className="h-32 rounded-[1.4rem] skeleton" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
