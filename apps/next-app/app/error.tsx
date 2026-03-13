'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('App error:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-background px-5 py-12 sm:px-12">
      <div className="mx-auto flex min-h-[75vh] max-w-3xl flex-col items-center justify-center text-center">
        <p className="mono-metric text-[11px] text-primary">mtl archives</p>
        <h1 className="text-display mt-5 text-[3rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[4.2rem]">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          We encountered an unexpected error. Please try again.
        </p>

        <button
          onClick={reset}
          className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/92"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
