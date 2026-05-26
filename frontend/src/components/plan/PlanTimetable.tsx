"use client";

import { useMemo } from "react";
import { WeeklyScheduleGrid } from "@/components/schedule/WeeklyScheduleGrid";
import { buildPlanTimetableGrid, type StudyGridBlock } from "@/lib/schedule-grid";
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

  const { gridMap, hiddenStudyCount } = useMemo(
    () => buildPlanTimetableGrid(schedule, tasks, completed),
    [schedule, tasks, completed],
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
    />
  );
}
