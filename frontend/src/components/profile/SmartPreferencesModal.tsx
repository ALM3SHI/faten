"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProfilePreferences } from "@/store/profileStore";
import {
  PEAK_OPTIONS,
  STRATEGY_OPTIONS,
  FOCUS_OPTIONS,
  SHORT_BREAK_OPTIONS,
  LONG_BREAK_OPTIONS,
  DAY_OFF_OPTIONS,
} from "./preferenceOptions";

/**
 * Smart Preferences Modal — controlled by Profile page draft state (Phase 4B.4).
 * Changes apply to the server only when the user clicks "حفظ التغييرات" on /profile.
 */
export function SmartPreferencesModal({
  isOpen,
  onClose,
  preferences,
  onPreferencesChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  preferences: ProfilePreferences;
  onPreferencesChange: (patch: Partial<ProfilePreferences>) => void;
}) {

  // Lock background scroll while the modal is open and wire Esc to close.
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="prefs-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            key="prefs-modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            dir="rtl"
            role="dialog"
            aria-label="تفضيلات المذاكرة"
            className="fixed inset-4 md:inset-x-auto md:inset-y-10 md:left-1/2 md:-translate-x-1/2 md:w-[min(960px,calc(100%-2rem))] z-50 bg-card border border-border text-foreground dark:bg-card/95 dark:border-foreground/10 backdrop-blur-2xl rounded-[28px] shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 p-6 border-b border-foreground/10 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg md:text-xl font-bold mb-1">تفضيلات المذاكرة</h2>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    خصّص تجربتك ليبني المساعد خطة دراسة وجلسات تركيز مناسبة لك.
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 rounded-full hover:bg-foreground/5 text-muted hover:text-foreground shrink-0"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full">
              {/* Peak Energy */}
              <section>
                <SectionHeader titleAr="أوقات الذروة الذهنية" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PEAK_OPTIONS.map((opt) => (
                    <SelectCard
                      key={opt.value}
                      selected={preferences.energyPeak === opt.value}
                      title={opt.titleAr}
                      subtitle={opt.subtitleAr}
                      onClick={() => onPreferencesChange({ energyPeak: opt.value })}
                    />
                  ))}
                </div>
              </section>

              {/* Task Strategy */}
              <section>
                <SectionHeader titleAr="استراتيجية المذاكرة" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {STRATEGY_OPTIONS.map((opt) => (
                    <SelectCard
                      key={opt.value}
                      selected={preferences.taskStrategy === opt.value}
                      title={opt.titleAr}
                      subtitle={opt.subtitleAr}
                      onClick={() => onPreferencesChange({ taskStrategy: opt.value })}
                    />
                  ))}
                </div>
              </section>

              {/* Pomodoro */}
              <section>
                <SectionHeader titleAr="إعدادات البومودورو" />
                <div className="space-y-4 p-5 rounded-2xl bg-foreground/5 border border-foreground/10">
                  <ChipRow
                    label="مدة التركيز"
                    unit="دقيقة"
                    options={FOCUS_OPTIONS}
                    selected={preferences.pomodoroFocus}
                    onChange={(v) => onPreferencesChange({ pomodoroFocus: v })}
                  />
                  <ChipRow
                    label="استراحة قصيرة"
                    unit="دقيقة"
                    options={SHORT_BREAK_OPTIONS}
                    selected={preferences.pomodoroShortBreak}
                    onChange={(v) => onPreferencesChange({ pomodoroShortBreak: v })}
                  />
                  <ChipRow
                    label="استراحة طويلة"
                    unit="دقيقة"
                    options={LONG_BREAK_OPTIONS}
                    selected={preferences.pomodoroLongBreak}
                    onChange={(v) => onPreferencesChange({ pomodoroLongBreak: v })}
                  />
                </div>
              </section>

              {/* Day Off */}
              <section>
                <SectionHeader titleAr="يوم الراحة المفضل" />
                <div className="flex flex-wrap gap-2">
                  {DAY_OFF_OPTIONS.map((opt) => (
                    <Chip
                      key={opt.value}
                      selected={preferences.dayOff === opt.value}
                      label={opt.label}
                      onClick={() => onPreferencesChange({ dayOff: opt.value })}
                    />
                  ))}
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 p-5 border-t border-foreground/10 bg-foreground/5 shrink-0">
              <p className="text-[11px] text-muted">
                التغييرات تُطبَّق على حسابك عند الضغط على «حفظ التغييرات» في صفحة الملف.
              </p>
              <Button
                onClick={onClose}
                className="rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 px-5 font-bold mr-auto"
              >
                <Check className="w-4 h-4" />
                تطبيق وإغلاق
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Internal building blocks ─────────────────────────────────────────────

function SelectCard({
  selected,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -2 }}
      className={cn(
        "group relative flex flex-col items-start gap-1 p-5 rounded-2xl border text-right transition-all overflow-hidden",
        selected
          ? "border-uqu-accent/50 bg-uqu-accent/[0.08] shadow-[0_0_40px_-10px_hsla(245,78%,62%,0.45)]"
          : "bg-background border-border hover:border-foreground/20",
      )}
    >
      <div className="space-y-0.5 min-w-0">
        <div className="font-bold text-[15px] leading-tight text-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] text-muted leading-tight">{subtitle}</div>
        )}
      </div>
      {selected && (
        <motion.span
          layoutId="pref-modal-selected-dot"
          className="absolute top-3 left-3 w-2 h-2 rounded-full bg-uqu-accent shadow-[0_0_12px_hsla(245,78%,62%,0.8)]"
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      )}
    </motion.button>
  );
}

function Chip({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-xl text-sm font-bold border transition-all whitespace-nowrap",
        selected
          ? "bg-uqu-accent/15 border-uqu-accent/50 text-foreground shadow-[0_0_20px_-6px_hsla(245,78%,62%,0.55)]"
          : "bg-foreground/5 border-foreground/10 text-muted hover:bg-foreground/5 hover:text-foreground hover:border-foreground/10",
      )}
    >
      {label}
    </button>
  );
}

function ChipRow({
  label,
  unit,
  options,
  selected,
  onChange,
}: {
  label: string;
  unit: string;
  options: number[];
  selected: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-foreground">{label}</span>
        <span className="text-[11px] text-muted font-mono">{unit}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((v) => (
          <Chip
            key={v}
            selected={selected === v}
            label={String(v)}
            onClick={() => onChange(v)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ titleAr }: { titleAr: string }) {
  return <h3 className="text-base font-bold text-foreground mb-3">{titleAr}</h3>;
}
