import { useEffect, useRef, useState } from "react";
import { RotateCw, Maximize, Minus, Plus, ExternalLink } from "lucide-react";
export function Viewer({
  id,
  rotation,
  onRotate,
}: {
  id: string;
  rotation: number;
  onRotate: () => void;
}) {
  const box = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    );
  const [size, setSize] = useState({ w: 600, h: 500 }),
    [natural, setNatural] = useState({ w: 1024, h: 1024 }),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [full, setFull] = useState(false),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFull(false);
    setLoaded(false);
    setFailed(false);
  }, [id]);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [rotation]);
  const sideways = rotation === 90 || rotation === 270;
  const fit = Math.min(
    (size.w - 24) / (sideways ? natural.h : natural.w),
    (size.h - 24) / (sideways ? natural.w : natural.h),
  );
  const change = (v: number) => setZoom(Math.min(8, Math.max(1, v)));
  return (
    <>
      <div
        ref={box}
        className="image-canvas"
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        style={{ cursor: zoom > 1 ? "grab" : "default" }}
      >
        {!loaded && !failed && (
          <span className="image-message">Loading preserved image…</span>
        )}
        {failed && (
          <span className="image-message" role="alert">
            Image did not load. Reload or check your sign-in.
          </span>
        )}
        <img
          key={`${id}-${full}`}
          src={`/api/media/${id}/${full ? "full" : "preview"}`}
          alt={`Archive candidate ${id}`}
          draggable={false}
          onLoad={(e) => {
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            });
            setLoaded(true);
            setFailed(false);
          }}
          onError={() => {
            setFailed(true);
            setLoaded(false);
          }}
          style={{
            width: natural.w * fit,
            height: natural.h * fit,
            opacity: loaded ? 1 : 0,
            transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
          }}
        />
      </div>
      <div className="viewer-tools">
        <button
          onClick={onRotate}
          title="Rotate view 90°. This records a recommended rotation; source bytes stay preserved."
        >
          <RotateCw size={18} />
          Rotate
        </button>
        <button
          onClick={() => {
            setFull(!full);
            setLoaded(false);
          }}
        >
          <ExternalLink size={16} />
          {full ? "Preview" : "Full image"}
        </button>
        <span className="tools-spacer" />
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <Maximize size={18} />
          Fit
        </button>
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            disabled={zoom === 1}
            onClick={() => change(zoom - 0.5)}
          >
            <Minus size={18} />
          </button>
          <span className="zoom-label">{zoom.toFixed(1)}×</span>
          <button
            aria-label="Zoom in"
            disabled={zoom === 8}
            onClick={() => change(zoom + 0.5)}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
