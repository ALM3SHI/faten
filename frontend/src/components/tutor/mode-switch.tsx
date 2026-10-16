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
    <nav aria-label="وضع فطن" className={cn("inline-flex p-1 rounded-xl bg-foreground/5 border border-foreground/10", className)}>
      {items.map(({ id, href, label, Icon }) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={current === id ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold transition-colors whitespace-nowrap",
            current === id ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
