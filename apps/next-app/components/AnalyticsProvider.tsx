'use client';

import { Analytics } from '@vercel/analytics/next';

export function AnalyticsProvider() {
  return (
    <Analytics
      beforeSend={(event) => {
        if (event.url.includes('/api/thumb')) return null;
        return event;
      }}
    />
  );
}
