"use client";

import { motion } from "framer-motion";
import { TrendingUp, Trophy, Clock, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePomodoroStore } from "@/store/pomodoroStore";
import { useGpaStore } from "@/store/gpaStore";
import { cn } from "@/lib/utils";

interface ConnectedDashboardProps {
  density?: "single" | "compact";
}

// Static mock — in production this comes from the schedule service.
const NEXT_CLASS = {
  label: "قاعة 11",
  time: "10:30 ص",
  startsInMinutes: 25,
  roomId: "Room_11",
};

const CURRENT_GPA = 3.84;

export function ConnectedDashboard({ density = "compact" }: ConnectedDashboardProps) {
  const router = useRouter();
  const completedSessions = usePomodoroStore((s) => s.completedSessions);
  const targetGpa = useGpaStore((s) => s.targetGpa);

  // Show projected GPA when the user has saved a target via the GPA widget,
  // otherwise the current one. Tiny delta hint helps the eye notice change.
  const gpaToShow = targetGpa ?? CURRENT_GPA;
  const gpaDelta = targetGpa !== null ? targetGpa - CURRENT_GPA : 0;

  return (
    <motion.div
      layout
      className={cn(
        "w-full h-fit shrink-0 flex flex-col bg-foreground/5 backdrop-blur-xl border border-foreground/10 rounded-3xl",
        density === "single" ? "p-5 gap-4" : "p-4 gap-3"
      )}
      dir="rtl"
    >
      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          icon={TrendingUp}
          label="المعدل الحالي"
          value={gpaToShow.toFixed(2)}
          hint={gpaDelta !== 0 ? `${gpaDelta > 0 ? "+" : ""}${gpaDelta.toFixed(2)}` : "من 4.00"}
          hintTone={gpaDelta > 0 ? "positive" : gpaDelta < 0 ? "negative" : "muted"}
          accent="text-[#0066cc]"
        />
        <StatCard
          icon={Trophy}
          label="جلسات التركيز"
          value={String(completedSessions)}
          hint={completedSessions === 0 ? "ابدأ أول جلسة" : `${Math.max(0, 4 - completedSessions)} حتى الإنجاز`}
          hintTone={completedSessions >= 4 ? "positive" : "muted"}
          accent="text-emerald-400"
        />
      </div>

      {/* Next Class */}
      <button
        onClick={() => router.push(`/locations?target=${encodeURIComponent(NEXT_CLASS.roomId)}`)}
        className="w-full flex items-center justify-between gap-3 bg-card/50 border border-foreground/10 hover:border-[#0066cc]/30 hover:bg-[#0066cc]/[0.04] rounded-2xl p-3 transition-all text-right active:scale-[0.99]"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#0066cc]/15 border border-[#0066cc]/20 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-[#0066cc]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-muted text-[10px] font-bold tracking-tight">المحاضرة القادمة</span>
            <span className="text-foreground text-[13px] font-bold flex items-center gap-1.5 truncate">
              <MapPin className="w-3 h-3 text-muted shrink-0" />
              <span className="truncate">{NEXT_CLASS.label}</span>
              <span className="text-muted">·</span>
              <span className="text-muted font-mono">{NEXT_CLASS.time}</span>
            </span>
          </div>
        </div>
        <span className="text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0 whitespace-nowrap">
          خلال {NEXT_CLASS.startsInMinutes} د
        </span>
      </button>
    </motion.div>
  );
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  hintTone: "positive" | "negative" | "muted";
  accent: string;
}

function StatCard({ icon: Icon, label, value, hint, hintTone, accent }: StatCardProps) {
  const hintClass =
    hintTone === "positive"
      ? "text-emerald-400"
      : hintTone === "negative"
        ? "text-red-400"
        : "text-muted";

  return (
    <div className="bg-card/50 border border-foreground/10 rounded-2xl p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted text-[10px] font-bold tracking-tight">{label}</span>
        <Icon className={cn("w-3.5 h-3.5", accent)} />
      </div>
      <span className={cn("font-mono font-black text-2xl tracking-tighter leading-none", accent)}>
        {value}
      </span>
      <span className={cn("text-[9px] font-bold tracking-tight", hintClass)}>{hint}</span>
    </div>
  );
}
