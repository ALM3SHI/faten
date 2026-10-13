"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { pageFor, rememberPage, sectionFor } from "@/lib/nav";

/**
 * The pages of the current section ("دراستي": الخطة · الاختبارات · …) as
 * tabs at the top of the page. Renders nothing outside multi-page sections.
 */
export function SectionTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const current = pageFor(pathname);

  useEffect(() => {
    rememberPage(pathname);
  }, [pathname]);

  if (!section || section.pages.length < 2) return null;

  return (
    <nav aria-label={`صفحات ${section.label}`} className={cn("-mx-4 px-4 overflow-x-auto no-scrollbar", className)}>
      <ul className="flex gap-2 w-max">
        {section.pages.map((p) => {
          const active = current?.href === p.href;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center h-9 px-4 rounded-full border text-sm font-bold whitespace-nowrap transition-colors",
                  active
                    ? "border-uqu-accent/40 bg-uqu-accent/10 text-uqu-accent"
                    : "border-foreground/10 text-muted-foreground hover:text-foreground hover:bg-foreground/5",
                )}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
