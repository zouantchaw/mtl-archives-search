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

/**
 * Extract a 4-digit year from a dateValue string like "1937-06-15" or "circa 1920".
 */
function extractYear(dateValue: string | null | undefined): string | null {
  if (!dateValue) return null;
  const match = dateValue.match(/\d{4}/);
  return match ? match[0] : null;
}

// Pre-defined events for consistency
export const events = {
  // === Photo interactions ===

  photoViewed: (photoId: string, photoName: string | null, data?: { searchQuery?: string; position?: number; dateValue?: string | null }) =>
    track('photo_viewed', {
      photoId,
      photoName,
      ...(data?.searchQuery ? { searchQuery: data.searchQuery } : {}),
      ...(data?.position !== undefined ? { position: data.position } : {}),
      ...(extractYear(data?.dateValue) ? { year: extractYear(data?.dateValue) } : {}),
      ...getReferrerContext(),
    }),

  photoDownloaded: (photoId: string, photoName: string | null) =>
    track('photo_downloaded', { photoId, photoName }),

  photoShared: (photoId: string, photoName: string | null) =>
    track('photo_shared', { photoId, photoName }),

  captionCopied: (photoId: string) =>
    track('photo_caption_copied', { photoId }),

  photoDwelled: (photoId: string, dwellTimeMs: number, data?: { dateValue?: string | null }) =>
    track('photo_dwelled', {
      photoId,
      dwellTimeMs,
      ...(extractYear(data?.dateValue) ? { year: extractYear(data?.dateValue) } : {}),
    }),

  photoZoomed: (photoId: string, data?: { dateValue?: string | null }) =>
    track('photo_zoomed', {
      photoId,
      ...(extractYear(data?.dateValue) ? { year: extractYear(data?.dateValue) } : {}),
    }),

  photoNavigated: (photoId: string, direction: 'prev' | 'next') =>
    track('photo_navigated', { photoId, direction }),

  // === Search ===
  // Only track committed searches (after user stops typing)

  searchCommitted: (query: string, mode: string, resultCount: number, lang?: string) =>
    track('search_committed', { query, mode, resultCount, ...(lang ? { lang } : {}) }),

  searchNoResults: (query: string, mode: string, lang?: string) =>
    track('search_no_results', { query, mode, ...(lang ? { lang } : {}) }),

  searchResultClicked: (query: string, position: number, photoId: string, resultCount?: number) =>
    track('search_result_clicked', {
      query,
      position,
      photoId,
      ...(resultCount !== undefined ? { resultCount } : {}),
    }),

  searchCleared: () =>
    track('search_cleared'),

  searchModeChanged: (mode: string) =>
    track('search_mode_changed', { mode }),

  searchRefined: (previousQuery: string, newQuery: string, mode: string) =>
    track('search_refined', { previousQuery, newQuery, mode }),

  searchAbandoned: (query: string, mode: string, resultCount: number) =>
    track('search_abandoned', { query, mode, resultCount }),

  // === Navigation / Discovery ===

  loadMoreClicked: (currentCount: number) =>
    track('gallery_load_more', { currentCount }),

  shuffleClicked: () =>
    track('gallery_shuffle', { ...getReferrerContext() }),

  neighborhoodShortcutClicked: (neighborhood: string) =>
    track('neighborhood_shortcut', { neighborhood, ...getReferrerContext() }),

  // === Photo page modes ===

  orderModeEntered: (photoId: string) =>
    track('order_mode_entered', { photoId, ...getReferrerContext() }),

  orderModeExited: (photoId: string, addedToCart: boolean) =>
    track('order_mode_exited', { photoId, addedToCart }),

  languageChanged: (from: string, to: string) =>
    track('language_changed', { from, to }),

  aboutOpened: () =>
    track('about_opened'),

  // === E-commerce (print orders) ===

  roomBackgroundChanged: (roomId: string) =>
    track('print_room_changed', { roomId }),

  printSizeSelected: (size: string, price: number) =>
    track('print_size_selected', { size, price }),

  printFrameSelected: (frame: string, price: number) =>
    track('print_frame_selected', { frame, price }),

  addToCartClicked: (photoId: string, size: string, frame: string, totalPrice: number, data?: { dateValue?: string | null }) =>
    track('cart_item_added', {
      photoId,
      size,
      frame,
      totalPrice,
      ...(extractYear(data?.dateValue) ? { year: extractYear(data?.dateValue) } : {}),
      ...getReferrerContext(),
    }),

  cartOpened: () =>
    track('cart_opened'),

  cartItemRemoved: (photoId: string) =>
    track('cart_item_removed', { photoId }),

  cartCleared: (itemCount: number) =>
    track('cart_cleared', { itemCount }),

  checkoutClicked: (total: number, itemCount: number) =>
    track('checkout_clicked', { total, itemCount }),

  checkoutCompleted: (orderId: string, total: number, itemCount: number, itemSummary?: string) =>
    track('order_completed', {
      orderId,
      total,
      itemCount,
      ...(itemSummary ? { itemSummary } : {}),
    }),

  checkoutFailed: (error: string) =>
    track('order_failed', { error }),

  // === External links ===

  archiveLinkClicked: (url: string) =>
    track('link_archives', { url }),

  instagramClicked: () =>
    track('link_instagram'),

  facebookClicked: () =>
    track('link_facebook'),

  // === Landing & Bounce Intelligence ===

  instagramVisitorLanded: (utmCampaign?: string) =>
    track('instagram_visitor_landed', { utmCampaign }),

  pageLoaded: (loadTimeMs: number) =>
    track('page_loaded', { loadTimeMs, ...getReferrerContext() }),

  pageFirstInteraction: (action: string) =>
    track('page_first_interaction', { action, ...getReferrerContext() }),

  pageScrollDepth: (percent: number) =>
    track('page_scroll_depth', { percent }),

  // === Session Classification ===

  sessionEnded: (type: string, eventCount: number, durationMs: number) =>
    track('session_ended', { type, eventCount, durationMs, ...getReferrerContext() }),

  // === Game ===

  gameLanded: (variant?: string, mode?: string, data?: { returnVisitor?: boolean }) =>
    track('game_landed', {
      variant,
      mode,
      ...(data?.returnVisitor !== undefined ? { returnVisitor: data.returnVisitor } : {}),
      ...getReferrerContext(),
    }),

  gameModeChanged: (from: string, to: string) =>
    track('game_mode_changed', { from, to }),

  gamePinPlaced: (mode: string) =>
    track('game_pin_placed', { mode }),

  gameGuessSubmitted: (mode: string, photoId: string, signedIn: boolean) =>
    track('game_guess_submitted', { mode, photoId, signedIn }),

  gameGuessResult: (mode: string, score: number, distanceMeters: number, data?: { photoYear?: string | null }) =>
    track('game_guess_result', {
      mode,
      score,
      distanceMeters,
      ...(data?.photoYear ? { photoYear: data.photoYear } : {}),
    }),

  gameShareClicked: (mode: string, score: number) =>
    track('game_share_clicked', { mode, score }),

  gameLeaderboardToggled: (open: boolean) =>
    track('game_leaderboard_toggled', { open }),

  gameSignInCtaClicked: () =>
    track('game_sign_in_cta_clicked'),

  gameReturnToArchive: (photoId?: string) =>
    track('game_return_to_archive', { ...(photoId ? { photoId } : {}) }),

  // === Navigation & AB Testing ===

  gameNavClicked: () =>
    track('game_nav_clicked', { ...getReferrerContext() }),

  homeNavClicked: () =>
    track('home_nav_clicked'),

  abAssigned: (variant: string, source: string) =>
    track('ab_assigned', { experiment: 'home_to_game', variant, source }),

  abRedirected: (variant: string) =>
    track('ab_redirected', { experiment: 'home_to_game', variant }),
};
