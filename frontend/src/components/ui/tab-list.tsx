"use client";

import { useId, useRef } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  value: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern) without a UI library: the arrow
 * keys move between tabs (in RTL, ← goes to the next tab), Home/End jump
 * to the ends, and only the active panel is mounted.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  listClassName,
  tabClassName,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  listClassName?: string;
  tabClassName?: string;
  className?: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, tabs.findIndex((t) => t.value === value));
  const active = tabs[index];

  const focusTab = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].value);
    refs.current[n]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = rtl ? "ArrowLeft" : "ArrowRight";
    const prev = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === next) focusTab(index + 1);
    else if (e.key === prev) focusTab(index - 1);
    else if (e.key === "Home") focusTab(0);
    else if (e.key === "End") focusTab(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn("flex flex-col min-w-0", className)}>
      <div role="tablist" aria-label={label} className={listClassName} onKeyDown={onKeyDown}>
        {tabs.map((t, i) => {
          const selected = t.value === active.value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.value}`}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              data-active={selected ? "" : undefined}
              onClick={() => onChange(t.value)}
              className={tabClassName}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active.value}`} tabIndex={0} className="min-w-0 outline-none">
        {active.content}
      </div>
    </div>
  );
}

export const TAB_CLASS = cn(
  "flex-1 min-w-fit px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors outline-none",
  "text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-uqu-accent/50",
  "data-[active]:bg-uqu-accent data-[active]:text-white data-[active]:hover:text-white",
);
