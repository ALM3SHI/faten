"use client";

import { useSyncExternalStore } from "react";
import { BookOpenCheck, Building2, GraduationCap, LayoutDashboard, MessageSquare, type LucideIcon } from "lucide-react";
import { SECTIONS, sectionHref, type SectionId } from "@/lib/nav";

export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  home: LayoutDashboard,
  chat: MessageSquare,
  study: BookOpenCheck,
  record: GraduationCap,
  university: Building2,
};

const LAST_KEY = "uqu_nav_last_v1";
export const NAV_CHANGED = "uqu-nav-last";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(NAV_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NAV_CHANGED, onChange);
  };
}

function snapshot(): string {
  try {
    return localStorage.getItem(LAST_KEY) || "{}";
  } catch {
    return "{}";
  }
}

/** Section links, each pointing at the page last opened in that section. */
export function useSectionLinks() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  let stored: Record<string, string> = {};
  try {
    stored = JSON.parse(raw);
  } catch {
    stored = {};
  }
  return SECTIONS.map((s) => ({ ...s, href: sectionHref(s, stored), Icon: SECTION_ICONS[s.id] }));
}
