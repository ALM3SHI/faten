"use client";

import Link from "next/link";
import { GraduationCap, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/** Two separate modes of the chat section: general questions vs. guided study. */
export function ChatModeSwitch({ active, className }: { active: "chat" | "tutor"; className?: string }) {
  const items = [
    { id: "chat", href: "/chat", label: "الدردشة العامة", Icon: MessageSquare },
    { id: "tutor", href: "/tutor", label: "المذاكرة الذكية", Icon: GraduationCap },
  ] as const;
  return (
    <nav aria-label="وضع المساعد" className={cn("inline-flex p-1 rounded-xl bg-foreground/5 border border-foreground/10", className)}>
      {items.map(({ id, href, label, Icon }) => (
        <Link
          key={id}
          href={href}
          prefetch={false}
          aria-current={active === id ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold transition-colors whitespace-nowrap",
            active === id ? "bg-uqu-accent text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
