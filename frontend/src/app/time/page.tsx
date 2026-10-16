"use client";

import { Suspense } from "react";
import { Navbar } from "@/components/navbar";
import { WeekView } from "@/components/time/week-view";

/** «وقتي» — the week: study plan, timetable, exams and absences. */
export default function TimePage() {
  return (
    <div className="min-h-screen bg-background pb-28">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 md:px-8 max-w-6xl" dir="rtl">
        {/* WeekView reads ?day= (useSearchParams needs a Suspense boundary in a static export) */}
        <Suspense fallback={null}>
          <WeekView />
        </Suspense>
      </main>
    </div>
  );
}
