export default function Loading() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header skeleton */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm border-b border-neutral-100">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="h-5 w-16 bg-neutral-200 rounded animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 bg-neutral-200 rounded animate-pulse" />
            <div className="h-5 w-5 bg-neutral-200 rounded animate-pulse" />
          </div>
        </div>
      </header>

      {/* Main content skeleton */}
      <main className="pt-12">
        {/* Hero image skeleton */}
        <div className="relative bg-neutral-100">
          <div className="max-w-5xl mx-auto">
            <div
              className="w-full bg-neutral-200 animate-pulse"
              style={{ aspectRatio: '4/3', maxHeight: '70vh' }}
            />
          </div>
        </div>

        {/* Info section skeleton */}
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Title */}
          <div className="mb-4">
            <div className="h-6 w-3/4 bg-neutral-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-24 bg-neutral-100 rounded animate-pulse" />
          </div>

          {/* Description */}
          <div className="space-y-2 mb-8">
            <div className="h-4 w-full bg-neutral-100 rounded animate-pulse" />
            <div className="h-4 w-5/6 bg-neutral-100 rounded animate-pulse" />
            <div className="h-4 w-4/6 bg-neutral-100 rounded animate-pulse" />
          </div>

          {/* Order button */}
          <div className="h-12 w-full bg-neutral-100 rounded-full animate-pulse" />

          {/* Credits */}
          <div className="mt-12 pt-6 border-t border-neutral-100 flex justify-center">
            <div className="h-3 w-48 bg-neutral-100 rounded animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
