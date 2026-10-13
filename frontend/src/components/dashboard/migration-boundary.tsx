"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ──────────────────────────────────────────────────────────────────
// Migration Boundary — surfaces the 422 case
// ──────────────────────────────────────────────────────────────────

export function MigrationBoundary({ detail }: { detail: string }) {
  return (
    <Card className="glass p-10 md:p-14 rounded-[32px] border-amber-500/30 bg-amber-500/[0.04] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-amber-800 dark:text-amber-300" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl md:text-3xl font-black">
            بياناتك بحاجة لإعادة المزامنة
          </h2>
          <p className="text-base text-foreground leading-relaxed">
            بياناتك الحالية لا تتوافق مع نظام الـ 4 نقاط الجديد. يرجى الذهاب
            للملف الشخصي وإعادة رفع السجل الأكاديمي.
          </p>
          <p className="text-xs text-muted font-mono leading-relaxed pt-2">
            {detail.slice(0, 220)}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/profile">
            <Button className="rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20 gap-2">
              <ArrowUpRight className="w-4 h-4" />
              فتح صفحة الملف الشخصي
            </Button>
          </Link>
          <Link href="/gpa">
            <Button
              variant="outline"
              className="rounded-xl glass border-foreground/10 gap-2"
            >
              المتابعة لحاسبة المعدل
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
