/**
 * Positions for the lesson diagrams the tutor describes (lib/tutor.ts: Diagram).
 * Pure functions, no DOM: components/tutor/diagram.tsx draws the result.
 *
 * The page reads right-to-left, so a horizontal flow starts on the RIGHT and
 * a sequence's first actor is the rightmost column.
 *
 *   flow      layered: each node sits one column after the longest chain that
 *             leads to it (edges that loop back are drawn as arcs, not layers)
 *   sequence  actors as columns with lifelines, messages top to bottom
 *   cycle     nodes around an ellipse, in order
 */

import type { Diagram, DiagramEdge, DiagramNode } from "@/lib/tutor";

export const FONT_PX = 13;
const CHAR_PX = 7.2;
const LINE_PX = 17;
const PAD_X = 14;
const NODE_MIN_W = 88;
const NODE_MAX_W = 176;
const WRAP_CHARS = 22;

export interface Box {
  node: DiagramNode;
  x: number; // centre
  y: number; // centre
  w: number;
  h: number;
  lines: string[];
}

export interface Arrow {
  edge: DiagramEdge;
  d: string; // SVG path
  labelX: number;
  labelY: number;
  back: boolean;
}

export interface Layout {
  width: number;
  height: number;
  boxes: Box[];
  arrows: Arrow[];
  /** sequence only: vertical lifelines */
  lifelines: { x: number; y1: number; y2: number }[];
}

/** Breaks a label into at most two lines of about WRAP_CHARS characters. */
export function wrapLabel(label: string, max = WRAP_CHARS): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(" ").slice(0, max - 1) + "…"];
}

function measure(node: DiagramNode): { w: number; h: number; lines: string[] } {
  const lines = wrapLabel(node.label);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const w = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.round(longest * CHAR_PX + PAD_X * 2)));
  const extra = node.shape === "decision" ? 18 : node.shape === "db" ? 14 : 0;
  return { w: w + (node.shape === "decision" ? 24 : 0), h: lines.length * LINE_PX + 20 + extra, lines };
}

/** Longest-path layers; edges that would close a loop are marked as back edges. */
export function layers(nodes: DiagramNode[], edges: DiagramEdge[]): { rank: Map<string, number>; back: Set<DiagramEdge> } {
  const out = new Map<string, DiagramEdge[]>(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => out.get(e.from)?.push(e));
  const back = new Set<DiagramEdge>();
  const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) back.add(e);
      else if (s === 0) visit(e.to);
    }
    state.set(id, 2);
  };
  nodes.forEach((n) => (state.get(n.id) ?? 0) === 0 && visit(n.id));

  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // relax forward edges until stable (graphs here have ≤ 8 nodes)
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (back.has(e)) continue;
      const r = (rank.get(e.from) ?? 0) + 1;
      if (r > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, r);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { rank, back };
}

const GAP_MAIN = 56; // between layers (at least)
const GAP_MAIN_MAX = 190;
const GAP_CROSS = 26; // between nodes of one layer
const MARGIN = 16;

/** Width of an edge label's pill (shared with the drawing). */
export function labelWidth(text: string): number {
  return Math.min(200, text.length * 6.6 + 14);
}

function flowLayout(d: Diagram): Layout {
  const { rank, back } = layers(d.nodes, d.edges);
  const horizontal = d.direction !== "tb";
  const nLayers = Math.max(...rank.values()) + 1;
  const byLayer: DiagramNode[][] = Array.from({ length: nLayers }, () => []);
  d.nodes.forEach((n) => byLayer[rank.get(n.id) ?? 0].push(n));
  const sizes = new Map(d.nodes.map((n) => [n.id, measure(n)]));

  // size of each layer along the main axis, and the longest layer across it
  const mainSize = byLayer.map((ns) => Math.max(...ns.map((n) => (horizontal ? sizes.get(n.id)!.w : sizes.get(n.id)!.h))));
  const crossSize = byLayer.map((ns) => ns.reduce((a, n) => a + (horizontal ? sizes.get(n.id)!.h : sizes.get(n.id)!.w), 0) + GAP_CROSS * (ns.length - 1));
  // the gap after each layer leaves room for the labels of the arrows crossing it
  const gaps = Array.from({ length: Math.max(0, nLayers - 1) }, (_, li) => {
    const labels = d.edges.filter((e) => !back.has(e) && rank.get(e.from) === li && e.label);
    const need = Math.max(0, ...labels.map((e) => (horizontal ? labelWidth(e.label) : 22) + (horizontal ? 30 : 40)));
    return Math.min(GAP_MAIN_MAX, Math.max(GAP_MAIN, need));
  });
  const totalMain = mainSize.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const totalCross = Math.max(...crossSize);
  const width = (horizontal ? totalMain : totalCross) + MARGIN * 2;
  const height = (horizontal ? totalCross : totalMain) + MARGIN * 2 + (back.size ? 34 : 0);

  const boxes: Box[] = [];
  let main = MARGIN;
  byLayer.forEach((ns, li) => {
    const centerMain = main + mainSize[li] / 2;
    let cross = MARGIN + (totalCross - crossSize[li]) / 2;
    ns.forEach((n) => {
      const s = sizes.get(n.id)!;
      const along = horizontal ? s.h : s.w;
      const centerCross = cross + along / 2;
      cross += along + GAP_CROSS;
      // right-to-left: the first layer is on the right
      const x = horizontal ? width - centerMain : centerCross;
      const y = horizontal ? centerCross : centerMain;
      boxes.push({ node: n, x, y, w: s.w, h: s.h, lines: s.lines });
    });
    main += mainSize[li] + (gaps[li] ?? 0);
  });

  const at = new Map(boxes.map((b) => [b.node.id, b]));
  const arrows: Arrow[] = d.edges.flatMap((e): Arrow[] => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return [];
    if (back.has(e) || a === b) {
      // a loop back: an arc under (or beside) the diagram
      const ax = a.x, ay = a.y + a.h / 2, bx = b.x, by = b.y + b.h / 2;
      const low = Math.max(ay, by) + 30;
      return [{ edge: e, back: true, d: `M ${ax} ${ay} C ${ax} ${low}, ${bx} ${low}, ${bx} ${by}`, labelX: (ax + bx) / 2, labelY: low - 4 }];
    }
    let x1: number, y1: number, x2: number, y2: number;
    if (horizontal) {
      // flowing leftwards (RTL)
      x1 = a.x - a.w / 2; y1 = a.y; x2 = b.x + b.w / 2; y2 = b.y;
    } else {
      x1 = a.x; y1 = a.y + a.h / 2; x2 = b.x; y2 = b.y - b.h / 2;
    }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const path = horizontal ? `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    // horizontal: the label sits above the line; vertical: on it, with line showing above and below
    return [{ edge: e, back: false, d: path, labelX: mx, labelY: horizontal ? my - 14 : my + 4 }];
  });
  return { width, height, boxes, arrows, lifelines: [] };
}

const ROW = 46;

function sequenceLayout(d: Diagram): Layout {
  const sizes = d.nodes.map(measure);
  const colW = Math.max(120, ...sizes.map((s) => s.w)) + 28;
  const headH = Math.max(...sizes.map((s) => s.h));
  const width = colW * d.nodes.length + MARGIN * 2;
  const top = MARGIN + headH + 18;
  const height = top + ROW * Math.max(1, d.edges.length) + MARGIN + 6;
  // right-to-left: actor 0 is the rightmost column
  const xOf = (i: number) => width - MARGIN - colW * i - colW / 2;
  const boxes: Box[] = d.nodes.map((n, i) => ({ node: n, x: xOf(i), y: MARGIN + headH / 2, w: sizes[i].w, h: sizes[i].h, lines: sizes[i].lines }));
  const index = new Map(d.nodes.map((n, i) => [n.id, i]));
  const arrows: Arrow[] = d.edges.flatMap((e, row) => {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined) return [];
    const y = top + ROW * row + ROW / 2;
    const x1 = xOf(a), x2 = xOf(b);
    if (a === b) {
      return [{ edge: e, back: false, d: `M ${x1} ${y - 8} C ${x1 - 34} ${y - 8}, ${x1 - 34} ${y + 10}, ${x1} ${y + 10}`, labelX: x1 - 40, labelY: y - 12 }];
    }
    const dir = x2 > x1 ? 1 : -1;
    return [{ edge: e, back: false, d: `M ${x1 + dir * 4} ${y} L ${x2 - dir * 6} ${y}`, labelX: (x1 + x2) / 2, labelY: y - 8 }];
  });
  const lifelines = boxes.map((b) => ({ x: b.x, y1: b.y + b.h / 2, y2: height - MARGIN }));
  return { width, height, boxes, arrows, lifelines };
}

function cycleLayout(d: Diagram): Layout {
  const sizes = d.nodes.map(measure);
  const n = d.nodes.length;
  const maxW = Math.max(...sizes.map((s) => s.w));
  const maxH = Math.max(...sizes.map((s) => s.h));
  const rx = Math.max(110, (maxW * n) / 4.2);
  const ry = Math.max(70, (maxH * n) / 3.2);
  const width = rx * 2 + maxW + MARGIN * 2;
  const height = ry * 2 + maxH + MARGIN * 2;
  const cx = width / 2, cy = height / 2;
  // start at the top, go clockwise as seen by an RTL reader (to the right first)
  const boxes: Box[] = d.nodes.map((node, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { node, x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), w: sizes[i].w, h: sizes[i].h, lines: sizes[i].lines };
  });
  const at = new Map(boxes.map((b) => [b.node.id, b]));
  const arrows: Arrow[] = d.edges.flatMap((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b || a === b) return [];
    // leave/enter at the box borders, bowing outwards from the centre
    const trim = (p: Box, q: Box) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const k = Math.min(p.w / 2 / Math.abs(dx || 1e-6), p.h / 2 / Math.abs(dy || 1e-6), 1) * 1.08;
      return { x: p.x + dx * k, y: p.y + dy * k };
    };
    const p1 = trim(a, b), p2 = trim(b, a);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const ox = mx - cx, oy = my - cy;
    const len = Math.hypot(ox, oy) || 1;
    const bow = 22;
    const qx = mx + (ox / len) * bow, qy = my + (oy / len) * bow;
    return [{ edge: e, back: false, d: `M ${p1.x} ${p1.y} Q ${qx} ${qy} ${p2.x} ${p2.y}`, labelX: qx, labelY: qy }];
  });
  return { width, height, boxes, arrows, lifelines: [] };
}

/**
 * `maxWidth`: the room on screen. A sideways flow that would not fit (a
 * phone) is laid out top to bottom instead of being cut off or shrunk.
 */
export function layoutDiagram(d: Diagram, maxWidth = Infinity): Layout {
  if (d.type === "sequence") return sequenceLayout(d);
  if (d.type === "cycle") return cycleLayout(d);
  const flow = flowLayout(d);
  if (d.direction === "lr" && flow.width > maxWidth) {
    const stacked = flowLayout({ ...d, direction: "tb" });
    if (stacked.width <= maxWidth || stacked.width < flow.width) return stacked;
  }
  return flow;
}
