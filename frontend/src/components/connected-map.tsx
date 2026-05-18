"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Navigation2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import fullData from "@/data/map-data.json";

interface Room {
  id: string;
  label: string;
  type: string;
  color: string;
  shapeType: "polygon";
  points: string;
  doors?: { id: string; x: number; y: number }[];
}

const ALL_ROOMS = (fullData.mapData as Room[]).filter((r) => r.type !== "waypoint");

const TYPE_META: Record<string, { label: string }> = {
  lab: { label: "مختبر" },
  office: { label: "مكتب" },
  classroom: { label: "قاعة" },
  amphitheater: { label: "مدرج" },
  library: { label: "مكتبة" },
  mosque: { label: "مصلى" },
  admin: { label: "إدارة" },
  corridor: { label: "ممر" },
  stairs: { label: "سلالم" },
  wc: { label: "دورة مياه" },
  other: { label: "أخرى" },
};

function centroid(points: string): { cx: number; cy: number } {
  const pts = points
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    });
  const sum = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { cx: sum.x / pts.length, cy: sum.y / pts.length };
}

export function ConnectedMap({ density = "compact" }: { density?: "single" | "compact" }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as Room[];
    return ALL_ROOMS.filter((r) => r.label.includes(q) || r.id.includes(q));
  }, [query]);

  const topMatch = matches[0] ?? null;
  const center = useMemo(
    () => (topMatch ? centroid(topMatch.points) : null),
    [topMatch?.id, topMatch?.points],
  );

  const listLimit = density === "single" ? 4 : 2;
  const visible = matches.slice(0, listLimit);

  return (
    <motion.div
      layout
      className="w-full h-fit shrink-0 flex flex-col gap-3"
      dir="rtl"
    >
      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن قاعة..."
          aria-label="ابحث عن قاعة"
          className="w-full bg-black/50 border border-foreground/10 rounded-xl pr-10 pl-4 py-2.5 text-sm text-foreground placeholder:text-muted outline-none focus:border-[#0066cc]/50 focus:ring-1 focus:ring-[#0066cc]/30 transition-all"
        />
      </div>

      {/* SVG floor plan */}
      <div
        className={cn(
          "w-full bg-black/20 rounded-2xl border border-foreground/10 overflow-hidden",
          density === "single" ? "h-64" : "h-48",
        )}
      >
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label="خريطة الحرم الجامعي"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <g>
            {ALL_ROOMS.map((r) => {
              const isMatch = topMatch?.id === r.id;
              return (
                <polygon
                  key={r.id}
                  points={r.points}
                  vectorEffect="non-scaling-stroke"
                  className={cn(
                    "transition-all duration-300",
                    isMatch
                      ? "fill-[#0066cc]/40 stroke-[#0066cc] stroke-[0.4]"
                      : "fill-transparent stroke-white/20 stroke-[0.2]",
                  )}
                />
              );
            })}
          </g>

          {center && (
            <g>
              <motion.circle
                cx={center.cx}
                cy={center.cy}
                r={1.2}
                fill="#0066cc"
                animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: "easeOut" }}
                style={{
                  transformOrigin: `${center.cx}px ${center.cy}px`,
                  transformBox: "fill-box",
                }}
              />
              <circle cx={center.cx} cy={center.cy} r={0.8} fill="#0066cc" />
            </g>
          )}
        </svg>
      </div>

      {/* Result list */}
      <div className="flex flex-col gap-1.5">
        {query.trim() === "" ? null : matches.length === 0 ? (
          <p className="text-center text-muted text-xs py-4">لا توجد نتائج</p>
        ) : (
          visible.map((r) => {
            const isTop = topMatch?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setQuery(r.label)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-right transition-all active:scale-[0.98] border",
                  isTop
                    ? "bg-[#0066cc]/15 border-[#0066cc]/30 text-foreground"
                    : "bg-foreground/5 border-foreground/10 text-muted hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: r.color }}
                />
                <span className="text-[13px] font-medium flex-1 truncate">{r.label}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/5 text-muted">
                  {TYPE_META[r.type]?.label ?? r.type}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Navigate CTA — appears as soon as a room is selected via search or list */}
      {topMatch && (
        <motion.button
          layout
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => router.push(`/locations?target=${encodeURIComponent(topMatch.id)}`)}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-2xl bg-[#0066cc] hover:bg-[#005bb5] text-foreground font-bold text-sm transition-all active:scale-[0.98] shadow-lg shadow-[#0066cc]/20"
        >
          <Navigation2 className="w-4 h-4" />
          <span>ابدأ الملاحة الآن</span>
          <span className="text-muted text-[11px] font-medium mr-1">إلى {topMatch.label}</span>
        </motion.button>
      )}
    </motion.div>
  );
}
