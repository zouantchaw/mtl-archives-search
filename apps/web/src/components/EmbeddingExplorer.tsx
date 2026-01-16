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

type ScoredPoint = Point & { similarity: number };

type SearchMode = 'visual' | 'semantic';

type ApiResult = {
  metadataFilename: string;
  name: string | null;
  dateValue: string | null;
  imageUrl: string;
  vlmCaption: string | null;
  score?: number;
};

type ClipStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
type EmbeddingsStatus = 'idle' | 'loading' | 'ready' | 'error';

// Small thumbnails for hover tooltips and result cards
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

// Color legend component
function ColorLegend({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  const colors = [
    { color: '#ff9500', label: 'Before 1930' },
    { color: '#ffd60a', label: '1930-1950' },
    { color: '#34c759', label: '1950-1970' },
    { color: '#0a84ff', label: 'After 1970' },
    { color: '#8e8e93', label: 'Unknown date' },
  ];

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
        title="Color legend"
      >
        <div className="w-4 h-4 rounded-full bg-gradient-to-r from-orange-500 via-yellow-500 to-blue-500" />
      </button>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-3 min-w-[140px]">
          <p className="text-xs font-medium text-white/70 mb-2">Photo dates</p>
          <div className="space-y-1.5">
            {colors.map(({ color, label }) => (
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
}: {
  photo: { id: string; name: string; date: string; image_url: string; vlm_caption: string } | null;
  onClose: () => void;
  onOpenOriginal: () => void;
}) {
  if (!photo) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Image */}
        <div className="relative aspect-[4/3] bg-black">
          <img
            src={`${import.meta.env.VITE_API_BASE_URL || ''}/api/thumb?src=${encodeURIComponent(photo.image_url)}&w=800&q=85&format=auto`}
            alt={photo.name || 'Historical photo'}
            className="w-full h-full object-contain"
          />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Details */}
        <div className="p-6">
          <h3 className="text-lg font-semibold text-white mb-1">
            {photo.name || 'Untitled'}
          </h3>
          {photo.date && (
            <p className="text-sm text-white/50 mb-3">{photo.date}</p>
          )}
          {photo.vlm_caption && (
            <p className="text-sm text-white/70 leading-relaxed mb-4">{photo.vlm_caption}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onOpenOriginal}
              className="flex-1 py-3 rounded-xl bg-white text-black font-medium text-sm hover:bg-white/90 transition-colors"
            >
              View Full Size
            </button>
            <a
              href={`https://mtlarchives.com/photo/${photo.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-3 rounded-xl bg-white/10 text-white font-medium text-sm hover:bg-white/15 transition-colors text-center"
            >
              Order Print
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// Onboarding modal for first-time users
function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-3xl max-w-md w-full p-8 shadow-2xl">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-semibold text-white mb-2">Montreal Archives Explorer</h2>
          <p className="text-white/50 text-sm">Explore 14,000+ historical photos of Montreal</p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-400 text-sm">🔍</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">Search by text</p>
              <p className="text-white/50 text-xs mt-0.5">Type any keyword like "church" or "1950s" to find matching photos</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-emerald-400 text-sm">🎨</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">Visual similarity search</p>
              <p className="text-white/50 text-xs mt-0.5">Describe what you want to see - "snowy street" or "busy market"</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-purple-400 text-sm">🗺️</span>
            </div>
            <div>
              <p className="text-white text-sm font-medium">Explore the point cloud</p>
              <p className="text-white/50 text-xs mt-0.5">Each dot is a photo. Similar photos cluster together. Click to view.</p>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-white text-black font-medium text-sm hover:bg-white/90 transition-colors"
        >
          Start Exploring
        </button>

        <p className="text-center text-white/30 text-xs mt-4">
          Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/50">?</kbd> anytime for help
        </p>
      </div>
    </div>
  );
}

// Help panel with keyboard shortcuts
function HelpPanel({ onClose, isMobile }: { onClose: () => void; isMobile: boolean }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Keyboard Shortcuts</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {!isMobile && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-white/70 text-sm">Navigate results</span>
                <div className="flex gap-1">
                  <kbd className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">↑</kbd>
                  <kbd className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">↓</kbd>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/70 text-sm">Open selected photo</span>
                <kbd className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">Enter</kbd>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-sm">Clear search</span>
            <kbd className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">Esc</kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-sm">Show help</span>
            <kbd className="px-2 py-1 rounded bg-white/10 text-white/70 text-xs">?</kbd>
          </div>
        </div>

        <div className="border-t border-white/10 mt-4 pt-4">
          <p className="text-white/50 text-xs">
            <strong className="text-white/70">Tip:</strong> Click any point to open the original photo. Drag to pan, scroll to zoom.
          </p>
        </div>
      </div>
    </div>
  );
}

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-white/95 text-black text-sm font-medium shadow-lg backdrop-blur-xl transition-all duration-300 flex items-center gap-2 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white">
        <CheckIcon size={12} />
      </span>
      {message}
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

const GlassPanel = forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string; style?: React.CSSProperties }>(
  ({ children, className = '', style }, ref) => (
    <div ref={ref} className={`bg-black/50 backdrop-blur-2xl border border-white/10 shadow-2xl ${className}`} style={style}>
      {children}
    </div>
  ),
);

GlassPanel.displayName = 'GlassPanel';

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
  const [dateRange, setDateRange] = useState<[number, number]>([1900, 1980]);
  const [selectedPhoto, setSelectedPhoto] = useState<{
    id: string;
    name: string;
    date: string;
    image_url: string;
    vlm_caption: string;
  } | null>(null);

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

  const topResults = useMemo(() => results.slice(0, 5), [results]);

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
      setHoverImageUrl(getThumbnailUrl(url));
      hoverImageTimerRef.current = null;
    }, HOVER_IMAGE_DELAY_MS);
  }, [hoverPoint?.image_url]);

  // --------------------------------------------------------
  // Point Colors
  // --------------------------------------------------------
  const getColor = useCallback((d: Point): [number, number, number] => {
    if (selectedIndex >= 0 && topResults[selectedIndex]?.id === d.id) {
      return [255, 69, 58];
    }
    const topIdx = topResults.findIndex(r => r.id === d.id);
    if (topIdx >= 0) {
      const t = 1 - topIdx / 5;
      return [255, 159 + t * 40, 10];
    }
    const match = results.find(r => r.id === d.id);
    if (match) {
      const t = match.similarity ** 2;
      return [10 + t * 245, 132 - t * 40, 255 - t * 155];
    }
    if (d.date) {
      const y = parseInt(d.date);
      if (y < 1930) return [255, 149, 0];
      if (y < 1950) return [255, 214, 10];
      if (y < 1970) return [52, 199, 89];
      return [10, 132, 255];
    }
    return [142, 142, 147];
  }, [results, topResults, selectedIndex]);

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
        const scaled = raw2d.map((d: any) => ({
          ...d,
          x: d.x * SCALE,
          y: d.y * SCALE,
          z: Math.random() * 100,
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
      return {
        position: new THREE.Vector3(SCALE * 1.2, SCALE * 0.3, SCALE * 0.8),
        target: new THREE.Vector3(SCALE / 2, SCALE / 2, 50),
        fov: 60,
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
  // Search functions
  // --------------------------------------------------------
  const searchApi = useCallback(async (q: string): Promise<ScoredPoint[]> => {
    const params = new URLSearchParams({ q, mode: 'semantic', limit: '50' });
    const res = await fetch(`${API_ORIGIN}/api/search?${params}`);
    if (!res.ok) return [];

    const json = await res.json() as { items: ApiResult[] };
    const idToPoint = new Map(data.map(p => [p.id, p]));

    return json.items
      .map(item => {
        const point = idToPoint.get(item.metadataFilename);
        if (point) {
          return { ...point, similarity: item.score ?? 0.5 };
        }
        return {
          id: item.metadataFilename,
          x: SCALE / 2 + (Math.random() - 0.5) * 100,
          y: SCALE / 2 + (Math.random() - 0.5) * 100,
          z: 50,
          name: item.name || '',
          date: item.dateValue || '',
          image_url: item.imageUrl || '',
          vlm_caption: item.vlmCaption || '',
          embeddingIndex: -1,
          similarity: item.score ?? 0.5,
        };
      })
      .filter((p): p is ScoredPoint => p !== null);
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
      .slice(0, 100);
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
  // Selection & Navigation
  // --------------------------------------------------------
  const selectResult = useCallback((idx: number) => {
    const r = topResults[idx];
    if (!r || !sceneRef.current) return;
    setSelectedIndex(idx);

    const { controls, camera } = sceneRef.current;
    const anim = animStateRef.current;
    const currentZ = anim.currentMode === '2d' ? 0 : r.z;

    controls.target.set(r.x, r.y, currentZ);

    if (anim.currentMode === '2d') {
      camera.position.set(r.x, r.y - SCALE * 0.3, SCALE * 0.5);
    } else {
      camera.position.set(r.x + 150, r.y - 100, currentZ + 200);
    }
  }, [topResults]);

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

      if (topResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectResult(Math.min(selectedIndex + 1, topResults.length - 1));
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectResult(Math.max(selectedIndex - 1, 0));
        }
        if (e.key === 'Enter' && selectedIndex >= 0 && topResults[selectedIndex]?.image_url) {
          const r = topResults[selectedIndex];
          setSelectedPhoto({
            id: r.id,
            name: r.name,
            date: r.date,
            image_url: r.image_url,
            vlm_caption: r.vlm_caption,
          });
          analytics.photoClicked(r.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topResults, selectedIndex, selectResult, showHelp]);

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
      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-[#0a0a0a] flex flex-col items-center justify-center gap-6">
          <div className="text-center mb-4">
            <h1 className="text-xl font-semibold mb-2">Montreal Archives</h1>
            <p className="text-white/50 text-sm">Loading visualization...</p>
          </div>
          <ProgressBar progress={loadProgress} label="Loading points" />
        </div>
      )}

      {/* Three.js Canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hover Tooltip - Desktop only */}
      {!isMobile && hoverPoint && (
        <GlassPanel
          ref={hoverTooltipRef}
          className="fixed z-40 rounded-2xl overflow-hidden pointer-events-none max-w-[280px] -translate-x-[10000px] -translate-y-[10000px]"
        >
          {hoverPoint.image_url && (
            <div className="w-full h-40 bg-white/5 flex items-center justify-center">
              {hoverImageUrl ? (
                <img src={hoverImageUrl} alt="" className="w-full h-40 object-cover" decoding="async" />
              ) : (
                <Spinner size="sm" />
              )}
            </div>
          )}
          <div className="p-3">
            <p className="text-sm font-medium text-white leading-snug">{hoverPoint.name || 'Untitled'}</p>
            <p className="text-xs text-white/50 mt-1">{hoverPoint.date || 'Unknown date'}</p>
            {hoverPoint.vlm_caption && (
              <p className="text-xs text-white/70 mt-2 leading-relaxed line-clamp-2">{hoverPoint.vlm_caption}</p>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Top Controls */}
      <div className="fixed top-5 left-5 right-5 z-30 flex items-start justify-between gap-4">
        {/* Left side - View toggle */}
        <GlassPanel className="rounded-xl p-1 flex shrink-0">
          {(['2d', '3d'] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                viewMode === v
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </GlassPanel>

        {/* Center - Search */}
        <div className={`flex-1 ${isMobile ? 'max-w-full' : 'max-w-md'}`}>
          <GlassPanel className="rounded-2xl flex items-center transition-shadow duration-200 focus-within:ring-1 focus-within:ring-white/20">
            <div className="pl-4 pr-2 text-white/40">
              <SearchIcon />
            </div>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchMode === 'visual' ? 'Search by visual concept...' : 'Search archives...'}
              className="flex-1 py-3 pr-3 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
            {isSearching && (
              <div className="pr-4">
                <Spinner size="sm" />
              </div>
            )}
            {!isSearching && results.length > 0 && (
              <span className="pr-4 text-xs text-white/50">{results.length}</span>
            )}
          </GlassPanel>
        </div>

        {/* Right side - Search mode toggle (desktop only) */}
        {!isMobile && (
          <GlassPanel className="rounded-xl p-1 flex shrink-0">
            <button
              onClick={() => setSearchMode('semantic')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                searchMode === 'semantic'
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              Text
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
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-200 flex items-center gap-2 ${
                searchMode === 'visual'
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              } ${visualSearchLoading ? 'opacity-50' : ''}`}
            >
              {visualSearchLoading ? (
                <>
                  <Spinner size="sm" />
                  Loading...
                </>
              ) : !visualSearchReady ? (
                <>
                  <DownloadIcon size={12} />
                  Visual
                </>
              ) : (
                'Visual'
              )}
            </button>
          </GlassPanel>
        )}
      </div>

      {/* Info Panel */}
      <GlassPanel className="fixed bottom-5 left-5 z-30 rounded-2xl px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white mb-0.5">Montreal Archives</p>
            <p className="text-xs text-white/50">
              {data.length.toLocaleString()} historical photos
            </p>
            <a
              href="https://mtlarchives.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 block"
            >
              mtlarchives.com →
            </a>
          </div>
          <div className="flex items-center gap-1">
            <ColorLegend show={showLegend} onToggle={() => setShowLegend(!showLegend)} />
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
            </button>
            <button
              onClick={() => setShowHelp(true)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title="Help (press ?)"
            >
              <HelpIcon size={16} />
            </button>
          </div>
        </div>
      </GlassPanel>

      {/* Results Panel */}
      {topResults.length > 0 && (
        <GlassPanel className={`fixed top-20 z-30 rounded-2xl overflow-hidden ${isMobile ? 'left-5 right-5' : 'right-5 w-[360px]'}`}>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Results</p>
              <p className="text-xs text-white/40 mt-0.5 truncate max-w-[200px]">"{query}"</p>
            </div>
            <button
              onClick={() => { setResults([]); setQuery(''); setSelectedIndex(-1); }}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white/50 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
          <div className={`overflow-y-auto ${isMobile ? 'max-h-[50vh]' : 'max-h-[calc(100vh-200px)]'}`}>
            {topResults.map((r, i) => {
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
                  })}
                  className={`group px-5 py-4 cursor-pointer transition-colors border-b border-white/5 last:border-0 ${
                    i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative flex-shrink-0">
                      {r.image_url ? (
                        <img
                          src={getThumbnailUrl(r.image_url)}
                          alt=""
                          className="w-16 h-16 rounded-xl object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center">
                          <ImagePlaceholder />
                        </div>
                      )}
                      <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-md bg-blue-500 text-[10px] font-bold flex items-center justify-center text-white">
                        {i + 1}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {r.name && (
                        <div className="flex items-center gap-1 group/row">
                          <p className="text-sm text-white font-medium truncate flex-1">{r.name}</p>
                          {!isMobile && (
                            <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <CopyButton text={r.name} label="Name copied" onCopy={showToast} />
                            </div>
                          )}
                        </div>
                      )}

                      {r.date && (
                        <p className="text-xs text-white/50 mt-1">{r.date}</p>
                      )}

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-semibold text-emerald-400">{(r.similarity * 100).toFixed(1)}%</span>
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                            style={{ width: `${(r.similarity / topResults[0].similarity) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {!isMobile && (
                    <div className="mt-3 pt-3 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(allDetails);
                          showToast('All details copied');
                        }}
                        className="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/60 hover:text-white/90 transition-colors flex items-center justify-center gap-2"
                      >
                        <CopyIcon size={12} />
                        Copy All Details
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

      {/* Photo detail modal */}
      {selectedPhoto && (
        <PhotoModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onOpenOriginal={() => {
            window.open(getPreviewUrl(selectedPhoto.image_url), '_blank');
          }}
        />
      )}
    </div>
  );
}
