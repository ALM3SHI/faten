"use client";

import Link from "next/link";
import { BookOpenCheck, Compass, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type FatenMode = "chat" | "advisor" | "study" | "tutor";

/**
 * The three modes of فطن, one switch on all their pages:
 *   «اسأل»   (/chat)    — anything: regulations, your record, your week
 *   «المرشد» (/advisor) — what to register, when you graduate, the risks
 *   «ذاكر»   (/study, /tutor) — study a lecture file
 */
export function ChatModeSwitch({ active, className }: { active: FatenMode; className?: string }) {
  const current = active === "tutor" ? "study" : active;
  const items = [
    { id: "chat", href: "/chat", label: "اسأل", Icon: MessageSquare },
    { id: "advisor", href: "/advisor", label: "المرشد", Icon: Compass },
    { id: "study", href: "/study", label: "ذاكر محاضرة", Icon: BookOpenCheck },
  ] as const;
  return (
    <nav aria-label="وضع فطن" className={cn("inline-flex rounded-control border border-line bg-surface-sunken p-1", className)}>
      {items.map(({ id, href, label, Icon }) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={current === id ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-small font-semibold motion-fast transition-colors focus-ring",
            current === id ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
          )}
        >
          <Icon className={cn("size-4", current === id && "text-brand")} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
