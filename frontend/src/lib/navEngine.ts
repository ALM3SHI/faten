/**
 * UQU Indoor Navigation Engine — TypeScript port of the legacy
 * `assets/nav-engine.js` (v2.2). Method-for-method faithful: every
 * algorithm, threshold, and constant matches the legacy file.
 *
 * Behaviour reproduced verbatim:
 *   • Binary MinHeap A* priority queue (no per-iteration sort).
 *   • `buildGraph()` ingests door nodes from MAP_DATA + waypoints
 *     from NAV_GRAPH, then auto-snaps each unconnected door to the
 *     nearest corridor edge (dist < 15) by inserting a "snap" node
 *     and splitting that edge into two segments.
 *   • Fallback for un-snappable doors: direct edge to nearest
 *     non-door waypoint within distance 30.
 *   • A* uses Euclidean heuristic, capped at MAX_ITER=20000.
 *   • `_stringPull` is intentionally disabled (legacy comment: all
 *     nodes share `corridorId:"CL_MAIN"` so collapsing would cut
 *     through walls).
 *   • `_smoothPath` is LINEAR INTERPOLATION subdivision (not
 *     Catmull-Rom) — 5 intermediate points per segment. Preserved
 *     verbatim because the spec was "1-to-1 port", not invention.
 *   • `findPath()` returns a rich PathResult with distanceMeters,
 *     estimatedTime, Arabic turn-by-turn steps, and smoothPoints.
 *
 * Differences from the legacy file (forced by the React port):
 *   • Constructor takes (mapData, navGraph) explicitly instead of
 *     reading `window.MAP_DATA` / `window.NAV_GRAPH`. Same data
 *     shape, just no global lookup.
 *   • Renderer / DOM manipulation (NavRenderer class, `_roomGroups`,
 *     polygon mutation) intentionally excluded — that's IndoorMap's
 *     responsibility in React.
 */

import { MAP_DATA, NAV_GRAPH, type Room, type NavGraph } from "@/data/mapData";

// ── Constants — exact values from nav-engine.js ──────────────────────

const METERS_PER_UNIT = 1.2;
const WALK_SPEED_MPS = 1.2;
const MAX_ITER = 20000;

// Snap thresholds, also from the legacy file.
const SNAP_TO_EDGE_THRESHOLD = 15;
const SNAP_FALLBACK_THRESHOLD = 30;

// ── Types ────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface NodeRef extends Point {
  /** "door" | "stairs" | "snap" | (waypoint corridorId set by NAV_GRAPH) | undefined */
  type?: string;
  roomId?: string;
  corridorId?: string;
}

interface AdjEdge {
  to: string;
  weight: number;
  accessible: boolean;
}

interface CorridorEdgeEntry {
  u: string;
  v: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface PathPoint extends Point {
  id?: string;
}

export interface PathStep {
  text: string;
  icon: string;
}

export interface PathResult {
  nodeIds: string[];
  points: PathPoint[];
  distanceMeters: number;
  estimatedTime: string;
  steps: PathStep[];
  /** Subdivided polyline (linear interpolation, 5 pts per segment). */
  smoothPoints: PathPoint[];
}

export interface FindPathOptions {
  accessible?: boolean;
  fromNodeId?: string;
}

// ── Binary min-heap priority queue — verbatim port ───────────────────

interface HeapEntry {
  id: string;
  f: number;
}

class MinHeap {
  private _d: HeapEntry[] = [];

  get size(): number {
    return this._d.length;
  }

  push(item: HeapEntry): void {
    this._d.push(item);
    let i = this._d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].f <= this._d[i].f) break;
      const t = this._d[p];
      this._d[p] = this._d[i];
      this._d[i] = t;
      i = p;
    }
  }

  pop(): HeapEntry | undefined {
    const top = this._d[0];
    const last = this._d.pop();
    if (last === undefined) return top;
    if (this._d.length > 0) {
      this._d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        const n = this._d.length;
        let m = i;
        if (l < n && this._d[l].f < this._d[m].f) m = l;
        if (r < n && this._d[r].f < this._d[m].f) m = r;
        if (m === i) break;
        const t = this._d[m];
        this._d[m] = this._d[i];
        this._d[i] = t;
        i = m;
      }
    }
    return top;
  }
}

// ── NavEngine ────────────────────────────────────────────────────────

export class NavEngine {
  private mapData: Room[];
  private navGraph: NavGraph;

  // Underscore-prefixed fields mirror the legacy field names so the
  // diff between legacy and port stays trivially reviewable.
  private nodes: Record<string, NodeRef> = {};
  private adj: Record<string, AdjEdge[]> = {};
  private _edgeList: CorridorEdgeEntry[] = [];
  private _built = false;

  constructor(mapData: Room[] = MAP_DATA, navGraph: NavGraph = NAV_GRAPH) {
    this.mapData = mapData;
    this.navGraph = navGraph;
  }

  // ── Public lifecycle ──────────────────────────────────────────────

  buildGraph(): void {
    this.nodes = {};
    this.adj = {};
    this._edgeList = [];

    // 1. Door nodes from MAP_DATA
    for (const room of this.mapData) {
      if (!room.doors) continue;
      for (const door of room.doors) {
        const id = `${room.id}__${door.id}`;
        this.nodes[id] = {
          x: door.x,
          y: door.y,
          roomId: room.id,
          type: room.type === "stairs" ? "stairs" : "door",
        };
      }
    }

    // 2. Waypoints from NAV_GRAPH
    for (const id of Object.keys(this.navGraph.nodes)) {
      this.nodes[id] = { ...this.navGraph.nodes[id] };
    }

    // 3. Adjacency from edges
    for (const id of Object.keys(this.nodes)) this.adj[id] = [];
    for (const edge of this.navGraph.edges) {
      const a = this.nodes[edge.from];
      const b = this.nodes[edge.to];
      if (!a || !b) continue;
      const w =
        edge.weight != null ? edge.weight : Math.hypot(a.x - b.x, a.y - b.y);
      const acc = edge.accessible !== false;
      this.adj[edge.from].push({ to: edge.to, weight: w, accessible: acc });
      if (!edge.oneWay) {
        this.adj[edge.to].push({ to: edge.from, weight: w, accessible: acc });
      }
    }

    // 4. Build flat edge list BEFORE snapping (only original corridor edges)
    this._buildEdgeIndex();

    // 5. Snap door nodes to nearest corridor edge
    this._autoSnapDoors();

    this._built = true;
  }

  // Alias matching the React-friendly naming used by the previous engine.
  build(): void {
    this.buildGraph();
  }

  // ── A* pathfinding ────────────────────────────────────────────────

  /**
   * Plan a route between two rooms (or from a free nav-node to a room).
   * Returns the rich `PathResult` shape from the legacy `_buildResult`.
   */
  findPath(
    fromRoomId: string | null,
    toRoomId: string,
    options: FindPathOptions = {},
  ): PathResult | null {
    if (!this._built) this.buildGraph();

    // Resolve start node
    let startNode: string | null = null;
    if (options.fromNodeId) {
      startNode = options.fromNodeId;
    } else if (fromRoomId) {
      const room = this.mapData.find((r) => r.id === fromRoomId);
      if (room && room.doors && room.doors.length > 0) {
        startNode = `${room.id}__${room.doors[0].id}`;
      }
    }

    // Resolve end node
    const targetRoom = this.mapData.find((r) => r.id === toRoomId);
    if (!targetRoom || !targetRoom.doors || targetRoom.doors.length === 0)
      return null;
    const endNode = `${targetRoom.id}__${targetRoom.doors[0].id}`;

    if (!startNode || !this.nodes[startNode] || !this.nodes[endNode])
      return null;

    const goal = this.nodes[endNode];
    const h = (id: string): number => {
      const n = this.nodes[id];
      return Math.hypot(n.x - goal.x, n.y - goal.y);
    };

    const heap = new MinHeap();
    const cameFrom: Record<string, string> = Object.create(null);
    const gScore: Record<string, number> = Object.create(null);
    const closed = new Set<string>();

    gScore[startNode] = 0;
    heap.push({ id: startNode, f: h(startNode) });

    let iter = 0;
    while (heap.size > 0) {
      if (++iter > MAX_ITER) {
        console.warn("NavEngine: A* hit iteration limit");
        break;
      }

      const popped = heap.pop();
      if (!popped) break;
      const cur = popped.id;
      if (cur === endNode)
        return this._buildResult(this._reconstructIds(cameFrom, endNode));
      if (closed.has(cur)) continue;
      closed.add(cur);

      const neighbors = this.adj[cur];
      if (!neighbors) continue;
      const gCur = gScore[cur];

      for (let i = 0; i < neighbors.length; i++) {
        const edge = neighbors[i];
        if (options.accessible && !edge.accessible) continue;
        const nb = edge.to;
        if (closed.has(nb)) continue;
        const g = gCur + edge.weight;
        if (g < (gScore[nb] ?? Infinity)) {
          cameFrom[nb] = cur;
          gScore[nb] = g;
          heap.push({ id: nb, f: g + h(nb) });
        }
      }
    }
    return null;
  }

  /** Route from a specific nav-graph node ID (entrance waypoint / free-point snap). */
  findPathFromNode(
    fromNodeId: string,
    toRoomId: string,
    options: FindPathOptions = {},
  ): PathResult | null {
    return this.findPath(null, toRoomId, { ...options, fromNodeId });
  }

  // ── Snapping / nearest queries (public surface) ──────────────────

  findNearestNode(
    x: number,
    y: number,
  ): { nodeId: string; distance: number; x: number; y: number } | null {
    if (!this._built) this.buildGraph();
    let best: { nodeId: string; distance: number; x: number; y: number } | null =
      null;
    let bestD = Infinity;
    for (const id of Object.keys(this.nodes)) {
      const n = this.nodes[id];
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = { nodeId: id, distance: d, x: n.x, y: n.y };
      }
    }
    return best;
  }

  snapToNearestEdge(
    x: number,
    y: number,
  ): { nodeId: string; distance: number; x: number; y: number } | null {
    if (!this._built) this.buildGraph();
    const snap = this._snapToEdgeFast(x, y);
    if (snap) return { nodeId: snap.u, distance: snap.dist, x: snap.x, y: snap.y };
    return this.findNearestNode(x, y);
  }

  /**
   * Convert a polyline of points to an SVG `d` string using straight
   * line segments. Identical to the legacy `toSvgPath` — pass
   * `smoothPoints` from a PathResult to get the subdivided polyline.
   */
  toSvgPath(pts: Point[]): string {
    if (pts.length < 2) return "";
    return (
      `M ${pts[0].x} ${pts[0].y} ` +
      pts
        .slice(1)
        .map((p) => `L ${p.x} ${p.y}`)
        .join(" ")
    );
  }

  /**
   * Catmull-Rom → cubic Bézier conversion. Produces a single SVG
   * path that passes through every input waypoint as a smooth curve,
   * giving the rendered route a natural "flowing corridor" look
   * instead of jagged straight segments.
   *
   * NOTE: this method is an ADDITION on top of the legacy port —
   * `nav-engine.js`'s `_smoothPath` is linear interpolation
   * subdivision (preserved verbatim in `_smoothPath` above). This
   * Catmull-Rom variant is what the React UI actually renders for
   * the elegant curved-path effect.
   *
   * Algorithm (uniform Catmull-Rom, tension=0.5):
   *   For each segment p1→p2, control points are derived from the
   *   neighbours p0 and p3 (clamped at the endpoints):
   *     cp1 = p1 + (p2 - p0) / 6
   *     cp2 = p2 - (p3 - p1) / 6
   *   then emit a single cubic Bézier "C cp1 cp2 p2".
   */
  toSmoothCurvePath(pts: Point[]): string {
    if (pts.length < 2) return "";
    if (pts.length === 2) {
      return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    }
    const out: string[] = [
      `M ${pts[0].x.toFixed(3)} ${pts[0].y.toFixed(3)}`,
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      out.push(
        `C ${cp1x.toFixed(3)} ${cp1y.toFixed(3)} ` +
          `${cp2x.toFixed(3)} ${cp2y.toFixed(3)} ` +
          `${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
      );
    }
    return out.join(" ");
  }

  // ── Internal: edge-index, snapping, projection ───────────────────

  private _buildEdgeIndex(): void {
    const seen = new Set<string>();
    for (const u of Object.keys(this.adj)) {
      const nu = this.nodes[u];
      if (!nu || nu.type === "door" || nu.type === "stairs") continue;
      for (const edge of this.adj[u]) {
        const v = edge.to;
        const nv = this.nodes[v];
        if (!nv || nv.type === "door" || nv.type === "stairs") continue;
        const key = u < v ? `${u}|${v}` : `${v}|${u}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this._edgeList.push({
          u,
          v,
          ax: nu.x,
          ay: nu.y,
          bx: nv.x,
          by: nv.y,
        });
      }
    }
  }

  private _autoSnapDoors(): void {
    const manuallyConnected = new Set<string>();
    for (const e of this.navGraph.edges || []) {
      if (e.from.includes("__")) manuallyConnected.add(e.from);
      if (e.to.includes("__")) manuallyConnected.add(e.to);
    }

    // Snapshot door IDs before mutating this.nodes
    const doorIds = Object.keys(this.nodes).filter((id) => {
      const n = this.nodes[id];
      return (
        (n.type === "door" || n.type === "stairs") &&
        !manuallyConnected.has(id)
      );
    });

    for (const nodeId of doorIds) {
      const node = this.nodes[nodeId];
      const snap = this._snapToEdgeFast(node.x, node.y);

      if (snap && snap.dist < SNAP_TO_EDGE_THRESHOLD) {
        const snapId = `${nodeId}_snap`;
        this.nodes[snapId] = { x: snap.x, y: snap.y, type: "snap" };
        this.adj[snapId] = [];

        const w = Math.hypot(node.x - snap.x, node.y - snap.y);
        this.adj[nodeId].push({ to: snapId, weight: w, accessible: true });
        this.adj[snapId].push({ to: nodeId, weight: w, accessible: true });
        this._splitEdge(snap.u, snap.v, snapId);
      } else {
        // Fallback: connect directly to nearest non-door waypoint
        let best: string | null = null;
        let bestD = Infinity;
        for (const id of Object.keys(this.nodes)) {
          const n = this.nodes[id];
          if (n.type === "door" || n.type === "stairs" || n.type === "snap")
            continue;
          const d = Math.hypot(n.x - node.x, n.y - node.y);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
        if (best && bestD < SNAP_FALLBACK_THRESHOLD) {
          this.adj[nodeId].push({ to: best, weight: bestD, accessible: true });
          this.adj[best].push({ to: nodeId, weight: bestD, accessible: true });
        }
      }
    }
  }

  /** O(e) snap using pre-built edge index — no Set allocation per call. */
  private _snapToEdgeFast(
    x: number,
    y: number,
  ): { x: number; y: number; dist: number; u: string; v: string } | null {
    let best: { x: number; y: number; dist: number; u: string; v: string } | null =
      null;
    let bestDist = Infinity;
    for (const edge of this._edgeList) {
      const proj = this._projectOnEdge(x, y, edge.ax, edge.ay, edge.bx, edge.by);
      if (proj.dist < bestDist) {
        bestDist = proj.dist;
        best = {
          x: proj.x,
          y: proj.y,
          dist: proj.dist,
          u: edge.u,
          v: edge.v,
        };
      }
    }
    return best;
  }

  private _projectOnEdge(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): { x: number; y: number; dist: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0)
      return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) };
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return { x: cx, y: cy, dist: Math.hypot(px - cx, py - cy) };
  }

  private _splitEdge(u: string, v: string, sId: string): void {
    this.adj[u] = this.adj[u].filter((e) => e.to !== v);
    this.adj[v] = this.adj[v].filter((e) => e.to !== u);
    const w1 = Math.hypot(
      this.nodes[u].x - this.nodes[sId].x,
      this.nodes[u].y - this.nodes[sId].y,
    );
    const w2 = Math.hypot(
      this.nodes[v].x - this.nodes[sId].x,
      this.nodes[v].y - this.nodes[sId].y,
    );
    this.adj[u].push({ to: sId, weight: w1, accessible: true });
    this.adj[sId].push({ to: u, weight: w1, accessible: true });
    this.adj[sId].push({ to: v, weight: w2, accessible: true });
    this.adj[v].push({ to: sId, weight: w2, accessible: true });
  }

  // ── Path reconstruction & result building ────────────────────────

  private _reconstructIds(
    cameFrom: Record<string, string>,
    current: string,
  ): string[] {
    const path: string[] = [current];
    while (current in cameFrom) {
      current = cameFrom[current];
      path.unshift(current);
    }
    return path;
  }

  private _buildResult(nodeIds: string[]): PathResult {
    const pulledIds = this._stringPull(nodeIds);
    const points: PathPoint[] = pulledIds.map((id) => ({
      x: this.nodes[id].x,
      y: this.nodes[id].y,
      id,
    }));

    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
    }
    const distMeters = Math.round(dist * METERS_PER_UNIT);

    return {
      nodeIds: pulledIds,
      points,
      distanceMeters: distMeters,
      estimatedTime: this._formatTime(distMeters / WALK_SPEED_MPS),
      steps: this._generateSteps(pulledIds),
      smoothPoints: this._smoothPath(points),
    };
  }

  private _stringPull(ids: string[]): string[] {
    if (ids.length <= 2) return ids;
    const result: string[] = [ids[0]];
    let anchor = 0;
    while (anchor < ids.length - 1) {
      let farthest = anchor + 1;
      for (let i = anchor + 2; i < ids.length; i++) {
        if (this._canSkip(ids[anchor], ids[i])) farthest = i;
        else break;
      }
      result.push(ids[farthest]);
      anchor = farthest;
    }
    return result;
  }

  // All nodes currently share corridorId:"CL_MAIN" so the corridorId check
  // would collapse the entire path into a single straight line (wall-cutting).
  // Disable string-pull until per-segment corridorIds are assigned.
  private _canSkip(_idA: string, _idB: string): boolean {
    return false;
  }

  private _generateSteps(ids: string[]): PathStep[] {
    const steps: PathStep[] = [];
    const start = this.nodes[ids[0]];
    if (start && start.roomId) {
      const room = this.mapData.find((r) => r.id === start.roomId);
      steps.push({
        text: `اخرج من ${room?.label || start.roomId}`,
        icon: "🚪",
      });
    }
    if (ids.length > 2)
      steps.push({ text: "أكمل السير في الممر", icon: "🚶" });
    const end = this.nodes[ids[ids.length - 1]];
    if (end && end.roomId) {
      const room = this.mapData.find((r) => r.id === end.roomId);
      steps.push({
        text: `ادخل ${room?.label || end.roomId}`,
        icon: "📍",
      });
    }
    return steps;
  }

  private _formatTime(s: number): string {
    if (s < 60) return "أقل من دقيقة";
    return `${Math.round(s / 60)} دقيقة`;
  }

  /**
   * Polyline smoothing — LINEAR INTERPOLATION subdivision, matching
   * the legacy `_smoothPath`. NOT Catmull-Rom: for each segment
   * (p1 → p2), emits 5 intermediate points at t = 0.2, 0.4, 0.6,
   * 0.8, 1.0. The visual effect is denser sampling on diagonals
   * rather than a curved path. Kept verbatim because the brief was
   * "1-to-1 port".
   */
  private _smoothPath(points: PathPoint[]): PathPoint[] {
    if (points.length <= 2) return points;
    const result: PathPoint[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      for (let t = 0.2; t <= 1.0; t += 0.2) {
        result.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        });
      }
    }
    return result;
  }
}

// Re-export the canonical data so consumers can import everything
// they need from this one module.
export { MAP_DATA, NAV_GRAPH };
