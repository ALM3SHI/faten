"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FONT_PX, labelWidth, layoutDiagram, type Box } from "@/lib/diagram-layout";
import type { Diagram as DiagramData } from "@/lib/tutor";

/**
 * A lesson diagram drawn from the tutor's description (nodes + edges) — no
 * image is generated anywhere. Right-to-left, in the design system's colours,
 * so it follows the light, dark and chalkboard themes.
 *
 * Screen readers get the same content as text: a list of the steps and
 * connections (the SVG itself is decorative).
 */
export function Diagram({ diagram, caption }: { diagram: DiagramData; caption?: string }) {
  // the room on screen decides whether a sideways flow is stacked instead (phones)
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number>(Infinity);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setRoom(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => layoutDiagram(diagram, room), [diagram, room]);
  const marker = `arrow-${useId().replace(/:/g, "")}`;
  const name = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div ref={box} className="overflow-x-auto" data-diagram={diagram.type}>
      <svg
        aria-hidden
        viewBox={`0 0 ${Math.ceil(layout.width)} ${Math.ceil(layout.height)}`}
        width={Math.ceil(layout.width)}
        className="mx-auto block h-auto max-w-full text-ink"
        style={{ fontSize: FONT_PX, minWidth: Math.min(layout.width, 300) }}
      >
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" className="stroke-ink-muted" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {layout.lifelines.map((l, i) => (
          <line key={i} x1={l.x} y1={l.y1} x2={l.x} y2={l.y2} className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="4 5" />
        ))}

        {layout.arrows.map((a, i) => (
          <g key={i}>
            <path
              d={a.d}
              fill="none"
              className="stroke-ink-muted"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeDasharray={a.edge.reply ? "6 5" : undefined}
              markerEnd={`url(#${marker})`}
            />
            {a.edge.label && <EdgeLabel x={a.labelX} y={a.labelY} text={a.edge.label} />}
          </g>
        ))}

        {layout.boxes.map((b) => (
          <NodeShape key={b.node.id} box={b} />
        ))}
      </svg>

      <div className="sr-only">
        {caption && <p>{caption}</p>}
        <ul>
          {diagram.edges.map((e, i) => (
            <li key={i}>
              {name(e.from)} {e.reply ? "يرد على" : "إلى"} {name(e.to)}
              {e.label ? `: ${e.label}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const w = labelWidth(text);
  return (
    <g>
      <rect x={x - w / 2} y={y - 11} width={w} height={18} rx={6} className="fill-canvas" />
      <text x={x} y={y + 2} textAnchor="middle" className="fill-ink-muted" style={{ fontSize: FONT_PX - 1.5 }} direction="rtl" unicodeBidi="plaintext">
        {text}
      </text>
    </g>
  );
}

function NodeShape({ box: b }: { box: Box }) {
  const left = b.x - b.w / 2;
  const top = b.y - b.h / 2;
  const shapeCls = "fill-info-soft stroke-info-ink";
  let shape: React.ReactNode;
  if (b.node.shape === "decision") {
    shape = <path d={`M ${b.x} ${top} L ${left + b.w} ${b.y} L ${b.x} ${top + b.h} L ${left} ${b.y} Z`} className={shapeCls} strokeWidth="1.6" strokeLinejoin="round" />;
  } else if (b.node.shape === "db") {
    const e = 7; // the cylinder's rim
    shape = (
      <g className={shapeCls} strokeWidth="1.6">
        <path d={`M ${left} ${top + e} L ${left} ${top + b.h - e} A ${b.w / 2} ${e} 0 0 0 ${left + b.w} ${top + b.h - e} L ${left + b.w} ${top + e}`} />
        <ellipse cx={b.x} cy={top + e} rx={b.w / 2} ry={e} />
      </g>
    );
  } else {
    // a slightly hand-drawn box: the corners are not all the same
    shape = <rect x={left} y={top} width={b.w} height={b.h} rx={10} ry={12} className={shapeCls} strokeWidth="1.6" />;
  }
  const first = b.y - ((b.lines.length - 1) * 17) / 2 + (b.node.shape === "db" ? 4 : 0) + 4.5;
  return (
    <g>
      {shape}
      {b.lines.map((line, i) => (
        <text key={i} x={b.x} y={first + i * 17} textAnchor="middle" className="fill-ink font-bold" direction="rtl" unicodeBidi="plaintext">
          {line}
        </text>
      ))}
    </g>
  );
}
