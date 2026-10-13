/**
 * App navigation: five sections, the same on phones (bottom bar) and
 * desktop (top bar). Sections with several pages show them as sub-tabs at
 * the top of each page (components/section-tabs.tsx), so every page is at
 * most two taps away without nested menus.
 */

import { normalizePath } from "@/lib/routes";

export type SectionId = "home" | "chat" | "study" | "record" | "university";

export interface NavPage {
  href: string;
  label: string;
}

export interface NavSection {
  id: SectionId;
  label: string;
  pages: NavPage[];
}

export const SECTIONS: NavSection[] = [
  { id: "home", label: "الرئيسية", pages: [{ href: "/dashboard", label: "الرئيسية" }] },
  { id: "chat", label: "الدردشة", pages: [{ href: "/chat", label: "الدردشة" }] },
  {
    id: "study",
    label: "دراستي",
    pages: [
      { href: "/plan", label: "الخطة" },
      { href: "/exams", label: "الاختبارات" },
      { href: "/study", label: "المذاكرة" },
      { href: "/pomodoro", label: "بومودورو" },
    ],
  },
  {
    id: "record",
    label: "سجلي",
    pages: [
      { href: "/gpa", label: "المعدل" },
      { href: "/attendance", label: "الغياب" },
      { href: "/schedule", label: "الجدول" },
      { href: "/transcript", label: "السجل" },
    ],
  },
  {
    id: "university",
    label: "الجامعة",
    pages: [
      { href: "/locations", label: "القاعات" },
      { href: "/community", label: "المجتمع" },
    ],
  },
];

/** Pages with their own full-screen layout and no app navigation bar. */
export const NO_APP_NAV = new Set(["/", "/login"]);

function pageMatches(path: string, href: string): boolean {
  return path === href || path.startsWith(href + "/");
}

/** The section a path belongs to (null for pages outside the sections, e.g. /profile). */
export function sectionFor(path: string | null | undefined): NavSection | null {
  const p = normalizePath(path);
  return SECTIONS.find((s) => s.pages.some((pg) => pageMatches(p, pg.href))) ?? null;
}

/** The page of a section the path is on, if any. */
export function pageFor(path: string | null | undefined): NavPage | null {
  const p = normalizePath(path);
  for (const s of SECTIONS) for (const pg of s.pages) if (pageMatches(p, pg.href)) return pg;
  return null;
}

const LAST_KEY = "uqu_nav_last_v1";

/** Remember the page last opened in each section, so the section link returns there. */
export function rememberPage(path: string | null | undefined): void {
  const section = sectionFor(path);
  const page = pageFor(path);
  if (!section || !page || section.pages.length < 2) return;
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) || "{}") as Record<string, string>;
    if (all[section.id] === page.href) return;
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...all, [section.id]: page.href }));
    window.dispatchEvent(new Event("uqu-nav-last"));
  } catch {
    // storage unavailable — the section link falls back to its first page
  }
}

/** Where a section link goes: the last page opened there, or the section's first page. */
export function sectionHref(section: NavSection, stored?: Record<string, string> | null): string {
  const last = stored?.[section.id];
  return last && section.pages.some((p) => p.href === last) ? last : section.pages[0].href;
}
