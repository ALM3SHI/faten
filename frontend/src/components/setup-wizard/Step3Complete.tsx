"use client";

import { motion } from "framer-motion";
import { CheckCircle2, ArrowLeft, BookOpen, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import type { ScheduleSource } from "./SetupWizard";

interface Step3Props {
  source: ScheduleSource | null;
  slotsCount: number;
  coursesCount: number;
  onCommit: () => void;
}

/**
 * Step 3 — Success screen. The commit to Zustand happens HERE (not
 * earlier) so backing out at any prior step leaves the stores untouched.
 * After commit, we push to the dashboard.
 */
export function Step3Complete({ slotsCount, coursesCount, onCommit }: Step3Props) {
  const router = useRouter();

  const handleSave = () => {
    onCommit();
    // Wizard parent calls onClose() inside onCommit, so the modal
    // unmounts. Then redirect to dashboard.
    router.push("/dashboard");
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center text-center gap-8 py-8 md:py-16"
    >
      <motion.div
        initial={{ scale: 0.6, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 16 }}
        className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border-2 border-emerald-500/40 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.3)]"
      >
        <CheckCircle2 className="w-12 h-12 text-emerald-400" />
      </motion.div>

      <h2 className="text-3xl md:text-4xl font-black tracking-tight max-w-md">
        تم إعداد ملفك الأكاديمي بنجاح!
      </h2>

      {coursesCount === 0 && (
        <p className="text-sm text-muted-foreground max-w-md leading-7">
          لا توجد مواد مسجلة في سجلك حالياً، فتخطّينا خطوة الجدول. تقدر تضيف جدولك لاحقاً من الملف الشخصي.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 w-full max-w-md">
        <StatPill
          icon={<BookOpen className="w-4 h-4 text-emerald-400" />}
          label="مواد الترم"
          value={String(coursesCount)}
        />
        <StatPill
          icon={<CalendarDays className="w-4 h-4 text-uqu-accent" />}
          label="محاضرات الأسبوع"
          value={String(slotsCount)}
        />
      </div>

      <Button
        onClick={handleSave}
        className="rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 gap-2 px-8 py-6 text-base font-bold shadow-[0_0_24px_hsla(245,78%,62%,0.4)]"
      >
        حفظ والذهاب للوحة القيادة
        <ArrowLeft className="w-5 h-5" />
      </Button>
    </motion.div>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-2xl bg-foreground/5 border border-foreground/10">
      <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex flex-col items-start">
        <span className="text-[11px] text-muted font-bold">{label}</span>
        <span className="text-xl font-black font-mono">{value}</span>
      </div>
    </div>
  );
}
