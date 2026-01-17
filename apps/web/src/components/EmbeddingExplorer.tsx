import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
import { AutoTokenizer, CLIPTextModelWithProjection, env as transformersEnv } from '@xenova/transformers';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clipEmbeddingCache } from '../lib/lru-cache';
import { events as analytics } from '../lib/analytics';

transformersEnv.allowLocalModels = false;

// Data URLs
const R2_BASE = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings';
const DATA_URL_2D = `${R2_BASE}/embeddings_2d.json`;
const DATA_URL_512D = `${R2_BASE}/embeddings_512d.bin`;
const DATA_URL_IDS = `${R2_BASE}/embeddings_ids.json`;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const API_ORIGIN = API_BASE_URL ? API_BASE_URL.replace(/\/$/, '') : '';

const SCALE = 1000;
const TRANSITION_MS = 600;
const HOVER_IMAGE_DELAY_MS = 200;

// Mobile detection
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
};

type Point = {
  id: string;
  x: number;
  y: number;
  z: number;
  name: string;
  date: string;
  image_url: string;
  vlm_caption: string;
  embeddingIndex: number;
};

type ScoredPoint = Point & {
  similarity: number;
  // Extra metadata from API search results
  description?: string;
  cote?: string;
  external_url?: string;
  credits?: string;
  latitude?: number;
  longitude?: number;
};

type SearchMode = 'visual' | 'semantic';

type ApiResult = {
  metadataFilename: string;
  name: string | null;
  dateValue: string | null;
  imageUrl: string;
  vlmCaption: string | null;
  description: string | null;
  cote: string | null;
  externalUrl: string | null;
  credits: string | null;
  latitude: number | null;
  longitude: number | null;
  score?: number;
};

// Extended photo type for detailed modal view
type PhotoDetail = {
  id: string;
  name: string;
  date: string;
  image_url: string;
  vlm_caption: string;
  description?: string;
  cote?: string;
  external_url?: string;
  credits?: string;
  latitude?: number;
  longitude?: number;
};

type ClipStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
type EmbeddingsStatus = 'idle' | 'loading' | 'ready' | 'error';
type ColorMode = 'date' | 'subject' | 'depth';

// Small thumbnails for result cards
function getThumbnailUrl(src: string): string {
  const params = new URLSearchParams({
    src,
    w: '320',
    h: '160',
    fit: 'cover',
    format: 'auto',
    q: '70',
  });
  return `${API_ORIGIN}/api/thumb?${params.toString()}`;
}

// Larger thumbnails for hover tooltips
function getHoverThumbnailUrl(src: string): string {
  const params = new URLSearchParams({
    src,
    w: '480',
    h: '320',
    fit: 'cover',
    format: 'auto',
    q: '80',
  });
  return `${API_ORIGIN}/api/thumb?${params.toString()}`;
}

// Larger optimized image for viewing (opens in new tab)
function getPreviewUrl(src: string): string {
  const params = new URLSearchParams({
    src,
    w: '1600',
    format: 'auto',
    q: '85',
  });
  return `${API_ORIGIN}/api/thumb?${params.toString()}`;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Convert year to Z position with jitter for organic 3D clustering
// Uses a compressed range (0-150) with random spread to avoid vertical columns
function yearToZ(dateStr: string | null | undefined, seed?: number): number {
  // Use seed for deterministic jitter (so same point always gets same jitter)
  const jitter = seed !== undefined
    ? ((seed * 9301 + 49297) % 233280) / 233280 // Seeded random 0-1
    : Math.random();

  const jitterAmount = 40; // How much random spread around the year position

  if (!dateStr) {
    // Unknown dates spread across middle with more jitter
    return 75 + (jitter - 0.5) * 80;
  }

  const year = parseInt(dateStr);
  if (isNaN(year)) {
    return 75 + (jitter - 0.5) * 80;
  }

  // Clamp to 1890-1990 range and map to 0-150 (compressed for spherical shape)
  const normalized = Math.max(0, Math.min(1, (year - 1890) / 100));
  const baseZ = normalized * 150;

  // Add jitter to prevent vertical columns
  return baseZ + (jitter - 0.5) * jitterAmount;
}

// Subject categories - these are search terms that get combined with user query
const SUBJECT_CATEGORIES = [
  { id: 'church', label: 'Churches', searchTerm: 'church cathedral', color: '#af52de' },
  { id: 'street', label: 'Streets', searchTerm: 'street avenue road', color: '#ff9500' },
  { id: 'building', label: 'Buildings', searchTerm: 'building architecture', color: '#0a84ff' },
  { id: 'people', label: 'People', searchTerm: 'people crowd portrait', color: '#ff3b30' },
  { id: 'vehicle', label: 'Vehicles', searchTerm: 'car automobile streetcar train', color: '#ffd60a' },
  { id: 'park', label: 'Parks', searchTerm: 'park garden nature trees', color: '#34c759' },
  { id: 'winter', label: 'Winter', searchTerm: 'snow winter ice', color: '#5ac8fa' },
  { id: 'aerial', label: 'Aerial', searchTerm: 'aerial view panorama skyline', color: '#ff6b6b' },
] as const;

// ============================================================
// UI Components
// ============================================================

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ImagePlaceholder() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/30">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return <div className={`${dims} border-2 border-white/20 border-t-white/80 rounded-full animate-spin`} />;
}

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function HelpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function FullscreenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function ExitFullscreenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3" />
      <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
      <path d="M3 16h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function FilterIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function ConstellationIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="12" cy="12" r="1.5" />
      <line x1="7.5" y1="7.5" x2="10.5" y2="10.5" />
      <line x1="13.5" y1="10.5" x2="16.5" y2="7.5" />
      <line x1="12" y1="13.5" x2="12" y2="16" />
    </svg>
  );
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function DiceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v1m0 16v1m-9-9h1m16 0h1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RotateIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

// Popular search suggestions
const POPULAR_SEARCHES = [
  { label: 'Churches', query: 'église church cathedral', icon: '⛪' },
  { label: 'Streets', query: 'rue street avenue', icon: '🛤️' },
  { label: 'Winter', query: 'hiver snow winter neige', icon: '❄️' },
  { label: 'Bridges', query: 'pont bridge', icon: '🌉' },
  { label: 'Parks', query: 'parc park jardin garden', icon: '🌳' },
  { label: 'Downtown', query: 'centre-ville downtown', icon: '🏙️' },
  { label: 'Old Montreal', query: 'vieux-montreal old montreal', icon: '🏛️' },
  { label: 'Tramways', query: 'tramway streetcar', icon: '🚃' },
] as const;

// Recent searches helper
const RECENT_SEARCHES_KEY = 'mtl-explorer-recent-searches';
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query: string) {
  if (typeof window === 'undefined' || !query.trim()) return;
  try {
    const recent = getRecentSearches().filter(q => q !== query);
    recent.unshift(query);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
  } catch {
    // Ignore storage errors
  }
}

function clearRecentSearches() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore
  }
}

// Export helpers for researchers
function exportToCSV(results: ScoredPoint[], query: string): void {
  const headers = ['ID', 'Name', 'Date', 'Description', 'Archive Cote', 'External URL', 'Image URL', 'Similarity Score', 'Latitude', 'Longitude'];
  const rows = results.map(r => [
    r.id,
    r.name || '',
    r.date || '',
    (r.vlm_caption || r.description || '').replace(/"/g, '""'),
    r.cote || '',
    r.external_url || '',
    r.image_url || '',
    r.similarity.toFixed(4),
    r.latitude?.toString() || '',
    r.longitude?.toString() || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mtl-archives-search-${query.replace(/\s+/g, '-').slice(0, 30)}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportToJSON(results: ScoredPoint[], query: string): void {
  const exportData = {
    query,
    exportDate: new Date().toISOString(),
    totalResults: results.length,
    results: results.map(r => ({
      id: r.id,
      name: r.name || null,
      date: r.date || null,
      description: r.vlm_caption || r.description || null,
      archiveCote: r.cote || null,
      externalUrl: r.external_url || null,
      imageUrl: r.image_url || null,
      similarityScore: r.similarity,
      coordinates: r.latitude && r.longitude ? { lat: r.latitude, lng: r.longitude } : null,
    })),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mtl-archives-search-${query.replace(/\s+/g, '-').slice(0, 30)}-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Collection/Favorites system for researchers
const COLLECTION_KEY = 'mtl-explorer-collection';

type CollectionItem = {
  id: string;
  name: string;
  date: string;
  image_url: string;
  vlm_caption: string;
  cote?: string;
  external_url?: string;
  addedAt: string;
};

function getCollection(): CollectionItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(COLLECTION_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToCollection(item: Omit<CollectionItem, 'addedAt'>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const collection = getCollection();
    if (collection.some(c => c.id === item.id)) {
      return false; // Already in collection
    }
    collection.unshift({ ...item, addedAt: new Date().toISOString() });
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
    return true;
  } catch {
    return false;
  }
}

function removeFromCollection(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const collection = getCollection().filter(c => c.id !== id);
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
  } catch {
    // Ignore
  }
}

function clearCollection(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(COLLECTION_KEY);
  } catch {
    // Ignore
  }
}

function exportCollection(collection: CollectionItem[]): void {
  const exportData = {
    exportDate: new Date().toISOString(),
    totalItems: collection.length,
    items: collection.map(c => ({
      id: c.id,
      name: c.name,
      date: c.date,
      description: c.vlm_caption,
      archiveCote: c.cote || null,
      externalUrl: c.external_url || null,
      imageUrl: c.image_url,
      addedToCollection: c.addedAt,
    })),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mtl-archives-collection-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Bookmark icon for collection
function BookmarkIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// Search suggestions component - shows when search is empty
function SearchSuggestions({
  onSearch,
  visible,
  recentSearches,
  onClearRecent,
}: {
  onSearch: (query: string) => void;
  visible: boolean;
  recentSearches: string[];
  onClearRecent: () => void;
}) {
  if (!visible) return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-2 z-50">
      <GlassPanel className="rounded-2xl p-4">
        {/* Recent searches */}
        {recentSearches.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/40 font-medium">Recent</p>
              <button
                onClick={onClearRecent}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((query) => (
                <button
                  key={query}
                  onClick={() => onSearch(query)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/60 hover:text-white transition-all flex items-center gap-1.5"
                >
                  <span className="text-white/30">🕐</span>
                  <span className="truncate max-w-[120px]">{query}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Popular searches */}
        <p className="text-xs text-white/40 mb-3 font-medium">Popular searches</p>
        <div className="flex flex-wrap gap-2">
          {POPULAR_SEARCHES.map(({ label, query, icon }) => (
            <button
              key={label}
              onClick={() => onSearch(query)}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-white/70 hover:text-white transition-all flex items-center gap-2 group"
            >
              <span className="text-base group-hover:scale-110 transition-transform">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

// Decade histogram timeline component
function DecadeTimeline({
  data,
  onDecadeClick,
  activeDecade,
}: {
  data: Point[];
  onDecadeClick: (decade: number | null) => void;
  activeDecade: number | null;
}) {
  // Calculate decade distribution
  const decadeCounts = useMemo(() => {
    const counts = new Map<number, number>();
    const decades = [1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990];
    decades.forEach(d => counts.set(d, 0));

    data.forEach(p => {
      if (p.date) {
        const year = parseInt(p.date);
        if (!isNaN(year)) {
          const decade = Math.floor(year / 10) * 10;
          if (decade >= 1890 && decade <= 1990) {
            counts.set(decade, (counts.get(decade) || 0) + 1);
          }
        }
      }
    });

    return decades.map(d => ({ decade: d, count: counts.get(d) || 0 }));
  }, [data]);

  const maxCount = Math.max(...decadeCounts.map(d => d.count), 1);

  // Color gradient based on decade
  const getDecadeColor = (decade: number): string => {
    const colors: Record<number, string> = {
      1890: '#ff6b35',
      1900: '#ff9500',
      1910: '#ffb700',
      1920: '#ffd60a',
      1930: '#d4e157',
      1940: '#8bc34a',
      1950: '#34c759',
      1960: '#00bcd4',
      1970: '#0a84ff',
      1980: '#5856d6',
      1990: '#af52de',
    };
    return colors[decade] || '#8e8e93';
  };

  return (
    <div className="flex items-end gap-1 h-12">
      {decadeCounts.map(({ decade, count }) => {
        const height = Math.max(4, (count / maxCount) * 40);
        const isActive = activeDecade === decade;

        return (
          <button
            key={decade}
            onClick={() => onDecadeClick(isActive ? null : decade)}
            className={`group relative flex flex-col items-center transition-all duration-200 ${
              isActive ? 'scale-110' : 'hover:scale-105'
            }`}
            title={`${decade}s: ${count.toLocaleString()} photos`}
          >
            <div
              className={`w-6 rounded-t-sm transition-all duration-200 ${
                isActive ? 'ring-2 ring-white/50' : 'opacity-70 group-hover:opacity-100'
              }`}
              style={{
                height: `${height}px`,
                backgroundColor: getDecadeColor(decade),
              }}
            />
            <span className={`text-[9px] mt-1 font-medium transition-colors ${
              isActive ? 'text-white' : 'text-white/40 group-hover:text-white/70'
            }`}>
              {String(decade).slice(2)}s
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Quick search panel - subject buttons trigger actual API searches
function QuickSearchPanel({
  show,
  onClose,
  activeSubject,
  onSubjectSearch,
  currentQuery,
}: {
  show: boolean;
  onClose: () => void;
  activeSubject: string | null;
  onSubjectSearch: (subjectId: string | null) => void;
  currentQuery: string;
}) {
  if (!show) return null;

  return (
    <GlassPanel className="fixed bottom-20 left-5 z-30 rounded-2xl p-4 w-[320px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Quick Search</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
          <CloseIcon size={16} />
        </button>
      </div>

      <p className="text-xs text-white/40 mb-3">Click a category to search. Combines with your current query.</p>

      {/* Subject chips - clicking triggers search */}
      <div className="flex flex-wrap gap-2">
        {SUBJECT_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => onSubjectSearch(activeSubject === cat.id ? null : cat.id)}
            className={`px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2 ${
              activeSubject === cat.id
                ? 'text-white ring-2 ring-white/40 shadow-lg'
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
            }`}
            style={{
              backgroundColor: activeSubject === cat.id ? `${cat.color}50` : undefined,
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
            {cat.label}
          </button>
        ))}
      </div>

      {activeSubject && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-white/50">
            Searching: <span className="text-white font-medium">
              {currentQuery || SUBJECT_CATEGORIES.find(c => c.id === activeSubject)?.searchTerm}
            </span>
          </p>
          <button
            onClick={() => onSubjectSearch(null)}
            className="text-xs text-blue-400 hover:text-blue-300 mt-1"
          >
            Clear filter
          </button>
        </div>
      )}
    </GlassPanel>
  );
}

// Collection panel to view saved photos
function CollectionPanel({
  show,
  onClose,
  collection,
  onRemove,
  onClear,
  onExport,
  onViewPhoto,
}: {
  show: boolean;
  onClose: () => void;
  collection: CollectionItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  onViewPhoto: (item: CollectionItem) => void;
}) {
  if (!show) return null;

  return (
    <GlassPanel variant="elevated" className="fixed bottom-20 right-5 z-30 rounded-2xl w-[360px] max-h-[60vh] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-gradient-to-b from-white/[0.02] to-transparent">
        <div>
          <div className="flex items-center gap-2">
            <BookmarkIcon size={16} filled />
            <p className="text-[15px] font-semibold text-white tracking-tight">My Collection</p>
            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-[12px] font-semibold text-amber-400 tabular-nums">{collection.length}</span>
          </div>
          <p className="text-[11px] text-white/35 mt-1 font-medium">Saved photos for your research</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/40 hover:text-white/80 transition-all duration-200"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      {collection.length === 0 ? (
        <div className="p-8 text-center">
          <BookmarkIcon size={32} />
          <p className="text-[14px] text-white/50 mt-3">No saved photos yet</p>
          <p className="text-[12px] text-white/30 mt-1">Click "Save" on any photo to add it here</p>
        </div>
      ) : (
        <>
          <div className="overflow-y-auto max-h-[40vh]">
            {collection.map((item) => (
              <div
                key={item.id}
                className="group px-5 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors cursor-pointer"
                onClick={() => onViewPhoto(item)}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={`${import.meta.env.VITE_API_BASE_URL || ''}/api/thumb?src=${encodeURIComponent(item.image_url)}&w=120&h=80&fit=cover&q=70`}
                    alt=""
                    className="w-14 h-10 rounded-lg object-cover ring-1 ring-white/[0.08]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white font-medium truncate">{item.name || 'Untitled'}</p>
                    <p className="text-[11px] text-white/40 mt-0.5">{item.date || 'Unknown date'}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/[0.1] text-white/40 hover:text-red-400 transition-all"
                    title="Remove from collection"
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 py-3 border-t border-white/[0.06] flex gap-2">
            <button
              onClick={onExport}
              className="flex-1 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-[12px] font-semibold hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-1.5"
            >
              <DownloadIcon size={12} />
              Export
            </button>
            <button
              onClick={onClear}
              className="flex-1 py-2 rounded-lg bg-red-500/10 text-red-400 text-[12px] font-semibold hover:bg-red-500/20 transition-all flex items-center justify-center gap-1.5"
            >
              Clear All
            </button>
          </div>
        </>
      )}
    </GlassPanel>
  );
}

// Color legend component with mode support
function ColorLegend({
  show,
  onToggle,
  colorMode,
  onColorModeChange
}: {
  show: boolean;
  onToggle: () => void;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}) {
  const legends: Record<ColorMode, { title: string; items: { color: string; label: string }[] }> = {
    date: {
      title: 'Photo dates',
      items: [
        { color: '#ff9500', label: 'Before 1930' },
        { color: '#ffd60a', label: '1930-1950' },
        { color: '#34c759', label: '1950-1970' },
        { color: '#0a84ff', label: 'After 1970' },
        { color: '#8e8e93', label: 'Unknown' },
      ],
    },
    subject: {
      title: 'Subject type',
      items: [
        { color: '#af52de', label: 'Churches' },
        { color: '#ff9500', label: 'Streets' },
        { color: '#0a84ff', label: 'Buildings' },
        { color: '#ff3b30', label: 'People' },
        { color: '#ffd60a', label: 'Vehicles' },
        { color: '#34c759', label: 'Nature' },
        { color: '#5ac8fa', label: 'Winter' },
      ],
    },
    depth: {
      title: 'Time depth',
      items: [
        { color: '#ff6b6b', label: '1890s (front)' },
        { color: '#c77dff', label: '1940s (middle)' },
        { color: '#4dabf7', label: '1990s (back)' },
      ],
    },
  };

  const legend = legends[colorMode];

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
        title="Color legend & modes"
      >
        <div className="w-4 h-4 rounded-full bg-gradient-to-r from-orange-500 via-yellow-500 to-blue-500" />
      </button>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl p-3 min-w-[160px]">
          {/* Mode selector */}
          <div className="flex gap-1 mb-3 pb-2 border-b border-white/10">
            {(['date', 'subject', 'depth'] as ColorMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => onColorModeChange(mode)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  colorMode === mode
                    ? 'bg-white/20 text-white'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <p className="text-xs font-medium text-white/70 mb-2">{legend.title}</p>
          <div className="space-y-1.5">
            {legend.items.map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs text-white/60">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Photo detail modal
function PhotoModal({
  photo,
  onClose,
  onOpenOriginal,
  onImageError,
  onFindSimilar,
  canFindSimilar,
  onCopyCitation,
  onAddToCollection,
  isInCollection,
}: {
  photo: PhotoDetail | null;
  onClose: () => void;
  onOpenOriginal: () => void;
  onImageError?: (id: string) => void;
  onFindSimilar?: () => void;
  canFindSimilar?: boolean;
  onCopyCitation?: (citation: string) => void;
  onAddToCollection?: () => void;
  isInCollection?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'info' | 'metadata'>('info');

  if (!photo) return null;

  // Generate citation in academic format
  const generateCitation = () => {
    const title = photo.name || 'Untitled photograph';
    const date = photo.date || 'n.d.';
    const cote = photo.cote ? `Cote: ${photo.cote}. ` : '';
    return `${title}. ${date}. ${cote}Montreal City Archives. Accessed via MTL Archives Explorer.`;
  };

  const handleCopyCitation = () => {
    const citation = generateCitation();
    navigator.clipboard.writeText(citation);
    onCopyCitation?.(citation);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gradient-to-b from-[#1c1c1e] to-[#0a0a0a] border border-white/[0.08] rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-[0_25px_80px_rgba(0,0,0,0.8)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Image */}
        <div className="relative aspect-[16/10] bg-black/50">
          <img
            src={`${import.meta.env.VITE_API_BASE_URL || ''}/api/thumb?src=${encodeURIComponent(photo.image_url)}&w=1000&q=90&format=auto`}
            alt={photo.name || 'Historical photo'}
            className="w-full h-full object-contain"
            onError={() => {
              onImageError?.(photo.id);
              onClose();
            }}
          />
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white transition-all duration-200"
          >
            <CloseIcon size={18} />
          </button>
          {/* Date badge */}
          {photo.date && (
            <div className="absolute top-4 left-4 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-sm">
              <span className="text-[13px] font-semibold text-white">{photo.date}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {/* Title */}
          <h3 className="text-[20px] font-semibold text-white tracking-tight leading-tight mb-2">
            {photo.name || 'Untitled'}
          </h3>

          {/* Tab toggle */}
          <div className="flex gap-1 p-1 bg-white/[0.04] rounded-xl mb-4 w-fit">
            <button
              onClick={() => setActiveTab('info')}
              className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-all duration-200 ${
                activeTab === 'info'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              Description
            </button>
            <button
              onClick={() => setActiveTab('metadata')}
              className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-all duration-200 ${
                activeTab === 'metadata'
                  ? 'bg-white/[0.1] text-white'
                  : 'text-white/50 hover:text-white/70'
              }`}
            >
              Archive Info
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'info' ? (
            <div className="space-y-4">
              {/* AI Caption */}
              {photo.vlm_caption && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">AI Description</p>
                  <p className="text-[14px] text-white/70 leading-relaxed">{photo.vlm_caption}</p>
                </div>
              )}
              {/* Original description if different */}
              {photo.description && photo.description !== photo.vlm_caption && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1.5">Original Description</p>
                  <p className="text-[14px] text-white/70 leading-relaxed">{photo.description}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Archive Cote */}
              {photo.cote && (
                <div className="flex items-start justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1">Archive Reference</p>
                    <p className="text-[14px] text-white font-mono">{photo.cote}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(photo.cote || '');
                      onCopyCitation?.('Reference copied');
                    }}
                    className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white transition-all"
                  >
                    <CopyIcon size={14} />
                  </button>
                </div>
              )}

              {/* Source Link */}
              {photo.external_url && (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1">Original Source</p>
                  <a
                    href={photo.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
                  >
                    View at Montreal City Archives →
                  </a>
                </div>
              )}

              {/* Credits */}
              {photo.credits && (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1">Credits</p>
                  <p className="text-[14px] text-white/70">{photo.credits}</p>
                </div>
              )}

              {/* Coordinates */}
              {photo.latitude && photo.longitude && (
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                  <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1">Location</p>
                  <p className="text-[14px] text-white/70 font-mono">
                    {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${photo.latitude},${photo.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-blue-400 hover:text-blue-300 mt-1 inline-block"
                  >
                    View on Google Maps →
                  </a>
                </div>
              )}

              {/* Photo ID */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <p className="text-[11px] uppercase tracking-wider text-white/30 font-semibold mb-1">Record ID</p>
                <p className="text-[14px] text-white/50 font-mono">{photo.id}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 pt-5 border-t border-white/[0.06] space-y-3">
            <div className="flex gap-3">
              <button
                onClick={onOpenOriginal}
                className="flex-1 py-3 rounded-xl bg-white text-black font-semibold text-[14px] hover:bg-white/90 transition-all duration-200"
              >
                View Full Size
              </button>
              <a
                href={`https://mtlarchives.com/photo/${photo.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3 rounded-xl bg-white/[0.08] text-white font-semibold text-[14px] hover:bg-white/[0.12] transition-all duration-200 text-center"
              >
                Order Print
              </a>
            </div>

            <div className="flex gap-3">
              {/* Add to Collection */}
              {onAddToCollection && (
                <button
                  onClick={onAddToCollection}
                  className={`flex-1 py-3 rounded-xl font-medium text-[13px] transition-all duration-200 flex items-center justify-center gap-2 ${
                    isInCollection
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                  }`}
                >
                  <BookmarkIcon size={14} filled={isInCollection} />
                  {isInCollection ? 'In Collection' : 'Save'}
                </button>
              )}

              {/* Copy Citation */}
              <button
                onClick={handleCopyCitation}
                className="flex-1 py-3 rounded-xl bg-emerald-500/10 text-emerald-400 font-medium text-[13px] hover:bg-emerald-500/20 transition-all duration-200 flex items-center justify-center gap-2"
              >
                <CopyIcon size={14} />
                Cite
              </button>

              {/* Find Similar */}
              {onFindSimilar && (
                <button
                  onClick={onFindSimilar}
                  disabled={!canFindSimilar}
                  className={`flex-1 py-3 rounded-xl font-medium text-[13px] transition-all duration-200 flex items-center justify-center gap-2 ${
                    canFindSimilar
                      ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20'
                      : 'bg-white/[0.04] text-white/30 cursor-not-allowed'
                  }`}
                >
                  <SparkleIcon size={14} />
                  {canFindSimilar ? 'Similar' : '...'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Onboarding modal for first-time users
function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-gradient-to-b from-[#1c1c1e] to-[#0a0a0a] border border-white/[0.08] rounded-3xl max-w-md w-full p-8 shadow-[0_25px_80px_rgba(0,0,0,0.8)] animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Animated logo */}
        <div className="flex justify-center mb-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-orange-500/30 to-blue-500/30 animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-orange-400 via-yellow-400 to-blue-500 shadow-xl shadow-orange-500/30" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h2 className="text-[26px] font-semibold text-white tracking-tight mb-2">Montreal Archives</h2>
          <p className="text-white/40 text-[15px] font-medium">Explore 14,715 historical photos</p>
        </div>

        <div className="space-y-5 mb-8">
          <div className="flex items-start gap-4 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.04]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-blue-600/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/10">
              <SearchIcon />
            </div>
            <div>
              <p className="text-white text-[14px] font-semibold">Search by text</p>
              <p className="text-white/40 text-[13px] mt-1 leading-relaxed">Type keywords like "church" or "winter" to find matching photos</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.04]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-600/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/10">
              <SparkleIcon size={18} />
            </div>
            <div>
              <p className="text-white text-[14px] font-semibold">Visual similarity</p>
              <p className="text-white/40 text-[13px] mt-1 leading-relaxed">Describe what you want to see - "snowy street" or "busy market"</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.04]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-purple-600/20 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/10">
              <ConstellationIcon size={18} />
            </div>
            <div>
              <p className="text-white text-[14px] font-semibold">Explore the cloud</p>
              <p className="text-white/40 text-[13px] mt-1 leading-relaxed">Each dot is a photo. Similar photos cluster together.</p>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold text-[15px] hover:from-orange-400 hover:to-orange-500 transition-all duration-300 shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:scale-[1.02] active:scale-[0.98]"
        >
          Start Exploring
        </button>

        <p className="text-center text-white/25 text-[12px] mt-5 font-medium">
          Press <kbd className="px-2 py-1 rounded-lg bg-white/[0.08] text-white/40 font-semibold mx-1">?</kbd> anytime for help
        </p>
      </div>
    </div>
  );
}

// Help panel with keyboard shortcuts
function HelpPanel({ onClose, isMobile }: { onClose: () => void; isMobile: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gradient-to-b from-[#1c1c1e] to-[#0a0a0a] border border-white/[0.08] rounded-3xl max-w-sm w-full p-6 shadow-[0_25px_80px_rgba(0,0,0,0.8)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[18px] font-semibold text-white tracking-tight">Keyboard Shortcuts</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/40 hover:text-white/80 transition-all duration-200"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="space-y-2">
          {!isMobile && (
            <>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <span className="text-white/60 text-[13px] font-medium">Navigate results</span>
                <div className="flex gap-1.5">
                  <kbd className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] text-white/70 text-[11px] font-semibold shadow-sm">↑</kbd>
                  <kbd className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] text-white/70 text-[11px] font-semibold shadow-sm">↓</kbd>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                <span className="text-white/60 text-[13px] font-medium">Open selected photo</span>
                <kbd className="px-3 py-1.5 rounded-lg bg-white/[0.08] text-white/70 text-[11px] font-semibold shadow-sm">Enter</kbd>
              </div>
            </>
          )}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <span className="text-white/60 text-[13px] font-medium">Clear search</span>
            <kbd className="px-3 py-1.5 rounded-lg bg-white/[0.08] text-white/70 text-[11px] font-semibold shadow-sm">Esc</kbd>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <span className="text-white/60 text-[13px] font-medium">Show help</span>
            <kbd className="px-3 py-1.5 rounded-lg bg-white/[0.08] text-white/70 text-[11px] font-semibold shadow-sm">?</kbd>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-white/[0.06]">
          <div className="flex items-start gap-3 text-white/40 text-[12px] leading-relaxed">
            <span className="text-orange-400">Tip</span>
            <span>Click any point to open the original photo. Drag to pan, scroll to zoom.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-95 pointer-events-none'
      }`}
    >
      <div className="px-5 py-3 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50 flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
          <CheckIcon size={13} />
        </span>
        <span className="text-[14px] font-semibold text-white tracking-tight">{message}</span>
      </div>
    </div>
  );
}

function CopyButton({ text, label, onCopy }: { text: string; label: string; onCopy: (msg: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy(label);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      onCopy(label);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded-md transition-all duration-200 ${
        copied
          ? 'bg-emerald-500/20 text-emerald-400'
          : 'bg-white/0 text-white/40 hover:bg-white/10 hover:text-white/80'
      }`}
      title={`Copy ${label}`}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}

const GlassPanel = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string; style?: React.CSSProperties; variant?: 'default' | 'elevated' }>(
  ({ children, className = '', style, variant = 'default' }, ref) => (
    <div
      ref={ref}
      className={`
        ${variant === 'elevated'
          ? 'bg-black/60 backdrop-blur-3xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
          : 'bg-black/40 backdrop-blur-2xl border border-white/[0.06] shadow-2xl'
        }
        transition-all duration-300 ease-out
        ${className}
      `}
      style={style}
    >
      {children}
    </div>
  ),
);

GlassPanel.displayName = 'GlassPanel';

// Animated logo for loading
function AnimatedLogo() {
  return (
    <div className="relative w-20 h-20">
      {/* Pulsing rings */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-orange-500/20 to-blue-500/20 animate-ping" />
      <div className="absolute inset-2 rounded-full bg-gradient-to-r from-orange-500/30 to-blue-500/30 animate-pulse" />
      {/* Center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 via-yellow-400 to-blue-500 shadow-lg shadow-orange-500/30" />
      </div>
      {/* Orbiting dots */}
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-orange-400" />
      </div>
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: '4s', animationDirection: 'reverse' }}>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />
      </div>
    </div>
  );
}

// Progress bar component
function ProgressBar({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="w-64">
      <div className="flex justify-between text-xs text-white/50 mb-1">
        <span>{label}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-white/50 rounded-full transition-all duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export function EmbeddingExplorer() {
  // Device detection
  const [isMobile] = useState(() => isMobileDevice());

  // Onboarding state
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem('mtl-explorer-visited');
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [showConstellations, setShowConstellations] = useState(true);
  const [isTimeTraveling, setIsTimeTraveling] = useState(false);
  const [activeDecade, setActiveDecade] = useState<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const autoRotateRef = useRef(false);
  const timeTravelRef = useRef<number | null>(null);

  // Collection/Favorites state
  const [collection, setCollection] = useState<CollectionItem[]>(() => getCollection());
  const [showCollection, setShowCollection] = useState(false);

  // Keep ref in sync with state
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Subject search - clicking a category triggers an API search
  const handleSubjectSearch = useCallback((subjectId: string | null) => {
    setActiveSubject(subjectId);
    setActiveDecade(null); // Clear decade when subject changes

    if (subjectId === null) {
      // Clear subject filter
      setQuery('');
      setResults([]);
      return;
    }

    const category = SUBJECT_CATEGORIES.find(c => c.id === subjectId);
    if (category) {
      // Set the search term and trigger search
      setQuery(category.searchTerm);
    }
  }, []);

  // Decade click - triggers a decade-specific search
  const handleDecadeClick = useCallback((decade: number | null) => {
    setActiveDecade(decade);
    setActiveSubject(null); // Clear subject when decade changes

    if (decade === null) {
      setQuery('');
      setResults([]);
      return;
    }

    // Search for photos from this decade
    setQuery(`${decade}s montreal`);
  }, []);


  // Time travel animation - cycle through decade searches
  const [timeTravelDecade, setTimeTravelDecade] = useState<number | null>(null);
  const decades = [1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980];

  const startTimeTravel = useCallback(() => {
    if (isTimeTraveling) {
      // Stop
      if (timeTravelRef.current) {
        clearInterval(timeTravelRef.current);
        timeTravelRef.current = null;
      }
      setIsTimeTraveling(false);
      setTimeTravelDecade(null);
      setQuery('');
      setResults([]);
      return;
    }

    // Start - cycle through decades
    setIsTimeTraveling(true);
    let decadeIndex = 0;
    setTimeTravelDecade(decades[0]);
    setQuery(`${decades[0]}s montreal`);

    timeTravelRef.current = window.setInterval(() => {
      decadeIndex++;
      if (decadeIndex >= decades.length) {
        // Stop at end
        clearInterval(timeTravelRef.current!);
        timeTravelRef.current = null;
        setIsTimeTraveling(false);
        setTimeTravelDecade(null);
        return;
      }
      const decade = decades[decadeIndex];
      setTimeTravelDecade(decade);
      setQuery(`${decade}s montreal`);
    }, 2500); // 2.5 seconds per decade for meaningful viewing
  }, [isTimeTraveling]);

  // Cleanup time travel on unmount
  useEffect(() => {
    return () => {
      if (timeTravelRef.current) {
        clearInterval(timeTravelRef.current);
      }
    };
  }, []);


  const [selectedPhoto, setSelectedPhoto] = useState<PhotoDetail | null>(null);

  const dismissWelcome = useCallback(() => {
    localStorage.setItem('mtl-explorer-visited', 'true');
    setShowWelcome(false);
  }, []);

  // Fullscreen handling
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      analytics.fullscreenToggled(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
      analytics.fullscreenToggled(false);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Data state - split into phases
  const [data, setData] = useState<Point[]>([]);
  const [embeddings, setEmbeddings] = useState<{ data: Float32Array; ids: string[]; dims: number } | null>(null);
  const [embeddingsStatus, setEmbeddingsStatus] = useState<EmbeddingsStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // View state
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [colorMode, setColorMode] = useState<ColorMode>('date');
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [hoverImageUrl, setHoverImageUrl] = useState<string | null>(null);

  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const hoverImageTimerRef = useRef<number | null>(null);
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const hoverPosRafRef = useRef<number | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    points: THREE.Points;
    geometry: THREE.BufferGeometry;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    constellationLines?: THREE.LineSegments;
    glowPoints?: THREE.Points;
  } | null>(null);
  const animFrameRef = useRef<number>(0);

  // Animation state
  const animStateRef = useRef({
    currentMode: '2d' as '2d' | '3d',
    transitioning: false,
    transitionStart: 0,
    fromMode: '2d' as '2d' | '3d',
    toMode: '2d' as '2d' | '3d',
  });

  // Search state - default to semantic (server-side)
  const [clipModel, setClipModel] = useState<{ tokenizer: any; model: any } | null>(null);
  const [clipStatus, setClipStatus] = useState<ClipStatus>(isMobile ? 'unavailable' : 'idle');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const isSearchingRef = useRef(false);
  const [results, setResults] = useState<ScoredPoint[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic'); // Default to server-side
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastTimeoutRef = useRef<number | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => getRecentSearches());

  // Track failed images to filter them out
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const handleImageError = useCallback((imageId: string) => {
    setFailedImages(prev => new Set(prev).add(imageId));
  }, []);

  // Find similar photos using CLIP embeddings
  // Surprise me - random photo with animation
  const surpriseMe = useCallback(() => {
    if (data.length === 0) return;

    // Filter to photos that have images
    const photosWithImages = data.filter(p => p.image_url && !failedImages.has(p.id));
    if (photosWithImages.length === 0) return;

    // Pick a random photo
    const randomIndex = Math.floor(Math.random() * photosWithImages.length);
    const randomPhoto = photosWithImages[randomIndex];

    // Fly camera to the point
    if (sceneRef.current) {
      const { controls, camera } = sceneRef.current;
      const anim = animStateRef.current;
      const targetZ = anim.currentMode === '2d' ? 0 : randomPhoto.z;

      controls.target.set(randomPhoto.x, randomPhoto.y, targetZ);
      if (anim.currentMode === '2d') {
        camera.position.set(randomPhoto.x, randomPhoto.y - SCALE * 0.2, SCALE * 0.4);
      } else {
        // Position camera at an angle to show the 3D cloud nicely
        camera.position.set(randomPhoto.x + 250, randomPhoto.y - 200, targetZ + 150);
      }
    }

    // Show the photo modal after a short delay for the camera animation
    setTimeout(() => {
      setSelectedPhoto({
        id: randomPhoto.id,
        name: randomPhoto.name,
        date: randomPhoto.date,
        image_url: randomPhoto.image_url,
        vlm_caption: randomPhoto.vlm_caption,
      });
      analytics.photoClicked(randomPhoto.id);
    }, 300);
  }, [data, failedImages]);

  // URL state sync - read on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const mode = params.get('mode') as '2d' | '3d' | null;
    if (q) setQuery(q);
    if (mode === '2d' || mode === '3d') setViewMode(mode);
  }, []);

  // URL state sync - write on change
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (viewMode !== '2d') params.set('mode', viewMode);
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }, [query, viewMode]);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, visible: true });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(t => ({ ...t, visible: false }));
      toastTimeoutRef.current = null;
    }, 2000);
  }, []);

  // Collection handlers
  const addToCollectionHandler = useCallback((photo: PhotoDetail) => {
    const success = saveToCollection({
      id: photo.id,
      name: photo.name,
      date: photo.date,
      image_url: photo.image_url,
      vlm_caption: photo.vlm_caption,
      cote: photo.cote,
      external_url: photo.external_url,
    });
    if (success) {
      setCollection(getCollection());
      showToast('Added to collection');
    } else {
      showToast('Already in collection');
    }
  }, [showToast]);

  const removeFromCollectionHandler = useCallback((id: string) => {
    removeFromCollection(id);
    setCollection(getCollection());
    showToast('Removed from collection');
  }, [showToast]);

  const clearCollectionHandler = useCallback(() => {
    clearCollection();
    setCollection([]);
    showToast('Collection cleared');
  }, [showToast]);

  // Find similar photos using CLIP embeddings
  const findSimilar = useCallback(async (photoId: string) => {
    if (!embeddings) return;

    const photo = data.find(p => p.id === photoId);
    if (!photo || photo.embeddingIndex < 0) {
      showToast('Cannot find visual embedding for this photo');
      return;
    }

    setSelectedPhoto(null); // Close modal
    setIsSearching(true);

    try {
      // Get the photo's embedding
      const photoEmb = embeddings.data.subarray(
        photo.embeddingIndex * embeddings.dims,
        (photo.embeddingIndex + 1) * embeddings.dims
      );

      // Find similar photos
      const scored = data
        .filter(p => p.embeddingIndex >= 0 && p.id !== photoId)
        .map(p => {
          const off = p.embeddingIndex * embeddings.dims;
          const sim = cosineSimilarity(photoEmb, embeddings.data.subarray(off, off + embeddings.dims));
          return { ...p, similarity: sim };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 100);

      setResults(scored);
      setQuery(`Similar to: ${photo.name || photo.id}`);
      setSelectedIndex(-1);
      showToast(`Found ${scored.length} similar photos`);
      analytics.searchPerformed(`similar:${photoId}`, 'visual', scored.length);
    } finally {
      setIsSearching(false);
    }
  }, [data, embeddings, showToast]);

  // Filter out failed images from results - show more for better constellation
  const topResults = useMemo(() => {
    return results
      .filter(r => !failedImages.has(r.id))
      .slice(0, 30); // Top 30 for rich constellation connections
  }, [results, failedImages]);

  // Top 10 for the UI panel display
  const displayResults = useMemo(() => topResults.slice(0, 10), [topResults]);

  // Compute stats about visible points
  const scheduleHoverTooltipPosition = useCallback((x: number, y: number) => {
    hoverPosRef.current.x = x;
    hoverPosRef.current.y = y;
    if (hoverPosRafRef.current != null) return;

    hoverPosRafRef.current = requestAnimationFrame(() => {
      hoverPosRafRef.current = null;
      const tooltip = hoverTooltipRef.current;
      if (!tooltip) return;
      const { x: px, y: py } = hoverPosRef.current;
      tooltip.style.transform = `translate3d(${px + 16}px, ${py + 16}px, 0)`;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (hoverPosRafRef.current != null) cancelAnimationFrame(hoverPosRafRef.current);
      if (hoverImageTimerRef.current != null) window.clearTimeout(hoverImageTimerRef.current);
      if (toastTimeoutRef.current != null) window.clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (hoverImageTimerRef.current != null) {
      window.clearTimeout(hoverImageTimerRef.current);
      hoverImageTimerRef.current = null;
    }
    setHoverImageUrl(null);
    const url = hoverPoint?.image_url?.trim() ?? '';
    if (!url) return;
    hoverImageTimerRef.current = window.setTimeout(() => {
      setHoverImageUrl(getHoverThumbnailUrl(url));
      hoverImageTimerRef.current = null;
    }, HOVER_IMAGE_DELAY_MS);
  }, [hoverPoint?.image_url]);

  // --------------------------------------------------------
  // Point Colors (supports multiple modes + filtering)
  // --------------------------------------------------------
  const getColor = useCallback((d: Point): [number, number, number] => {
    // Search results get highlight colors
    if (selectedIndex >= 0 && topResults[selectedIndex]?.id === d.id) {
      return [255, 69, 58]; // Bright red for selected
    }
    const topIdx = topResults.findIndex(r => r.id === d.id);
    if (topIdx >= 0) {
      const t = 1 - topIdx / 5;
      return [255, 159 + t * 40, 10]; // Bright orange gradient for top results
    }
    const match = results.find(r => r.id === d.id);
    if (match) {
      const t = match.similarity ** 2;
      return [10 + t * 245, 132 - t * 40, 255 - t * 155]; // Blue-to-purple for matches
    }

    // Base color depends on color mode
    if (colorMode === 'date') {
      if (d.date) {
        const y = parseInt(d.date);
        if (y < 1930) return [255, 149, 0];   // Orange - early
        if (y < 1950) return [255, 214, 10];  // Yellow - 30s-40s
        if (y < 1970) return [52, 199, 89];   // Green - 50s-60s
        return [10, 132, 255];                 // Blue - 70s+
      }
      return [142, 142, 147]; // Gray for unknown
    }

    if (colorMode === 'subject') {
      const caption = (d.vlm_caption || '').toLowerCase();
      if (caption.includes('church') || caption.includes('cathedral') || caption.includes('chapel')) {
        return [175, 82, 222]; // Purple - religious
      }
      if (caption.includes('street') || caption.includes('avenue') || caption.includes('road') || caption.includes('boulevard')) {
        return [255, 149, 0]; // Orange - streets
      }
      if (caption.includes('building') || caption.includes('house') || caption.includes('apartment') || caption.includes('office')) {
        return [10, 132, 255]; // Blue - buildings
      }
      if (caption.includes('people') || caption.includes('crowd') || caption.includes('person') || caption.includes('man') || caption.includes('woman')) {
        return [255, 59, 48]; // Red - people
      }
      if (caption.includes('car') || caption.includes('vehicle') || caption.includes('truck') || caption.includes('bus') || caption.includes('train')) {
        return [255, 214, 10]; // Yellow - vehicles
      }
      if (caption.includes('park') || caption.includes('tree') || caption.includes('garden') || caption.includes('nature')) {
        return [52, 199, 89]; // Green - nature
      }
      if (caption.includes('snow') || caption.includes('winter') || caption.includes('ice')) {
        return [90, 200, 250]; // Light blue - winter
      }
      return [142, 142, 147]; // Gray for unclassified
    }

    if (colorMode === 'depth') {
      const t = d.z / 800;
      const r = Math.round(255 * (1 - t));
      const g = Math.round(100 + 100 * Math.sin(t * Math.PI));
      const b = Math.round(255 * t);
      return [r, g, b];
    }

    return [142, 142, 147];
  }, [results, topResults, selectedIndex, colorMode]);

  // --------------------------------------------------------
  // Phase 1: Load 2D positions only (fast initial load)
  // --------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialData() {
      try {
        setLoadProgress(0);

        // Only load 2D positions and IDs - skip the heavy 512D embeddings
        const [res2d, resIds] = await Promise.all([
          fetch(DATA_URL_2D, { signal: controller.signal }),
          fetch(DATA_URL_IDS, { signal: controller.signal }),
        ]);

        if (!res2d.ok || !resIds.ok) {
          throw new Error('Failed to fetch data');
        }

        setLoadProgress(0.5);

        const [raw2d, ids] = await Promise.all([
          res2d.json(),
          resIds.json(),
        ]);

        if (controller.signal.aborted) return;

        setLoadProgress(0.8);

        const idToIdx = new Map(ids.map((id: string, i: number) => [id, i]));
        const scaled = raw2d.map((d: any, idx: number) => ({
          ...d,
          x: d.x * SCALE,
          y: d.y * SCALE,
          z: yearToZ(d.date, idx), // Year-based Z with jitter for organic clustering
          embeddingIndex: idToIdx.get(d.id) ?? -1,
        }));

        setData(scaled);
        setLoadProgress(1);
        setIsLoading(false);
      } catch (err) {
        if (err && typeof err === 'object' && 'name' in err && (err as any).name === 'AbortError') return;
        setLoadError(err instanceof Error ? err.message : 'Unknown error');
      }
    }
    loadInitialData();

    return () => controller.abort();
  }, []);

  // --------------------------------------------------------
  // Phase 2: Load 512D embeddings on demand (for visual search)
  // --------------------------------------------------------
  const loadEmbeddings = useCallback(async () => {
    if (embeddingsStatus !== 'idle' || isMobile) return;

    setEmbeddingsStatus('loading');

    try {
      const res = await fetch(DATA_URL_512D);
      if (!res.ok) throw new Error('Failed to fetch embeddings');

      const buffer = await res.arrayBuffer();
      const header = new Uint32Array(buffer, 0, 2);
      const dims = header[1];
      const embData = new Float32Array(buffer, 8);

      setEmbeddings({ data: embData, ids: [], dims });
      setEmbeddingsStatus('ready');
    } catch (err) {
      console.error('Failed to load embeddings:', err);
      setEmbeddingsStatus('error');
    }
  }, [embeddingsStatus, isMobile]);

  // --------------------------------------------------------
  // Load CLIP model on demand (lazy loading)
  // --------------------------------------------------------
  const loadClipModel = useCallback(async () => {
    if (clipStatus !== 'idle' || isMobile) return;

    setClipStatus('loading');

    try {
      const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
      const model = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
      setClipModel({ tokenizer, model });
      setClipStatus('ready');
    } catch (err) {
      console.error('Failed to load CLIP:', err);
      setClipStatus('error');
    }
  }, [clipStatus, isMobile]);

  // --------------------------------------------------------
  // Enable visual search (loads both embeddings and CLIP)
  // --------------------------------------------------------
  const enableVisualSearch = useCallback(async () => {
    if (isMobile) {
      showToast('Visual search unavailable on mobile');
      return;
    }

    setSearchMode('visual');

    // Load both in parallel
    await Promise.all([
      loadEmbeddings(),
      loadClipModel(),
    ]);
  }, [loadEmbeddings, loadClipModel, isMobile, showToast]);

  // --------------------------------------------------------
  // Camera positions
  // --------------------------------------------------------
  const getCameraConfig = useCallback((mode: '2d' | '3d') => {
    if (mode === '2d') {
      return {
        position: new THREE.Vector3(SCALE / 2, -SCALE * 0.1, SCALE * 1.2),
        target: new THREE.Vector3(SCALE / 2, SCALE / 2, 0),
        fov: 50,
      };
    } else {
      // 3D view - camera positioned to see the full time-layered cloud
      return {
        position: new THREE.Vector3(SCALE * 1.5, -SCALE * 0.3, SCALE * 1.2),
        target: new THREE.Vector3(SCALE / 2, SCALE / 2, 400), // Center of Z range (0-800)
        fov: 65,
      };
    }
  }, []);

  // --------------------------------------------------------
  // Three.js Scene Setup
  // --------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || data.length === 0 || sceneRef.current) return;

    const container = containerRef.current;
    const dataRef = data;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    const config2D = getCameraConfig('2d');
    const camera = new THREE.PerspectiveCamera(config2D.fov, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.copy(config2D.position);
    camera.lookAt(config2D.target);

    const renderer = new THREE.WebGLRenderer({ antialias: !isMobile }); // Disable AA on mobile
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(config2D.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = SCALE * 4;
    controls.minDistance = 50;
    controls.enableRotate = false;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(dataRef.length * 3);
    const colors = new Float32Array(dataRef.length * 3);

    dataRef.forEach((d, i) => {
      positions[i * 3] = d.x;
      positions[i * 3 + 1] = d.y;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = 142 / 255;
      colors[i * 3 + 1] = 142 / 255;
      colors[i * 3 + 2] = 147 / 255;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: isMobile ? 8 : 5, // Larger points on mobile for touch
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });

    // Store base size for animation
    const basePointSize = isMobile ? 8 : 5;

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = isMobile ? 20 : 10; // Larger threshold on mobile
    const mouse = new THREE.Vector2();

    sceneRef.current = { scene, camera, renderer, controls, points, geometry, raycaster, mouse };

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const anim = animStateRef.current;

      // Ambient breathing animation - subtle size pulsing
      const breathe = Math.sin(now * 0.001) * 0.15 + 1; // 0.85 to 1.15
      material.size = basePointSize * breathe;

      if (anim.transitioning) {
        const elapsed = now - anim.transitionStart;
        const progress = Math.min(elapsed / TRANSITION_MS, 1);
        const t = easeOutCubic(progress);

        const fromConfig = getCameraConfig(anim.fromMode);
        const toConfig = getCameraConfig(anim.toMode);

        camera.position.lerpVectors(fromConfig.position, toConfig.position, t);
        controls.target.lerpVectors(fromConfig.target, toConfig.target, t);
        camera.fov = lerp(fromConfig.fov, toConfig.fov, t);
        camera.updateProjectionMatrix();

        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const posArray = posAttr.array as Float32Array;
        for (let i = 0; i < dataRef.length; i++) {
          const fromZ = anim.fromMode === '2d' ? 0 : dataRef[i].z;
          const toZ = anim.toMode === '2d' ? 0 : dataRef[i].z;
          posArray[i * 3 + 2] = lerp(fromZ, toZ, t);
        }
        posAttr.needsUpdate = true;

        if (progress >= 1) {
          anim.transitioning = false;
          anim.currentMode = anim.toMode;
          controls.enableRotate = anim.toMode === '3d';
        }
      }

      // Animate glow points if present
      if (sceneRef.current?.glowPoints) {
        const glowMaterial = sceneRef.current.glowPoints.material as THREE.PointsMaterial;
        const glowPulse = Math.sin(now * 0.002) * 0.2 + 0.8; // Faster pulse for glow
        glowMaterial.opacity = 0.4 * glowPulse;
      }

      // Auto-rotate in 3D mode
      if (autoRotateRef.current && anim.currentMode === '3d' && !anim.transitioning) {
        const angle = now * 0.0001; // Slow rotation
        const radius = camera.position.distanceTo(controls.target);
        const targetX = controls.target.x;
        const targetY = controls.target.y;
        const targetZ = controls.target.z;

        camera.position.x = targetX + Math.sin(angle) * radius * 0.7;
        camera.position.z = targetZ + Math.cos(angle) * radius * 0.7;
      }

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Mouse/touch handlers
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(points);

      if (intersects.length > 0) {
        const idx = intersects[0].index!;
        if (hoverIndexRef.current !== idx) {
          hoverIndexRef.current = idx;
          setHoverPoint(dataRef[idx]);
        }
        if (!isMobile) scheduleHoverTooltipPosition(e.clientX, e.clientY);
        container.style.cursor = 'pointer';
      } else {
        if (hoverIndexRef.current !== null) {
          hoverIndexRef.current = null;
          setHoverPoint(null);
        }
        container.style.cursor = 'grab';
      }
    };

    const onClick = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(points);

      if (intersects.length > 0) {
        const idx = intersects[0].index!;
        const point = dataRef[idx];
        if (point.image_url) {
          setSelectedPhoto({
            id: point.id,
            name: point.name,
            date: point.date,
            image_url: point.image_url,
            vlm_caption: point.vlm_caption,
          });
          analytics.photoClicked(point.id);
        }
      }
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);

    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [data, getCameraConfig, isMobile, scheduleHoverTooltipPosition]);

  // --------------------------------------------------------
  // View mode transitions
  // --------------------------------------------------------
  useEffect(() => {
    const anim = animStateRef.current;
    if (anim.currentMode === viewMode && !anim.transitioning) return;
    if (anim.transitioning && anim.toMode === viewMode) return;

    anim.transitioning = true;
    anim.transitionStart = performance.now();
    anim.fromMode = anim.transitioning ? anim.toMode : anim.currentMode;
    anim.toMode = viewMode;

    if (viewMode === '3d' && sceneRef.current) {
      sceneRef.current.controls.enableRotate = true;
    }
  }, [viewMode]);

  // --------------------------------------------------------
  // Update colors
  // --------------------------------------------------------
  useEffect(() => {
    if (!sceneRef.current || data.length === 0) return;

    const { geometry } = sceneRef.current;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const colorArray = colorAttr.array as Float32Array;

    data.forEach((d, i) => {
      const color = getColor(d);
      colorArray[i * 3] = color[0] / 255;
      colorArray[i * 3 + 1] = color[1] / 255;
      colorArray[i * 3 + 2] = color[2] / 255;
    });

    colorAttr.needsUpdate = true;
  }, [data, results, topResults, selectedIndex, getColor]);

  // --------------------------------------------------------
  // Glow Effect for Search Results
  // --------------------------------------------------------
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current.scene;

    // Remove existing glow points
    if (sceneRef.current.glowPoints) {
      scene.remove(sceneRef.current.glowPoints);
      sceneRef.current.glowPoints.geometry.dispose();
      (sceneRef.current.glowPoints.material as THREE.Material).dispose();
      sceneRef.current.glowPoints = undefined;
    }

    // Only add glow if we have results
    if (topResults.length === 0) return;

    const anim = animStateRef.current;

    // Create glow geometry
    const glowGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(topResults.length * 3);
    const colors = new Float32Array(topResults.length * 3);
    const sizes = new Float32Array(topResults.length);

    topResults.forEach((r, i) => {
      const z = anim.currentMode === '2d' ? 0 : r.z;
      positions[i * 3] = r.x;
      positions[i * 3 + 1] = r.y;
      positions[i * 3 + 2] = z;

      // Orange-yellow glow color based on similarity
      const t = r.similarity / topResults[0].similarity;
      colors[i * 3] = 1;           // R
      colors[i * 3 + 1] = 0.5 + t * 0.3; // G
      colors[i * 3 + 2] = 0.1;     // B

      // Size based on rank - top result biggest
      sizes[i] = 40 - i * 3;
    });

    glowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    glowGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const glowMaterial = new THREE.PointsMaterial({
      size: 35,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });

    const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
    glowPoints.renderOrder = -1; // Render behind regular points
    scene.add(glowPoints);
    sceneRef.current.glowPoints = glowPoints;
  }, [topResults, viewMode]);

  // --------------------------------------------------------
  // Constellation Lines (connect search results with bright visible lines)
  // --------------------------------------------------------
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current.scene;

    // Remove existing lines
    if (sceneRef.current.constellationLines) {
      scene.remove(sceneRef.current.constellationLines);
      sceneRef.current.constellationLines.geometry.dispose();
      (sceneRef.current.constellationLines.material as THREE.Material).dispose();
      sceneRef.current.constellationLines = undefined;
    }

    // Only show lines if we have results and feature is enabled
    if (!showConstellations || topResults.length < 2) return;

    const anim = animStateRef.current;

    // Create line segments connecting top results
    const positions: number[] = [];
    const colors: number[] = [];

    // Connect each result to the next (creates a path through similarity)
    for (let i = 0; i < topResults.length - 1; i++) {
      const p1 = topResults[i];
      const p2 = topResults[i + 1];

      const z1 = anim.currentMode === '2d' ? 0 : p1.z;
      const z2 = anim.currentMode === '2d' ? 0 : p2.z;

      positions.push(p1.x, p1.y, z1);
      positions.push(p2.x, p2.y, z2);

      // Bright orange/yellow gradient
      colors.push(1, 0.6, 0.1); // Start - bright orange
      colors.push(1, 0.8, 0.2); // End - golden
    }

    // Also connect top result to ALL others (star pattern from #1)
    const center = topResults[0];
    const centerZ = anim.currentMode === '2d' ? 0 : center.z;

    for (let i = 1; i < topResults.length; i++) {
      const p = topResults[i];
      const pZ = anim.currentMode === '2d' ? 0 : p.z;

      positions.push(center.x, center.y, centerZ);
      positions.push(p.x, p.y, pZ);

      // Color by similarity - brighter = more similar
      const t = p.similarity / topResults[0].similarity;
      colors.push(1, 0.5, 0.1);     // Center - orange
      colors.push(t, t * 0.8, 0.1); // Endpoint - fades based on similarity
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85, // Much more visible
      linewidth: 2,  // Note: may not work on all GPUs
    });

    const lines = new THREE.LineSegments(geometry, material);
    scene.add(lines);
    sceneRef.current.constellationLines = lines;
  }, [topResults, showConstellations, viewMode]);

  // --------------------------------------------------------
  // Search functions
  // --------------------------------------------------------
  const searchApi = useCallback(async (q: string): Promise<ScoredPoint[]> => {
    const params = new URLSearchParams({ q, mode: 'semantic', limit: '200' });
    const res = await fetch(`${API_ORIGIN}/api/search?${params}`);
    if (!res.ok) return [];

    const json = await res.json() as { items: ApiResult[] };
    const idToPoint = new Map(data.map(p => [p.id, p]));

    return json.items
      .map(item => {
        const point = idToPoint.get(item.metadataFilename);
        // Extra metadata from API
        const extraMeta = {
          description: item.description || undefined,
          cote: item.cote || undefined,
          external_url: item.externalUrl || undefined,
          credits: item.credits || undefined,
          latitude: item.latitude || undefined,
          longitude: item.longitude || undefined,
        };

        if (point) {
          return { ...point, ...extraMeta, similarity: item.score ?? 0.5 };
        }
        return {
          id: item.metadataFilename,
          x: SCALE / 2 + (Math.random() - 0.5) * 100,
          y: SCALE / 2 + (Math.random() - 0.5) * 100,
          z: 75 + (Math.random() - 0.5) * 40, // Middle of Z range with jitter
          name: item.name || '',
          date: item.dateValue || '',
          image_url: item.imageUrl || '',
          vlm_caption: item.vlmCaption || '',
          embeddingIndex: -1,
          similarity: item.score ?? 0.5,
          ...extraMeta,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null) as ScoredPoint[];
  }, [data]);

  const searchClip = useCallback(async (q: string): Promise<ScoredPoint[]> => {
    if (!clipModel || !embeddings) return [];

    const cacheKey = q.trim().toLowerCase();
    let qEmb = clipEmbeddingCache.get(cacheKey);

    if (!qEmb) {
      const inputs = clipModel.tokenizer(q, { padding: true, truncation: true, max_length: 77 });
      const { text_embeds } = await clipModel.model(inputs);
      qEmb = text_embeds.data as Float32Array;

      const norm = Math.sqrt(qEmb.reduce((s, v) => s + v * v, 0));
      for (let i = 0; i < qEmb.length; i++) qEmb[i] /= norm;

      clipEmbeddingCache.set(cacheKey, qEmb);
    }

    return data
      .filter(p => p.embeddingIndex >= 0)
      .map(p => {
        const off = p.embeddingIndex * embeddings.dims;
        const sim = cosineSimilarity(qEmb!, embeddings.data.subarray(off, off + embeddings.dims));
        return { ...p, similarity: sim };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 200);
  }, [clipModel, embeddings, data]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSelectedIndex(-1);
      return;
    }
    if (isSearchingRef.current) return;

    isSearchingRef.current = true;
    setIsSearching(true);
    await new Promise(r => setTimeout(r, 30));

    try {
      let scored: ScoredPoint[] = [];

      if (searchMode === 'visual' && clipModel && embeddings) {
        scored = await searchClip(q);
      } else {
        // Fallback to semantic search
        scored = await searchApi(q);
      }

      setResults(scored);
      setSelectedIndex(-1);
      analytics.searchPerformed(q, searchMode === 'visual' ? 'visual' : 'text', scored.length);

      // Add to recent searches if we got results
      if (scored.length > 0) {
        addRecentSearch(q);
        setRecentSearches(getRecentSearches());
      }
    } finally {
      isSearchingRef.current = false;
      setIsSearching(false);
    }
  }, [clipModel, embeddings, searchMode, searchClip, searchApi]);

  useEffect(() => {
    const t = setTimeout(() => search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  // --------------------------------------------------------
  // Cinematic camera zoom to fit search results
  // --------------------------------------------------------
  const searchZoomRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sceneRef.current || topResults.length === 0) return;

    // Cancel any ongoing search zoom animation
    if (searchZoomRef.current) {
      cancelAnimationFrame(searchZoomRef.current);
      searchZoomRef.current = null;
    }

    const { controls, camera } = sceneRef.current;
    const anim = animStateRef.current;

    // Calculate bounding box of top results
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    topResults.slice(0, 15).forEach(r => {
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x);
      minY = Math.min(minY, r.y);
      maxY = Math.max(maxY, r.y);
      const z = anim.currentMode === '2d' ? 0 : r.z;
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });

    // Center and span
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const span = Math.max(spanX, spanY, 200);

    // Store start positions
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();

    // Calculate target positions
    const targetTarget = new THREE.Vector3(
      centerX,
      centerY,
      anim.currentMode === '2d' ? 0 : centerZ
    );
    const targetPosition = anim.currentMode === '2d'
      ? new THREE.Vector3(centerX, centerY - span * 0.3, span * 1.2)
      : new THREE.Vector3(centerX + span * 0.4, centerY - span * 0.25, centerZ + span * 0.5);

    // Smooth ease-out-cubic function
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    // Animate over 800ms
    const duration = 800;
    const startTime = performance.now();

    const animateZoom = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      // Interpolate positions
      controls.target.lerpVectors(startTarget, targetTarget, easedProgress);
      camera.position.lerpVectors(startPosition, targetPosition, easedProgress);

      if (progress < 1) {
        searchZoomRef.current = requestAnimationFrame(animateZoom);
      } else {
        searchZoomRef.current = null;
      }
    };

    // Start animation after a brief delay for visual clarity
    setTimeout(() => {
      searchZoomRef.current = requestAnimationFrame(animateZoom);
    }, 100);

    return () => {
      if (searchZoomRef.current) {
        cancelAnimationFrame(searchZoomRef.current);
      }
    };
  }, [topResults]);

  // --------------------------------------------------------
  // Selection & Navigation
  // --------------------------------------------------------
  const selectResult = useCallback((idx: number) => {
    const r = displayResults[idx];
    if (!r || !sceneRef.current) return;
    setSelectedIndex(idx);

    const { controls, camera } = sceneRef.current;
    const anim = animStateRef.current;
    const currentZ = anim.currentMode === '2d' ? 0 : r.z;

    // Store start positions
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();

    // Target positions
    const targetTarget = new THREE.Vector3(r.x, r.y, currentZ);
    const targetPosition = anim.currentMode === '2d'
      ? new THREE.Vector3(r.x, r.y - SCALE * 0.25, SCALE * 0.4)
      : new THREE.Vector3(r.x + 200, r.y - 150, currentZ + 120);

    // Animate smoothly
    const duration = 400;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const t = easeOutCubic(progress);

      controls.target.lerpVectors(startTarget, targetTarget, t);
      camera.position.lerpVectors(startPosition, targetPosition, t);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [displayResults]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Escape') {
          setResults([]);
          setSelectedIndex(-1);
          setQuery('');
          (e.target as HTMLInputElement).blur();
        }
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(h => !h);
        return;
      }

      if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false);
        } else {
          setResults([]);
          setSelectedIndex(-1);
          setQuery('');
        }
        return;
      }

      if (displayResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectResult(Math.min(selectedIndex + 1, displayResults.length - 1));
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectResult(Math.max(selectedIndex - 1, 0));
        }
        if (e.key === 'Enter' && selectedIndex >= 0 && displayResults[selectedIndex]?.image_url) {
          const r = displayResults[selectedIndex];
          setSelectedPhoto({
            id: r.id,
            name: r.name,
            date: r.date,
            image_url: r.image_url,
            vlm_caption: r.vlm_caption,
            description: r.description,
            cote: r.cote,
            external_url: r.external_url,
            credits: r.credits,
            latitude: r.latitude,
            longitude: r.longitude,
          });
          analytics.photoClicked(r.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [displayResults, selectedIndex, selectResult, showHelp]);

  // --------------------------------------------------------
  // Render
  // --------------------------------------------------------
  if (loadError) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">Failed to load</p>
          <p className="text-white/40 text-xs">{loadError}</p>
        </div>
      </div>
    );
  }

  const visualSearchReady = clipStatus === 'ready' && embeddingsStatus === 'ready';
  const visualSearchLoading = clipStatus === 'loading' || embeddingsStatus === 'loading';

  return (
    <div className="w-screen h-screen bg-[#0a0a0a] text-white font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display',sans-serif] antialiased select-none">
      {/* Loading - Apple-style intro */}
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-[#0a0a0a] flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-8">
            <AnimatedLogo />
            <div className="text-center space-y-3">
              <h1 className="text-2xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">
                Montreal Archives
              </h1>
              <p className="text-white/40 text-sm font-medium tracking-wide">
                {loadProgress < 0.3 ? 'Initializing...' : loadProgress < 0.7 ? 'Loading photos...' : 'Almost ready...'}
              </p>
            </div>
            <div className="w-48">
              <div className="h-[2px] bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-400 via-yellow-400 to-blue-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${loadProgress * 100}%` }}
                />
              </div>
            </div>
            <p className="text-[11px] text-white/25 font-medium tracking-widest uppercase">
              14,715 Historic Photos
            </p>
          </div>
        </div>
      )}

      {/* Three.js Canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hover Tooltip - Desktop only - Larger preview with more info */}
      {!isMobile && hoverPoint && (
        <GlassPanel
          ref={hoverTooltipRef}
          className="fixed z-40 rounded-2xl overflow-hidden pointer-events-none max-w-[340px] -translate-x-[10000px] -translate-y-[10000px] shadow-2xl shadow-black/50"
        >
          {hoverPoint.image_url && (
            <div className="w-full h-52 bg-white/5 flex items-center justify-center relative">
              {hoverImageUrl ? (
                <img
                  src={hoverImageUrl}
                  alt=""
                  className="w-full h-52 object-cover"
                  decoding="async"
                  onError={() => hoverPoint && handleImageError(hoverPoint.id)}
                />
              ) : (
                <Spinner size="sm" />
              )}
              {/* Year badge overlay */}
              {hoverPoint.date && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm">
                  <span className="text-xs font-semibold text-white">{hoverPoint.date}</span>
                </div>
              )}
            </div>
          )}
          <div className="p-4">
            <p className="text-sm font-semibold text-white leading-snug">{hoverPoint.name || 'Untitled'}</p>
            {hoverPoint.vlm_caption && (
              <p className="text-xs text-white/60 mt-2 leading-relaxed line-clamp-3">{hoverPoint.vlm_caption}</p>
            )}
            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
              <span className="text-[10px] text-white/40 uppercase tracking-wide">Click to view</span>
              <span className="text-[10px] text-white/40 font-mono">{hoverPoint.id}</span>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Top Controls */}
      <div className="fixed top-5 left-5 right-5 z-30 flex items-start justify-between gap-4">
        {/* Left side - View toggle */}
        <GlassPanel variant="elevated" className="rounded-2xl p-1.5 flex shrink-0 gap-1">
          {(['2d', '3d'] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`relative px-5 py-2.5 text-[13px] font-semibold rounded-xl transition-all duration-300 ease-out ${
                viewMode === v
                  ? 'text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {/* Active indicator background */}
              {viewMode === v && (
                <span className="absolute inset-0 bg-white/[0.12] rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" />
              )}
              <span className="relative">{v.toUpperCase()}</span>
            </button>
          ))}
          {/* Auto-rotate for 3D */}
          <div className={`overflow-hidden transition-all duration-300 ease-out ${viewMode === '3d' ? 'w-10 opacity-100' : 'w-0 opacity-0'}`}>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              className={`w-10 h-full rounded-xl transition-all duration-300 flex items-center justify-center ${
                autoRotate
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-[inset_0_0_12px_rgba(34,211,238,0.2)]'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/[0.06]'
              }`}
              title={autoRotate ? 'Stop rotation' : 'Auto-rotate'}
            >
              <span className={`transition-transform duration-500 ${autoRotate ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }}>
                <RotateIcon size={14} />
              </span>
            </button>
          </div>
        </GlassPanel>

        {/* Center - Search */}
        <div className={`flex-1 ${isMobile ? 'max-w-full' : 'max-w-md'} relative group/search`}>
          <GlassPanel
            variant="elevated"
            className="rounded-2xl flex items-center transition-all duration-300 ease-out
                       focus-within:ring-1 focus-within:ring-white/30 focus-within:bg-black/70
                       focus-within:shadow-[0_8px_40px_rgba(255,149,0,0.1)]
                       group-hover/search:bg-black/50"
          >
            <div className="pl-4 pr-2 text-white/40 transition-colors duration-200 group-focus-within/search:text-orange-400/70">
              <SearchIcon />
            </div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder={searchMode === 'visual' ? 'Search by visual concept...' : 'Search archives...'}
              className="flex-1 py-3.5 pr-3 bg-transparent text-[15px] text-white placeholder:text-white/25 focus:outline-none font-medium tracking-tight"
            />
            {isSearching && (
              <div className="pr-4">
                <div className="w-4 h-4 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" />
              </div>
            )}
            {!isSearching && results.length > 0 && (
              <div className="pr-4 flex items-center gap-1.5">
                <span className="text-xs text-white/50 font-semibold tabular-nums">{results.length}</span>
                <span className="text-[10px] text-white/30">results</span>
              </div>
            )}
          </GlassPanel>
          {/* Search suggestions dropdown */}
          <SearchSuggestions
            visible={showSuggestions && !query.trim()}
            onSearch={(q) => {
              setQuery(q);
              setShowSuggestions(false);
            }}
            recentSearches={recentSearches}
            onClearRecent={() => {
              clearRecentSearches();
              setRecentSearches([]);
            }}
          />
        </div>

        {/* Right side - Search mode toggle (desktop only) */}
        {!isMobile && (
          <GlassPanel variant="elevated" className="rounded-2xl p-1.5 flex shrink-0 gap-1">
            <button
              onClick={() => setSearchMode('semantic')}
              className={`relative px-5 py-2.5 text-[13px] font-semibold rounded-xl transition-all duration-300 ease-out ${
                searchMode === 'semantic'
                  ? 'text-white'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {searchMode === 'semantic' && (
                <span className="absolute inset-0 bg-white/[0.12] rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" />
              )}
              <span className="relative">Text</span>
            </button>
            <button
              onClick={() => {
                if (visualSearchReady) {
                  setSearchMode('visual');
                } else if (!visualSearchLoading) {
                  enableVisualSearch();
                }
              }}
              disabled={visualSearchLoading}
              className={`relative px-5 py-2.5 text-[13px] font-semibold rounded-xl transition-all duration-300 ease-out flex items-center gap-2 ${
                searchMode === 'visual'
                  ? 'text-white'
                  : 'text-white/40 hover:text-white/70'
              } ${visualSearchLoading ? 'opacity-70 cursor-wait' : ''}`}
            >
              {searchMode === 'visual' && (
                <span className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" />
              )}
              <span className="relative flex items-center gap-2">
                {visualSearchLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
                    <span>Loading</span>
                  </>
                ) : !visualSearchReady ? (
                  <>
                    <DownloadIcon size={13} />
                    <span>Visual</span>
                  </>
                ) : (
                  'Visual'
                )}
              </span>
            </button>
          </GlassPanel>
        )}
      </div>

      {/* Minimal Floating Toolbar - Apple Style */}
      <div className="fixed bottom-5 left-5 z-30 flex items-end gap-3">
        {/* Main pill - always visible */}
        <GlassPanel variant="elevated" className="rounded-full px-4 py-2.5 flex items-center gap-3">
          {/* Photo count */}
          <span className="text-[13px] text-white/60 font-medium tabular-nums">
            {results.length > 0 ? (
              <><span className="text-white font-semibold">{results.length}</span> results</>
            ) : (
              <>{data.length.toLocaleString()} photos</>
            )}
          </span>

          {/* Divider */}
          <div className="w-px h-4 bg-white/10" />

          {/* Surprise me */}
          <button
            onClick={surpriseMe}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-purple-400 transition-all"
            title="Random photo"
          >
            <DiceIcon size={16} />
          </button>

          {/* Collection (if has items) */}
          {collection.length > 0 && (
            <button
              onClick={() => setShowCollection(!showCollection)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-amber-400 transition-all relative"
              title={`Collection (${collection.length})`}
            >
              <BookmarkIcon size={16} filled />
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-500 text-[9px] font-bold flex items-center justify-center text-black">
                {collection.length}
              </span>
            </button>
          )}

          {/* Help */}
          <button
            onClick={() => setShowHelp(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
            title="Help (?)"
          >
            <HelpIcon size={15} />
          </button>
        </GlassPanel>

        {/* Secondary tools - more button that expands */}
        <GlassPanel variant="elevated" className="rounded-full p-1 flex items-center gap-0.5">
          {/* Constellation toggle */}
          <button
            onClick={() => setShowConstellations(!showConstellations)}
            className={`p-2 rounded-full transition-all ${
              showConstellations ? 'bg-orange-500/20 text-orange-400' : 'text-white/40 hover:text-white/70 hover:bg-white/10'
            }`}
            title="Connections"
          >
            <ConstellationIcon size={14} />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-full text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
            title="Fullscreen"
          >
            {isFullscreen ? <ExitFullscreenIcon size={14} /> : <FullscreenIcon size={14} />}
          </button>
        </GlassPanel>
      </div>

      {/* Floating link - bottom right */}
      <a
        href="https://mtlarchives.com"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-5 right-5 z-20 text-[11px] text-white/25 hover:text-white/50 transition-colors"
      >
        mtlarchives.com
      </a>

      {/* Results Panel */}
      {displayResults.length > 0 && (
        <GlassPanel variant="elevated" className={`fixed top-20 z-30 rounded-2xl overflow-hidden ${isMobile ? 'left-5 right-5' : 'right-5 w-[380px]'}`}>
          {/* Results header */}
          <div className="px-5 py-4 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-semibold text-white tracking-tight">Results</p>
                  <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-[12px] font-semibold text-white/60 tabular-nums">{results.length}</span>
                </div>
                <p className="text-[12px] text-white/35 mt-1 truncate max-w-[180px] font-medium">"{query}"</p>
              </div>
              <button
                onClick={() => { setResults([]); setQuery(''); setSelectedIndex(-1); }}
                className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/40 hover:text-white/80 transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <CloseIcon size={14} />
              </button>
            </div>
            {/* Export buttons for researchers */}
            {!isMobile && results.length > 0 && (
              <div className="flex gap-2 mt-3 pt-3 border-t border-white/[0.04]">
                <button
                  onClick={() => {
                    exportToCSV(results, query);
                    showToast(`Exported ${results.length} results to CSV`);
                  }}
                  className="flex-1 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-semibold text-white/50 hover:text-white/70 transition-all flex items-center justify-center gap-1.5"
                >
                  <DownloadIcon size={12} />
                  Export CSV
                </button>
                <button
                  onClick={() => {
                    exportToJSON(results, query);
                    showToast(`Exported ${results.length} results to JSON`);
                  }}
                  className="flex-1 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-semibold text-white/50 hover:text-white/70 transition-all flex items-center justify-center gap-1.5"
                >
                  <DownloadIcon size={12} />
                  Export JSON
                </button>
              </div>
            )}
          </div>
          <div className={`overflow-y-auto ${isMobile ? 'max-h-[50vh]' : 'max-h-[calc(100vh-200px)]'}`}>
            {displayResults.map((r, i) => {
              const allDetails = [
                r.name && `Name: ${r.name}`,
                r.date && `Date: ${r.date}`,
                r.vlm_caption && `Description: ${r.vlm_caption}`,
                r.image_url && `Image: ${r.image_url}`,
              ].filter(Boolean).join('\n');

              return (
                <div
                  key={r.id}
                  onClick={() => selectResult(i)}
                  onDoubleClick={() => r.image_url && setSelectedPhoto({
                    id: r.id,
                    name: r.name,
                    date: r.date,
                    image_url: r.image_url,
                    vlm_caption: r.vlm_caption,
                    description: r.description,
                    cote: r.cote,
                    external_url: r.external_url,
                    credits: r.credits,
                    latitude: r.latitude,
                    longitude: r.longitude,
                  })}
                  className={`group px-5 py-4 cursor-pointer transition-all duration-200 ease-out border-b border-white/[0.04] last:border-0 ${
                    i === selectedIndex
                      ? 'bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                      : 'hover:bg-white/[0.04] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]'
                  }`}
                  style={{
                    animationDelay: `${i * 30}ms`,
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="relative flex-shrink-0 group/thumb">
                      {r.image_url ? (
                        <img
                          src={getThumbnailUrl(r.image_url)}
                          alt=""
                          className="w-[72px] h-[72px] rounded-xl object-cover ring-1 ring-white/[0.08] transition-all duration-300 group-hover/thumb:ring-white/20 group-hover/thumb:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                          onError={() => handleImageError(r.id)}
                        />
                      ) : (
                        <div className="w-[72px] h-[72px] rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] flex items-center justify-center">
                          <ImagePlaceholder />
                        </div>
                      )}
                      {/* Rank badge with gradient */}
                      <span className={`absolute -top-2 -left-2 w-6 h-6 rounded-lg text-[11px] font-bold flex items-center justify-center text-white shadow-lg ${
                        i === 0 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                        i === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-500' :
                        i === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-800' :
                        'bg-gradient-to-br from-blue-500 to-blue-700'
                      }`}>
                        {i + 1}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                      {r.name && (
                        <div className="flex items-center gap-1.5 group/row">
                          <p className="text-[15px] text-white font-semibold truncate flex-1 tracking-tight leading-tight">{r.name}</p>
                          {!isMobile && (
                            <div className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 -translate-x-1 group-hover/row:translate-x-0">
                              <CopyButton text={r.name} label="Name copied" onCopy={showToast} />
                            </div>
                          )}
                        </div>
                      )}

                      {r.date && (
                        <p className="text-[13px] text-white/40 mt-1.5 font-medium">{r.date}</p>
                      )}

                      {/* Similarity bar with animated fill */}
                      <div className="flex items-center gap-2.5 mt-3">
                        <span className={`text-[12px] font-bold tabular-nums ${
                          r.similarity > 0.8 ? 'text-emerald-400' :
                          r.similarity > 0.6 ? 'text-green-400' :
                          'text-yellow-400'
                        }`}>{(r.similarity * 100).toFixed(0)}%</span>
                        <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${
                              r.similarity > 0.8 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' :
                              r.similarity > 0.6 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                              'bg-gradient-to-r from-yellow-500 to-yellow-400'
                            }`}
                            style={{ width: `${(r.similarity / topResults[0].similarity) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions - fade in on hover */}
                  {!isMobile && (
                    <div className="mt-4 pt-3 border-t border-white/[0.04] opacity-0 group-hover:opacity-100 transition-all duration-200 -translate-y-1 group-hover:translate-y-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(allDetails);
                          showToast('All details copied');
                        }}
                        className="w-full py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[13px] text-white/50 hover:text-white/80 transition-all duration-200 flex items-center justify-center gap-2 font-medium"
                      >
                        <CopyIcon size={13} />
                        Copy Details
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      {/* Toast notification */}
      <Toast message={toast.message} visible={toast.visible} />

      {/* Welcome modal for first-time users */}
      {showWelcome && <WelcomeModal onClose={dismissWelcome} />}

      {/* Help panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} isMobile={isMobile} />}

      {/* Filter panel */}
      <QuickSearchPanel
        show={showFilters}
        onClose={() => setShowFilters(false)}
        activeSubject={activeSubject}
        onSubjectSearch={handleSubjectSearch}
        currentQuery={query}
      />

      {/* Collection panel */}
      <CollectionPanel
        show={showCollection}
        onClose={() => setShowCollection(false)}
        collection={collection}
        onRemove={removeFromCollectionHandler}
        onClear={clearCollectionHandler}
        onExport={() => {
          exportCollection(collection);
          showToast(`Exported ${collection.length} items`);
        }}
        onViewPhoto={(item) => {
          setSelectedPhoto({
            id: item.id,
            name: item.name,
            date: item.date,
            image_url: item.image_url,
            vlm_caption: item.vlm_caption,
            cote: item.cote,
            external_url: item.external_url,
          });
          setShowCollection(false);
        }}
      />

      {/* Photo detail modal */}
      {selectedPhoto && (
        <PhotoModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onOpenOriginal={() => {
            window.open(getPreviewUrl(selectedPhoto.image_url), '_blank');
          }}
          onImageError={handleImageError}
          onFindSimilar={() => findSimilar(selectedPhoto.id)}
          canFindSimilar={embeddingsStatus === 'ready'}
          onCopyCitation={(msg) => showToast(msg)}
          onAddToCollection={() => addToCollectionHandler(selectedPhoto)}
          isInCollection={collection.some(c => c.id === selectedPhoto.id)}
        />
      )}
    </div>
  );
}
