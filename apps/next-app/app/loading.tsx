export default function Loading() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header skeleton - matches actual header layout */}
      <header className="sticky top-0 z-50 bg-[#fafafa]/95 backdrop-blur-sm border-b border-neutral-100">
        <div className="h-14 px-4 flex items-center justify-between">
          {/* Logo */}
          <div className="h-4 w-20 sm:w-24 skeleton rounded" />

          {/* Search bar - hidden on mobile, visible on desktop */}
          <div className="hidden sm:flex items-center gap-3 flex-1 max-w-md mx-8">
            <div className="h-9 flex-1 skeleton rounded-full" />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {/* Mobile search icon */}
            <div className="sm:hidden h-5 w-5 skeleton rounded" />
            {/* Language toggle */}
            <div className="h-4 w-8 skeleton rounded" />
            {/* Cart */}
            <div className="h-5 w-5 skeleton rounded" />
          </div>
        </div>

        {/* Mobile search bar - below header on mobile */}
        <div className="sm:hidden px-4 pb-3">
          <div className="h-10 w-full skeleton rounded-full" />
        </div>
      </header>

      {/* Stats bar skeleton */}
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <div className="h-3 w-32 skeleton rounded" />
        <div className="h-3 w-16 skeleton rounded" />
      </div>

      {/* Grid skeleton - responsive columns matching actual grid */}
      <div className="px-0.5">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-0.5">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square skeleton"
              style={{
                animationDelay: `${(i % 8) * 0.1}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
