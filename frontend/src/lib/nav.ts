/**
 * App navigation: four spaces, the same on phones (bottom bar) and desktop
 * (top bar). Each space answers one question the student has:
 *
 *   اليوم   — what do I have right now?        /dashboard
 *   وقتي    — what's coming up?                 /time   (+ schedule, plan, exams, attendance, pomodoro)
 *   فطن     — ask, plan, or study with Faten    /chat   (+ advisor, study, tutor)
 *   معدّلي  — how am I doing academically?      /record (+ gpa, transcript)
 *
 * The first page of a space is its hub. The other pages are detail pages
 * reached from the hub, with a back link to it (components/section-tabs.tsx)
 * instead of a row of sub-tabs. Every old URL keeps working, so the agent's
 * navigation actions and saved links still land in the right place.
 *
 * Pages outside the spaces (profile, rooms, course reviews, admin) live in
 * the account menu (ACCOUNT_LINKS).
 */

import { normalizePath } from "@/lib/routes";

export type SectionId = "today" | "time" | "faten" | "record";

export interface NavPage {
  href: string;
  label: string;
}

export interface NavSection {
  id: SectionId;
  label: string;
  /** The hub first, then its detail pages. */
  pages: NavPage[];
}

export const SECTIONS: NavSection[] = [
  { id: "today", label: "اليوم", pages: [{ href: "/dashboard", label: "اليوم" }] },
  {
    id: "time",
    label: "وقتي",
    pages: [
      { href: "/time", label: "وقتي" },
      { href: "/schedule", label: "الجدول" },
      // forwards to /time, which now holds the study plan
      { href: "/plan", label: "خطة المذاكرة" },
      { href: "/exams", label: "الاختبارات" },
      { href: "/attendance", label: "الغياب" },
      { href: "/pomodoro", label: "جلسة تركيز" },
    ],
  },
  {
    id: "faten",
    label: "فطن",
    pages: [
      { href: "/chat", label: "اسأل" },
      { href: "/advisor", label: "المرشد" },
      { href: "/study", label: "ذاكر محاضرة" },
      { href: "/tutor", label: "المذاكرة الذكية" },
    ],
  },
  {
    id: "record",
    label: "معدّلي",
    pages: [
      { href: "/record", label: "معدّلي" },
      { href: "/gpa", label: "محاكي المعدل" },
      { href: "/transcript", label: "السجل الأكاديمي" },
    ],
  },
];

export interface AccountLink {
  href: string;
  label: string;
  /** Shown only to admins (checked against the server). */
  adminOnly?: boolean;
}

/** The account menu (avatar): everything that is not part of a space. */
export const ACCOUNT_LINKS: AccountLink[] = [
  { href: "/profile", label: "الملف الشخصي والأهداف" },
  { href: "/locations", label: "القاعات والخريطة" },
  { href: "/community", label: "تقييمات المواد" },
  { href: "/admin", label: "لوحة الإدارة", adminOnly: true },
];

/** Pages with their own full-screen layout and no app navigation bar. */
export const NO_APP_NAV = new Set(["/", "/login"]);

function pageMatches(path: string, href: string): boolean {
  return path === href || path.startsWith(href + "/");
}

/** The space a path belongs to (null for pages outside the spaces, e.g. /profile). */
export function sectionFor(path: string | null | undefined): NavSection | null {
  const p = normalizePath(path);
  return SECTIONS.find((s) => s.pages.some((pg) => pageMatches(p, pg.href))) ?? null;
}

/** The page of a space the path is on, if any. */
export function pageFor(path: string | null | undefined): NavPage | null {
  const p = normalizePath(path);
  for (const s of SECTIONS) for (const pg of s.pages) if (pageMatches(p, pg.href)) return pg;
  return null;
}

/** Where a space link goes: always its hub. */
export function sectionHref(section: NavSection): string {
  return section.pages[0].href;
}

/** True when the path is a space's hub (not one of its detail pages). */
export function isHub(path: string | null | undefined): boolean {
  const p = normalizePath(path);
  return SECTIONS.some((s) => pageMatches(p, s.pages[0].href));
}
