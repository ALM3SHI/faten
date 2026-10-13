"use client";

import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Room, RoomGroup } from "@/data/mapData";

// ── Constants ─────────────────────────────────────────────────────────

export const GROUP_ORDER: RoomGroup[] = ["قاعات", "مكاتب", "مرافق"];

const GROUP_LIMIT_DEFAULT = 5; // collapsed view per group


// ──────────────────────────────────────────────────────────────────
// Sidebar pieces
// ──────────────────────────────────────────────────────────────────

export function GroupedList({
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


export function SearchResults({
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
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-foreground/5 text-muted shrink-0">
          {roomTypeAr(room.type)}
        </span>
      </div>
      <div className="text-[11px] text-muted flex items-center gap-1">
        <MapPin className="w-3 h-3" />
        الدور الأرضي
      </div>
    </button>
  );
}


const ROOM_TYPE_AR: Record<string, string> = {
  lab: "معمل",
  office: "مكتب",
  classroom: "قاعة دراسية",
  amphitheater: "مدرج",
  admin: "إداري",
  library: "مكتبة",
  mosque: "مصلى",
  wc: "دورات مياه",
  stairs: "درج",
  corridor: "ممر",
  other: "مرفق",
};

export const roomTypeAr = (t: unknown) => ROOM_TYPE_AR[String(t)] ?? String(t);
