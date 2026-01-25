// Seline Analytics Utility
// https://seline.so/docs/custom-events

declare global {
  interface Window {
    seline?: {
      track: (event: string, properties?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Track a custom event with Seline
 * Event naming convention: "object: action"
 */
export function track(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && window.seline) {
    window.seline.track(event, properties);
  }
}

/**
 * Get referrer context from URL params (utm_source, utm_medium) or document.referrer.
 * Returns an object to spread into event properties for source attribution.
 */
export function getReferrerContext(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const utm_source = params.get('utm_source');
  const utm_medium = params.get('utm_medium');
  if (utm_source) {
    return { source: utm_source, ...(utm_medium ? { medium: utm_medium } : {}) };
  }
  // Fallback: parse document.referrer
  try {
    const ref = document.referrer;
    if (!ref) return { source: 'direct' };
    const host = new URL(ref).hostname;
    if (host.includes('instagram')) return { source: 'instagram', medium: 'social' };
    if (host.includes('linkedin')) return { source: 'linkedin', medium: 'social' };
    if (host.includes('facebook') || host.includes('fb.com')) return { source: 'facebook', medium: 'social' };
    if (host.includes('google')) return { source: 'google', medium: 'search' };
    return { source: host };
  } catch {
    return { source: 'unknown' };
  }
}

// Pre-defined events for consistency
export const events = {
  // Photo interactions
  photoViewed: (photoId: string, photoName: string | null) =>
    track('photo: viewed', { photoId, photoName, ...getReferrerContext() }),

  photoDownloaded: (photoId: string, photoName: string | null) =>
    track('photo: downloaded', { photoId, photoName }),

  photoShared: (photoId: string, photoName: string | null) =>
    track('photo: shared', { photoId, photoName }),

  captionCopied: (photoId: string) =>
    track('photo: caption copied', { photoId }),

  // Search
  searchPerformed: (query: string, mode: string, resultCount: number) =>
    track('search: performed', { query, mode, resultCount, ...getReferrerContext() }),

  // Track "final" search after user stops typing for 1.5s - use this for business metrics
  searchCommitted: (query: string, mode: string, resultCount: number) =>
    track('search: committed', { query, mode, resultCount }),

  // Track when search returns no results - important for content gaps
  searchNoResults: (query: string, mode: string) =>
    track('search: no results', { query, mode }),

  // Track which search result position was clicked - helps optimize ranking
  searchResultClicked: (query: string, position: number, photoId: string) =>
    track('search: result clicked', { query, position, photoId }),

  searchCleared: () =>
    track('search: cleared'),

  searchModeChanged: (mode: string) =>
    track('search: mode changed', { mode }),

  // Navigation / Discovery
  loadMoreClicked: (currentCount: number) =>
    track('gallery: load more', { currentCount }),

  shuffleClicked: () =>
    track('gallery: shuffle clicked', { ...getReferrerContext() }),

  neighborhoodShortcutClicked: (neighborhood: string) =>
    track('gallery: neighborhood shortcut clicked', { neighborhood, ...getReferrerContext() }),

  // Photo page modes
  orderModeEntered: (photoId: string) =>
    track('photo: order mode entered', { photoId, ...getReferrerContext() }),

  orderModeExited: (photoId: string, addedToCart: boolean) =>
    track('photo: order mode exited', { photoId, addedToCart }),

  languageChanged: (from: string, to: string) =>
    track('settings: language changed', { from, to }),

  aboutOpened: () =>
    track('about: opened'),

  // E-commerce (print orders)
  roomBackgroundChanged: (roomId: string) =>
    track('print: room preview changed', { roomId }),

  printSizeSelected: (size: string, price: number) =>
    track('print: size selected', { size, price }),

  printFrameSelected: (frame: string, price: number) =>
    track('print: frame selected', { frame, price }),

  addToCartClicked: (photoId: string, size: string, frame: string, totalPrice: number) =>
    track('cart: item added', { photoId, size, frame, totalPrice, ...getReferrerContext() }),

  cartOpened: () =>
    track('cart: opened'),

  cartItemRemoved: (photoId: string) =>
    track('cart: item removed', { photoId }),

  cartCleared: (itemCount: number) =>
    track('cart: cleared', { itemCount }),

  checkoutClicked: (total: number, itemCount: number) =>
    track('cart: checkout clicked', { total, itemCount }),

  checkoutCompleted: (orderId: string, total: number, itemCount: number) =>
    track('order: completed', { orderId, total, itemCount }),

  checkoutFailed: (error: string) =>
    track('order: failed', { error }),

  // External links
  archiveLinkClicked: (url: string) =>
    track('link: archives clicked', { url }),

  instagramClicked: () =>
    track('link: instagram clicked'),

  facebookClicked: () =>
    track('link: facebook clicked'),

  // === Landing & Bounce Intelligence ===

  // Fires when visitor comes from Instagram (utm_source or referrer)
  instagramVisitorLanded: (utmCampaign?: string) =>
    track('instagram: visitor landed', { utmCampaign }),

  // Fires once per session when the page becomes interactive
  pageLoaded: (loadTimeMs: number) =>
    track('page: loaded', { loadTimeMs, ...getReferrerContext() }),

  // Fires once: what was the very first thing the visitor did?
  pageFirstInteraction: (action: string) =>
    track('page: first interaction', { action, ...getReferrerContext() }),

  // Fires at 25/50/75/100% scroll depth (gallery)
  pageScrollDepth: (percent: number) =>
    track('page: scroll depth', { percent }),

  // === Photo Engagement Depth ===

  // Fires when user stays on photo page for >5s (meaningful engagement)
  photoDwelled: (photoId: string, dwellTimeMs: number) =>
    track('photo: dwelled', { photoId, dwellTimeMs }),

  // === Search Quality ===

  // User modified existing query (refined vs new search)
  searchRefined: (previousQuery: string, newQuery: string, mode: string) =>
    track('search: refined', { previousQuery, newQuery, mode }),

  // User had search results but left without clicking any
  searchAbandoned: (query: string, mode: string, resultCount: number) =>
    track('search: abandoned', { query, mode, resultCount }),

  // === Session Classification ===

  // Fires on beforeunload — classifies what type of session this was
  sessionEnded: (type: string, eventCount: number, durationMs: number) =>
    track('session: ended', { type, eventCount, durationMs, ...getReferrerContext() }),
};
