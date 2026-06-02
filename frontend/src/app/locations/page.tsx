"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Navigation2,
  MapPin,
  X,
  ChevronLeft,
  Plus,
  Minus,
  Maximize2,
  Compass,
  Footprints,
  AlertCircle,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  IndoorMap,
  type IndoorMapHandle,
} from "@/components/map/IndoorMap";
import {
  MAP_DATA,
  NAV_GRAPH,
  DEFAULT_START_ROOM_ID,
  isSelectableRoom,
  polygonCentroid,
  roomGroup,
  type Room,
  type RoomGroup,
} from "@/data/mapData";
import { NavEngine, type PathResult } from "@/lib/navEngine";

// ── Constants ─────────────────────────────────────────────────────────

const GROUP_ORDER: RoomGroup[] = ["قاعات", "مكاتب", "مرافق"];
const GROUP_LIMIT_DEFAULT = 5; // collapsed view per group

// ── Page ──────────────────────────────────────────────────────────────

function LocationsContent() {
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
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Navbar />

      <main className="flex-1 flex flex-col md:flex-row pt-16 min-h-0">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside
          className="w-full md:w-[380px] bg-card text-foreground border-l border-border flex flex-col gap-4 relative z-30 shadow-2xl min-h-0"
          dir="rtl"
        >
          {/* Header — sticky title */}
          <div className="px-6 pt-6 pb-2 shrink-0">
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
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-300 p-3 text-xs flex items-start gap-2">
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
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-300 p-3 text-xs flex items-start gap-2">
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
                  <Card className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-300 p-3 text-xs flex items-start gap-2">
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

          {/* Status chip */}
          <div className="absolute top-6 right-6 z-10">
            <div className="px-3 py-2 rounded-xl bg-card border border-border text-foreground shadow-sm flex items-center gap-2 backdrop-blur-md dark:glass dark:border-foreground/10">
              <div className="w-2 h-2 rounded-full bg-uqu-cyan animate-pulse" />
              <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
                Nav Engine · A*
              </span>
            </div>
          </div>

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

// ──────────────────────────────────────────────────────────────────
// Sidebar pieces
// ──────────────────────────────────────────────────────────────────

function GroupedList({
  grouped,
  expanded,
  onToggleGroup,
  selectedId,
  onSelect,
}: {
  grouped: Map<RoomGroup, Room[]>;
  expanded: Record<RoomGroup, boolean>;
  onToggleGroup: (g: RoomGroup) => void;
  selectedId: string | null;
  onSelect: (r: Room) => void;
}) {
  return (
    <div className="space-y-3">
      {GROUP_ORDER.map((g) => {
        const items = grouped.get(g) ?? [];
        if (items.length === 0) return null;
        const isOpen = expanded[g];
        const visible = isOpen ? items : items.slice(0, GROUP_LIMIT_DEFAULT);
        return (
          <section key={g}>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">
                {g}
                <span className="font-mono text-muted mr-1.5">· {items.length}</span>
              </h3>
              {items.length > GROUP_LIMIT_DEFAULT && (
                <button
                  onClick={() => onToggleGroup(g)}
                  className="text-[11px] text-uqu-accent hover:text-uqu-accent/80 font-bold"
                >
                  {isOpen ? "إخفاء" : `عرض الكل (${items.length})`}
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {visible.map((r) => (
                <RoomRow
                  key={r.id}
                  room={r}
                  selected={r.id === selectedId}
                  onClick={() => onSelect(r)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SearchResults({
  results,
  selectedId,
  onSelect,
}: {
  results: Room[];
  selectedId: string | null;
  onSelect: (r: Room) => void;
}) {
  if (results.length === 0) {
    return (
      <Card className="rounded-xl border-foreground/10 bg-foreground/5 p-6 text-center">
        <p className="text-sm text-muted-foreground">لا توجد نتائج مطابقة.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted px-1 mb-1">
        نتائج البحث
        <span className="font-mono text-muted mr-1.5">· {results.length}</span>
      </div>
      {results.map((r) => (
        <RoomRow
          key={r.id}
          room={r}
          selected={r.id === selectedId}
          onClick={() => onSelect(r)}
        />
      ))}
    </div>
  );
}

function RoomRow({
  room,
  selected,
  onClick,
}: {
  room: Room;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-right p-3 rounded-xl border transition-all group",
        selected
          ? "bg-uqu-accent/15 border-uqu-accent/50 shadow-[0_0_18px_-6px_hsla(245,78%,62%,0.6)]"
          : "bg-background border-border hover:border-foreground/20",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[13px] font-bold truncate text-foreground">
          {room.label}
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-foreground/5 text-muted shrink-0 font-mono">
          {String(room.type)}
        </span>
      </div>
      <div className="text-[10px] text-muted flex items-center gap-1 font-mono">
        <MapPin className="w-3 h-3" />
        {room.id}
      </div>
    </button>
  );
}

function SelectedRoomCard({
  room,
  startRoom,
  onNavigate,
  onChangeStart,
  onClear,
}: {
  room: Room;
  startRoom: Room | null;
  onNavigate: () => void;
  onChangeStart: () => void;
  onClear: () => void;
}) {
  const centroid = polygonCentroid(room.points);
  return (
    <div className="space-y-3">
      {/* Prominent back-to-list button. Sits ABOVE the card so the
          escape route is the first thing the user sees — the rest of
          the card focuses entirely on the navigate CTA. */}
      <Button
        onClick={onClear}
        variant="ghost"
        className="w-full h-10 rounded-xl text-muted hover:text-foreground hover:bg-foreground/5 gap-2 font-bold border border-foreground/10"
      >
        <X className="w-4 h-4" />
        عودة للقائمة
      </Button>

      <Card className="p-5 rounded-2xl bg-uqu-accent/10 border-uqu-accent/30 space-y-5 shadow-[0_0_24px_-6px_hsla(245,78%,62%,0.55)]">
        {/* Room identity */}
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-uqu-accent/20 border border-uqu-accent/40 flex items-center justify-center text-uqu-accent shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-lg leading-tight truncate">
              {room.label}
            </h3>
            <p className="text-[11px] text-uqu-accent font-bold font-mono mt-0.5">
              {room.id} · {String(room.type)}
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-2">
          <Tile
            label="الموقع"
            value={`(${centroid.x.toFixed(0)}, ${centroid.y.toFixed(0)})`}
            mono
          />
          <Tile label="نقطة الدخول" value={`${room.doors?.length ?? 0} باب`} />
        </div>

        {/* Start point chip — matches Tile styling above */}
        <div className="p-2.5 rounded-xl bg-foreground/5 border border-foreground/10">
          <div className="text-[10px] text-muted mb-0.5 font-bold uppercase tracking-wider">
            نقطة البداية
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold truncate">
              {startRoom?.label || "—"}
            </span>
            <button
              onClick={onChangeStart}
              className="text-uqu-accent hover:text-uqu-accent/80 font-bold text-[11px] shrink-0"
            >
              تغيير
            </button>
          </div>
        </div>

        {/* MAIN CTA — large, bright, unmistakable. */}
        <Button
          onClick={onNavigate}
          className={cn(
            "w-full h-16 rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90",
            "text-base font-black gap-3",
            "shadow-[0_0_28px_-4px_hsla(245,78%,62%,0.75)]",
            "hover:shadow-[0_0_36px_-4px_hsla(245,78%,62%,0.9)] transition-shadow",
          )}
        >
          <Navigation2 className="w-5 h-5" />
          ابدأ
        </Button>
      </Card>
    </div>
  );
}

function ActiveRoutePanel({
  selectedRoom,
  startRoom,
  stats,
  onCancel,
  onChangeStart,
}: {
  selectedRoom: Room | null;
  startRoom: Room | null;
  stats: { meters: number; time: string; steps: number } | null;
  onCancel: () => void;
  onChangeStart: () => void;
}) {
  return (
    <Card className="p-5 rounded-2xl bg-emerald-500/10 border-emerald-500/30 space-y-4 shadow-[0_0_24px_-8px_rgba(52,211,153,0.5)]">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 animate-pulse">
          <Navigation2 className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-emerald-300">المسار</h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-2 h-2 rounded-full bg-uqu-cyan shrink-0" />
          <span className="text-muted shrink-0">من:</span>
          <span className="font-bold truncate flex-1">
            {startRoom?.label || "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <span className="w-2 h-2 rounded-full bg-uqu-accent shrink-0" />
          <span className="text-muted shrink-0">إلى:</span>
          <span className="font-bold truncate flex-1">
            {selectedRoom?.label || "—"}
          </span>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <Tile label="المسافة" value={`${stats.meters} م`} mono />
          <Tile label="الوقت" value={stats.time} mono />
          <Tile label="خطوات" value={String(stats.steps)} mono />
        </div>
      )}

      {/* Change-start point — explicit prominent secondary action. Lets
          the student switch from the default Main Entrance start to any
          other room for true room-to-room navigation. */}
      <Button
        onClick={onChangeStart}
        variant="outline"
        className="w-full h-11 rounded-xl border-uqu-cyan/40 bg-uqu-cyan/[0.06] text-uqu-cyan hover:bg-uqu-cyan/[0.12] hover:text-uqu-cyan gap-2 font-bold"
      >
        <Footprints className="w-4 h-4" />
        🔁 تغيير نقطة البداية
      </Button>

      <Button
        onClick={onCancel}
        variant="outline"
        className="w-full rounded-xl glass border-foreground/10 gap-2"
      >
        <X className="w-4 h-4" />
        إنهاء
      </Button>
    </Card>
  );
}

function PickStart({
  query,
  onQueryChange,
  grouped,
  searchResults,
  expanded,
  onToggleGroup,
  currentStartId,
  onPick,
  onCancel,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  grouped: Map<RoomGroup, Room[]>;
  searchResults: Room[];
  expanded: Record<RoomGroup, boolean>;
  onToggleGroup: (g: RoomGroup) => void;
  currentStartId: string | null;
  onPick: (roomId: string) => void;
  onCancel: () => void;
}) {
  const isSearching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Footprints className="w-4 h-4 text-uqu-cyan" />
            اختر نقطة البداية
          </h3>
          <p className="text-[11px] text-muted">
            ابحث أو اختر أي قاعة أو مدخل كنقطة انطلاق.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-muted hover:text-foreground text-[11px] font-bold inline-flex items-center gap-1"
        >
          <ChevronLeft className="w-3 h-3 rotate-180" />
          عودة
        </button>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="ابحث عن قاعة، مكتب، أو مدخل..."
          className="pr-10 rounded-xl glass border-foreground/10"
          aria-label="بحث نقطة البداية"
          autoFocus
        />
        {query && (
          <button
            onClick={() => onQueryChange("")}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            aria-label="مسح البحث"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {(() => {
        const defaultId = DEFAULT_START_ROOM_ID;
        if (!defaultId || isSearching) return null;
        return (
          <button
            onClick={() => onPick(defaultId)}
            className={cn(
              "w-full p-3 rounded-xl border text-right transition-colors",
              currentStartId === defaultId
                ? "bg-uqu-cyan/15 border-uqu-cyan/50"
                : "bg-foreground/5 border-foreground/10 hover:bg-foreground/5",
            )}
          >
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-uqu-cyan" />
              <span className="text-[13px] font-bold">المدخل الرئيسي</span>
              <span className="text-[10px] text-muted font-mono mr-auto">
                {defaultId}
              </span>
            </div>
          </button>
        );
      })()}

      {isSearching ? (
        <SearchResults
          results={searchResults}
          selectedId={currentStartId}
          onSelect={(r) => onPick(r.id)}
        />
      ) : (
        <GroupedList
          grouped={grouped}
          expanded={expanded}
          onToggleGroup={onToggleGroup}
          selectedId={currentStartId}
          onSelect={(r) => onPick(r.id)}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="p-2.5 rounded-xl bg-foreground/5 border border-foreground/10">
      <div className="text-[10px] text-muted mb-0.5 font-bold uppercase tracking-wider">
        {label}
      </div>
      <div className={cn("text-[12px] font-bold", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

// ── Page wrapper (Suspense for useSearchParams) ───────────────────────

export default function LocationsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-muted-foreground">
          جاري تحميل الخريطة...
        </div>
      }
    >
      <LocationsContent />
    </Suspense>
  );
}
