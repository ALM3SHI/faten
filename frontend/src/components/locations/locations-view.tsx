"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X, Plus, Minus, Maximize2, AlertCircle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { IndoorMap, type IndoorMapHandle } from "@/components/map/IndoorMap";
import {
  MAP_DATA,
  NAV_GRAPH,
  DEFAULT_START_ROOM_ID,
  isSelectableRoom,
  roomGroup,
  type Room,
  type RoomGroup,
} from "@/data/mapData";
import { NavEngine, type PathResult } from "@/lib/navEngine";
import { GROUP_ORDER, GroupedList, SearchResults } from "@/components/locations/room-list";
import { SelectedRoomCard, ActiveRoutePanel, PickStart } from "@/components/locations/route-panels";

// ── Page ──────────────────────────────────────────────────────────────

export function LocationsContent() {
  const searchParams = useSearchParams();
  const mapRef = useRef<IndoorMapHandle | null>(null);

  // ── Engine — built once ───────────────────────────────────────────
  const engine = useMemo(() => {
    const e = new NavEngine(MAP_DATA, NAV_GRAPH);
    e.build();
    return e;
  }, []);

  // ── State ────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [pickStartQuery, setPickStartQuery] = useState("");
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [navStartRoom, setNavStartRoom] = useState<string | null>(
    DEFAULT_START_ROOM_ID,
  );
  const [navRoute, setNavRoute] = useState<PathResult | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  // Sidebar mode: browse list vs. picking the starting room.
  const [mode, setMode] = useState<"browse" | "pickStart">("browse");
  // Per-group expansion state for the collapsed view.
  const [expanded, setExpanded] = useState<Record<RoomGroup, boolean>>({
    قاعات: false,
    مكاتب: false,
    مرافق: false,
    ممرات: false,
  });

  // ── Selectable subset (exclude corridors/waypoints from EVERY list) ─
  const selectable = useMemo(() => MAP_DATA.filter(isSelectableRoom), []);

  // ── Grouped (when search is empty) ───────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<RoomGroup, Room[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const r of selectable) {
      const g = roomGroup(r);
      if (g === "ممرات") continue; // never surface corridors
      const list = map.get(g) ?? [];
      list.push(r);
      map.set(g, list);
    }
    return map;
  }, [selectable]);

  // ── Filtered (when user is searching) ────────────────────────────
  const filtered = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    const needle = q.toLowerCase();
    return selectable
      .filter(
        (r) =>
          r.label?.toLowerCase().includes(needle) ||
          r.id?.toLowerCase().includes(needle),
      )
      .slice(0, 30);
  }, [searchQuery, selectable]);

  const pickStartFiltered = useMemo(() => {
    const q = pickStartQuery.trim();
    if (!q) return [];
    const needle = q.toLowerCase();
    return selectable
      .filter(
        (r) =>
          r.label?.toLowerCase().includes(needle) ||
          r.id?.toLowerCase().includes(needle),
      )
      .slice(0, 50);
  }, [pickStartQuery, selectable]);

  const openPickStart = () => {
    setPickStartQuery("");
    setExpanded((prev) => ({ ...prev, قاعات: true }));
    setMode("pickStart");
  };

  // ── URL ?target= deep-link → auto-select + auto-route ────────────
  useEffect(() => {
    const target = searchParams.get("target");
    if (!target) return;
    const room = MAP_DATA.find((r) => r.id === target);
    if (!room || !isSelectableRoom(room)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deep link ?target= selects a room once
    setSelectedRoom(room);
    // give the map a tick to fit before centering
    requestAnimationFrame(() => mapRef.current?.panToRoom(room.id));
    if (navStartRoom) {
      const result = engine.findPath(navStartRoom, room.id);
      if (result) setNavRoute(result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, engine]);

  // ── Selection handler — also pans the map ────────────────────────
  const selectRoom = (room: Room) => {
    setSelectedRoom(room);
    setNavError(null);
    // Defer to next frame so the map has the latest props applied.
    requestAnimationFrame(() => mapRef.current?.panToRoom(room.id));
  };

  const clearSelection = () => {
    setSelectedRoom(null);
    setNavRoute(null);
    setNavError(null);
    setMode("browse");
  };

  // ── Coordinates logging (for adding new entrance) ──────────────────
  const handleMapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    console.log(
      `📍 إحداثيات المدخل: X: ${x.toFixed(2)}, Y: ${y.toFixed(2)}`
    );
  };

  // ── Navigation flow ──────────────────────────────────────────────
  const requestNavigation = () => {
    if (!selectedRoom) return;
    // Default start is the main entrance; if it's missing, drop into
    // picker mode immediately so the user must choose.
    if (!navStartRoom) {
      openPickStart();
      return;
    }
    runFindPath(navStartRoom, selectedRoom.id);
  };

  const runFindPath = (fromId: string, toId: string) => {
    setNavError(null);
    if (fromId === toId) {
      setNavError("نقطة البداية والوجهة متطابقتان.");
      setNavRoute(null);
      return;
    }
    const result = engine.findPath(fromId, toId);
    if (!result || result.points.length < 2) {
      setNavError("لم نتمكن من إيجاد مسار بين النقطتين.");
      setNavRoute(null);
      return;
    }
    setNavRoute(result);
    setMode("browse");
  };

  const cancelNavigation = () => {
    setNavRoute(null);
    setNavError(null);
  };

  // ── Derived render values ────────────────────────────────────────
  // The route is rendered as a Catmull-Rom → Bézier curve over the
  // raw A* waypoints — gives a smooth flowing path through the
  // corridors. The engine still exposes the legacy linear-subdivision
  // points (`smoothPoints`) under `toSvgPath` if straight segments
  // are ever needed instead.
  const smoothPath = useMemo(
    () => (navRoute ? engine.toSmoothCurvePath(navRoute.points) : null),
    [navRoute, engine],
  );
  const startRoom = useMemo(
    () => (navStartRoom ? MAP_DATA.find((r) => r.id === navStartRoom) ?? null : null),
    [navStartRoom],
  );
  const navStartPoint = useMemo(
    () =>
      navRoute && navRoute.points.length > 0
        ? { x: navRoute.points[0].x, y: navRoute.points[0].y }
        : null,
    [navRoute],
  );
  const navEndPoint = useMemo(
    () => {
      if (!navRoute || navRoute.points.length === 0) return null;
      const p = navRoute.points[navRoute.points.length - 1];
      return { x: p.x, y: p.y };
    },
    [navRoute],
  );

  // Stats now come straight off the engine — distanceMeters /
  // estimatedTime are computed inside _buildResult using the legacy
  // METERS_PER_UNIT (1.2) and WALK_SPEED_MPS (1.2). steps = number
  // of nav graph hops in the result.
  const routeStats = useMemo(() => {
    if (!navRoute) return null;
    return {
      meters: navRoute.distanceMeters,
      time: navRoute.estimatedTime,
      steps: navRoute.points.length,
    };
  }, [navRoute]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100dvh-var(--bottom-nav-h))] flex flex-col bg-background overflow-hidden">
      <Navbar />

      <main className="flex-1 flex flex-col md:flex-row pt-16 min-h-0">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside
          className="w-full md:w-[380px] bg-card text-foreground border-l border-border flex flex-col gap-4 relative z-30 shadow-2xl min-h-0"
          dir="rtl"
        >
          {/* Header — sticky title */}
          <div className="px-6 pt-4 pb-2 shrink-0 space-y-3">
            <SectionTabs />
            <h1 className="text-2xl font-black">الخريطة</h1>
          </div>

          {/* Sticky search — ONLY visible in browse mode. When the user
              has selected a room, picked a route, or entered start-picker
              mode, the search bar steps aside so the focused panel below
              owns the full sidebar width. */}
          {mode === "browse" && !selectedRoom && !navRoute && (
            <div className="px-6 sticky top-0 shrink-0 z-10 bg-transparent">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن قاعة، مكتب، أو معمل..."
                  className="pr-10 rounded-xl glass border-foreground/10"
                  aria-label="بحث"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                    aria-label="مسح البحث"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Body — scrollable. Branches are mutually exclusive so the
              sidebar always presents ONE focused view, never a stack
              of cards on top of a long list. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
            {mode === "pickStart" ? (
              // 1. Start-picker takes over the whole body.
              <PickStart
                query={pickStartQuery}
                onQueryChange={setPickStartQuery}
                grouped={grouped}
                searchResults={pickStartFiltered}
                expanded={expanded}
                onToggleGroup={(g) =>
                  setExpanded((prev) => ({ ...prev, [g]: !prev[g] }))
                }
                currentStartId={navStartRoom}
                onPick={(roomId) => {
                  setNavStartRoom(roomId);
                  if (selectedRoom) {
                    runFindPath(roomId, selectedRoom.id);
                  } else {
                    setMode("browse");
                  }
                }}
                onCancel={() => setMode("browse")}
              />
            ) : navRoute ? (
              // 2. Active navigation — route is rendered on the map,
              //    the sidebar shows the route panel + any error.
              <>
                <ActiveRoutePanel
                  selectedRoom={selectedRoom}
                  startRoom={startRoom}
                  stats={routeStats}
                  onCancel={cancelNavigation}
                  onChangeStart={openPickStart}
                />
                {navError && (
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-3 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{navError}</span>
                  </Card>
                )}
              </>
            ) : selectedRoom ? (
              // 3. Room is selected (no route yet) — search/lists are
              //    hidden; only the focused selection card appears so
              //    the big "ابدأ" button is unmistakable.
              <>
                <SelectedRoomCard
                  room={selectedRoom}
                  startRoom={startRoom}
                  onNavigate={requestNavigation}
                  onChangeStart={openPickStart}
                  onClear={clearSelection}
                />
                {navError && (
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-3 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{navError}</span>
                  </Card>
                )}
              </>
            ) : (
              // 4. Default browse — search input above + grouped or
              //    filtered list here.
              <>
                {searchQuery.trim() ? (
                  <SearchResults
                    results={filtered}
                    selectedId={null}
                    onSelect={selectRoom}
                  />
                ) : (
                  <GroupedList
                    grouped={grouped}
                    expanded={expanded}
                    onToggleGroup={(g) =>
                      setExpanded((prev) => ({ ...prev, [g]: !prev[g] }))
                    }
                    selectedId={null}
                    onSelect={selectRoom}
                  />
                )}
                {navError && (
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-3 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{navError}</span>
                  </Card>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── Map ────────────────────────────────────────────────── */}
        <div className="flex-1 relative bg-muted/30 dark:bg-[#020202] min-h-0">
          <div className="absolute inset-0 pointer-events-none opacity-30">
            <div className="aurora-blob w-[1000px] h-[1000px] -top-96 -right-96 bg-uqu-accent/20 blur-[180px]" />
            <div className="aurora-blob w-[800px] h-[800px] -bottom-64 -left-64 bg-uqu-cyan/20 blur-[180px]" />
          </div>

          <IndoorMap
            ref={mapRef}
            selectedRoomId={selectedRoom?.id ?? null}
            routePath={smoothPath}
            routeStart={navStartPoint}
            routeEnd={navEndPoint}
            onRoomClick={selectRoom}
            onMapClick={handleMapClick}
          />


          {/* Zoom controls */}
          <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => mapRef.current?.zoomBy(1.25)}
              className="rounded-xl w-10 h-10 bg-card border-border text-foreground shadow-sm hover:bg-accent/50 dark:glass dark:border-foreground/10 dark:hover:bg-foreground/5"
              aria-label="تكبير"
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => mapRef.current?.zoomBy(0.8)}
              className="rounded-xl w-10 h-10 bg-card border-border text-foreground shadow-sm hover:bg-accent/50 dark:glass dark:border-foreground/10 dark:hover:bg-foreground/5"
              aria-label="تصغير"
            >
              <Minus className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => mapRef.current?.resetView()}
              className="rounded-xl w-10 h-10 bg-card border-border text-foreground shadow-sm hover:bg-accent/50 dark:glass dark:border-foreground/10 dark:hover:bg-foreground/5"
              aria-label="إعادة الضبط"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
