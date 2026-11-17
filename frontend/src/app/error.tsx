"use client";

import { useEffect } from "react";
import { Button } from "@/components/ds/button";
import Link from "next/link";
import { LogoMark } from "@/components/logo";

/** Shown instead of a blank screen when a page crashes while rendering. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Faten] page error:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-surface text-ink flex items-center justify-center px-4" dir="rtl">
      <div className="max-w-md text-center space-y-5">
        <LogoMark className="w-14 h-14 mx-auto" iconClassName="w-7 h-7" />
        <h1 className="text-title font-bold">صار خطأ غير متوقع</h1>
        <p className="text-ink-muted leading-relaxed">
          ما قدرنا نعرض هذه الصفحة. بياناتك محفوظة — جرّب مرة ثانية، وإذا تكرر الخطأ ارجع لصفحة «اليوم».
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Button variant="bare"
            type="button"
            onClick={reset}
            className="px-5 h-11 inline-flex items-center rounded-control bg-brand text-on-brand font-bold hover:bg-brand-hover"
          >
            حاول مرة ثانية
          </Button>
          <Link href="/dashboard" className="px-5 h-11 inline-flex items-center rounded-control border border-line font-bold hover:bg-surface-sunken">
            افتح «اليوم»
          </Link>
        </div>
      </div>
    </main>
  );
}
