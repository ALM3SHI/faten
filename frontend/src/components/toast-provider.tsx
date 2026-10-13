"use client";

import dynamic from "next/dynamic";
import { useToastStore } from "@/lib/toast";

// framer-motion only loads once a toast is actually shown, not on every page.
const ToastList = dynamic(() => import("@/components/toast-list").then((m) => m.ToastList), { ssr: false });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const active = useToastStore((s) => s.shown);

  return (
    <>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col items-stretch gap-2 px-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {active && <ToastList />}
      </div>
    </>
  );
}
