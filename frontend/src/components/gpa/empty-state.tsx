"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyTranscriptState() {
  return (
    <Card className="border border-line bg-surface shadow-card p-12 rounded-card text-center space-y-5 animate-in fade-in duration-500">
      <div className="w-16 h-16 mx-auto rounded-card bg-surface-sunken border border-line flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-ink-muted" />
      </div>
      <div className="space-y-2">
        <h2 className="text-heading font-bold">لم نجد سجلاً أكاديمياً بعد</h2>
        <p className="text-small text-ink-muted max-w-md mx-auto leading-relaxed">
          ارفع سجلك الأكاديمي (PDF) من معالج الإعداد لاستيراد المواد المكتملة والمسجّلة تلقائياً،
          ثم ابدأ المحاكاة هنا.
        </p>
      </div>
      <Link href="/profile">
        <Button className="rounded-control bg-brand hover:bg-brand-hover gap-2">
          ابدأ الإعداد الأكاديمي
        </Button>
      </Link>
    </Card>
  );
}
