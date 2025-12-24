'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Map, { Marker, NavigationControl, type ViewStateChangeEvent, type MarkerEvent } from 'react-map-gl/mapbox';
import { Search, X, MapPin, Calendar, ExternalLink, ChevronLeft, Eye, FileText, ImageIcon } from 'lucide-react';
import type { MapPin as MapPinType, MapPinsResponse, PhotoRecord, SearchResponse, SearchMode } from '@/lib/types';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const INITIAL_VIEW = {
  latitude: 45.5017,
  longitude: -73.5673,
  zoom: 12,
};

const API_BASE = '';

type ViewState = {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
};

export function ArchiveMap() {
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW);

  // Map pins (geolocated photos)
  const [pins, setPins] = useState<MapPinType[]>([]);
  const [pinsLoading, setPinsLoading] = useState(true);

  // Selected photo (for detail view)
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | MapPinType | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic');
  const [searchResults, setSearchResults] = useState<PhotoRecord[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // UI state
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load map pins on mount
  useEffect(() => {
    async function fetchPins() {
      try {
        setPinsLoading(true);
        const res = await fetch(`${API_BASE}/api/map`);
        if (!res.ok) throw new Error(`Failed to fetch pins: ${res.status}`);
        const data: MapPinsResponse = await res.json();
        setPins(data.pins);
      } catch (err) {
        console.error('Failed to fetch map pins:', err);
      } finally {
        setPinsLoading(false);
      }
    }
    fetchPins();
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      setHasSearched(true);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          mode: searchMode,
          limit: '50',
        });

        let res: Response;

        if (searchMode === 'visual') {
          // For visual search, first get CLIP embedding from local API
          const clipRes = await fetch('/api/clip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: searchQuery }),
          });

          if (!clipRes.ok) {
            console.error('CLIP embedding failed:', await clipRes.text());
            setSearchResults([]);
            return;
          }

          const { embedding } = await clipRes.json();

          // Then search with the embedding
          res = await fetch(`${API_BASE}/api/search?${params}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embedding }),
          });
        } else {
          // Semantic search - just use GET
          res = await fetch(`${API_BASE}/api/search?${params}`);
        }

        if (res.ok) {
          const data: SearchResponse = await res.json();
          setSearchResults(data.items);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchMode]);

  // Split search results into geolocated and non-geolocated
  const { geolocatedResults, nonGeolocatedResults } = useMemo(() => {
    const geo: PhotoRecord[] = [];
    const nonGeo: PhotoRecord[] = [];

    for (const result of searchResults) {
      if (result.latitude != null && result.longitude != null) {
        geo.push(result);
      } else {
        nonGeo.push(result);
      }
    }

    return { geolocatedResults: geo, nonGeolocatedResults: nonGeo };
  }, [searchResults]);

  // Get IDs of geolocated search results for highlighting
  const highlightedPinIds = useMemo(() => {
    return new Set(geolocatedResults.map(r => r.metadataFilename));
  }, [geolocatedResults]);

  // Determine which pins to show
  const displayPins = useMemo(() => {
    if (!hasSearched || searchResults.length === 0) {
      return pins;
    }
    // When searching, show all pins but highlight matches
    return pins;
  }, [pins, hasSearched, searchResults]);

  const handleMarkerClick = useCallback((pin: MapPinType) => {
    // Find full record from search results if available
    const fullRecord = searchResults.find(r => r.metadataFilename === pin.id);
    setSelectedPhoto(fullRecord || pin);
    setViewState((prev) => ({
      ...prev,
      latitude: pin.latitude,
      longitude: pin.longitude,
      zoom: Math.max(prev.zoom, 15),
    }));
  }, [searchResults]);

  const handleResultClick = useCallback((result: PhotoRecord) => {
    setSelectedPhoto(result);
    if (result.latitude != null && result.longitude != null) {
      setViewState((prev) => ({
        ...prev,
        latitude: result.latitude!,
        longitude: result.longitude!,
        zoom: Math.max(prev.zoom, 15),
      }));
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedPhoto(null);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
    searchInputRef.current?.focus();
  }, []);

  // Get thumbnail URL
  const getThumbnailUrl = useCallback((src: string, w = 320, h = 200) => {
    if (!src) return '';
    const params = new URLSearchParams({ src, w: String(w), h: String(h), fit: 'cover', format: 'auto', q: '75' });
    return `${API_BASE}/api/thumb?${params}`;
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-neutral-950 text-white">
        <div className="px-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800">
            <MapPin className="h-6 w-6 text-neutral-400" />
          </div>
          <h2 className="text-lg font-semibold">Map Unavailable</h2>
          <p className="mt-2 text-sm text-neutral-400">Missing map configuration</p>
        </div>
      </div>
    );
  }

  const showResultsPanel = hasSearched && (nonGeolocatedResults.length > 0 || geolocatedResults.length > 0);

  return (
    <div className="relative h-[100dvh] w-full bg-neutral-950">
      {/* ========== HEADER ========== */}
      <header
        className="absolute top-0 left-0 right-0 z-20 bg-neutral-950/90 backdrop-blur-xl border-b border-white/10"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3 md:px-6 md:py-4">
          {/* Logo - hidden on mobile when searching */}
          <div className={`flex items-center gap-2.5 shrink-0 ${isSearchFocused ? 'hidden md:flex' : 'flex'}`}>
            <div className="flex h-8 w-8 md:h-9 md:w-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-rose-600">
              <MapPin className="h-4 w-4 md:h-5 md:w-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold text-white">MTL Archives</h1>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-2xl">
            <div className={`
              flex items-center gap-2 px-3 py-2 md:px-4 md:py-2.5
              rounded-xl md:rounded-2xl
              bg-neutral-800/60 border border-white/10
              transition-all duration-200
              ${isSearchFocused ? 'bg-neutral-800/80 border-white/20 ring-1 ring-white/10' : ''}
            `}>
              <Search className="h-4 w-4 md:h-5 md:w-5 shrink-0 text-neutral-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search 14,822 historical photos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className="flex-1 bg-transparent text-sm md:text-base text-white placeholder:text-neutral-500 outline-none min-w-0"
              />
              {isSearching && (
                <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              )}
              {searchQuery && !isSearching && (
                <button
                  onClick={clearSearch}
                  className="shrink-0 p-1 rounded-full hover:bg-white/10 active:bg-white/20"
                >
                  <X className="h-4 w-4 text-neutral-400" />
                </button>
              )}
            </div>
          </div>

          {/* Search Mode Toggle */}
          <div className="hidden sm:flex items-center gap-1 p-1 rounded-xl bg-neutral-800/60 border border-white/10">
            <button
              onClick={() => setSearchMode('semantic')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                searchMode === 'semantic'
                  ? 'bg-white/15 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
              title="Text search using AI captions"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Text</span>
            </button>
            <button
              onClick={() => setSearchMode('visual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                searchMode === 'visual'
                  ? 'bg-white/15 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
              title="Visual search using image similarity"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Visual</span>
            </button>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-2 text-sm text-neutral-400">
            <div className={`h-2 w-2 rounded-full ${pinsLoading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            <span>{pins.length} on map</span>
          </div>
        </div>

        {/* Mobile Search Mode Toggle */}
        <div className="sm:hidden flex items-center gap-2 px-4 pb-3">
          <button
            onClick={() => setSearchMode('semantic')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
              searchMode === 'semantic'
                ? 'bg-white/15 text-white'
                : 'bg-neutral-800/60 text-neutral-400'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Text Search
          </button>
          <button
            onClick={() => setSearchMode('visual')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
              searchMode === 'visual'
                ? 'bg-white/15 text-white'
                : 'bg-neutral-800/60 text-neutral-400'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Visual Search
          </button>
        </div>
      </header>

      {/* ========== MAP ========== */}
      <div
        className="absolute inset-0"
        style={{ top: 'calc(env(safe-area-inset-top) + 7rem)', paddingTop: '0' }}
      >
        <Map
          {...viewState}
          onMove={(evt: ViewStateChangeEvent) => setViewState(evt.viewState)}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          attributionControl={false}
          touchPitch={false}
          onClick={() => setSelectedPhoto(null)}
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {displayPins.map((pin) => {
            const isHighlighted = highlightedPinIds.has(pin.id);
            const isSelected = selectedPhoto && 'id' in selectedPhoto && selectedPhoto.id === pin.id;

            return (
              <Marker
                key={pin.id}
                latitude={pin.latitude}
                longitude={pin.longitude}
                anchor="center"
                onClick={(e: MarkerEvent<MouseEvent>) => {
                  e.originalEvent.stopPropagation();
                  handleMarkerClick(pin);
                }}
              >
                <button
                  className="group relative flex items-center justify-center"
                  aria-label={`View ${pin.name || 'photo'}`}
                >
                  <div className="absolute h-11 w-11" />
                  <div
                    className={`
                      relative rounded-full border-2 border-white
                      shadow-[0_2px_8px_rgba(0,0,0,0.4)]
                      transition-all duration-200 ease-out
                      ${isSelected
                        ? 'h-5 w-5 bg-amber-400 scale-125'
                        : isHighlighted
                        ? 'h-4 w-4 bg-emerald-400 scale-110 ring-2 ring-emerald-400/50'
                        : hasSearched && searchResults.length > 0
                        ? 'h-2.5 w-2.5 bg-neutral-500 opacity-40'
                        : 'h-3 w-3 bg-rose-500 group-hover:scale-150 group-hover:bg-rose-400'
                      }
                    `}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-75" />
                    )}
                  </div>
                </button>
              </Marker>
            );
          })}
        </Map>
      </div>

      {/* ========== RESULTS PANEL (Desktop) ========== */}
      {showResultsPanel && (
        <aside className="
          hidden md:flex flex-col
          absolute z-10
          top-[calc(env(safe-area-inset-top)+5rem)] left-4 bottom-4
          w-96
          bg-neutral-900/95 backdrop-blur-xl
          border border-white/10 rounded-2xl
          overflow-hidden
        ">
          {/* Results Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div>
              <h2 className="text-sm font-semibold text-white">
                {searchResults.length} results
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                {geolocatedResults.length} on map · {nonGeolocatedResults.length} other
              </p>
            </div>
            <button
              onClick={clearSearch}
              className="p-2 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results List */}
          <div className="flex-1 overflow-y-auto">
            {/* On Map Section */}
            {geolocatedResults.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-emerald-500/10 border-b border-white/5">
                  <span className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    On Map ({geolocatedResults.length})
                  </span>
                </div>
                {geolocatedResults.map((result) => (
                  <ResultCard
                    key={result.metadataFilename}
                    result={result}
                    onClick={() => handleResultClick(result)}
                    getThumbnailUrl={getThumbnailUrl}
                    isSelected={!!(selectedPhoto && 'metadataFilename' in selectedPhoto && selectedPhoto.metadataFilename === result.metadataFilename)}
                  />
                ))}
              </div>
            )}

            {/* Not on Map Section */}
            {nonGeolocatedResults.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-neutral-800/50 border-b border-white/5">
                  <span className="text-xs font-medium text-neutral-400 flex items-center gap-1.5">
                    <ImageIcon className="h-3 w-3" />
                    Other Results ({nonGeolocatedResults.length})
                  </span>
                </div>
                {nonGeolocatedResults.map((result) => (
                  <ResultCard
                    key={result.metadataFilename}
                    result={result}
                    onClick={() => handleResultClick(result)}
                    getThumbnailUrl={getThumbnailUrl}
                    isSelected={!!(selectedPhoto && 'metadataFilename' in selectedPhoto && selectedPhoto.metadataFilename === result.metadataFilename)}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ========== RESULTS PANEL (Mobile) ========== */}
      {showResultsPanel && (
        <div
          className="md:hidden absolute left-0 right-0 z-10 bg-neutral-900/95 backdrop-blur-xl border-t border-white/10"
          style={{
            bottom: 0,
            maxHeight: '45vh',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Drag Handle */}
          <div className="flex justify-center py-2">
            <div className="h-1 w-10 rounded-full bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pb-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white">{searchResults.length} results</span>
              <span className="text-xs text-neutral-400">
                {geolocatedResults.length} on map
              </span>
            </div>
            <button onClick={clearSearch} className="p-1.5 rounded-lg hover:bg-white/10">
              <X className="h-4 w-4 text-neutral-400" />
            </button>
          </div>

          {/* Horizontal Scroll */}
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-3 px-4">
              {searchResults.map((result) => (
                <MobileResultCard
                  key={result.metadataFilename}
                  result={result}
                  onClick={() => handleResultClick(result)}
                  getThumbnailUrl={getThumbnailUrl}
                  isOnMap={result.latitude != null}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== DESKTOP: Side Panel for Selected Photo ========== */}
      <aside
        className={`
          hidden md:flex flex-col
          absolute top-[calc(env(safe-area-inset-top)+5rem)] right-4 bottom-4 z-10
          w-96
          bg-neutral-900/95 backdrop-blur-xl
          border border-white/10 rounded-2xl
          overflow-hidden
          transition-all duration-300 ease-out
          ${selectedPhoto ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0 pointer-events-none'}
        `}
      >
        {selectedPhoto && (
          <PhotoDetail
            photo={selectedPhoto}
            onClose={handleCloseDetail}
            getThumbnailUrl={getThumbnailUrl}
          />
        )}
      </aside>

      {/* ========== MOBILE: Bottom Sheet for Selected Photo ========== */}
      {isMobile && (
        <Drawer
          open={!!selectedPhoto}
          onOpenChange={(open) => !open && handleCloseDetail()}
        >
          <DrawerContent className="mx-auto max-w-lg rounded-t-3xl border-white/10 bg-neutral-900">
            <DrawerTitle className="sr-only">Photo Details</DrawerTitle>
            <div className="flex justify-center pt-4 pb-2">
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>
            {selectedPhoto && (
              <PhotoDetail
                photo={selectedPhoto}
                onClose={handleCloseDetail}
                getThumbnailUrl={getThumbnailUrl}
                isMobile
              />
            )}
          </DrawerContent>
        </Drawer>
      )}

      {/* ========== Loading Overlay ========== */}
      {pinsLoading && pins.length === 0 && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-950">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="mt-4 text-sm text-neutral-400">Loading map...</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Result Card Component (Desktop)
// ============================================================
function ResultCard({
  result,
  onClick,
  getThumbnailUrl,
  isSelected,
}: {
  result: PhotoRecord;
  onClick: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex gap-3 p-3 text-left
        border-b border-white/5
        transition-colors
        ${isSelected ? 'bg-white/10' : 'hover:bg-white/5'}
      `}
    >
      {/* Thumbnail */}
      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-neutral-800 shrink-0">
        {result.imageUrl ? (
          <img
            src={getThumbnailUrl(result.imageUrl, 64, 64)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-5 w-5 text-neutral-600" />
          </div>
        )}
        {result.score != null && (
          <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
            <span className="text-[10px] font-medium text-emerald-400">
              {(result.score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">
          {result.name || 'Untitled'}
        </p>
        {result.dateValue && (
          <p className="text-xs text-neutral-400 mt-0.5">{result.dateValue}</p>
        )}
        {result.vlmCaption && (
          <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{result.vlmCaption}</p>
        )}
      </div>
    </button>
  );
}

// ============================================================
// Mobile Result Card (Horizontal Scroll)
// ============================================================
function MobileResultCard({
  result,
  onClick,
  getThumbnailUrl,
  isOnMap,
}: {
  result: PhotoRecord;
  onClick: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
  isOnMap: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-32 text-left"
    >
      <div className="relative aspect-square rounded-xl overflow-hidden bg-neutral-800">
        {result.imageUrl ? (
          <img
            src={getThumbnailUrl(result.imageUrl, 128, 128)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-neutral-600" />
          </div>
        )}
        {isOnMap && (
          <div className="absolute top-1.5 left-1.5 p-1 rounded-md bg-emerald-500/90">
            <MapPin className="h-3 w-3 text-white" />
          </div>
        )}
        {result.score != null && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70">
            <span className="text-[10px] font-semibold text-emerald-400">
              {(result.score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-white mt-1.5 line-clamp-2">
        {result.name || 'Untitled'}
      </p>
    </button>
  );
}

// ============================================================
// Photo Detail Component
// ============================================================
function PhotoDetail({
  photo,
  onClose,
  getThumbnailUrl,
  isMobile = false,
}: {
  photo: PhotoRecord | MapPinType;
  onClose: () => void;
  getThumbnailUrl: (src: string, w?: number, h?: number) => string;
  isMobile?: boolean;
}) {
  const imageUrl = photo.imageUrl;
  const name = photo.name || 'Untitled Photo';
  const dateValue = photo.dateValue;
  const externalUrl = photo.externalUrl;
  const vlmCaption = 'vlmCaption' in photo ? photo.vlmCaption : null;
  const hasLocation = 'latitude' in photo && photo.latitude != null;

  return (
    <div className={`flex flex-col ${isMobile ? '' : 'h-full'}`}>
      {/* Header (desktop only) */}
      {!isMobile && (
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="shrink-0 text-neutral-400 hover:text-white hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium text-neutral-400">Photo Details</span>
        </div>
      )}

      {/* Content */}
      <div className={`${isMobile ? '' : 'flex-1 overflow-y-auto'}`}>
        {/* Image */}
        <div className={`relative bg-neutral-800 ${isMobile ? 'mx-4 rounded-2xl overflow-hidden aspect-[4/3]' : 'aspect-[4/3]'}`}>
          {imageUrl ? (
            <img
              src={getThumbnailUrl(imageUrl, 400, 300)}
              alt={name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <MapPin className="h-12 w-12 text-neutral-600" />
            </div>
          )}
          {hasLocation && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/90 text-white text-xs font-medium">
              <MapPin className="h-3 w-3" />
              On Map
            </div>
          )}
        </div>

        {/* Details */}
        <div className={isMobile ? 'p-4' : 'p-5'}>
          <h2 className="text-lg font-semibold text-white leading-snug">{name}</h2>

          {dateValue && (
            <p className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
              <Calendar className="h-4 w-4" />
              {dateValue}
            </p>
          )}

          {vlmCaption && (
            <p className="mt-3 text-sm text-neutral-300 leading-relaxed">
              {vlmCaption}
            </p>
          )}

          {/* Actions */}
          <div className={`mt-5 flex flex-col gap-3 ${isMobile ? 'mt-6' : ''}`}>
            <Button
              className={`w-full bg-white text-neutral-900 hover:bg-neutral-100 ${isMobile ? 'h-12 rounded-xl' : 'h-11 rounded-lg'}`}
              onClick={() => imageUrl && window.open(imageUrl, '_blank')}
            >
              View Full Image
            </Button>
            {externalUrl && (
              <Button
                variant="outline"
                className={`w-full border-white/20 text-white hover:bg-white/10 ${isMobile ? 'h-12 rounded-xl' : 'h-11 rounded-lg'}`}
                asChild
              >
                <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Original Source
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Safe area (mobile) */}
        {isMobile && <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }} />}
      </div>
    </div>
  );
}
