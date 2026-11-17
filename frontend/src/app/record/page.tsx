import { Navbar } from "@/components/navbar";
import { RecordView } from "@/components/record/record-view";

/** «معدّلي» — GPA, hours, target and the analysis behind them. */
export default function RecordPage() {
  return (
    <div className="ds-page min-h-screen bg-canvas text-ink">
      <Navbar />
      <main className="container mx-auto pt-24 pb-28 px-4 max-w-3xl">
        <RecordView />
      </main>
    </div>
  );
}
