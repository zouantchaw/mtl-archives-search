'use client';

import { Analytics } from '@vercel/analytics/next';

export function AnalyticsProvider() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          const url = new URL(event.url);
          if (url.pathname.startsWith('/api/')) return null;
        } catch {
          if (event.url.startsWith('/api/')) return null;
        }
        return event;
      }}
    />
  );
}
