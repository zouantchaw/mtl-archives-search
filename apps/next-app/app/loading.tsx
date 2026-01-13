export default function Loading() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header skeleton */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="h-4 w-24 bg-neutral-200 rounded animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="h-8 w-48 bg-neutral-100 rounded-full animate-pulse" />
            <div className="h-4 w-8 bg-neutral-200 rounded animate-pulse" />
          </div>
        </div>
      </header>

      {/* Grid skeleton */}
      <div className="px-2 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/3] bg-neutral-200 animate-pulse"
              style={{
                animationDelay: `${i * 50}ms`,
                animationDuration: '1.5s',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
