"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { normalizePath } from "@/lib/routes";
import { NO_APP_NAV, sectionFor } from "@/lib/nav";
import { useSectionLinks } from "@/components/nav-sections";

/**
 * Thumb-reachable bar for phones with the four spaces (hidden from lg up,
 * where the top navbar shows them). A space opens its hub; detail pages
 * link back to it. Full-height pages reserve the bar's space through
 * --bottom-nav-h (globals.css).
 */
export function BottomNav() {
  const pathname = usePathname();
  const sections = useSectionLinks();
  if (NO_APP_NAV.has(normalizePath(pathname))) return null;
  const active = sectionFor(pathname)?.id;

  return (
    <>
      <div className="h-[var(--bottom-nav-h)] lg:hidden" aria-hidden />
      <nav
        aria-label="التنقل الرئيسي"
        className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-border bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-4 h-16">
          {sections.map(({ id, label, href, Icon }) => {
            const on = active === id;
            return (
              <li key={id}>
                <Link
                  href={href}
                  // No prefetch: each tab loads its code when opened (see navbar.tsx).
                  prefetch={false}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors",
                    on ? "text-uqu-accent" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-5 h-5" strokeWidth={on ? 2.4 : 2} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
