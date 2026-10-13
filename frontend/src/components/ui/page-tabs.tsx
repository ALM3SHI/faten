"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { TAB_CLASS, Tabs, type TabItem } from "@/components/ui/tab-list";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Top-level tabs of a page, kept in the URL hash (/profile#notifications)
 * so a link can open a specific tab.
 */
export function PageTabs({ tabs, label, className }: { tabs: TabItem[]; label: string; className?: string }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash.slice(1), () => "");
  const value = tabs.some((t) => t.value === hash) ? hash : tabs[0].value;

  return (
    <Tabs
      tabs={tabs}
      value={value}
      onChange={(next) => {
        history.replaceState(null, "", next === tabs[0].value ? window.location.pathname : `#${next}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
      label={label}
      className={cn("gap-6", className)}
      listClassName="flex gap-1 p-1 rounded-2xl bg-foreground/5 border border-foreground/10 overflow-x-auto no-scrollbar sm:w-fit"
      tabClassName={cn(TAB_CLASS, "rounded-xl px-4 sm:flex-none")}
    />
  );
}
