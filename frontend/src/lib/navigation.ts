/**
 * Compatibility re-export — the engine implementation now lives in
 * `./navEngine.ts` (a faithful 1-to-1 port of the legacy
 * `assets/nav-engine.js`). This file is kept so existing imports
 * like `@/lib/navigation` keep resolving.
 *
 * Callers should migrate to `@/lib/navEngine` over time. The
 * `NavEngine` class exported here is the same class.
 */

export { NavEngine, MAP_DATA, NAV_GRAPH } from "./navEngine";
export type {
  Point,
  NodeRef,
  NodeRef as Node,
  PathPoint,
  PathResult,
  PathStep,
  FindPathOptions,
} from "./navEngine";

// The legacy `Edge` type was a public-facing input shape (used by
// callers constructing a graph manually). The data layer uses the
// `NavEdge` type from `@/data/mapData` instead — re-exported here
// under the historic name for any imports still pointing at it.
export type { NavEdge as Edge } from "@/data/mapData";
