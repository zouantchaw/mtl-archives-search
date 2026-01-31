'use client';

import { useEffect, useState } from 'react';
import { getAbVariant } from '@/lib/experiments';

/**
 * Emits feature flag values to the DOM via a <script data-flag-values> tag.
 * Vercel Web Analytics automatically picks these up and annotates all
 * page views and custom events with the flag values.
 *
 * @see https://vercel.com/docs/feature-flags/flags-explorer/reference#values
 */
export function FlagValues() {
  const [flags, setFlags] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const variant = getAbVariant();
    if (variant) {
      setFlags({ 'game-variant': variant });
    }
  }, []);

  if (!flags) return null;

  return (
    <script
      type="application/json"
      data-flag-values
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(flags).replace(/</g, '\\u003c'),
      }}
    />
  );
}
