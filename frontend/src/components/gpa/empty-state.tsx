"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ds/states";
import { buttonClass } from "@/components/ds/button";
import { EmptyRecordArt } from "@/components/sketch/notebook-art";

export function EmptyTranscriptState() {
  return (
    <EmptyState
      art={<EmptyRecordArt />}
      title="لم نجد سجلاً أكاديمياً بعد"
      text="ارفع سجلك الأكاديمي (PDF) من معالج الإعداد لاستيراد المواد المكتملة والمسجّلة تلقائياً، ثم ابدأ المحاكاة هنا."
      className="bg-surface py-12"
      action={
        <Link href="/profile" className={buttonClass({ variant: "primary" })}>
          ابدأ الإعداد الأكاديمي
        </Link>
      }
    />
  );
}
