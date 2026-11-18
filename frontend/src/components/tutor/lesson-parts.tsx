"use client";

import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Code2,
  FileText,
  GitCompare,
  Globe,
  HelpCircle,
  Lightbulb,
  ListOrdered,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { BotMarkdown } from "@/components/bot-markdown";
import { Button } from "@/components/ds/button";
import { cn } from "@/lib/utils";
import type { LessonPart, PartRole } from "@/lib/tutor";

const ROLE: Record<PartRole, { label: string; icon: LucideIcon; box?: string }> = {
  idea: { label: "الفكرة", icon: Lightbulb },
  why: { label: "لماذا نحتاجه؟", icon: HelpCircle },
  how: { label: "كيف يعمل؟", icon: ListOrdered },
  example: { label: "مثال", icon: BookOpen },
  real_world: { label: "من الواقع", icon: Globe, box: "border-info-line bg-info-soft" },
  code: { label: "الكود خطوة بخطوة", icon: Code2 },
  mistake: { label: "خطأ شائع", icon: AlertTriangle, box: "border-warning-line bg-warning-soft" },
  compare: { label: "مقارنة", icon: GitCompare },
  summary: { label: "الخلاصة", icon: Bookmark, box: "border-success-line bg-success-soft" },
};

/** Where a piece comes from — the student's own file, or help that is not in it. */
function Origin({ part, onSlide }: { part: LessonPart; onSlide: (p: number) => void }) {
  if (part.origin === "added") {
    return (
      <span className="inline-flex items-center gap-1 text-caption font-bold text-ink-muted" title="شرح إضافي من فطن ليس في ملفك">
        <Sparkles className="size-3" aria-hidden /> إضافة توضيحية
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-caption font-bold text-info-ink">
      <FileText className="size-3" aria-hidden /> من ملفك
      {part.pages.slice(0, 4).map((p) => (
        <Button
          key={p}
          variant="bare"
          type="button"
          onClick={() => onSlide(p)}
          aria-label={`افتح الشريحة ${p}`}
          className="h-5 rounded-full border border-info-line px-1.5 text-caption font-bold hover:bg-info-soft"
        >
          ص {p}
        </Button>
      ))}
    </span>
  );
}

/**
 * A lesson part as teaching pieces: each one says what it is for (the idea,
 * why it matters, an example, a common mistake…) and where it comes from, so
 * the student can tell their lecture from the tutor's added help.
 */
export function LessonParts({ parts, reviewed, onSlide }: { parts: LessonPart[]; reviewed?: boolean; onSlide: (p: number) => void }) {
  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        const role = ROLE[part.role] ?? ROLE.idea;
        const Icon = role.icon;
        return (
          <section
            key={i}
            aria-label={role.label}
            data-origin={part.origin}
            className={cn("rounded-control", role.box ? `border px-3.5 py-3 ${role.box}` : "", part.origin === "added" && !role.box && "border-s-2 border-line ps-3")}
          >
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h4 className="inline-flex items-center gap-1.5 text-small font-bold">
                <Icon className="size-4 shrink-0" aria-hidden /> {role.label}
              </h4>
              <Origin part={part} onSlide={onSlide} />
            </div>
            <BotMarkdown content={part.md} onSlide={onSlide} />
          </section>
        );
      })}
      <p className="flex items-start gap-1.5 border-t border-line pt-2.5 text-caption leading-6 text-ink-muted">
        <ShieldCheck className="mt-1 size-3.5 shrink-0" aria-hidden />
        <span>
          «من ملفك» مأخوذ من شرائحك، و«إضافة توضيحية» شرح من فطن ليس في ملفك.
          {reviewed ? " راجعنا كل ما وُسم «من ملفك» مقابل صفحاتك." : ""}
        </span>
      </p>
    </div>
  );
}
