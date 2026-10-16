"use client";

import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { PlanView } from "@/components/plan/plan-view";

/** «خطة المذاكرة» — see components/plan/plan-view.tsx. */
export default function PlanPage() {
  return (
    <div className="min-h-screen bg-background pb-28">
      <Navbar />
      <main className="container mx-auto pt-24 px-4 md:px-8 max-w-6xl" dir="rtl">
        <SectionTabs className="mb-5" />
        <PlanView />
      </main>
    </div>
  );
}
