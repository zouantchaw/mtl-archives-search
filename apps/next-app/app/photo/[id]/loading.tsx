export default function Loading() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header skeleton */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm border-b border-neutral-100">
        <div className="flex items-center justify-between h-12 px-4">
          {/* Back button */}
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="hidden sm:block h-4 w-14 skeleton rounded" />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="h-5 w-5 skeleton rounded" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="pt-12">
        {/* Hero image skeleton */}
        <div className="relative bg-neutral-100">
          <div className="max-w-5xl mx-auto">
            {/* Mobile: shorter aspect ratio, Desktop: wider */}
            <div
              className="w-full skeleton"
              style={{
                aspectRatio: '4/3',
                maxHeight: 'min(60vh, 500px)',
              }}
            />
          </div>
        </div>

        {/* Info section skeleton */}
        <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
          {/* Title skeleton */}
          <div className="mb-3">
            <div className="h-5 sm:h-6 w-3/4 skeleton rounded mb-2" />
            <div className="h-4 w-20 skeleton rounded" />
          </div>

          {/* Description skeleton - 2-3 lines */}
          <div className="space-y-2 mb-6">
            <div className="h-4 w-full skeleton rounded" />
            <div className="h-4 w-5/6 skeleton rounded" />
            <div className="h-4 w-2/3 skeleton rounded" />
          </div>

          {/* Order button skeleton */}
          <div className="h-12 w-full skeleton rounded-full" />

          {/* Credits skeleton */}
          <div className="mt-10 pt-5 border-t border-neutral-100 flex justify-center">
            <div className="h-3 w-40 skeleton rounded" />
          </div>
        </div>
      </main>
    </div>
  );
}
