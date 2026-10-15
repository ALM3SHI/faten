import { Navbar } from "@/components/navbar";
import { TimeView } from "@/components/time/time-view";

/** «وقتي» — the timetable, study plan, exams and absences as one agenda. */
export default function TimePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto pt-24 pb-28 px-4 max-w-3xl">
        <TimeView />
      </main>
    </div>
  );
}
