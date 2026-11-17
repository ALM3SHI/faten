"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { CloudOff, Loader2 } from "lucide-react";
import { markBackendUnreachable, useBackendStatus, warmupBackend } from "@/lib/backend-status";
import { isProtectedPath } from "@/lib/routes";
import { Button } from "@/components/ds/button";

/**
 * Mounted once in the root layout: wakes the API server early, and on app
 * pages says so while it is waking, so a slow first load is explained
 * instead of looking frozen. Public pages stay quiet.
 */
export function BackendWarmup() {
  useEffect(() => {
    warmupBackend();
  }, []);

  const status = useBackendStatus((s) => s.status);
  const pathname = usePathname();
  if (!isProtectedPath(pathname) || (status !== "waking" && status !== "down")) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface-raised px-4 py-2 text-small text-ink shadow-menu"
      >
        {status === "waking" ? (
          <>
            <Loader2 className="size-4 text-brand motion-safe:animate-spin" aria-hidden />
            <span>الخادم يستيقظ، قد يأخذ ذلك دقيقة. بياناتك المحفوظة تعمل الآن.</span>
          </>
        ) : (
          <>
            <CloudOff className="size-4 text-warning-ink" aria-hidden />
            <span>تعذّر الوصول للخادم. بياناتك المحفوظة على جهازك تعمل.</span>
            <Button variant="bare" onClick={markBackendUnreachable} className="rounded-sm font-semibold text-brand underline underline-offset-4">
              أعد المحاولة
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
