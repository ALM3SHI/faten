"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlarmClock,
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  Calculator,
  ClipboardList,
  Compass,
  FileText,
  GraduationCap,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Search,
  Sparkles,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useCommandPalette } from "@/components/command-palette-host";
import { Button } from "@/components/ds/button";
import { LogoMark } from "@/components/logo";
import { useSectionLinks } from "@/components/nav-sections";
import { sectionFor } from "@/lib/nav";
import { isActivePath, normalizePath } from "@/lib/routes";
import { cn } from "@/lib/utils";

const PAGE_ICONS: Record<string, LucideIcon> = {
  "/time": CalendarDays,
  "/schedule": ClipboardList,
  "/exams": AlarmClock,
  "/attendance": CalendarCheck,
  "/pomodoro": Timer,
  "/chat": MessageSquare,
  "/advisor": Compass,
  "/study": BookOpenCheck,
  "/tutor": Sparkles,
  "/record": GraduationCap,
  "/gpa": Calculator,
  "/transcript": FileText,
};

/** Tools that belong to no single space; they used to be reachable only from the account menu. */
const TOOLS = [
  { href: "/locations", label: "الخريطة والقاعات", Icon: MapPin },
  { href: "/community", label: "تقييمات المواد", Icon: MessagesSquare },
];

const ITEM =
  "flex min-h-11 items-center gap-3 rounded-control px-3 text-body font-medium motion-fast transition-colors focus-ring";
const IDLE = "text-ink-muted hover:bg-surface-sunken hover:text-ink";
const ACTIVE = "bg-info-soft text-info-ink font-semibold";

/**
 * Desktop navigation (lg and up) for signed-in students: the four spaces,
 * the pages of the space you are in, and the tools. Phones keep the bottom
 * bar. Every link target is unchanged — this is a second way to the same
 * routes, built from the same SECTIONS list as the rest of the navigation.
 *
 * Rendered by app-sidebar-host.tsx, which decides when it shows and loads
 * this file only then.
 */
export default function AppSidebar() {
  const pathname = usePathname();
  const sections = useSectionLinks();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const section = sectionFor(pathname);
  // /plan only forwards to /time, so it is not listed.
  const pages = section && section.pages.length > 1 ? section.pages.filter((p) => p.href !== "/plan") : [];

  return (
    <aside className="ds-page fixed inset-y-0 start-0 z-40 hidden w-60 flex-col gap-5 overflow-y-auto border-e border-line bg-surface px-3 py-4 text-ink lg:flex">
      <Link href="/" prefetch={false} aria-label="فطن — الصفحة الرئيسية" className="flex items-center gap-2 rounded-control px-2 py-1 focus-ring">
        <LogoMark />
        <span className="font-heading text-heading font-bold">فطن</span>
      </Link>

      <Button onClick={() => openPalette(true)} className="justify-start bg-canvas px-3 text-small font-normal text-ink-muted hover:text-ink">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-start">ابحث أو انتقل…</span>
        <kbd className="rounded border border-line px-1.5 text-caption" dir="ltr" aria-hidden>Ctrl K</kbd>
      </Button>

      <nav aria-label="الأقسام">
        <ul className="space-y-1">
          {sections.map((item) => {
            const on = section?.id === item.id;
            return (
              <li key={item.id}>
                <Link href={item.href} prefetch={false} aria-current={on ? "page" : undefined} className={cn(ITEM, on ? ACTIVE : IDLE)}>
                  <item.Icon className="size-5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {pages.length > 0 && section && (
        <nav aria-label={`صفحات ${section.label}`}>
          <p className="px-3 pb-1 text-caption font-semibold text-ink-muted" aria-hidden>في {section.label}</p>
          <ul className="space-y-0.5">
            {pages.map((page) => {
              const Icon = PAGE_ICONS[page.href] ?? FileText;
              const on = normalizePath(pathname) === page.href;
              return (
                <li key={page.href}>
                  <Link href={page.href} prefetch={false} aria-current={on ? "page" : undefined} className={cn(ITEM, "min-h-10 text-small", on ? "text-ink font-semibold" : IDLE)}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {page.label}
                    {on && <span className="ms-auto size-1.5 rounded-full bg-brand" aria-hidden />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <nav aria-label="أدوات">
        <p className="px-3 pb-1 text-caption font-semibold text-ink-muted" aria-hidden>أدوات</p>
        <ul className="space-y-0.5">
          {TOOLS.map(({ href, label, Icon }) => {
            const on = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link href={href} prefetch={false} aria-current={on ? "page" : undefined} className={cn(ITEM, "min-h-10 text-small", on ? ACTIVE : IDLE)}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
