"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  ArrowLeft,
  Save,
  X,
  BookOpen,
  GraduationCap,
  FlaskConical,
  Trash2,
  Building2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EnrichedCourse } from "@/lib/transcript-parser";
import type { ScheduleSlot } from "@/store/scheduleStore";
import { WEEK_DAYS, type ScheduleDay } from "@/store/scheduleStore";

interface ManualBuilderProps {
  currentCourses: EnrichedCourse[];
  onBack: () => void;
  onSave: (slots: ScheduleSlot[]) => void;
}

interface PendingPlacement {
  courseCode: string;
  courseName: string;
  day: ScheduleDay;
  startTime: string;
  endTime: string;
  // Largest number of hours the popover should allow. Computed from the
  // current grid state at drop time so the user can't choose a duration
  // that would overlap an existing slot or run past the workday.
  maxHours: number;
}

const TIME_SLOTS: { start: string; end: string }[] = [
  { start: "08:00", end: "08:50" },
  { start: "09:00", end: "09:50" },
  { start: "10:00", end: "10:50" },
  { start: "11:00", end: "11:50" },
  { start: "12:00", end: "12:50" },
  { start: "13:00", end: "13:50" },
  { start: "14:00", end: "14:50" },
  { start: "15:00", end: "15:50" },
  { start: "16:00", end: "16:50" },
  { start: "17:00", end: "17:50" },
  { start: "18:00", end: "18:50" },
  { start: "19:00", end: "19:50" },
  { start: "20:00", end: "20:50" },
  { start: "21:00", end: "21:50" },
];

// A cell is either empty (droppable), the HEAD of a multi-row slot
// (renders one `<td rowSpan={duration}>`), or COVERED by a slot above
// (the `<td>` for that day/row is skipped entirely so the parent
// rowSpan paints over it).
type CellState =
  | { kind: "empty" }
  | { kind: "head"; slot: ScheduleSlot; slotIndex: number; duration: number }
  | { kind: "covered" };

const CELL_HEIGHT_PX = 60;

/**
 * Manual schedule builder — Drag-and-Drop fallback when the Vision API
 * can't read the PDF (or the user prefers full control).
 *
 *   Right panel  → Draggable list of current-semester courses. The SAME
 *                  course can be dragged multiple times, which is the
 *                  intended way to split into separate نظري + عملي slots.
 *   Left panel   → 5-column × 14-row weekly grid (Sun→Thu, 08:00→21:00).
 *
 * Multi-hour slots (labs, double-lectures) span N rows visually via
 * HTML `rowSpan`. Covered cells are not rendered, and they're treated
 * as "occupied" for drop validation — you can't drop a course into the
 * tail of an existing slot. Same-cell drops are blocked too, with a
 * brief toast explaining why.
 */
export function ManualScheduleBuilder({ currentCourses, onBack, onSave }: ManualBuilderProps) {
  // Pointer sensor with a 5px activation distance prevents drag-on-click for
  // accidental cursor jitter. Keyboard sensor enables full a11y — Space to
  // pick up a course, arrow keys to move between cells, Space again to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [pending, setPending] = useState<PendingPlacement | null>(null);
  const [activeCourseCode, setActiveCourseCode] = useState<string | null>(null);
  // Ephemeral toast (collision feedback). Cleared after ~2.5s.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Portal-mount flag — see the original comment in DragOverlay below.
  const mounted = useHydrated();

  const activeCourse = activeCourseCode
    ? currentCourses.find((c) => c.code === activeCourseCode) ?? null
    : null;

  // ── Grid occupation map ────────────────────────────────────────────
  // Recomputed on every `slots` change. Maps `${day}:${rowIdx}` →
  // CellState. Renderer & collision check both read from here so
  // they can't disagree about who owns a cell.
  const gridMap = useMemo(() => buildGridMap(slots), [slots]);

  const isCellOccupied = (day: ScheduleDay, rowIdx: number) => {
    const s = gridMap.get(cellKey(day, rowIdx));
    return s !== undefined && s.kind !== "empty";
  };

  // Largest duration that can still fit at (day, startIdx) given existing
  // slots and the bottom of the grid. Returns at least 1.
  const computeMaxHours = (day: ScheduleDay, startIdx: number): number => {
    let max = 1;
    for (let k = 1; k < 4; k++) {
      const rowIdx = startIdx + k;
      if (rowIdx >= TIME_SLOTS.length) break;
      if (isCellOccupied(day, rowIdx)) break;
      max = k + 1;
    }
    return max;
  };

  // ── DnD handlers ───────────────────────────────────────────────────
  const onDragStart = (e: DragStartEvent) => {
    setActiveCourseCode(String(e.active.id));
  };

  const onDragCancel = () => {
    setActiveCourseCode(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveCourseCode(null);
    const { active, over } = e;
    if (!over) return;
    const dropId = String(over.id);

    // Drop id format: cell:<day>:<HH:MM>. The HH:MM contains a colon,
    // so we use a strict regex instead of naive `split(":")`.
    const match = dropId.match(/^cell:(.+?):(\d{1,2}:\d{2})$/);
    if (!match) return;
    const [, day, startTime] = match;

    const courseCode = String(active.id);
    const course = currentCourses.find((c) => c.code === courseCode);
    if (!course) return;

    const startIdx = TIME_SLOTS.findIndex((s) => s.start === startTime);
    if (startIdx < 0) return;

    // Collision: refuse the drop entirely. Covered cells shouldn't be
    // droppable (they're not rendered), but guard anyway in case a future
    // refactor changes that.
    if (isCellOccupied(day as ScheduleDay, startIdx)) {
      showToast("هذا الوقت محجوز مسبقاً");
      return;
    }

    const maxHours = computeMaxHours(day as ScheduleDay, startIdx);
    const slot = TIME_SLOTS[startIdx];

    setPending({
      courseCode: course.code,
      courseName: course.nameAr || course.nameEn || course.code,
      day: day as ScheduleDay,
      startTime: slot.start,
      endTime: slot.end,
      maxHours,
    });
  };

  const commitPending = (
    type: "نظري" | "عملي",
    room: string,
    building: string,
    extraHours: number,
  ) => {
    if (!pending) return;

    // Clamp duration to whatever the grid still allows — defensive in
    // case the popover's UI got out of sync.
    const startIdx = TIME_SLOTS.findIndex((s) => s.start === pending.startTime);
    if (startIdx < 0) {
      setPending(null);
      return;
    }
    const safeExtra = Math.min(extraHours, pending.maxHours - 1);
    const endIdx = Math.min(TIME_SLOTS.length - 1, startIdx + safeExtra);
    const endTime = TIME_SLOTS[endIdx].end;

    const next: ScheduleSlot = {
      course_code: pending.courseCode,
      course_name: pending.courseName,
      day: pending.day,
      start_time: pending.startTime,
      end_time: endTime,
      type,
      room: room.trim() || undefined,
      building: building.trim() || undefined,
    };
    setSlots((prev) => [...prev, next]);
    setPending(null);
  };

  const removeSlotByIndex = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
      dir="rtl"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-black tracking-tight mb-1">
            بناء الجدول الدراسي
          </h2>
          <p className="text-sm text-muted-foreground">
            اسحب المواد من اليمين وأفلتها على الخلية المناسبة. يمكنك سحب نفس المادة عدة مرات
            للنظري والعملي على أوقات مختلفة.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onBack}
            size="sm"
            className="rounded-xl glass border-foreground/10 gap-2"
          >
            <ArrowLeft className="w-4 h-4 rotate-180" />
            خيار آخر
          </Button>
          <Button
            onClick={() => onSave(slots)}
            disabled={slots.length === 0}
            size="sm"
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 gap-2"
          >
            <Save className="w-4 h-4" />
            حفظ ({slots.length})
          </Button>
        </div>
      </header>

      {/* Collision toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-200 text-[13px] font-bold"
            role="status"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Grid */}
          <Card className="glass border-foreground/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="bg-foreground/5 border border-foreground/10 p-2 text-[10px] font-mono text-muted w-16">
                      الوقت
                    </th>
                    {WEEK_DAYS.map((day) => (
                      <th
                        key={day}
                        className="bg-foreground/5 border border-foreground/10 p-2 text-[12px] font-bold"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIME_SLOTS.map((time, rowIdx) => (
                    <tr key={time.start}>
                      <td className="bg-foreground/5 border border-foreground/10 p-1 text-[10px] font-mono text-muted text-center align-top">
                        {time.start}
                      </td>
                      {WEEK_DAYS.map((day) => {
                        const cell = gridMap.get(cellKey(day, rowIdx)) ?? { kind: "empty" };
                        // Covered: skip — the head row above paints
                        // over this cell via rowSpan.
                        if (cell.kind === "covered") return null;
                        if (cell.kind === "head") {
                          return (
                            <SpanningSlotCell
                              key={day}
                              slot={cell.slot}
                              duration={cell.duration}
                              onRemove={() => removeSlotByIndex(cell.slotIndex)}
                            />
                          );
                        }
                        return (
                          <DroppableCell
                            key={day}
                            day={day}
                            startTime={time.start}
                          />
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Courses sidebar */}
          <Card className="glass border-foreground/10 rounded-2xl p-3 flex flex-col gap-2 h-fit max-h-[600px] overflow-y-auto">
            <div className="px-2 py-1 text-[11px] font-bold text-muted sticky top-0 bg-card/95 backdrop-blur z-10">
              مواد الترم ({currentCourses.length})
            </div>
            {currentCourses.map((c) => (
              <DraggableCourseChip key={c.code} course={c} />
            ))}
            {currentCourses.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center">لا توجد مواد</p>
            )}
          </Card>
        </div>

        {/* DragOverlay — portaled to <body> so the wizard modal's
            `-translate-x-1/2` doesn't leak into the overlay's transform
            and create a catastrophic X-offset bug. */}
        {mounted &&
          createPortal(
            <DragOverlay dropAnimation={null} zIndex={70}>
              {activeCourse ? (
                <div dir="rtl" className="w-[260px] pointer-events-none">
                  <CourseChipVisual course={activeCourse} dragging />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      {pending && (
        <PendingPlacementDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onCommit={commitPending}
        />
      )}
    </motion.div>
  );
}

// ── Grid-occupation helpers ────────────────────────────────────────────

function cellKey(day: string, rowIdx: number) {
  return `${day}:${rowIdx}`;
}

/**
 * Duration in TIME_SLOTS rows. A 1-hour slot ends at the same row's
 * end (`08:00 → 08:50`). A 3-hour slot spans rows whose ends are
 * `08:50`, `09:50`, `10:50` — we match against `end_time` and add 1.
 */
function rowSpanForSlot(slot: ScheduleSlot): number {
  const startIdx = TIME_SLOTS.findIndex((s) => s.start === slot.start_time);
  const endIdx = TIME_SLOTS.findIndex((s) => s.end === slot.end_time);
  if (startIdx < 0 || endIdx < 0) return 1;
  return Math.max(1, endIdx - startIdx + 1);
}

function buildGridMap(slots: ScheduleSlot[]): Map<string, CellState> {
  const map = new Map<string, CellState>();
  // Pre-seed every cell as empty so renderer never gets `undefined`.
  for (const day of WEEK_DAYS) {
    for (let i = 0; i < TIME_SLOTS.length; i++) {
      map.set(cellKey(day, i), { kind: "empty" });
    }
  }
  slots.forEach((slot, slotIndex) => {
    const startIdx = TIME_SLOTS.findIndex((s) => s.start === slot.start_time);
    if (startIdx < 0) return;
    const dur = rowSpanForSlot(slot);
    map.set(cellKey(String(slot.day), startIdx), {
      kind: "head",
      slot,
      slotIndex,
      duration: dur,
    });
    for (let k = 1; k < dur; k++) {
      map.set(cellKey(String(slot.day), startIdx + k), { kind: "covered" });
    }
  });
  return map;
}

// ── Sub-components ─────────────────────────────────────────────────────

/**
 * Pure-visual chip — no DnD hooks. Reused in two places:
 *   1. Source list (wrapped by DraggableCourseChip).
 *   2. DragOverlay clone — the element that actually follows the cursor.
 */
function CourseChipVisual({
  course,
  dragging,
}: {
  course: EnrichedCourse;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        "w-full flex items-center gap-2 p-2.5 rounded-xl text-right transition-all",
        "bg-foreground/5 border border-foreground/10",
        dragging
          ? "border-uqu-accent/60 bg-uqu-accent/10 shadow-[0_8px_30px_hsla(245,78%,62%,0.45)] scale-105 cursor-grabbing"
          : "hover:bg-foreground/5 hover:border-uqu-accent/30",
      )}
    >
      <div className="w-8 h-8 rounded-lg bg-uqu-accent/15 border border-uqu-accent/25 flex items-center justify-center shrink-0">
        <BookOpen className="w-3.5 h-3.5 text-uqu-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold truncate">{course.nameAr || course.code}</div>
        <div className="text-[9px] text-muted font-mono">
          {course.code} · {course.creditHours}س
        </div>
      </div>
    </div>
  );
}

function DraggableCourseChip({ course }: { course: EnrichedCourse }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: course.code,
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "w-full text-right rounded-xl cursor-grab active:cursor-grabbing touch-none transition-opacity",
        isDragging && "opacity-30",
      )}
      aria-roledescription="draggable course"
      aria-label={`اسحب المادة ${course.nameAr || course.code}`}
    >
      <CourseChipVisual course={course} />
    </button>
  );
}

/**
 * Empty cell — droppable target. Rendered for every (day, row) that
 * isn't owned or covered by an existing slot.
 */
function DroppableCell({
  day,
  startTime,
}: {
  day: ScheduleDay;
  startTime: string;
}) {
  // ID format MUST stay in sync with the regex in `onDragEnd`:
  //   /^cell:(.+?):(\d{1,2}:\d{2})$/
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${day}:${startTime}` });
  return (
    <td
      ref={setNodeRef}
      className={cn(
        // Explicit min-h + min-w so the cell ALWAYS has a hit target,
        // even when it's empty.
        "border border-foreground/10 p-1 align-top min-h-[60px] h-[60px] min-w-[110px] transition-colors",
        isOver
          ? "bg-uqu-accent/20 border-uqu-accent/60 shadow-[inset_0_0_0_2px_hsla(245,78%,62%,0.4)]"
          : "bg-transparent",
      )}
    >
      <div className="flex flex-col gap-0.5 w-full h-full min-h-[52px]" />
    </td>
  );
}

/**
 * Spanning cell — the HEAD row of a multi-hour slot. The single `<td>`
 * uses `rowSpan` to physically cover `duration` rows; the renderer
 * skips the corresponding `<td>`s in subsequent `<tr>`s. NOT droppable
 * — overwriting an occupied slot is blocked by `isCellOccupied` in
 * onDragEnd. The slot is removed via the inline trash button.
 */
function SpanningSlotCell({
  slot,
  duration,
  onRemove,
}: {
  slot: ScheduleSlot;
  duration: number;
  onRemove: () => void;
}) {
  const isLab = slot.type === "عملي";
  return (
    <td
      rowSpan={duration}
      className={cn(
        "border align-top p-1 min-w-[110px] transition-colors",
        isLab
          ? "border-amber-500/30 bg-amber-500/[0.06]"
          : "border-uqu-accent/30 bg-uqu-accent/[0.06]",
      )}
      style={{ height: duration * CELL_HEIGHT_PX }}
    >
      <div
        className={cn(
          "group h-full w-full rounded-lg border p-2 flex flex-col gap-1 relative overflow-hidden",
          isLab
            ? "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100"
            : "bg-uqu-accent/15 border-uqu-accent/40 text-foreground",
        )}
      >
        <div className="flex items-center justify-between gap-1 shrink-0">
          <span className="text-[9px] font-mono font-bold opacity-80">
            {slot.course_code || "—"}
          </span>
          <button
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-700 hover:text-rose-600 dark:text-rose-300 dark:hover:text-rose-200"
            aria-label="حذف"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="text-[11px] font-bold leading-tight line-clamp-2">
          {slot.course_name}
        </div>
        <div className="mt-auto flex items-center justify-between gap-1 text-[9px] font-mono opacity-70">
          <span>
            {slot.start_time}–{slot.end_time}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-foreground/10 dark:bg-black/30">
            {isLab ? "عملي" : "نظري"} · {duration}س
          </span>
        </div>
        {slot.room && (
          <div className="text-[9px] opacity-60 truncate">
            {slot.building ? `${slot.building} · ` : ""}
            {slot.room}
          </div>
        )}
      </div>
    </td>
  );
}

function PendingPlacementDialog({
  pending,
  onCancel,
  onCommit,
}: {
  pending: PendingPlacement;
  onCancel: () => void;
  onCommit: (type: "نظري" | "عملي", room: string, building: string, extraHours: number) => void;
}) {
  const [type, setType] = useState<"نظري" | "عملي">("نظري");
  const [room, setRoom] = useState("");
  const [building, setBuilding] = useState("");
  const [extraHours, setExtraHours] = useState(0);

  // Clamp the selected duration if it exceeds what the grid can fit.
  useEffect(() => {
    if (extraHours > pending.maxHours - 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp when the available range shrinks
      setExtraHours(pending.maxHours - 1);
    }
  }, [pending.maxHours, extraHours]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(440px,calc(100%-2rem))] bg-card/95 backdrop-blur-2xl border border-foreground/10 rounded-3xl shadow-2xl"
        dir="rtl"
      >
        <div className="flex items-center justify-between p-5 border-b border-foreground/10">
          <h3 className="font-bold text-base">تفاصيل المحاضرة</h3>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-foreground/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1 p-3 bg-foreground/5 border border-foreground/10 rounded-xl">
            <div className="text-[11px] text-muted font-bold">المادة</div>
            <div className="text-sm font-bold">{pending.courseName}</div>
            <div className="text-[11px] text-muted font-mono">
              {pending.day} · {pending.startTime}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-muted mb-2">النوع</div>
            <div className="grid grid-cols-2 gap-2">
              <TypeChoice
                active={type === "نظري"}
                onClick={() => setType("نظري")}
                icon={<GraduationCap className="w-4 h-4" />}
                label="نظري"
                accent="blue"
              />
              <TypeChoice
                active={type === "عملي"}
                onClick={() => setType("عملي")}
                icon={<FlaskConical className="w-4 h-4" />}
                label="عملي"
                accent="amber"
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[11px] font-bold text-muted">عدد الساعات</div>
              {pending.maxHours < 4 && (
                <div className="text-[10px] text-muted">
                  الحد الأقصى المتاح: {pending.maxHours}س
                </div>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((h) => {
                const disabled = h > pending.maxHours;
                const active = extraHours === h - 1 && !disabled;
                return (
                  <button
                    key={h}
                    onClick={() => !disabled && setExtraHours(h - 1)}
                    disabled={disabled}
                    className={cn(
                      "rounded-xl border py-2 text-sm font-bold transition-all relative",
                      active
                        ? "bg-uqu-accent border-uqu-accent text-white"
                        : disabled
                          ? "bg-foreground/5 border-foreground/10 text-muted cursor-not-allowed"
                          : "bg-foreground/5 border-foreground/10 text-muted hover:border-foreground/10",
                    )}
                    title={disabled ? "هذا الامتداد يتعارض مع محاضرة موجودة" : undefined}
                  >
                    {h} س
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] font-bold text-muted mb-1.5">القاعة (اختياري)</div>
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="1.042"
                dir="ltr"
                className="w-full bg-input border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted outline-none focus:border-uqu-accent/50 dark:bg-black/40 dark:border-foreground/10"
              />
            </div>
            <div>
              <div className="text-[11px] font-bold text-muted mb-1.5">المبنى (اختياري)</div>
              <div className="relative">
                <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
                <input
                  value={building}
                  onChange={(e) => setBuilding(e.target.value)}
                  placeholder="25"
                  dir="ltr"
                  className="w-full bg-input border border-border rounded-xl pr-8 pl-3 py-2 text-sm text-foreground placeholder:text-muted outline-none focus:border-uqu-accent/50 dark:bg-black/40 dark:border-foreground/10"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-foreground/10">
          <Button variant="ghost" onClick={onCancel} className="rounded-xl">
            إلغاء
          </Button>
          <Button
            onClick={() => onCommit(type, room, building, extraHours)}
            className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90"
          >
            إضافة المحاضرة
          </Button>
        </div>
      </motion.div>
    </>
  );
}

function TypeChoice({
  active,
  onClick,
  icon,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: "blue" | "amber";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all font-bold text-sm",
        active
          ? accent === "blue"
            ? "bg-uqu-accent/15 border-uqu-accent/50 text-uqu-accent"
            : "bg-amber-500/15 border-amber-500/50 text-amber-800 dark:text-amber-300"
          : "bg-foreground/5 border-foreground/10 text-muted hover:border-foreground/10",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// re-export helper Badge so types resolve cleanly in some build configurations
void Badge;
