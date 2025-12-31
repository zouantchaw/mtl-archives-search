import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
import { AutoTokenizer, CLIPTextModelWithProjection, env as transformersEnv } from '@xenova/transformers';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clipEmbeddingCache } from '../lib/lru-cache';

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

type SearchMode = 'clip' | 'semantic' | 'hybrid';

type ApiResult = {
  metadataFilename: string;
  name: string | null;
  dateValue: string | null;
  imageUrl: string;
  vlmCaption: string | null;
  score?: number;
};

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
      // Fallback for older browsers
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

// ============================================================
// Main Component
// ============================================================

export function EmbeddingExplorer() {
  // Data state
  const [data, setData] = useState<Point[]>([]);
  const [embeddings, setEmbeddings] = useState<{ data: Float32Array; ids: string[]; dims: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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

  // Animation state (using refs to avoid re-renders during animation)
  const animStateRef = useRef({
    currentMode: '2d' as '2d' | '3d',
    transitioning: false,
    transitionStart: 0,
    fromMode: '2d' as '2d' | '3d',
    toMode: '2d' as '2d' | '3d',
  });

  // Search state
  const [clipModel, setClipModel] = useState<{ tokenizer: any; model: any } | null>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const isSearchingRef = useRef(false);
  const [results, setResults] = useState<ScoredPoint[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchMode, setSearchMode] = useState<SearchMode>('clip');
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastTimeoutRef = useRef<number | null>(null);

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
      if (hoverPosRafRef.current != null) {
        cancelAnimationFrame(hoverPosRafRef.current);
      }
      if (hoverImageTimerRef.current != null) {
        window.clearTimeout(hoverImageTimerRef.current);
      }
      if (toastTimeoutRef.current != null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
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
  // Data Loading
  // --------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [res2d, res512d, resIds] = await Promise.all([
          fetch(DATA_URL_2D, { signal: controller.signal }),
          fetch(DATA_URL_512D, { signal: controller.signal }),
          fetch(DATA_URL_IDS, { signal: controller.signal }),
        ]);

        if (!res2d.ok || !res512d.ok || !resIds.ok) {
          throw new Error('Failed to fetch embedding data');
        }

        const [raw2d, buffer, ids] = await Promise.all([
          res2d.json(),
          res512d.arrayBuffer(),
          resIds.json(),
        ]);

        if (controller.signal.aborted) return;

        const header = new Uint32Array(buffer, 0, 2);
        const dims = header[1];
        const embData = new Float32Array(buffer, 8);
        setEmbeddings({ data: embData, ids, dims });

        const idToIdx = new Map(ids.map((id: string, i: number) => [id, i]));
        const scaled = raw2d.map((d: any) => ({
          ...d,
          x: d.x * SCALE,
          y: d.y * SCALE,
          z: Math.random() * 100,
          embeddingIndex: idToIdx.get(d.id) ?? -1,
        }));

        setData(scaled);
        setIsLoading(false);
      } catch (err) {
        if (err && typeof err === 'object' && 'name' in err && (err as { name?: unknown }).name === 'AbortError') {
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Unknown error');
      }
    }
    load();

    return () => controller.abort();
  }, []);

  // --------------------------------------------------------
  // CLIP Model Loading
  // --------------------------------------------------------
  useEffect(() => {
    async function loadClip() {
      try {
        const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
        const model = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
        setClipModel({ tokenizer, model });
        setModelStatus('ready');
      } catch {
        setModelStatus('error');
      }
    }
    loadClip();
  }, []);

  // --------------------------------------------------------
  // Camera positions for each mode
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
    const dataRef = data; // Capture for closure

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Camera - start in 2D config
    const config2D = getCameraConfig('2d');
    const camera = new THREE.PerspectiveCamera(config2D.fov, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.copy(config2D.position);
    camera.lookAt(config2D.target);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(config2D.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = SCALE * 4;
    controls.minDistance = 50;
    controls.enableRotate = false; // Start in 2D mode

    // Geometry - create points
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(dataRef.length * 3);
    const colors = new Float32Array(dataRef.length * 3);

    dataRef.forEach((d, i) => {
      positions[i * 3] = d.x;
      positions[i * 3 + 1] = d.y;
      positions[i * 3 + 2] = 0; // Start flat
      colors[i * 3] = 142 / 255;
      colors[i * 3 + 1] = 142 / 255;
      colors[i * 3 + 2] = 147 / 255;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Material
    const material = new THREE.PointsMaterial({
      size: 5,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Raycaster
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points!.threshold = 10;
    const mouse = new THREE.Vector2();

    sceneRef.current = { scene, camera, renderer, controls, points, geometry, raycaster, mouse };

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const anim = animStateRef.current;

      // Handle transition animation
      if (anim.transitioning) {
        const elapsed = now - anim.transitionStart;
        const progress = Math.min(elapsed / TRANSITION_MS, 1);
        const t = easeOutCubic(progress);

        const fromConfig = getCameraConfig(anim.fromMode);
        const toConfig = getCameraConfig(anim.toMode);

        // Animate camera position
        camera.position.lerpVectors(fromConfig.position, toConfig.position, t);
        controls.target.lerpVectors(fromConfig.target, toConfig.target, t);
        camera.fov = lerp(fromConfig.fov, toConfig.fov, t);
        camera.updateProjectionMatrix();

        // Animate point Z positions
        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const posArray = posAttr.array as Float32Array;
        for (let i = 0; i < dataRef.length; i++) {
          const fromZ = anim.fromMode === '2d' ? 0 : dataRef[i].z;
          const toZ = anim.toMode === '2d' ? 0 : dataRef[i].z;
          posArray[i * 3 + 2] = lerp(fromZ, toZ, t);
        }
        posAttr.needsUpdate = true;

        // Transition complete
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

    // Mouse handlers
    const onMouseMove = (e: MouseEvent) => {
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
        scheduleHoverTooltipPosition(e.clientX, e.clientY);
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
          window.open(point.image_url, '_blank');
        }
      }
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);

    return () => {
      container.removeEventListener('mousemove', onMouseMove);
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
  }, [data, getCameraConfig]);

  // --------------------------------------------------------
  // Handle view mode change - trigger transition
  // --------------------------------------------------------
  useEffect(() => {
    const anim = animStateRef.current;

    // Don't trigger if already in target mode or already transitioning to it
    if (anim.currentMode === viewMode && !anim.transitioning) return;
    if (anim.transitioning && anim.toMode === viewMode) return;

    // Start transition
    anim.transitioning = true;
    anim.transitionStart = performance.now();
    anim.fromMode = anim.transitioning ? anim.toMode : anim.currentMode; // Handle mid-transition switches
    anim.toMode = viewMode;

    // Immediately allow rotation when going to 3D
    if (viewMode === '3d' && sceneRef.current) {
      sceneRef.current.controls.enableRotate = true;
    }
  }, [viewMode]);

  // --------------------------------------------------------
  // Update colors when search results change
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
  // Search
  // --------------------------------------------------------

  // API-based search (semantic or visual)
  const searchApi = useCallback(async (q: string, mode: 'semantic' | 'visual'): Promise<ScoredPoint[]> => {
    const params = new URLSearchParams({ q, mode, limit: '50' });
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
        // Return a virtual point for API-only results
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

  // Client-side CLIP search (with LRU caching)
  const searchClip = useCallback(async (q: string): Promise<ScoredPoint[]> => {
    if (!clipModel || !embeddings) return [];

    // Normalize query for cache key
    const cacheKey = q.trim().toLowerCase();

    // Check cache first
    let qEmb = clipEmbeddingCache.get(cacheKey);

    if (!qEmb) {
      // Generate embedding
      const inputs = clipModel.tokenizer(q, { padding: true, truncation: true, max_length: 77 });
      const { text_embeds } = await clipModel.model(inputs);
      qEmb = text_embeds.data as Float32Array;

      // L2 normalize
      const norm = Math.sqrt(qEmb.reduce((s, v) => s + v * v, 0));
      for (let i = 0; i < qEmb.length; i++) qEmb[i] /= norm;

      // Cache the normalized embedding
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

  // Main search handler
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

      if (searchMode === 'clip') {
        if (!clipModel || !embeddings) return;
        scored = await searchClip(q);
      } else if (searchMode === 'semantic') {
        scored = await searchApi(q, 'semantic');
      } else if (searchMode === 'hybrid') {
        // Run both CLIP and semantic in parallel, merge results
        const [clipResults, semanticResults] = await Promise.all([
          clipModel && embeddings ? searchClip(q) : Promise.resolve([]),
          searchApi(q, 'semantic'),
        ]);

        // Dynamic weighting: short queries favor CLIP (visual), longer queries favor BGE (semantic)
        // - 1-2 words: 80% CLIP, 20% semantic (visual concepts like "church", "bridge")
        // - 3-4 words: 60% CLIP, 40% semantic (mixed queries)
        // - 5+ words: 40% CLIP, 60% semantic (descriptive queries)
        const wordCount = q.trim().split(/\s+/).length;
        const clipWeight = wordCount <= 2 ? 0.8 : wordCount <= 4 ? 0.6 : 0.4;
        const semanticWeight = 1 - clipWeight;

        // Merge and dedupe by id, combining weighted scores
        const merged = new Map<string, ScoredPoint>();
        for (const r of clipResults) {
          merged.set(r.id, { ...r, similarity: r.similarity * clipWeight });
        }
        for (const r of semanticResults) {
          const existing = merged.get(r.id);
          if (existing) {
            existing.similarity += r.similarity * semanticWeight;
          } else {
            merged.set(r.id, { ...r, similarity: r.similarity * semanticWeight });
          }
        }
        scored = Array.from(merged.values())
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 100);
      }

      setResults(scored);
      setSelectedIndex(-1);
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
      if (e.key === 'Escape') {
        setResults([]);
        setSelectedIndex(-1);
        setQuery('');
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
          window.open(topResults[selectedIndex].image_url, '_blank');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topResults, selectedIndex, selectResult]);

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

  return (
    <div className="w-screen h-screen bg-black text-white font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display',sans-serif] antialiased select-none">
      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center gap-4">
          <Spinner />
          <p className="text-white/50 text-sm">Loading embeddings...</p>
        </div>
      )}

      {/* Three.js Canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hover Tooltip */}
      {hoverPoint && (
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
              <p className="text-xs text-white/70 mt-2 leading-relaxed">{hoverPoint.vlm_caption}</p>
            )}
          </div>
        </GlassPanel>
      )}

      {/* View Toggle */}
      <GlassPanel className="fixed top-5 left-5 z-30 rounded-xl p-1 flex">
        {(['2d', '3d'] as const).map(v => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            className={`px-5 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
              viewMode === v
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </GlassPanel>

      {/* Search Mode Toggle */}
      <GlassPanel className="fixed top-5 left-32 z-30 rounded-xl p-1 flex">
        {([
          { mode: 'clip' as const, label: 'Visual', title: 'Client-side CLIP image similarity' },
          { mode: 'semantic' as const, label: 'Text', title: 'Server-side BGE text search (uses VLM captions)' },
          { mode: 'hybrid' as const, label: 'Hybrid', title: 'Combined visual + text search' },
        ]).map(({ mode, label, title }) => (
          <button
            key={mode}
            onClick={() => setSearchMode(mode)}
            title={title}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
              searchMode === mode
                ? 'bg-white/15 text-white'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </GlassPanel>

      {/* Search */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-30 w-[400px]">
        <GlassPanel className="rounded-2xl flex items-center transition-shadow duration-200 focus-within:ring-1 focus-within:ring-white/20">
          <div className="pl-4 pr-2 text-white/40">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search images..."
            className="flex-1 py-3.5 pr-3 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
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

      {/* Info Panel */}
      <GlassPanel className="fixed bottom-5 left-5 z-30 rounded-2xl px-5 py-4">
        <p className="text-sm font-semibold text-white mb-0.5">Montreal Archives</p>
        <p className="text-xs text-white/50">
          {data.length.toLocaleString()} images · CLIP embeddings
        </p>
      </GlassPanel>

      {/* Model Status */}
      {modelStatus !== 'ready' && (
        <GlassPanel className="fixed bottom-5 right-5 z-30 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
          {modelStatus === 'loading' && <Spinner size="sm" />}
          <span className={`text-xs ${modelStatus === 'error' ? 'text-red-400' : 'text-white/50'}`}>
            {modelStatus === 'loading' ? 'Loading CLIP...' : 'CLIP unavailable'}
          </span>
        </GlassPanel>
      )}

      {/* Results Panel */}
      {topResults.length > 0 && (
        <GlassPanel className="fixed top-20 right-5 z-30 rounded-2xl w-[360px] overflow-hidden">
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
          <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
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
                  onDoubleClick={() => r.image_url && window.open(r.image_url, '_blank')}
                  className={`group px-5 py-4 cursor-pointer transition-colors border-b border-white/5 last:border-0 ${
                    i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Thumbnail */}
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

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      {/* Name row */}
                      {r.name && (
                        <div className="flex items-center gap-1 group/row">
                          <p className="text-sm text-white font-medium truncate flex-1">{r.name}</p>
                          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                            <CopyButton text={r.name} label="Name copied" onCopy={showToast} />
                          </div>
                        </div>
                      )}

                      {/* Date row */}
                      {r.date && (
                        <div className="flex items-center gap-1 mt-1 group/row">
                          <p className="text-xs text-white/50 flex-1">{r.date}</p>
                          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                            <CopyButton text={r.date} label="Date copied" onCopy={showToast} />
                          </div>
                        </div>
                      )}

                      {/* Caption row */}
                      {r.vlm_caption && (
                        <div className="flex items-start gap-1 mt-2 group/row">
                          <p className="text-xs text-white/60 flex-1 line-clamp-2 leading-relaxed">{r.vlm_caption}</p>
                          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity flex-shrink-0">
                            <CopyButton text={r.vlm_caption} label="Description copied" onCopy={showToast} />
                          </div>
                        </div>
                      )}

                      {/* Similarity score */}
                      <div className="flex items-center gap-2 mt-2.5">
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

                  {/* Copy All button - appears on hover */}
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
                </div>
              );
            })}
          </div>
        </GlassPanel>
      )}

      {/* Toast notification */}
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
