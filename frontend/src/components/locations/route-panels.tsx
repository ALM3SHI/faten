"use client";

import { Search, Navigation2, MapPin, X, ChevronLeft, Compass, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DEFAULT_START_ROOM_ID, polygonCentroid, type Room, type RoomGroup } from "@/data/mapData";
import { GroupedList, SearchResults, roomTypeAr } from "@/components/locations/room-list";

export function SelectedRoomCard({
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
              {roomTypeAr(room.type)}
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


export function ActiveRoutePanel({
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
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-700 dark:text-emerald-300 animate-pulse">
          <Navigation2 className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-emerald-700 dark:text-emerald-300">المسار</h3>
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


export function PickStart({
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
