"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, CalendarCheck, LayoutDashboard, MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActivePath, normalizePath } from "@/lib/routes";

const ITEMS = [
  { name: "اللوحة", href: "/dashboard", icon: LayoutDashboard },
  { name: "الدردشة", href: "/chat", icon: MessageSquare },
  { name: "الخطة", href: "/plan", icon: CalendarCheck },
  { name: "المعدل", href: "/gpa", icon: Calculator },
  { name: "المجتمع", href: "/community", icon: Users },
];

/** Pages with their own full-screen layout and no app navigation. */
const HIDDEN_ON = new Set(["/", "/login"]);

/**
 * Thumb-reachable tab bar for phones (hidden from lg up, where the top
 * navbar shows every link). Full-height pages reserve its space through
 * the --bottom-nav-h CSS variable defined in globals.css.
 */
export function BottomNav() {
  const pathname = usePathname();
  if (HIDDEN_ON.has(normalizePath(pathname))) return null;

  return (
    <>
      <div className="h-[var(--bottom-nav-h)] lg:hidden" aria-hidden />
      <nav
        aria-label="التنقل الرئيسي"
        className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-border bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="grid grid-cols-5 h-16">
          {ITEMS.map(({ name, href, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  // No prefetch: each tab loads its code when opened (see navbar.tsx).
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "h-full flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors",
                    active ? "text-uqu-accent" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
                  {name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
