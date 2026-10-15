"use client";

import Link from "next/link";
import { BookOpenCheck, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The two modes of فطن: «اسأل» (/chat) and «ذاكر محاضرة» (/study, which
 * leads to the guided tutor at /tutor). One switch for all three pages.
 */
export function ChatModeSwitch({ active, className }: { active: "chat" | "study" | "tutor"; className?: string }) {
  const studying = active !== "chat";
  const items = [
    { id: "chat", on: !studying, href: "/chat", label: "اسأل", Icon: MessageSquare },
    { id: "study", on: studying, href: "/study", label: "ذاكر محاضرة", Icon: BookOpenCheck },
  ] as const;
  return (
    <nav aria-label="وضع فطن" className={cn("inline-flex p-1 rounded-xl bg-foreground/5 border border-foreground/10", className)}>
      {items.map(({ id, on, href, label, Icon }) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={on ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold transition-colors whitespace-nowrap",
            on ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
