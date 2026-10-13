"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyTranscriptState() {
  return (
    <Card className="glass p-12 rounded-[32px] border-foreground/10 text-center space-y-5 animate-in fade-in duration-500">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-muted" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-black">لم نجد سجلاً أكاديمياً بعد</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          ارفع سجلك الأكاديمي (PDF) من معالج الإعداد لاستيراد المواد المكتملة والمسجّلة تلقائياً،
          ثم ابدأ المحاكاة هنا.
        </p>
      </div>
      <Link href="/profile">
        <Button className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 shadow-lg shadow-uqu-accent/20 gap-2">
          ابدأ الإعداد الأكاديمي
        </Button>
      </Link>
    </Card>
  );
}
