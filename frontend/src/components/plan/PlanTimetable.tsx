"use client";

import { useEffect, useMemo, useState } from "react";
import { WeeklyScheduleGrid } from "@/components/schedule/WeeklyScheduleGrid";
import {
  buildPlanTimetableGrid,
  currentWeekRange,
  weekdayNameFromDate,
  type StudyGridBlock,
  type WeekRange,
} from "@/lib/schedule-grid";
import type { PlanTask } from "@/store/planStore";
import { useScheduleStore } from "@/store/scheduleStore";

export interface PlanTimetableProps {
  tasks?: PlanTask[];
  completed: string[];
  onToggleTask: (taskKey: string) => void;
  interactiveStudy?: boolean;
  onEditStudyBlock?: (block: StudyGridBlock) => void;
  onDeleteStudyBlock?: (block: StudyGridBlock) => void;
}

/**
 * Plan page weekly timetable — lectures + study tasks on one grid.
 */
export function PlanTimetable({
  tasks = [],
  completed,
  onToggleTask,
  interactiveStudy = false,
  onEditStudyBlock,
  onDeleteStudyBlock,
}: PlanTimetableProps) {
  const schedule = useScheduleStore((s) => s.schedule);

  // Compute "now" only after mount so SSR and the first client render agree
  // (no hydration mismatch). Until then weekRange is undefined → dated events
  // are not filtered, matching the server render.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- "now" must come from the visitor's clock, after hydration
    setNow(new Date());
  }, []);

  const weekRange: WeekRange | undefined = useMemo(
    () => (now ? currentWeekRange(now) : undefined),
    [now],
  );
  const todayColumn = now ? weekdayNameFromDate(now) : null;

  const { gridMap, hiddenStudyCount } = useMemo(
    () => buildPlanTimetableGrid(schedule, tasks, completed, { weekRange }),
    [schedule, tasks, completed, weekRange],
  );

  const hasPlanTasks = tasks.length > 0;

  return (
    <WeeklyScheduleGrid
      gridMap={gridMap}
      className="w-full rounded-[28px]"
      title="جدول الأسبوع"
      emptyHint={
        schedule.length === 0 && !hasPlanTasks
          ? "لم تُضف محاضرات بعد. أضف جدولك من الملف الأكاديمي لعرضها هنا."
          : undefined
      }
      hiddenStudyCount={hiddenStudyCount}
      onToggleStudy={hasPlanTasks ? onToggleTask : undefined}
      interactiveStudy={interactiveStudy && hasPlanTasks}
      onEditStudyBlock={onEditStudyBlock}
      onDeleteStudyBlock={onDeleteStudyBlock}
      todayColumn={todayColumn}
    />
  );
}
