/**
 * Typed re-export of the UQU floor-plan data and navigation graph.
 *
 * The underlying file (`map-data.json`) is a verbatim port of the
 * legacy PWA's `map-data.js`. Keeping it as JSON means we don't have
 * to maintain a 3700-line TS literal — this wrapper just gives the
 * consumer compile-time types and stable named exports.
 *
 * Coordinate system: every `points`, `door.x/y`, and `navGraph.nodes`
 * coord is a PERCENTAGE of the floor-plan bounding box (0–100). The
 * SVG renderer uses `viewBox="0 0 100 100"` and the IndoorMap
 * component overlays the base image at the same dimensions, so
 * polygons line up pixel-perfect with the underlying floor plan.
 */

import rawData from "./map-data.json";

// ── Domain types ──────────────────────────────────────────────────────

/**
 * Loose union of the room types found in the data file. Kept as
 * `string` at the type level so unknown values (added later by data
 * edits) don't break the build. The constants below cover the values
 * present today and drive the sidebar grouping.
 */
export type RoomType =
  | "lab"
  | "office"
  | "classroom"
  | "amphitheater"
  | "library"
  | "mosque"
  | "admin"
  | "corridor"
  | "stairs"
  | "wc"
  | "other"
  | "waypoint"
  | (string & {});

export interface Door {
  id: string;
  x: number; // 0–100, percentage of viewBox width
  y: number; // 0–100, percentage of viewBox height
}

export interface Room {
  id: string;
  label: string;
  type: RoomType;
  /** Optional brand color from the legacy data file. */
  color?: string;
  /** Shape kind. Today everything is "polygon". */
  shapeType?: string;
  /** Space-separated "x,y x,y ..." pairs in percentage coords. */
  points: string;
  /** One or more entry points used as A* graph endpoints. */
  doors?: Door[];
}

export interface NavNode {
  x: number;
  y: number;
  /** Optional grouping hint from the legacy data (e.g. "CL_MAIN"). */
  corridorId?: string;
}

export interface NavEdge {
  from: string;
  to: string;
  /** Edge cost. If omitted, the engine falls back to Euclidean distance. */
  weight?: number;
  /** Wheelchair-accessible? Engine respects this when options.accessible=true. */
  accessible?: boolean;
  /** Directed edge? Default = bidirectional. */
  oneWay?: boolean;
}

export interface NavGraph {
  nodes: Record<string, NavNode>;
  edges: NavEdge[];
}

// ── Exports ───────────────────────────────────────────────────────────

export const MAP_DATA: Room[] = rawData.mapData as Room[];
export const NAV_GRAPH: NavGraph = rawData.navGraph as NavGraph;

/**
 * Default entry point — used as the start node on first mount.
 *
 * Resolution order:
 *   1. A room literally named `Room_MainEntrance` (none today, but
 *      kept first so a future data edit picks this up automatically).
 *   2. Any non-corridor room whose label contains an entrance-keyword.
 *   3. The rightmost non-corridor room (highest polygon-centroid x).
 *      The UQU floor plan's main entrance is on the right side, so the
 *      easternmost real room is the best heuristic stand-in until a
 *      proper entrance is tagged in the data.
 *   4. The first non-corridor room as a last resort.
 */
function _resolveDefaultEntrance(): string | null {
  // 1. Explicit ID
  const named = MAP_DATA.find((r) => r.id === "Room_MainEntrance");
  if (named) return named.id;

  // 2. Label keyword scan (Arabic entrance variants)
  const ENTRANCE_KEYWORDS = ["مدخل", "بوابة", "استقبال", "دخول", "entrance"];
  const byLabel = MAP_DATA.find(
    (r) =>
      isSelectableRoom(r) &&
      ENTRANCE_KEYWORDS.some((k) => (r.label || "").includes(k)),
  );
  if (byLabel) return byLabel.id;

  // 3. Rightmost real room by polygon centroid
  let best: { id: string; x: number } | null = null;
  for (const r of MAP_DATA) {
    if (!isSelectableRoom(r)) continue;
    const c = polygonCentroid(r.points);
    if (!best || c.x > best.x) best = { id: r.id, x: c.x };
  }
  if (best) return best.id;

  // 4. First selectable room
  return MAP_DATA.find(isSelectableRoom)?.id ?? null;
}

export const DEFAULT_START_ROOM_ID: string | null = _resolveDefaultEntrance();

// ── Sidebar grouping ──────────────────────────────────────────────────

/**
 * High-level category for the sidebar's grouped view. The sidebar
 * collapses 100+ rooms into a handful of buckets so the user isn't
 * scrolling forever before they search.
 */
export type RoomGroup = "قاعات" | "مكاتب" | "مرافق" | "ممرات";

const GROUP_BY_TYPE: Record<string, RoomGroup> = {
  lab: "قاعات",
  classroom: "قاعات",
  amphitheater: "قاعات",
  office: "مكاتب",
  admin: "مكاتب",
  library: "مرافق",
  mosque: "مرافق",
  wc: "مرافق",
  stairs: "مرافق",
  other: "مرافق",
  corridor: "ممرات",
  waypoint: "ممرات",
};

export function roomGroup(room: Room): RoomGroup {
  return GROUP_BY_TYPE[String(room.type).toLowerCase()] ?? "مرافق";
}

/**
 * Corridors and waypoints are not destinations — they're routing
 * geometry. Sidebar lists and click handlers should filter on this.
 */
export function isSelectableRoom(room: Room): boolean {
  const t = String(room.type).toLowerCase();
  return t !== "corridor" && t !== "waypoint";
}

// ── Polygon geometry helpers ──────────────────────────────────────────

/** Parse a `"x,y x,y ..."` point string into `Point[]`. */
export function parsePoints(pointsStr: string): { x: number; y: number }[] {
  if (!pointsStr) return [];
  return pointsStr
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Geometric centroid of a polygon — used to pan-to-room. */
export function polygonCentroid(pointsStr: string): { x: number; y: number } {
  const pts = parsePoints(pointsStr);
  if (pts.length === 0) return { x: 50, y: 50 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}
