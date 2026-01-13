export default function Loading() {
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Header skeleton - fixed position like actual header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fafafa]/90 backdrop-blur-sm border-b border-neutral-100">
        <div className="flex items-center justify-between h-12 px-4">
          {/* Back button */}
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="hidden sm:block h-4 w-12 skeleton rounded" />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 skeleton rounded" />
            <div className="h-5 w-5 skeleton rounded" />
          </div>
        </div>
      </header>

      {/* Main content with proper spacing */}
      <main className="pt-12">
        {/* Hero image skeleton - constrained like actual image */}
        <div className="relative bg-neutral-50">
          <div className="max-w-5xl mx-auto">
            <div
              className="w-full skeleton"
              style={{
                aspectRatio: '4/3',
                maxHeight: '70vh',
              }}
            />
          </div>
        </div>

        {/* Info section skeleton - matches actual layout */}
        <div className="max-w-2xl mx-auto px-4 py-8">
          {/* Title */}
          <div className="mb-4">
            <div className="h-6 sm:h-7 w-4/5 skeleton rounded mb-2" />
            <div className="h-4 w-24 skeleton rounded" />
          </div>

          {/* Description - multiple lines */}
          <div className="space-y-2 mb-8">
            <div className="h-4 w-full skeleton rounded" />
            <div className="h-4 w-11/12 skeleton rounded" />
            <div className="h-4 w-3/4 skeleton rounded" />
          </div>

          {/* Order button */}
          <div className="h-12 w-full skeleton rounded-full" />

          {/* Credits */}
          <div className="mt-12 pt-6 border-t border-neutral-100 flex justify-center">
            <div className="h-3 w-44 skeleton rounded" />
          </div>
        </div>
      </main>
    </div>
  );
}
