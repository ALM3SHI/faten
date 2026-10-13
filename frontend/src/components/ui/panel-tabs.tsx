"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TAB_CLASS, Tabs, type TabItem } from "@/components/ui/tab-list";

export type PanelTab = TabItem;

/**
 * One card that holds several related panels behind tabs. Inactive panels
 * are not mounted, so a panel's data and code load the first time it opens.
 */
export function PanelTabs({
  tabs,
  label,
  className,
  defaultValue,
}: {
  tabs: PanelTab[];
  /** Accessible name for the tab list, e.g. "تحليل المعدل والدراسة". */
  label: string;
  className?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? tabs[0]?.value ?? "");
  return (
    <Card className={cn("glass rounded-[24px] border-foreground/10 p-4 md:p-5 gap-0", className)}>
      <Tabs
        tabs={tabs}
        value={value}
        onChange={setValue}
        label={label}
        className="gap-4"
        listClassName="flex gap-1 p-1 rounded-xl bg-foreground/5 border border-foreground/10 overflow-x-auto no-scrollbar"
        tabClassName={TAB_CLASS}
      />
    </Card>
  );
}
