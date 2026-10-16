"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHub, pageFor, sectionFor } from "@/lib/nav";
import { normalizePath } from "@/lib/routes";
import { ChatModeSwitch } from "@/components/tutor/mode-switch";

/**
 * Top-of-page navigation inside a space.
 *
 *   • فطن (chat · study · tutor): a two-way switch «اسأل | ذاكر محاضرة».
 *   • A detail page (/plan, /gpa, …): a back link to its hub («→ وقتي»).
 *   • A hub, or a page outside the spaces: nothing.
 *
 * Kept under its old name so every page that rendered the sub-tabs now
 * renders this without further changes.
 */
export function SectionTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  if (!section) return null;

  if (section.id === "faten") {
    const p = normalizePath(pathname);
    const active = p.startsWith("/chat") ? "chat" : p.startsWith("/advisor") ? "advisor" : p.startsWith("/tutor") ? "tutor" : "study";
    return <ChatModeSwitch active={active} className={className} />;
  }
  if (isHub(pathname)) return null;

  const hub = section.pages[0];
  const page = pageFor(pathname);
  return (
    <nav aria-label="مسار الصفحة" className={cn("flex items-center gap-1.5 text-sm", className)}>
      <Link
        href={hub.href}
        prefetch={false}
        className="inline-flex items-center gap-1 h-9 ps-1 pe-3 rounded-full font-bold text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
      >
        <ChevronRight className="w-4 h-4" aria-hidden />
        {hub.label}
      </Link>
      {page && (
        <>
          <span className="text-muted-foreground/50" aria-hidden>/</span>
          <span aria-current="page" className="font-bold">{page.label}</span>
        </>
      )}
    </nav>
  );
}
