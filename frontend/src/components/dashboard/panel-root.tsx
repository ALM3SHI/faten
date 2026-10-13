"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Dashboard panels render as their own card, or "bare" inside a tabbed
 * card (components/ui/panel-tabs.tsx) where the tab already names them.
 */
export function PanelRoot({ bare, className, children }: { bare?: boolean; className: string; children: React.ReactNode }) {
  if (bare) return <div className="relative min-w-0 flex flex-col">{children}</div>;
  return <Card className={cn(className)}>{children}</Card>;
}
