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
    <Card className="border border-line bg-surface shadow-card p-10 md:p-14 rounded-card border-warning-line bg-warning-soft animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-2xl mx-auto text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-card bg-warning-soft border border-warning-line flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-warning-ink" />
        </div>
        <div className="space-y-3">
          <h2 className="text-heading md:text-title font-bold">
            بياناتك بحاجة لإعادة المزامنة
          </h2>
          <p className="text-body text-ink leading-relaxed">
            بياناتك الحالية لا تتوافق مع نظام الـ 4 نقاط الجديد. يرجى الذهاب
            للملف الشخصي وإعادة رفع السجل الأكاديمي.
          </p>
          <p className="text-caption text-ink-muted font-mono leading-relaxed pt-2">
            {detail.slice(0, 220)}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link href="/profile">
            <Button className="gap-2 rounded-control bg-brand font-semibold text-on-brand hover:bg-brand-hover">
              <ArrowUpRight className="w-4 h-4" />
              فتح صفحة الملف الشخصي
            </Button>
          </Link>
          <Link href="/gpa">
            <Button
              variant="outline"
              className="rounded-control border border-line bg-surface shadow-card border-line gap-2"
            >
              المتابعة لحاسبة المعدل
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
