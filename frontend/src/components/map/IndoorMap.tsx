"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  MAP_DATA,
  isSelectableRoom,
  polygonCentroid,
  type Room,
} from "@/data/mapData";

/**
 * IndoorMap — React port of the legacy `assets/floorplan.js`.
 *
 * Architecture matches the legacy file:
 *   • A wrapper <div> sized to the DISPLAYED image dimensions
 *     (computed from container size vs image aspect, not a hardcoded
 *     box) gets all pan/zoom transforms.
 *   • Inside: an <img> filling the wrapper + an <svg viewBox="0 0 100 100">
 *     overlaid at identical dimensions. Room point coords are already
 *     percentages, so they map 1:1 to the viewBox.
 *   • Pan/zoom write directly to `wrapperRef.current.style.transform`
 *     — never to React state — so the 60 Hz interaction never triggers
 *     a re-render.
 *   • Rotation from the legacy file is intentionally out of scope.
 *
 * Numeric constants match the legacy file:
 *   • minScale = 0.3, maxScale = 8
 *   • wheel zoom factor = 0.9 / 1.1
 *   • drag threshold = 5 px
 *   • auto-center scale clamp = max(1.5, min(currentScale, 4))
 *   • double-click zoom = ×2
 *   • keyboard '0' = reset, no rotate shortcut here
 */

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

export interface IndoorMapHandle {
  /** Smoothly pan + zoom to center `roomId` in the viewport. */
  panToRoom: (roomId: string) => void;
  /** Reset to the initial fit-to-container transform. */
  resetView: () => void;
  /** Imperatively change zoom around the viewport center. */
  zoomBy: (factor: number) => void;
}

export interface IndoorMapProps {
  /** Currently focused room. Renders an accent fill + drop-shadow on its polygon. */
  selectedRoomId?: string | null;
  /**
   * Pre-built SVG `d` string for the navigation route. Caller is
   * expected to produce this by calling `engine.toSvgPath(result.smoothPoints)`.
   */
  routePath?: string | null;
  /** Endpoints to draw markers for (typically `points[0]` and `points.at(-1)`). */
  routeStart?: { x: number; y: number } | null;
  routeEnd?: { x: number; y: number } | null;
  onRoomClick?: (room: Room) => void;
  onMapClick?: (e: React.MouseEvent<SVGSVGElement>) => void;
  /** Override the default `/base-map.jpg` if needed. */
  baseImageSrc?: string;
  className?: string;
}

// Legacy floorplan.js constants
const MIN_SCALE = 0.3;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 5;
const WHEEL_FACTOR_IN = 1.1;
const WHEEL_FACTOR_OUT = 0.9;
const DOUBLE_CLICK_ZOOM = 2;

// ──────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────

export const IndoorMap = forwardRef<IndoorMapHandle, IndoorMapProps>(function IndoorMap(
  {
    selectedRoomId,
    routePath,
    routeStart,
    routeEnd,
    onRoomClick,
    onMapClick,
    baseImageSrc = "/base-map.jpg",
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Pan/zoom/displayed-image state — all in refs, never React state.
  // Mirrors the legacy field names: scale, panX, panY, _displayW, _displayH.
  const stateRef = useRef({
    scale: 1,
    panX: 0,
    panY: 0,
    displayW: 0,
    displayH: 0,
    imgW: 0,
    imgH: 0,
  });

  // Drag bookkeeping
  const dragRef = useRef({
    panning: false,
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  // For error state we DO need React (it triggers a UI swap).
  const [imageError, setImageError] = useState<string | null>(null);

  // ── Transform helpers ────────────────────────────────────────────

  const apply = useCallback((smooth = false) => {
    const w = wrapperRef.current;
    if (!w) return;
    const { scale, panX, panY } = stateRef.current;
    if (smooth) {
      w.style.transition = "transform 0.4s ease";
      window.setTimeout(() => {
        if (wrapperRef.current) wrapperRef.current.style.transition = "";
      }, 450);
    }
    w.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }, []);

  // Fit-to-container: replicates the legacy `_fit()`.
  // 1. Compute displayed image size from container vs image aspect.
  // 2. Resize the wrapper to those dimensions.
  // 3. Center it inside the container at scale=1.
  const fit = useCallback(() => {
    const c = containerRef.current;
    const w = wrapperRef.current;
    const s = stateRef.current;
    if (!c || !w || !s.imgW || !s.imgH) return;
    const cr = c.getBoundingClientRect();
    const imgAspect = s.imgW / s.imgH;
    const containerAspect = cr.width / cr.height;

    let displayW: number;
    let displayH: number;
    if (containerAspect > imgAspect) {
      displayH = cr.height;
      displayW = displayH * imgAspect;
    } else {
      displayW = cr.width;
      displayH = displayW / imgAspect;
    }

    s.displayW = displayW;
    s.displayH = displayH;
    s.scale = 1;
    s.panX = (cr.width - displayW) / 2;
    s.panY = (cr.height - displayH) / 2;

    w.style.width = `${displayW}px`;
    w.style.height = `${displayH}px`;
    apply(false);
  }, [apply]);

  // ── Image load ───────────────────────────────────────────────────
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      stateRef.current.imgW = img.naturalWidth;
      stateRef.current.imgH = img.naturalHeight;
      fit();
    }
  }, [fit]);

  // ── Resize listener ──────────────────────────────────────────────
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(c);
    return () => ro.disconnect();
  }, [fit]);

  // ── Wheel zoom (cursor-anchored, no rotation) ────────────────────
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      const factor = e.deltaY > 0 ? WHEEL_FACTOR_OUT : WHEEL_FACTOR_IN;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * factor));
      if (newScale === s.scale) return;
      const cr = c.getBoundingClientRect();
      // Match the legacy `_zoomToPoint` math, rotation == 0 simplification.
      const dx = e.clientX - cr.left - cr.width / 2;
      const dy = e.clientY - cr.top - cr.height / 2;
      const ratio = newScale / s.scale;
      s.panX -= dx * (ratio - 1);
      s.panY -= dy * (ratio - 1);
      s.scale = newScale;
      apply(false);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [apply]);

  // ── Pointer drag pan ─────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const d = dragRef.current;
    d.panning = true;
    d.isDragging = false;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.panning) return;
    const dxScreen = e.clientX - d.lastX;
    const dyScreen = e.clientY - d.lastY;

    // Drag-vs-click discrimination — legacy uses 5px.
    if (!d.isDragging) {
      const totalDx = e.clientX - d.startX;
      const totalDy = e.clientY - d.startY;
      if (Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) {
        d.isDragging = true;
      }
    }

    if (d.isDragging) {
      const s = stateRef.current;
      s.panX += dxScreen;
      s.panY += dyScreen;
      apply(false);
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    d.panning = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // Reset isDragging on the next microtask so the click handler can
    // read it. Mirrors the legacy `setTimeout(..., 0)` trick.
    window.setTimeout(() => {
      dragRef.current.isDragging = false;
    }, 0);
  };

  const handleRoomClick = (room: Room) => {
    if (dragRef.current.isDragging) return;
    onRoomClick?.(room);
  };

  // ── Double-click zoom & keyboard '0' reset ───────────────────────
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onDbl = (e: MouseEvent) => {
      const s = stateRef.current;
      const newScale = Math.min(MAX_SCALE, s.scale * DOUBLE_CLICK_ZOOM);
      if (newScale === s.scale) return;
      const cr = c.getBoundingClientRect();
      const dx = e.clientX - cr.left - cr.width / 2;
      const dy = e.clientY - cr.top - cr.height / 2;
      const ratio = newScale / s.scale;
      s.panX -= dx * (ratio - 1);
      s.panY -= dy * (ratio - 1);
      s.scale = newScale;
      apply(true);
    };
    c.addEventListener("dblclick", onDbl);
    return () => c.removeEventListener("dblclick", onDbl);
  }, [apply]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "0") {
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

  // ── Imperative handle ────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      panToRoom(roomId) {
        const room = MAP_DATA.find((r) => r.id === roomId);
        const c = containerRef.current;
        const s = stateRef.current;
        if (!room || !c || !s.displayW || !s.displayH) return;
        // Legacy `_centerOnItem`: targetScale = max(1.5, min(currentScale, 4)).
        const targetScale = Math.max(1.5, Math.min(s.scale, 4));
        const centroid = polygonCentroid(room.points);
        const pxX = (centroid.x / 100) * s.displayW;
        const pxY = (centroid.y / 100) * s.displayH;
        const cr = c.getBoundingClientRect();
        s.scale = targetScale;
        s.panX = cr.width / 2 - pxX * targetScale;
        s.panY = cr.height / 2 - pxY * targetScale;
        apply(true);
      },
      resetView() {
        fit();
      },
      zoomBy(factor) {
        const c = containerRef.current;
        const s = stateRef.current;
        if (!c) return;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * factor));
        if (newScale === s.scale) return;
        const ratio = newScale / s.scale;
        // Zoom around viewport center → dx = dy = 0 in the legacy math.
        s.panX -= 0 * (ratio - 1);
        s.panY -= 0 * (ratio - 1);
        s.scale = newScale;
        apply(true);
      },
    }),
    [apply, fit],
  );

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────

  if (imageError) {
    return (
      <div className="w-full h-full grid place-items-center text-rose-400 p-8 text-center">
        {imageError}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className={cn(
        "relative w-full h-full overflow-hidden touch-none select-none",
        "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <div
        ref={wrapperRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {/* Image fills the wrapper exactly — legacy approach. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={baseImageSrc}
          alt="UQU floor plan"
          draggable={false}
          onLoad={(e) => {
            const i = e.currentTarget;
            stateRef.current.imgW = i.naturalWidth;
            stateRef.current.imgH = i.naturalHeight;
            fit();
          }}
          onError={() =>
            setImageError(`لم يتم العثور على صورة الخريطة: ${baseImageSrc}`)
          }
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            userSelect: "none",
            filter: "brightness(0.78) contrast(1.08)",
          }}
        />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          onClick={onMapClick}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          <defs>
            <filter id="routeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="routeStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(245, 78%, 62%)" />
              <stop offset="100%" stopColor="hsl(187, 80%, 48%)" />
            </linearGradient>
          </defs>

          {/* Rooms layer — corridors are non-interactive per legacy. */}
          {/* Rooms layer — corridors are non-interactive per legacy. */}
          <g>
            {MAP_DATA.map((room) => {
              const corridor = !isSelectableRoom(room);
              if (corridor) {
                return (
                  <polygon
                    key={room.id}
                    points={room.points}
                    fill="transparent"
                    stroke="transparent"
                    style={{ pointerEvents: "none" }}
                  />
                );
              }
              
              const selected = room.id === selectedRoomId;

              return (
                <polygon
                  key={room.id}
                  points={room.points}
                  onClick={() => handleRoomClick(room)}
                  className={cn(
                    "transition-colors cursor-pointer",
                    selected
                      ? "fill-uqu-accent/40 stroke-uqu-accent"
                      : "fill-white/[0.04] stroke-white/15 hover:fill-uqu-accent/15 hover:stroke-uqu-accent/40",
                  )}
                  strokeWidth={selected ? 0.35 : 0.18}
                  style={
                    selected
                      ? { filter: "drop-shadow(0 0 0.8px hsl(245, 78%, 62%))" }
                      : undefined
                  }
                />
              );
            })}
          </g>

          {/* Route layer */}
          {routePath && (
            <g>
              {/* Soft outer glow underlay */}
              <path
                d={routePath}
                fill="none"
                stroke="hsla(245, 78%, 62%, 0.35)"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#routeGlow)"
              />
              {/* Main stroke */}
              <path
                d={routePath}
                fill="none"
                stroke="url(#routeStroke)"
                strokeWidth={0.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="0.9 0.7"
                style={{ animation: "indoor-map-dash 1.2s linear infinite" }}
              />
            </g>
          )}

          {/* Endpoints — start cyan, end purple+white. SVG <animate>
              keeps the pulse ring centered on (cx, cy); CSS scale on
              <circle> would drift to the SVG origin. */}
          {routeStart && (
            <g>
              <circle
                cx={routeStart.x}
                cy={routeStart.y}
                r={1.1}
                fill="hsl(187, 80%, 48%)"
                opacity={0.95}
              />
              <circle
                cx={routeStart.x}
                cy={routeStart.y}
                r={1.2}
                fill="none"
                stroke="hsl(187, 80%, 48%)"
                strokeWidth={0.18}
              >
                <animate
                  attributeName="r"
                  from={1.2}
                  to={3}
                  dur="1.6s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from={0.85}
                  to={0}
                  dur="1.6s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          )}
          {routeEnd && (
            <g>
              <circle
                cx={routeEnd.x}
                cy={routeEnd.y}
                r={1.4}
                fill="hsl(245, 78%, 62%)"
              />
              <circle cx={routeEnd.x} cy={routeEnd.y} r={0.55} fill="white" />
            </g>
          )}
        </svg>
      </div>

      {/* Scoped keyframes — only the `stroke-dashoffset` animation, which
          mutates a numeric attribute (not a transform) so it's safe. */}
      <style jsx>{`
        @keyframes indoor-map-dash {
          to {
            stroke-dashoffset: -6;
          }
        }
      `}</style>
    </div>
  );
});
