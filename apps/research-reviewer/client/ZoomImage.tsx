import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { pointInImage, rectBetween, type Rect } from "./inspection";
export type ZoomHandle = {
  zoomBy: (factor: number) => void;
  fit: () => void;
  actual: () => void;
};
type Props = {
  src: string;
  alt: string;
  rotation?: number;
  filter?: string;
  selecting?: boolean;
  onSelect?: (rect: Rect) => void;
  highlight?: Rect | null;
  onLoad?: (w: number, h: number) => void;
  onError?: () => void;
  onZoom?: (zoom: number) => void;
  children?: ReactNode;
};
// One display-only viewer: pinch / ctrl+wheel zooms at the pointer, scroll and
// drag pan, double-click toggles a close look. Source pixels are never altered.
export const ZoomImage = forwardRef<ZoomHandle, Props>(function ZoomImage(
  {
    src,
    alt,
    rotation = 0,
    filter,
    selecting,
    onSelect,
    highlight,
    onLoad,
    onError,
    onZoom,
    children,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    ),
    selectionStart = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 }),
    [natural, setNatural] = useState({ w: 0, h: 0 }),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false),
    [live, setLive] = useState<Rect | null>(null);
  const view = useRef({ zoom, pan });
  view.current = { zoom, pan };
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [rotation]);
  useEffect(() => onZoom?.(zoom), [zoom]);
  const sideways = rotation === 90 || rotation === 270;
  const fit =
    natural.w && size.w
      ? Math.min(
          (size.w - 16) / (sideways ? natural.h : natural.w),
          (size.h - 16) / (sideways ? natural.w : natural.h),
        )
      : 1;
  const maxZoom = Math.max(8, 3 / fit);
  function zoomAt(next: number, at?: { x: number; y: number }) {
    const { zoom: z, pan: p } = view.current;
    const target = Math.min(maxZoom, Math.max(1, next));
    const r = target / z,
      q = at ?? { x: 0, y: 0 };
    setZoom(target);
    setPan(
      target === 1
        ? { x: 0, y: 0 }
        : { x: (1 - r) * q.x + r * p.x, y: (1 - r) * q.y + r * p.y },
    );
  }
  function local(e: { clientX: number; clientY: number }) {
    const b = host.current!.getBoundingClientRect();
    return { x: e.clientX - b.left - size.w / 2, y: e.clientY - b.top - size.h / 2 };
  }
  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(view.current.zoom * f),
    fit: () => zoomAt(1),
    actual: () => zoomAt(1 / fit),
  }));
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(view.current.zoom * Math.exp(-e.deltaY / 200), local(e));
      } else if (view.current.zoom > 1) {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  function imagePoint(e: React.PointerEvent) {
    const q = local(e);
    return pointInImage(
      q.x - pan.x,
      q.y - pan.y,
      natural.w * fit * zoom,
      natural.h * fit * zoom,
      rotation,
    );
  }
  const plane = {
    width: natural.w * fit,
    height: natural.h * fit,
    transform: `translate(calc(-50% + ${pan.x}px),calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
  };
  const shown = live ?? highlight;
  return (
    <div
      ref={host}
      className="zoom-image"
      data-selecting={selecting || undefined}
      data-zoomed={zoom > 1 || undefined}
      onDoubleClick={(e) =>
        zoomAt(zoom > 1.05 ? 1 : Math.min(maxZoom, 2.5), local(e))
      }
      onPointerDown={(e) => {
        if (!loaded) return;
        if (selecting) {
          const p = imagePoint(e);
          if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
          selectionStart.current = p;
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
          if (next.w >= 50 && next.h >= 50) onSelect?.(next);
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
    >
      {!loaded && !failed && (
        <span className="image-message">Loading image…</span>
      )}
      {failed && (
        <span className="image-message" role="alert">
          Image did not load. Reload or check your sign-in.
        </span>
      )}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          const w = e.currentTarget.naturalWidth,
            h = e.currentTarget.naturalHeight;
          setNatural({ w, h });
          setLoaded(true);
          setFailed(false);
          onLoad?.(w, h);
        }}
        onError={() => {
          setFailed(true);
          setLoaded(false);
          onError?.();
        }}
        style={{ ...plane, opacity: loaded ? 1 : 0, filter }}
      />
      {loaded && shown && (shown.w < 10000 || shown.h < 10000) && (
        <div className="selection-plane" aria-hidden="true" style={plane}>
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
      {children}
    </div>
  );
});
