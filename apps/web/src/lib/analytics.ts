// Seline Analytics for MTL Archives Explorer
// https://seline.so/docs/custom-events

declare global {
  interface Window {
    seline?: {
      track: (event: string, properties?: Record<string, unknown>) => void;
    };
  }
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && window.seline) {
    window.seline.track(event, properties);
  }
}

export const events = {
  // Search
  searchPerformed: (query: string, mode: 'text' | 'visual', resultCount: number) =>
    track('explorer: search', { query, mode, resultCount }),

  // View mode
  viewModeChanged: (mode: '2d' | '3d') =>
    track('explorer: view changed', { mode }),

  // Visual search
  visualSearchEnabled: () =>
    track('explorer: visual search enabled'),

  // Photo interactions
  photoClicked: (photoId: string) =>
    track('explorer: photo clicked', { photoId }),

  photoHovered: (photoId: string) =>
    track('explorer: photo hovered', { photoId }),

  // Navigation
  fullscreenToggled: (isFullscreen: boolean) =>
    track('explorer: fullscreen', { isFullscreen }),

  helpOpened: () =>
    track('explorer: help opened'),

  // External
  mainSiteClicked: () =>
    track('explorer: main site clicked'),
};
