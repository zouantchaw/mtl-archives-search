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

  captionCopied: (photoId: string) =>
    track('photo: caption copied', { photoId }),

  // Search
  searchPerformed: (query: string, mode: string, resultCount: number) =>
    track('search: performed', { query, mode, resultCount }),

  searchCleared: () =>
    track('search: cleared'),

  // Navigation
  loadMoreClicked: (currentCount: number) =>
    track('gallery: load more', { currentCount }),

  languageChanged: (from: string, to: string) =>
    track('settings: language changed', { from, to }),

  // E-commerce (print orders)
  printSizeSelected: (size: string, price: number) =>
    track('print: size selected', { size, price }),

  printFrameSelected: (frame: string, price: number) =>
    track('print: frame selected', { frame, price }),

  addToCartClicked: (photoId: string, size: string, frame: string, totalPrice: number) =>
    track('cart: item added', { photoId, size, frame, totalPrice }),

  // External links
  archiveLinkClicked: (photoId: string, url: string) =>
    track('link: archives clicked', { photoId, url }),

  instagramClicked: () =>
    track('link: instagram clicked'),
};
