"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { CloudOff, Loader2, WifiOff } from "lucide-react";
import { markBackendUnreachable, useBackendStatus, warmupBackend } from "@/lib/backend-status";
import { isProtectedPath } from "@/lib/routes";
import { Button } from "@/components/ds/button";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Mounted once in the root layout: wakes the API server early, and on app
 * pages says so while it is waking, so a slow first load is explained
 * instead of looking frozen. Public pages stay quiet.
 *
 * When the device itself is offline it says THAT — not "the server is
 * waking", which sent students waiting for something that was never coming.
 * Sits below the top bar, never over its buttons.
 */
export function BackendWarmup() {
  useEffect(() => {
    warmupBackend();
  }, []);

  const status = useBackendStatus((s) => s.status);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const pathname = usePathname();
  if (!isProtectedPath(pathname)) return null;
  if (online && status !== "waking" && status !== "down") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.75rem] z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-small text-ink shadow-menu"
      >
        {!online ? (
          <>
            <WifiOff className="size-4 shrink-0 text-warning-ink" aria-hidden />
            <span>أنت غير متصل بالإنترنت. تشوف آخر بيانات محفوظة على جهازك.</span>
          </>
        ) : status === "waking" ? (
          <>
            <Loader2 className="size-4 shrink-0 text-brand motion-safe:animate-spin" aria-hidden />
            <span>الخادم يستيقظ، قد يأخذ ذلك دقيقة. بياناتك المحفوظة تعمل الآن.</span>
          </>
        ) : (
          <>
            <CloudOff className="size-4 shrink-0 text-warning-ink" aria-hidden />
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
