"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { isProtectedPath, normalizePath, safeNextPath } from "@/lib/routes";

/**
 * Keeps signed-out visitors away from pages that only make sense with an
 * account (dashboard, GPA, plan…). They are sent to /login and brought back
 * to the page they wanted after signing in.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const needsAuth = isProtectedPath(pathname);

  const onLogin = normalizePath(pathname) === "/login";

  useEffect(() => {
    // Already signed in → the login page has nothing to offer.
    if (onLogin && !loading && user) {
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
      return;
    }
    if (needsAuth && !loading && !user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    }
  }, [needsAuth, onLogin, loading, user, router]);

  if (needsAuth && (loading || !user)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" aria-busy="true">
        <Loader2 className="w-7 h-7 animate-spin text-uqu-accent" aria-label="جارٍ التحميل" />
      </div>
    );
  }
  return <>{children}</>;
}
