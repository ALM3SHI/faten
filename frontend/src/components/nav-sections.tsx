"use client";

import { CalendarDays, GraduationCap, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { SECTIONS, sectionHref, type SectionId } from "@/lib/nav";

export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  today: Sun,
  time: CalendarDays,
  faten: Sparkles,
  record: GraduationCap,
};

const LINKS = SECTIONS.map((s) => ({ ...s, href: sectionHref(s), Icon: SECTION_ICONS[s.id] }));

/** The four space links, each pointing at its hub. */
export function useSectionLinks() {
  return LINKS;
}
