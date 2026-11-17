"use client";

import { SketchArrow, SketchCircle, SketchUnderline } from "@/components/sketch";

/**
 * The landing page's chalkboard: one question a student actually asks, and
 * how فطن answers it — the number, and where it comes from. The figures are
 * the ones the attendance page uses (lib/attendance).
 *
 * The board is this section's one motion: its chalk marks draw themselves
 * once when it scrolls into view, and are simply there with reduced motion.
 */
export function Chalkboard() {
  return (
    <section aria-labelledby="board-title" className="border-t border-line bg-canvas">
      <div className="container mx-auto max-w-6xl px-4 py-16 md:py-24">
        <div className="mb-8 max-w-2xl">
          <h2 id="board-title" className="text-title font-bold">
            سؤال، وجواب من اللائحة
          </h2>
          <p className="mt-3 text-body text-ink-muted">مثل ما يشرحه لك زميل على السبورة: الرقم، وليش، ومن وين.</p>
        </div>

        <figure className="relative overflow-hidden rounded-card border-8 border-board-frame bg-board p-6 text-board-ink shadow-card md:p-10">
          {/* chalk dust along the tray */}
          <div aria-hidden className="absolute inset-x-6 bottom-0 h-1.5 rounded-t-full bg-board-line" />

          <p className="chalk text-subheading text-board-muted">سؤال:</p>
          <p className="chalk mt-1 text-heading font-bold md:text-title">كم مرة أقدر أغيب قبل الحرمان؟</p>

          <div className="mt-8 grid gap-8 md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div>
              <p className="chalk text-subheading text-board-muted">الجواب:</p>
              <p className="chalk mt-2 text-title font-bold leading-snug md:text-display">
                <SketchCircle className="text-board-accent">
                  <span className="nums" dir="ltr">15%</span>
                </SketchCircle>{" "}
                بدون عذر
              </p>
              <p className="chalk mt-3 text-heading">
                أو <span className="nums font-bold" dir="ltr">25%</span> بالمجموع مع العذر.
              </p>
            </div>

            <SketchArrow className="hidden h-12 w-24 text-board-accent md:block" />

            <div className="rounded-control border border-board-line p-4">
              <p className="chalk text-small text-board-muted">المصدر</p>
              <p className="chalk mt-1 text-body">
                <SketchUnderline className="text-board-accent">لائحة الدراسة والاختبارات</SketchUnderline> — جامعة أم القرى
              </p>
              <p className="chalk mt-3 text-small text-board-muted">
                وفطن يحسبها لكل مادة من جدولك، وينبهك قبل ما توصل للحد.
              </p>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
