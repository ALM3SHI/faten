"use client";

import { MapPin } from "lucide-react";
import { Button } from "@/components/ds/button";
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
              <h2 className="text-caption font-bold uppercase tracking-wider text-ink-muted">
                {g}
                <span className="font-mono text-ink-muted mr-1.5">· {items.length}</span>
              </h2>
              {items.length > GROUP_LIMIT_DEFAULT && (
                <Button variant="bare"
                  onClick={() => onToggleGroup(g)}
                  className="text-caption text-info-ink hover:text-info-ink font-bold"
                >
                  {isOpen ? "إخفاء" : `عرض الكل (${items.length})`}
                </Button>
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
      <Card className="rounded-control border-line bg-surface-sunken p-6 text-center">
        <p className="text-small text-ink-muted">لا توجد نتائج مطابقة.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="text-caption font-bold uppercase tracking-wider text-ink-muted px-1 mb-1">
        نتائج البحث
        <span className="font-mono text-ink-muted mr-1.5">· {results.length}</span>
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
    <Button variant="bare"
      onClick={onClick}
      className={cn(
        "w-full text-right p-3 rounded-control border transition-all group",
        selected
          ? "bg-info-soft border-info-line "
          : "bg-surface border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-small font-bold truncate text-ink">
          {room.label}
        </span>
        <span className="text-caption font-bold px-1.5 py-0.5 rounded-md bg-surface-sunken text-ink-muted shrink-0">
          {roomTypeAr(room.type)}
        </span>
      </div>
      <div className="text-caption text-ink-muted flex items-center gap-1">
        <MapPin className="w-3 h-3" />
        الدور الأرضي
      </div>
    </Button>
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
