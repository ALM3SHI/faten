"use client";

import { Search, Navigation2, MapPin, X, ChevronLeft, Compass, Footprints } from "lucide-react";
import { Button as DsButton } from "@/components/ds/button";
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
        className="w-full h-10 rounded-control text-ink-muted hover:text-ink hover:bg-surface-sunken gap-2 font-bold border border-line"
      >
        <X className="w-4 h-4" />
        عودة للقائمة
      </Button>

      <Card className="p-5 rounded-card bg-info-soft border-info-line space-y-5">
        {/* Room identity */}
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-card bg-info-soft border border-info-line flex items-center justify-center text-info-ink shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-subheading leading-tight truncate">
              {room.label}
            </h3>
            <p className="text-caption text-info-ink font-bold font-mono mt-0.5">
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
        <div className="p-2.5 rounded-control bg-surface-sunken border border-line">
          <div className="text-caption text-ink-muted mb-0.5 font-bold uppercase tracking-wider">
            نقطة البداية
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-small font-bold truncate">
              {startRoom?.label || "—"}
            </span>
            <DsButton variant="bare"
              onClick={onChangeStart}
              className="text-info-ink hover:text-info-ink font-bold text-caption shrink-0"
            >
              تغيير
            </DsButton>
          </div>
        </div>

        {/* MAIN CTA — large, bright, unmistakable. */}
        <Button
          onClick={onNavigate}
          className={cn(
            "w-full h-16 rounded-card bg-brand hover:bg-brand-hover",
            "text-body font-bold gap-3",
            "",
            "hover: transition-shadow",
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
    <Card className="p-5 rounded-card bg-success-soft border-success-line space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-success-soft border border-success-line flex items-center justify-center text-success-ink animate-pulse">
          <Navigation2 className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-success-ink">المسار</h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-small">
          <span className="w-2 h-2 rounded-full bg-info-soft shrink-0" />
          <span className="text-ink-muted shrink-0">من:</span>
          <span className="font-bold truncate flex-1">
            {startRoom?.label || "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-small">
          <span className="w-2 h-2 rounded-full bg-brand shrink-0" />
          <span className="text-ink-muted shrink-0">إلى:</span>
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
        className="w-full h-11 rounded-control border-brand bg-info-soft text-info-ink hover:bg-info-soft hover:text-info-ink gap-2 font-bold"
      >
        <Footprints className="w-4 h-4" />
        🔁 تغيير نقطة البداية
      </Button>

      <Button
        onClick={onCancel}
        variant="outline"
        className="w-full rounded-control border border-line bg-surface shadow-card gap-2"
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
          <h3 className="text-small font-bold flex items-center gap-1.5">
            <Footprints className="w-4 h-4 text-info-ink" />
            اختر نقطة البداية
          </h3>
          <p className="text-caption text-ink-muted">
            ابحث أو اختر أي قاعة أو مدخل كنقطة انطلاق.
          </p>
        </div>
        <DsButton variant="bare"
          onClick={onCancel}
          className="text-ink-muted hover:text-ink text-caption font-bold inline-flex items-center gap-1"
        >
          <ChevronLeft className="w-3 h-3 rotate-180" />
          عودة
        </DsButton>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="ابحث عن قاعة، مكتب، أو مدخل..."
          className="pr-10 rounded-control border border-line bg-surface shadow-card"
          aria-label="بحث نقطة البداية"
          autoFocus
        />
        {query && (
          <DsButton variant="bare"
            onClick={() => onQueryChange("")}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            aria-label="مسح البحث"
          >
            <X className="w-3.5 h-3.5" />
          </DsButton>
        )}
      </div>

      {(() => {
        const defaultId = DEFAULT_START_ROOM_ID;
        if (!defaultId || isSearching) return null;
        return (
          <DsButton variant="bare"
            onClick={() => onPick(defaultId)}
            className={cn(
              "w-full p-3 rounded-control border text-right transition-colors",
              currentStartId === defaultId
                ? "bg-info-soft border-brand"
                : "bg-surface-sunken border-line hover:bg-surface-sunken",
            )}
          >
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-info-ink" />
              <span className="text-small font-bold">المدخل الرئيسي</span>
              <span className="text-caption text-ink-muted font-mono mr-auto">
                {defaultId}
              </span>
            </div>
          </DsButton>
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
    <div className="p-2.5 rounded-control bg-surface-sunken border border-line">
      <div className="text-caption text-ink-muted mb-0.5 font-bold uppercase tracking-wider">
        {label}
      </div>
      <div className={cn("text-small font-bold", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}
