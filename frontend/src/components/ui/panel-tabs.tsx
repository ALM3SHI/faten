"use client";

import { Tabs } from "@base-ui/react/tabs";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface PanelTab {
  value: string;
  label: string;
  content: React.ReactNode;
}

/**
 * One card that holds several related panels behind tabs (keyboard arrows
 * move between tabs). Inactive panels are not mounted, so a panel's data
 * and code load the first time it is opened.
 */
export function PanelTabs({
  tabs,
  label,
  className,
  defaultValue,
}: {
  tabs: PanelTab[];
  /** Accessible name for the tab list, e.g. "تحليلات المعدل". */
  label: string;
  className?: string;
  defaultValue?: string;
}) {
  return (
    <Card className={cn("glass rounded-[24px] border-foreground/10 p-4 md:p-5 gap-4", className)}>
      <Tabs.Root defaultValue={defaultValue ?? tabs[0]?.value} className="flex flex-col gap-4 min-w-0">
        <Tabs.List
          aria-label={label}
          className="flex gap-1 p-1 rounded-xl bg-foreground/5 border border-foreground/10 overflow-x-auto no-scrollbar"
        >
          {tabs.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              className={cn(
                "flex-1 min-w-fit px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors outline-none",
                "text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-uqu-accent/50",
                "data-[active]:bg-uqu-accent data-[active]:text-white data-[active]:hover:text-white",
              )}
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((t) => (
          <Tabs.Panel key={t.value} value={t.value} className="min-w-0 outline-none">
            {t.content}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </Card>
  );
}
