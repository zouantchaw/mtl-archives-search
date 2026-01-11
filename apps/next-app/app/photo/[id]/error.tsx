'use client';

import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function PhotoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Photo page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-light mb-2">Photo unavailable</h2>
        <p className="text-neutral-500 text-sm mb-6">
          We couldn&apos;t load this photo. It may have been moved or deleted.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-neutral-100 text-neutral-900 text-xs uppercase tracking-wide hover:bg-neutral-200 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-6 py-2.5 bg-neutral-900 text-white text-xs uppercase tracking-wide hover:bg-neutral-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to gallery
          </Link>
        </div>
      </div>
    </div>
  );
}
