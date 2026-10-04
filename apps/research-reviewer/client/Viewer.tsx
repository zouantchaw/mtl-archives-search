import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  RotateCw,
  Maximize,
  Minus,
  Plus,
  ExternalLink,
  Scan,
} from "lucide-react";
import { areas, pointInImage, rectBetween, type Rect } from "./inspection";
export function Viewer({
  id,
  rotation,
  onRotate,
  rect,
  onSelect,
}: {
  id: string;
  rotation: number;
  onRotate: () => void;
  rect?: Rect;
  onSelect?: (rect: Rect) => void;
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
  const [selecting, setSelecting] = useState(false),
    [live, setLive] = useState<Rect | null>(null),
    [brightness, setBrightness] = useState(100),
    [contrast, setContrast] = useState(100);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
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
    setBrightness(100);
    setContrast(100);
    setLive(null);
    setSelecting(false);
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
  function imagePoint(e: React.PointerEvent<HTMLDivElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    return pointInImage(
      e.clientX - bounds.left - size.w / 2 - pan.x,
      e.clientY - bounds.top - size.h / 2 - pan.y,
      natural.w * fit * zoom,
      natural.h * fit * zoom,
      rotation,
    );
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }
  const shown = live ?? rect;
  return (
    <>
      <div
        ref={box}
        className="image-canvas"
        onPointerDown={(e) => {
          if (selecting && loaded) {
            const p = imagePoint(e);
            if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
            selectionStart.current = p;
            setLive(null);
            e.currentTarget.setPointerCapture(e.pointerId);
            return;
          }
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (selectionStart.current) {
            setLive(rectBetween(selectionStart.current, imagePoint(e)));
            return;
          }
          if (drag.current)
            setPan({
              x: drag.current.px + e.clientX - drag.current.x,
              y: drag.current.py + e.clientY - drag.current.y,
            });
        }}
        onPointerUp={(e) => {
          if (selectionStart.current) {
            const next = rectBetween(selectionStart.current, imagePoint(e));
            if (next.w >= 50 && next.h >= 50) {
              onSelect?.(next);
              setSelecting(false);
            }
            setLive(null);
            selectionStart.current = null;
          }
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          selectionStart.current = null;
          setLive(null);
        }}
        style={{
          cursor: selecting ? "crosshair" : zoom > 1 ? "grab" : "default",
          touchAction: selecting || zoom > 1 ? "none" : "pan-y",
        }}
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
            filter: `brightness(${brightness}%) contrast(${contrast}%)`,
            transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
          }}
        />
        {loaded && shown && (shown.w < 10000 || shown.h < 10000) && (
          <div
            className="selection-plane"
            aria-hidden="true"
            style={{
              width: natural.w * fit,
              height: natural.h * fit,
              transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
            }}
          >
            <div
              className="selected-area"
              style={{
                left: `${shown.x / 100}%`,
                top: `${shown.y / 100}%`,
                width: `${shown.w / 100}%`,
                height: `${shown.h / 100}%`,
              }}
            />
          </div>
        )}
        {selecting && (
          <span className="select-instruction">
            Drag around a detail. On touch, drag with one finger.
          </span>
        )}
      </div>
      <div className="viewer-tools">
        <Button
          variant="ghost"
          onClick={onRotate}
          title="Rotate view 90°. This records a recommended rotation; source bytes stay preserved."
        >
          <RotateCw size={18} />
          Rotate
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFull(!full);
            setLoaded(false);
          }}
        >
          <ExternalLink size={16} />
          {full ? "Preview" : "Full image"}
        </Button>
        {onSelect && (
          <Button
            variant="ghost"
            aria-pressed={selecting}
            onClick={() => setSelecting(!selecting)}
          >
            <Scan size={17} />
            Select area
          </Button>
        )}
        <span className="tools-spacer" />
        <Button
          variant="ghost"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <Maximize size={18} />
          Fit
        </Button>
        <div className="zoom-controls">
          <Button
            variant="ghost"
            aria-label="Zoom out"
            disabled={zoom === 1}
            onClick={() => change(zoom - 0.5)}
          >
            <Minus size={18} />
          </Button>
          <span className="zoom-label">{zoom.toFixed(1)}×</span>
          <Button
            variant="ghost"
            aria-label="Zoom in"
            disabled={zoom === 8}
            onClick={() => change(zoom + 0.5)}
          >
            <Plus size={18} />
          </Button>
        </div>
      </div>
      <div className="inspection-tools">
        {onSelect && (
          <label>
            Check edges{" "}
            <select
              aria-label="Inspect an edge"
              value={
                Object.keys(areas).find(
                  (k) => JSON.stringify(areas[k]) === JSON.stringify(rect),
                ) ?? "Custom area"
              }
              onChange={(e) => {
                onSelect(areas[e.target.value]);
                setSelecting(false);
              }}
            >
              <option disabled>Custom area</option>
              {Object.keys(areas).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        )}
        <details>
          <summary>View adjustments</summary>
          <div className="adjustments">
            <label>
              Brightness{" "}
              <input
                type="range"
                min="60"
                max="180"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
            </label>
            <label>
              Contrast{" "}
              <input
                type="range"
                min="60"
                max="180"
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                setBrightness(100);
                setContrast(100);
                resetView();
              }}
            >
              Reset view
            </Button>
            <small>
              Display only. Model help uses pixels without these adjustments.
            </small>
          </div>
        </details>
        <small>
          {full ? "Original file" : "Preview"} ·{" "}
          {loaded
            ? `${natural.w.toLocaleString()} × ${natural.h.toLocaleString()}`
            : "loading"}
        </small>
      </div>
    </>
  );
}
