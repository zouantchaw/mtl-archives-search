'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Map, { Marker, NavigationControl, type ViewStateChangeEvent, type MarkerEvent } from 'react-map-gl/mapbox';
import { Search, X, MapPin, Calendar, ExternalLink, ChevronLeft } from 'lucide-react';
import Image from 'next/image';
import type { MapPin as MapPinType, MapPinsResponse } from '@/lib/types';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [pins, setPins] = useState<MapPinType[]>([]);
  const [selectedPin, setSelectedPin] = useState<MapPinType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchPins() {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/map`);
        if (!res.ok) throw new Error(`Failed to fetch pins: ${res.status}`);
        const data: MapPinsResponse = await res.json();
        setPins(data.pins);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch map pins:', err);
        setError(err instanceof Error ? err.message : 'Failed to load map data');
      } finally {
        setLoading(false);
      }
    }
    fetchPins();
  }, []);

  const handleMarkerClick = useCallback((pin: MapPinType) => {
    setSelectedPin(pin);
    setViewState((prev) => ({
      ...prev,
      latitude: pin.latitude,
      longitude: pin.longitude,
      zoom: Math.max(prev.zoom, 15),
    }));
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedPin(null);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  const filteredPins = searchQuery
    ? pins.filter((pin) =>
        pin.name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : pins;

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

  return (
    <div className="relative h-[100dvh] w-full bg-neutral-950">
      {/* ========== DESKTOP HEADER (hidden on mobile) ========== */}
      <header className="
        hidden md:flex
        absolute top-0 left-0 right-0 z-20
        h-16 items-center justify-between
        bg-neutral-950/90 backdrop-blur-xl
        border-b border-white/10
        px-6
      ">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500">
            <MapPin className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">MTL Archives</h1>
            <p className="text-xs text-neutral-400">Historical Montreal</p>
          </div>
        </div>

        {/* Desktop Search */}
        <div className="flex-1 max-w-md mx-8">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="
                h-10 w-full rounded-lg
                bg-neutral-800/50 border-neutral-700
                pl-10 pr-10
                text-sm text-white placeholder:text-neutral-500
                focus-visible:border-neutral-600 focus-visible:ring-neutral-600
              "
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-white/10"
              >
                <X className="h-4 w-4 text-neutral-400" />
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>
            {loading ? 'Loading...' : error ? 'Error' : `${filteredPins.length} locations`}
          </span>
        </div>
      </header>

      {/* ========== MOBILE FLOATING SEARCH (hidden on desktop) ========== */}
      <div
        className="
          md:hidden
          absolute left-4 right-4 z-10
          transition-all duration-200
        "
        style={{
          top: `calc(env(safe-area-inset-top) + ${isSearchFocused ? '0.5rem' : '1rem'})`,
        }}
      >
        <div className={`
          flex items-center gap-3 px-4 py-3
          rounded-2xl
          bg-neutral-900/80 backdrop-blur-xl
          border border-white/10
          shadow-[0_8px_32px_rgba(0,0,0,0.4)]
          transition-all duration-200
          ${isSearchFocused ? 'bg-neutral-900/95 border-white/20' : ''}
        `}>
          <Search className="h-5 w-5 shrink-0 text-neutral-400" />
          <input
            type="text"
            placeholder="Search historical photos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className="
              flex-1 bg-transparent
              text-base text-white placeholder:text-neutral-500
              outline-none
            "
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="shrink-0 rounded-full p-1 hover:bg-white/10 active:bg-white/20"
            >
              <X className="h-4 w-4 text-neutral-400" />
            </button>
          )}
        </div>
      </div>

      {/* ========== MAP ========== */}
      <div className="absolute inset-0 md:top-16">
        <Map
          {...viewState}
          onMove={(evt: ViewStateChangeEvent) => setViewState(evt.viewState)}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          attributionControl={false}
          touchPitch={false}
          onClick={() => setSelectedPin(null)}
        >
          <NavigationControl position="bottom-right" showCompass={false} />

          {filteredPins.map((pin) => (
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
                    relative h-3 w-3 rounded-full border-2 border-white
                    shadow-[0_2px_8px_rgba(0,0,0,0.4)]
                    transition-all duration-200 ease-out
                    group-hover:scale-150 group-active:scale-125
                    ${selectedPin?.id === pin.id
                      ? 'scale-150 bg-amber-400'
                      : 'bg-rose-500 group-hover:bg-rose-400'
                    }
                  `}
                >
                  {selectedPin?.id === pin.id && (
                    <div className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-75" />
                  )}
                </div>
              </button>
            </Marker>
          ))}
        </Map>
      </div>

      {/* ========== MOBILE: Stats & Branding (hidden on desktop) ========== */}
      <div
        className="md:hidden absolute left-4 z-10 pointer-events-none"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div className="
          flex items-center gap-2 rounded-full
          bg-neutral-900/80 backdrop-blur-xl
          border border-white/10
          px-3 py-1.5
          shadow-lg
          pointer-events-auto
        ">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-white">
            {loading ? 'Loading...' : `${filteredPins.length} locations`}
          </span>
        </div>
      </div>

      <div
        className="md:hidden absolute right-4 z-10 pointer-events-none"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div className="text-right">
          <h1 className="text-sm font-bold text-white drop-shadow-lg">MTL Archives</h1>
        </div>
      </div>

      {/* ========== DESKTOP: Side Panel (hidden on mobile) ========== */}
      <aside
        className={`
          hidden md:flex flex-col
          absolute top-16 right-0 bottom-0 z-10
          w-96
          bg-neutral-950/95 backdrop-blur-xl
          border-l border-white/10
          transition-transform duration-300 ease-out
          ${selectedPin ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {selectedPin && (
          <>
            {/* Panel Header */}
            <div className="flex items-center gap-3 p-4 border-b border-white/10">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCloseDetail}
                className="shrink-0 text-neutral-400 hover:text-white hover:bg-white/10"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="text-sm font-medium text-neutral-400">Photo Details</span>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Image */}
              <div className="relative aspect-[4/3] bg-neutral-800">
                {selectedPin.imageUrl ? (
                  <Image
                    src={selectedPin.imageUrl}
                    alt={selectedPin.name || 'Archive photo'}
                    fill
                    className="object-cover"
                    sizes="400px"
                    priority
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <MapPin className="h-12 w-12 text-neutral-600" />
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="p-5">
                <h2 className="text-lg font-semibold text-white leading-snug">
                  {selectedPin.name || 'Untitled Photo'}
                </h2>
                {selectedPin.dateValue && (
                  <p className="mt-2 flex items-center gap-2 text-sm text-neutral-400">
                    <Calendar className="h-4 w-4" />
                    {selectedPin.dateValue}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-6 flex flex-col gap-3">
                  <Button
                    className="h-11 w-full rounded-lg bg-white text-neutral-900 hover:bg-neutral-100"
                    onClick={() => console.log('View details:', selectedPin.id)}
                  >
                    View Full Details
                  </Button>
                  {selectedPin.externalUrl && (
                    <Button
                      variant="outline"
                      className="h-11 w-full rounded-lg border-white/20 text-white hover:bg-white/10"
                      asChild
                    >
                      <a
                        href={selectedPin.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View Original Source
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ========== MOBILE: Bottom Sheet (hidden on desktop) ========== */}
      <div className="md:hidden">
        <Drawer
          open={!!selectedPin}
          onOpenChange={(open) => !open && handleCloseDetail()}
        >
          <DrawerContent className="mx-auto max-w-lg rounded-t-3xl border-white/10 bg-neutral-900">
            {/* Drag Handle */}
            <div className="flex justify-center pt-4 pb-2">
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>

            {selectedPin && (
              <div className="flex flex-col">
                {/* Image */}
                <div className="relative mx-4 aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-800">
                  {selectedPin.imageUrl ? (
                    <Image
                      src={selectedPin.imageUrl}
                      alt={selectedPin.name || 'Archive photo'}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 500px"
                      priority
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <MapPin className="h-12 w-12 text-neutral-600" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h2 className="text-lg font-semibold text-white">
                    {selectedPin.name || 'Untitled Photo'}
                  </h2>
                  {selectedPin.dateValue && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-neutral-400">
                      <Calendar className="h-3.5 w-3.5" />
                      {selectedPin.dateValue}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-5 flex gap-3">
                    <Button
                      className="h-12 flex-1 rounded-xl bg-white text-neutral-900 hover:bg-neutral-100"
                      onClick={() => console.log('View details:', selectedPin.id)}
                    >
                      View Full Details
                    </Button>
                    {selectedPin.externalUrl && (
                      <Button
                        variant="outline"
                        className="h-12 w-12 shrink-0 rounded-xl border-white/20 bg-white/5 hover:bg-white/10"
                        asChild
                      >
                        <a
                          href={selectedPin.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View original source"
                        >
                          <ExternalLink className="h-5 w-5 text-white" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Safe area */}
                <div style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }} />
              </div>
            )}
          </DrawerContent>
        </Drawer>
      </div>

      {/* ========== Loading Overlay ========== */}
      {loading && pins.length === 0 && (
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
