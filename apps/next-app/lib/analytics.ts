// Vercel Analytics Custom Events
// https://vercel.com/docs/analytics/custom-events

import { track } from '@vercel/analytics';

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
    track('photo_viewed', { photoId, photoName, ...getReferrerContext() }),

  photoDownloaded: (photoId: string, photoName: string | null) =>
    track('photo_downloaded', { photoId, photoName }),

  photoShared: (photoId: string, photoName: string | null) =>
    track('photo_shared', { photoId, photoName }),

  captionCopied: (photoId: string) =>
    track('photo_caption_copied', { photoId }),

  // Search - only track committed searches (after user stops typing)
  // This reduces event volume significantly vs tracking every keystroke
  searchCommitted: (query: string, mode: string, resultCount: number) =>
    track('search_committed', { query, mode, resultCount }),

  // Track when search returns no results - important for content gaps
  searchNoResults: (query: string, mode: string) =>
    track('search_no_results', { query, mode }),

  // Track which search result position was clicked - helps optimize ranking
  searchResultClicked: (query: string, position: number, photoId: string) =>
    track('search_result_clicked', { query, position, photoId }),

  searchCleared: () =>
    track('search_cleared'),

  searchModeChanged: (mode: string) =>
    track('search_mode_changed', { mode }),

  // Navigation / Discovery
  loadMoreClicked: (currentCount: number) =>
    track('gallery_load_more', { currentCount }),

  shuffleClicked: () =>
    track('gallery_shuffle', { ...getReferrerContext() }),

  neighborhoodShortcutClicked: (neighborhood: string) =>
    track('neighborhood_shortcut', { neighborhood, ...getReferrerContext() }),

  // Photo page modes
  orderModeEntered: (photoId: string) =>
    track('order_mode_entered', { photoId, ...getReferrerContext() }),

  orderModeExited: (photoId: string, addedToCart: boolean) =>
    track('order_mode_exited', { photoId, addedToCart }),

  languageChanged: (from: string, to: string) =>
    track('language_changed', { from, to }),

  aboutOpened: () =>
    track('about_opened'),

  // E-commerce (print orders)
  roomBackgroundChanged: (roomId: string) =>
    track('print_room_changed', { roomId }),

  printSizeSelected: (size: string, price: number) =>
    track('print_size_selected', { size, price }),

  printFrameSelected: (frame: string, price: number) =>
    track('print_frame_selected', { frame, price }),

  addToCartClicked: (photoId: string, size: string, frame: string, totalPrice: number) =>
    track('cart_item_added', { photoId, size, frame, totalPrice, ...getReferrerContext() }),

  cartOpened: () =>
    track('cart_opened'),

  cartItemRemoved: (photoId: string) =>
    track('cart_item_removed', { photoId }),

  cartCleared: (itemCount: number) =>
    track('cart_cleared', { itemCount }),

  checkoutClicked: (total: number, itemCount: number) =>
    track('checkout_clicked', { total, itemCount }),

  checkoutCompleted: (orderId: string, total: number, itemCount: number) =>
    track('order_completed', { orderId, total, itemCount }),

  checkoutFailed: (error: string) =>
    track('order_failed', { error }),

  // External links
  archiveLinkClicked: (url: string) =>
    track('link_archives', { url }),

  instagramClicked: () =>
    track('link_instagram'),

  facebookClicked: () =>
    track('link_facebook'),

  // === Landing & Bounce Intelligence ===

  // Fires when visitor comes from Instagram (utm_source or referrer)
  instagramVisitorLanded: (utmCampaign?: string) =>
    track('instagram_visitor_landed', { utmCampaign }),

  // Fires once per session when the page becomes interactive
  pageLoaded: (loadTimeMs: number) =>
    track('page_loaded', { loadTimeMs, ...getReferrerContext() }),

  // Fires once: what was the very first thing the visitor did?
  pageFirstInteraction: (action: string) =>
    track('page_first_interaction', { action, ...getReferrerContext() }),

  // Fires at 25/50/75/100% scroll depth (gallery)
  pageScrollDepth: (percent: number) =>
    track('page_scroll_depth', { percent }),

  // === Photo Engagement Depth ===

  // Fires when user stays on photo page for >5s (meaningful engagement)
  photoDwelled: (photoId: string, dwellTimeMs: number) =>
    track('photo_dwelled', { photoId, dwellTimeMs }),

  // === Search Quality ===

  // User modified existing query (refined vs new search)
  searchRefined: (previousQuery: string, newQuery: string, mode: string) =>
    track('search_refined', { previousQuery, newQuery, mode }),

  // User had search results but left without clicking any
  searchAbandoned: (query: string, mode: string, resultCount: number) =>
    track('search_abandoned', { query, mode, resultCount }),

  // === Session Classification ===

  // Fires on beforeunload — classifies what type of session this was
  sessionEnded: (type: string, eventCount: number, durationMs: number) =>
    track('session_ended', { type, eventCount, durationMs, ...getReferrerContext() }),
};
