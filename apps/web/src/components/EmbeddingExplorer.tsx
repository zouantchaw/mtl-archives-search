import { useState, useEffect, useCallback, useMemo } from 'react';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, PointCloudLayer } from '@deck.gl/layers';
import { OrthographicView, OrbitView, OrthographicViewState, OrbitViewState, LinearInterpolator } from '@deck.gl/core';
import { AutoTokenizer, CLIPTextModelWithProjection, env as transformersEnv } from '@xenova/transformers';

// Transformers.js config
transformersEnv.allowLocalModels = false;

// Constants
const DATA_URL_2D = '/embeddings_2d.json';
const DATA_URL_512D = '/embeddings_512d.bin';
const DATA_URL_IDS = '/embeddings_ids.json';

const INITIAL_VIEW_STATE_2D: OrthographicViewState = {
  target: [500, 500, 0],
  zoom: 0,
  minZoom: -2,
  maxZoom: 8,
};

const INITIAL_VIEW_STATE_3D: OrbitViewState = {
  target: [500, 500, 50],
  rotationX: 45,
  rotationOrbit: 45,
  zoom: 0,
  minZoom: -2,
  maxZoom: 8,
};


const SCALE = 1000;
const POINT_RADIUS = 4;

type Point = {
  id: string;
  x: number;
  y: number;
  z: number; // Add Z for 3D
  name: string;
  date: string;
  image_url: string;
  embeddingIndex: number;
  similarity?: number;
};

type SearchResult = Point & { similarity: number };

// Helper Functions
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function EmbeddingExplorer() {
  const [data, setData] = useState<Point[]>([]);
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingText, setLoadingText] = useState('Loading embeddings...');

  const [currentView, setCurrentView] = useState<'2d' | '3d'>('2d');
  const [viewState2D, setViewState2D] = useState<OrthographicViewState>(INITIAL_VIEW_STATE_2D);
  const [viewState3D, setViewState3D] = useState<OrbitViewState>(INITIAL_VIEW_STATE_3D);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);

  // Search State
  const [clipModel, setClipModel] = useState<{ tokenizer: any, model: any } | null>(null);
  const [modelStatus, setModelStatus] = useState('Loading CLIP model...');
  const [searchStatus, setSearchStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [embeddings, setEmbeddings] = useState<{ data: Float32Array; ids: string[]; dims: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Data Loading
  useEffect(() => {
    async function loadAllData() {
      try {
        setLoadingText('Loading 2D coordinates...');
        const response2d = await fetch(DATA_URL_2D);
        if (!response2d.ok) throw new Error('Failed to load 2D embeddings');

        setLoadingText('Loading 512D embeddings (28MB)...');
        const [response512d, responseIds] = await Promise.all([
          fetch(DATA_URL_512D),
          fetch(DATA_URL_IDS),
        ]);

        if (!response512d.ok || !responseIds.ok) {
          throw new Error('Failed to load 512D embeddings');
        }

        const raw2d = await response2d.json();
        const buffer512d = await response512d.arrayBuffer();
        const ids512d = await responseIds.json();

        // Parse 512D embeddings
        const header = new Uint32Array(buffer512d, 0, 2);
        const [numVectors, dims] = header;
        console.log(`Loaded ${numVectors} vectors of ${dims} dimensions`);
        const embeddingData = new Float32Array(buffer512d, 8);
        setEmbeddings({ data: embeddingData, ids: ids512d, dims });

        const idToIndex = new Map(ids512d.map((id: string, i: number) => [id, i]));

        const scaledData = raw2d.map((d: any) => ({
          ...d,
          x: d.x * SCALE,
          y: d.y * SCALE,
          z: Math.random() * 100, // Random Z for now
          embeddingIndex: idToIndex.get(d.id) ?? -1,
        }));
        setData(scaledData);
        setIsLoading(false);
      } catch (err) {
        console.error(err);
        setLoadingText(`Failed to load data: ${err}`);
      }
    }
    loadAllData();
  }, []);

  // CLIP Model Loading
  useEffect(() => {
    async function loadClip() {
      try {
        setModelStatus('Loading CLIP tokenizer...');
        const tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
        setModelStatus('Loading CLIP text model...');
        const model = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
        setClipModel({ tokenizer, model });
        setModelStatus('CLIP ready');
      } catch (err) {
        console.error('Failed to load CLIP:', err);
        setModelStatus('CLIP unavailable');
      }
    }
    loadClip();
  }, []);

  // Search Logic
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchStatus('');
      setSelectedResultIndex(-1);
      return;
    }

    if (!clipModel) {
      setSearchStatus('Model loading...');
      return;
    }

    if (!embeddings) {
      setSearchStatus('Embeddings not loaded');
      return;
    }

    // Prevent concurrent searches
    if (isSearching) return;
    setIsSearching(true);

    setSearchStatus('Searching...');
    await new Promise(r => setTimeout(r, 50)); // Allow UI to update

    try {
      const textInputs = clipModel.tokenizer(query, { padding: true, truncation: true, max_length: 77 });
      const { text_embeds } = await clipModel.model(textInputs);
      const queryEmbedding = text_embeds.data as Float32Array;

      // Normalize query embedding
      const norm = Math.sqrt(queryEmbedding.reduce((s, v) => s + v * v, 0));
      for (let i = 0; i < queryEmbedding.length; i++) {
        queryEmbedding[i] /= norm;
      }

      const scored = data
        .map(point => {
          if (point.embeddingIndex === -1) return null;

          const offset = point.embeddingIndex * embeddings.dims;
          const imageEmbedding = embeddings.data.subarray(offset, offset + embeddings.dims);

          const similarity = cosineSimilarity(queryEmbedding, imageEmbedding);
          return { ...point, similarity };
        })
        .filter((p): p is SearchResult => p !== null)
        .sort((a, b) => b.similarity - a.similarity);

      const topScore = scored[0]?.similarity || 0;
      const threshold = Math.max(topScore * 0.7, 0.15);
      const matchCount = scored.filter(d => d.similarity >= threshold).length;

      setSearchResults(scored.slice(0, 100)); // Keep top 100
      setSelectedResultIndex(-1);
      setSearchStatus(`${matchCount} matches (top: ${topScore.toFixed(3)})`);
    } catch (err) {
      console.error('Search error:', err);
      setSearchStatus('Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [clipModel, embeddings, data, isSearching]);

  useEffect(() => {
    const handler = setTimeout(() => performSearch(searchQuery), 300);
    return () => clearTimeout(handler);
  }, [searchQuery, performSearch]);


  const topResults = useMemo(() => searchResults.slice(0, 5), [searchResults]);

  const getPointColor = useCallback((d: Point): [number, number, number, number] => {
    // Check if this is the selected result
    if (selectedResultIndex >= 0 && topResults[selectedResultIndex]?.id === d.id) {
      return [255, 59, 48, 255]; // Bright red for selected
    }

    // Check if this is one of the top results
    const topResultIndex = topResults.findIndex(r => r.id === d.id);
    if (topResultIndex >= 0) {
      const intensity = 1 - topResultIndex / 5;
      return [255, 149 + intensity * 50, 0, 220 + intensity * 35];
    }

    // Highlight search results
    const searchResult = searchResults.find(r => r.id === d.id);
    if (searchResult) {
      const intensity = Math.pow(searchResult.similarity, 2);
      return [
        10 + intensity * 245,
        132 - intensity * 50,
        255 - intensity * 155,
        200 + intensity * 55,
      ];
    }

    // Color by date
    if (d.date) {
      const year = parseInt(d.date);
      if (year < 1930) return [255, 149, 0, 180];
      if (year < 1950) return [255, 214, 10, 180];
      if (year < 1970) return [48, 209, 88, 180];
      return [10, 132, 255, 180];
    }

    return [142, 142, 147, 150];
  }, [searchResults, topResults, selectedResultIndex]);

  const layers = useMemo(() => {
    if (currentView === '3d') {
      return [
        new PointCloudLayer<Point>({
          id: 'point-cloud',
          data,
          getPosition: d => [d.x, d.y, d.z],
          getColor: getPointColor,
          pointSize: 8,
          pickable: true,
          onHover: info => setHoverInfo(info),
          onClick: ({ object }) => {
            if (object?.image_url) window.open(object.image_url, '_blank')
          },
          updateTriggers: {
            getColor: [searchResults, topResults, selectedResultIndex],
          }
        })
      ];
    }
    return [
      new ScatterplotLayer<Point>({
        id: 'scatter',
        data,
        getPosition: d => [d.x, d.y],
        getRadius: POINT_RADIUS,
        getFillColor: getPointColor,
        pickable: true,
        onHover: info => setHoverInfo(info),
        onClick: ({ object }) => {
          if (object?.image_url) window.open(object.image_url, '_blank')
        },
        radiusMinPixels: 2,
        radiusMaxPixels: 12,
        updateTriggers: {
          getFillColor: [searchResults, topResults, selectedResultIndex],
        }
      }),
    ];
  }, [data, searchResults, topResults, selectedResultIndex, getPointColor, currentView]);

  // Handle result selection with zoom-to-point
  const selectResult = useCallback((index: number) => {
    const result = topResults[index];
    if (!result) return;
    setSelectedResultIndex(index);

    if (currentView === '2d') {
      setViewState2D(prev => ({
        ...prev,
        target: [result.x, result.y, 0],
        zoom: 4,
        transitionDuration: 500,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
      }));
    } else {
      setViewState3D(prev => ({
        ...prev,
        target: [result.x, result.y, result.z],
        zoom: 4,
        transitionDuration: 500,
        transitionInterpolator: new LinearInterpolator(['target', 'zoom']),
      }));
    }
  }, [topResults, currentView]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchResults([]);
        setSelectedResultIndex(-1);
      }
      if (topResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const newIndex = Math.min(selectedResultIndex + 1, topResults.length - 1);
          selectResult(newIndex);
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const newIndex = Math.max(selectedResultIndex - 1, 0);
          selectResult(newIndex);
        }
        if (e.key === 'Enter' && selectedResultIndex >= 0) {
          const result = topResults[selectedResultIndex];
          if (result?.image_url) {
            window.open(result.image_url, '_blank');
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [topResults, selectedResultIndex, selectResult]);

  const currentViewState = currentView === '2d' ? viewState2D : viewState3D;
  const currentView$ = currentView === '2d'
    ? new OrthographicView({ id: 'ortho' })
    : new OrbitView({ id: 'orbit', orbitAxis: 'Z' });

  return (
    <div className="relative w-screen h-screen bg-black">
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-700 border-t-white rounded-full animate-spin mb-4" />
          <div className="text-gray-400 text-sm">{loadingText}</div>
        </div>
      )}

      <DeckGL
        layers={layers}
        views={currentView$}
        viewState={currentViewState}
        onViewStateChange={({ viewState }) => {
          if (currentView === '2d') {
            setViewState2D(viewState as OrthographicViewState);
          } else {
            setViewState3D(viewState as OrbitViewState);
          }
        }}
        controller={true}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      >
        {hoverInfo?.object && (
          <div
            className="absolute bg-gray-800/80 backdrop-blur-sm p-3 rounded-lg shadow-lg pointer-events-none"
            style={{
              left: hoverInfo.x + 10,
              top: hoverInfo.y + 10,
              maxWidth: 320,
            }}
          >
            {hoverInfo.object.image_url && (
              <img
                src={hoverInfo.object.image_url}
                alt={hoverInfo.object.name}
                className="w-full h-auto rounded-md mb-2"
              />
            )}
            <h3 className="text-white font-semibold text-sm">{hoverInfo.object.name || 'Untitled'}</h3>
            <p className="text-gray-400 text-xs">{hoverInfo.object.date || 'Unknown date'}</p>
          </div>
        )}
      </DeckGL>

      <div className="absolute top-6 left-6 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 p-1 bg-gray-800/80 backdrop-blur-sm rounded-lg border border-gray-700">
          <button onClick={() => setCurrentView('2d')} className={`px-4 py-1.5 text-sm rounded-md ${currentView === '2d' ? 'bg-blue-500 text-white' : 'text-gray-300'}`}>2D</button>
          <button onClick={() => setCurrentView('3d')} className={`px-4 py-1.5 text-sm rounded-md ${currentView === '3d' ? 'bg-blue-500 text-white' : 'text-gray-300'}`}>3D</button>
        </div>
      </div>

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center bg-gray-800/80 backdrop-blur-xl border border-gray-700 rounded-2xl px-1 shadow-xl w-[400px] focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/15 transition-all">
          <div className="px-4 text-gray-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
          </div>
          <input
            type="text"
            placeholder="Search images with CLIP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 py-3 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
          />
          {searchStatus && (
            <div className={`px-4 text-xs whitespace-nowrap ${isSearching ? 'text-blue-400' : 'text-gray-500'}`}>
              {searchStatus}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-6 left-6 z-10 p-4 bg-gray-800/80 backdrop-blur-xl rounded-2xl border border-gray-700 max-w-[280px]">
        <h2 className="text-white font-semibold text-sm mb-1">Montreal Archives</h2>
        <p className="text-gray-400 text-xs leading-relaxed">
          <strong className="text-white">{data.length.toLocaleString()}</strong> images<br />
          CLIP embeddings projected to 2D via UMAP<br />
          Scroll to zoom, drag to pan
        </p>
      </div>

      {/* Model status indicator */}
      <div className={`absolute bottom-6 right-6 z-10 px-4 py-3 bg-gray-800/80 backdrop-blur-xl rounded-xl border border-gray-700 text-xs transition-opacity ${
        modelStatus === 'CLIP ready' ? 'text-green-400' : 'text-gray-400'
      } ${modelStatus === 'CLIP ready' ? 'opacity-0 pointer-events-none' : ''}`} style={{ transitionDelay: modelStatus === 'CLIP ready' ? '2000ms' : '0ms' }}>
        {modelStatus}
      </div>

      {topResults.length > 0 && (
        <div className="absolute top-24 right-6 z-10 bg-gray-800/80 backdrop-blur-sm rounded-2xl border border-gray-700 w-80 max-h-[calc(100vh-150px)] overflow-hidden shadow-xl">
          <div className="flex justify-between items-center px-5 py-4 border-b border-gray-700">
            <div>
              <h3 className="text-white font-semibold text-sm">Top Matches</h3>
              <p className="text-gray-400 text-xs">"{searchQuery}" · top: {topResults[0]?.similarity.toFixed(3)}</p>
            </div>
            <button
              onClick={() => { setSearchResults([]); setSelectedResultIndex(-1); }}
              className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-gray-400 hover:text-white"
            >
              ×
            </button>
          </div>
          <div className="p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
            {topResults.map((result, i) => (
              <div
                key={result.id}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors relative ${
                  i === selectedResultIndex ? 'bg-blue-500/20' : 'hover:bg-gray-700/50'
                }`}
                onClick={() => selectResult(i)}
                onDoubleClick={() => result.image_url && window.open(result.image_url, '_blank')}
              >
                <div className="absolute top-2 left-2 w-5 h-5 bg-blue-500 rounded-md flex items-center justify-center text-white text-xs font-semibold z-10">
                  {i + 1}
                </div>
                {result.image_url ? (
                  <img src={result.image_url} className="w-16 h-16 object-cover rounded-lg bg-gray-700 flex-shrink-0" loading="lazy" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-700 flex items-center justify-center text-gray-500 flex-shrink-0">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <path d="M21 15l-5-5L5 21"></path>
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium line-clamp-2">{result.name || 'Untitled'}</p>
                  <p className="text-xs text-gray-400">{result.date || 'Unknown date'}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs font-semibold text-green-400 bg-green-400/15 px-2 py-0.5 rounded">
                      {(result.similarity * 100).toFixed(1)}%
                    </span>
                    <div className="w-10 h-1 bg-gray-700 rounded overflow-hidden">
                      <div
                        className="h-full bg-green-400 rounded"
                        style={{ width: `${Math.min((result.similarity / topResults[0].similarity) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
