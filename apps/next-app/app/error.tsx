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
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-light mb-2">Something went wrong</h2>
        <p className="text-neutral-500 text-sm mb-6">
          We encountered an unexpected error. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-neutral-900 text-white text-xs uppercase tracking-wide hover:bg-neutral-800 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
