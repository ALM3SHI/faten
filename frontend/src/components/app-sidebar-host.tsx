"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { NO_APP_NAV } from "@/lib/nav";
import { normalizePath } from "@/lib/routes";

// Downloaded only for signed-in students on app pages, so the landing page,
// the login page and visitors never pay for it.
const AppSidebar = dynamic(() => import("@/components/app-sidebar"), { ssr: false });

/**
 * Decides when the desktop sidebar shows: a signed-in student, on any page
 * except the landing and login pages. While it shows, <html data-app-sidebar>
 * shifts the page and the top bar over by the sidebar's width and hides the
 * top bar's own copy of the four spaces (globals.css).
 */
export function AppSidebarHost() {
  const pathname = usePathname();
  const { user } = useAuth();
  const visible = !!user && !NO_APP_NAV.has(normalizePath(pathname));

  useEffect(() => {
    if (!visible) return;
    document.documentElement.dataset.appSidebar = "";
    return () => {
      delete document.documentElement.dataset.appSidebar;
    };
  }, [visible]);

  return visible ? <AppSidebar /> : null;
}
