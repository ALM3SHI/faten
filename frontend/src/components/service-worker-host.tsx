"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { isProtectedPath } from "@/lib/routes";
import { Button } from "@/components/ds/button";

// The same file push notifications use: one worker per scope (public/push-sw.js).
const SW_URL = "/push-sw.js";

/** Screens kept for offline use once a student is signed in. */
export const OFFLINE_PATHS = ["/dashboard/", "/time/", "/schedule/", "/locations/", "/record/"];

/**
 * Mounted once in the root layout (production builds only): registers the
 * service worker after the page has loaded, asks it to keep the core screens
 * on app pages, and offers a reload when a new version has been deployed.
 */
export function ServiceWorkerHost() {
  const pathname = usePathname();
  const onApp = isProtectedPath(pathname);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    // A new worker took over a page that already had one: a new deploy.
    const onChange = () => {
      if (hadController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    const register = () => navigator.serviceWorker.register(SW_URL).catch((err) => console.warn("[sw] register failed:", err));
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    // Long-lived tabs (a student keeps «وقتي» open all day) check hourly.
    const timer = window.setInterval(() => {
      void navigator.serviceWorker.getRegistration().then((r) => r?.update());
    }, 60 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      window.removeEventListener("load", register);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!onApp || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return;
      // Off the critical path: after the page has settled.
      const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
      idle(() => {
        const loaded = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(`${location.origin}/_next/static/`));
        reg.active?.postMessage({ type: "keep", urls: loaded });
        reg.active?.postMessage({ type: "warm", paths: OFFLINE_PATHS });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onApp]);

  if (!updateReady) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+1rem)] z-50 flex justify-center px-4 md:bottom-6">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface-raised py-1.5 ps-4 pe-1.5 text-small text-ink shadow-menu"
      >
        <span>يوجد تحديث لفطن.</span>
        <Button variant="primary" size="sm" className="rounded-full" onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden />
          حدّث الصفحة
        </Button>
      </div>
    </div>
  );
}
