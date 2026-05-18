"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { CheckCircle2, Loader2, Target, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGpaStore } from "@/store/gpaStore";

// UQU 4.00 Scale
const GRADE_POINTS: Record<string, number> = {
  "A+": 4.00,
  "A": 3.75,
  "B+": 3.50,
  "B": 3.00,
  "C+": 2.50,
  "C": 2.00,
  "D+": 1.50,
  "D": 1.00,
  "F": 0.00
};

const GRADES = Object.keys(GRADE_POINTS);

const INITIAL_COURSES = [
  { id: 1, name: "هياكل البيانات", credits: 3, expectedGrade: "A" },
  { id: 2, name: "الرياضيات المتقطعة", credits: 3, expectedGrade: "B+" },
  { id: 3, name: "هندسة البرمجيات", credits: 4, expectedGrade: "A" },
  { id: 4, name: "قواعد البيانات", credits: 3, expectedGrade: "A+" },
  { id: 5, name: "فيزياء الحوسبة", credits: 2, expectedGrade: "B" },
  { id: 6, name: "اللغة الإنجليزية التقنية", credits: 2, expectedGrade: "B+" },
];

function AnimatedNumber({ value }: { value: number }) {
  const nodeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const controls = animate(parseFloat(node.textContent || "0"), value, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate(v) {
        node.textContent = v.toFixed(2);
      },
    });
    return () => controls.stop();
  }, [value]);

  return <span ref={nodeRef}>{value.toFixed(2)}</span>;
}

export function ConnectedGPA({ density = "compact" }: { density?: "single" | "compact" }) {
  // The widget always stretches to fill its column (the column never has more than
  // 2 tools, so there's always real space). `density` only drives the visualizer
  // styling: ring + history chart when alone, bar pill when sharing.
  const layoutMode: "rich" | "compact" = density === "single" ? "rich" : "compact";
  const [courses, setCourses] = useState(INITIAL_COURSES);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  
  const setTargetGpa = useGpaStore((state) => state.setTargetGpa);

  const CURRENT_GPA = 3.84;
  const CURRENT_CREDITS = 80;

  const projectedGpa = useMemo(() => {
    let currentQualityPoints = CURRENT_GPA * CURRENT_CREDITS;
    let newQualityPoints = 0;
    let newCredits = 0;

    courses.forEach(course => {
      newQualityPoints += GRADE_POINTS[course.expectedGrade] * course.credits;
      newCredits += course.credits;
    });

    const totalQualityPoints = currentQualityPoints + newQualityPoints;
    const totalCredits = CURRENT_CREDITS + newCredits;
    
    return totalQualityPoints / totalCredits;
  }, [courses]);

  const handleSaveTarget = async () => {
    setIsSaving(true);
    await new Promise(r => setTimeout(r, 1000));
    setTargetGpa(Number(projectedGpa.toFixed(2)));
    setIsSaving(false);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const updateGrade = (id: number, newGrade: string) => {
    setCourses(courses.map(c => c.id === id ? { ...c, expectedGrade: newGrade } : c));
  };

  // SVG Ring calculations
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = projectedGpa / 4.00;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <motion.div
      layout
      className={cn(
        "w-full flex-1 flex flex-col min-h-0 max-h-full bg-foreground/5 backdrop-blur-xl border border-foreground/10 rounded-3xl relative",
        layoutMode === "compact" ? "p-4 gap-3" : "p-6 gap-4"
      )}
      dir="rtl"
    >
      {/* Header */}
      <div className="flex items-center justify-between text-foreground shrink-0">
        <div className="flex items-center gap-2">
          <Calculator className="w-5 h-5 text-[#0066cc]" />
          <h3 className="font-bold text-foreground tracking-tight">حاسبة المعدل التفاعلية</h3>
        </div>
        <div className="text-[11px] font-medium px-3 py-1 bg-foreground/5 rounded-full border border-foreground/10">
          المعدل الحالي: {CURRENT_GPA}
        </div>
      </div>

      {/* Visualizer */}
      {layoutMode === "rich" ? (
        <div className="relative w-full flex items-center justify-center py-2 shrink-0">
          <svg className="w-48 h-48 transform -rotate-90">
            <circle 
              cx="96" cy="96" r="80" 
              className="text-white/5" 
              stroke="currentColor" 
              strokeWidth="10" 
              fill="transparent" 
            />
            <motion.circle 
              cx="96" cy="96" r="80" 
              className="text-[#0066cc]" 
              stroke="currentColor" 
              strokeWidth="10" 
              fill="transparent" 
              strokeLinecap="round"
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              style={{ strokeDasharray: circumference }}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center mt-1">
            <span className="text-5xl font-mono font-black text-foreground tracking-tighter">
              <AnimatedNumber value={projectedGpa} />
            </span>
            <span className="text-muted text-[11px] font-bold mt-1 tracking-widest uppercase">من 4.00</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between bg-card p-3 rounded-2xl border border-foreground/10 shrink-0">
           <span className="text-muted text-xs font-bold">المعدل المتوقع:</span>
           <span className="text-[#0066cc] font-black text-2xl tracking-tighter">
             <AnimatedNumber value={projectedGpa} />
           </span>
        </div>
      )}

      {/* Rich Mode Extra: History Chart */}
      {layoutMode === "rich" && (
        <div className="w-full p-4 bg-card border border-foreground/10 rounded-2xl flex flex-col gap-3 shrink-0">
          <span className="text-muted text-xs font-bold">تطور المعدل (آخر 4 فصول)</span>
          <div className="flex items-end justify-between h-12 gap-2">
             {[3.6, 3.75, 3.84, projectedGpa].map((gpa, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                   <motion.div 
                     initial={{ height: 0 }} 
                     animate={{ height: `${(gpa / 4) * 100}%` }} 
                     transition={{ duration: 1, delay: i * 0.1 }}
                     className={cn("w-full rounded-t-sm", i === 3 ? "bg-[#0066cc]" : "bg-foreground/5")} 
                   />
                </div>
             ))}
          </div>
        </div>
      )}

      {/* Inputs List — grows to fill the remaining column space and scrolls
          internally. The button below is `shrink-0 mt-auto`, so it stays
          anchored regardless of how many courses are shown. */}
      <div className={cn(
        "flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-foreground/5 [&::-webkit-scrollbar-thumb]:rounded-full pr-1",
        layoutMode === "compact" ? "space-y-1.5" : "space-y-2.5"
      )}>
        {courses.map((course) => (
          <div key={course.id} className={cn("flex items-center justify-between bg-card/50 border border-foreground/10 rounded-2xl", layoutMode === "compact" ? "p-2" : "p-3.5")}>
            <div className="flex flex-col gap-1">
              <span className="text-foreground text-sm font-bold tracking-tight">{course.name}</span>
              <span className="text-muted text-[10px] font-bold">{course.credits} ساعات معتمدة</span>
            </div>
            
            <div className="relative flex items-center">
              <select 
                value={course.expectedGrade}
                onChange={(e) => updateGrade(course.id, e.target.value)}
                disabled={isSaving || isSaved}
                className="appearance-none bg-card border border-foreground/10 text-foreground text-sm font-bold rounded-xl pl-8 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#0066cc] focus:border-transparent cursor-pointer disabled:opacity-50 transition-colors"
              >
                {GRADES.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted text-xs">
                ▼
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Button — anchored to bottom */}
      <div className="w-full shrink-0 mt-auto pt-3">
        <AnimatePresence mode="wait">
          {isSaved ? (
            <motion.div 
              key="saved"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-500 p-4 rounded-2xl border border-emerald-500/20 h-[56px]"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="text-sm font-bold text-center">تم التحديث في لوحة التحكم</span>
            </motion.div>
          ) : (
            <motion.button
              key="save"
              onClick={handleSaveTarget}
              disabled={isSaving}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={cn(
                "w-full flex items-center justify-center gap-2 p-4 rounded-2xl font-bold text-foreground transition-all active:scale-[0.98] h-[56px]",
                isSaving ? "bg-foreground/5 cursor-not-allowed" : "bg-[#0066cc] hover:bg-[#005bb5] shadow-lg shadow-[#0066cc]/20"
              )}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Target className="w-5 h-5" />
                  <span>اعتماد كخطة مستهدفة</span>
                </>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
