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

// Pre-defined events for consistency
export const events = {
  // Photo interactions
  photoViewed: (photoId: string, photoName: string | null) =>
    track('photo: viewed', { photoId, photoName }),

  photoDownloaded: (photoId: string, photoName: string | null) =>
    track('photo: downloaded', { photoId, photoName }),

  photoShared: (photoId: string, photoName: string | null) =>
    track('photo: shared', { photoId, photoName }),

  captionCopied: (photoId: string) =>
    track('photo: caption copied', { photoId }),

  // Search
  searchPerformed: (query: string, mode: string, resultCount: number) =>
    track('search: performed', { query, mode, resultCount }),

  searchCleared: () =>
    track('search: cleared'),

  searchModeChanged: (mode: string) =>
    track('search: mode changed', { mode }),

  // Navigation / Discovery
  loadMoreClicked: (currentCount: number) =>
    track('gallery: load more', { currentCount }),

  shuffleClicked: () =>
    track('gallery: shuffle clicked'),

  // Photo page modes
  orderModeEntered: (photoId: string) =>
    track('photo: order mode entered', { photoId }),

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
    track('cart: item added', { photoId, size, frame, totalPrice }),

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
  archiveLinkClicked: (photoId: string, url: string) =>
    track('link: archives clicked', { photoId, url }),

  instagramClicked: () =>
    track('link: instagram clicked'),

  facebookClicked: () =>
    track('link: facebook clicked'),
};
