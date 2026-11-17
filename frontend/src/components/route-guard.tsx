"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loading, Skeleton } from "@/components/ds/states";
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
      // A skeleton with the page's rough shape: the wait reads as "loading
      // this page", not as a blank screen with a spinner.
      <Loading className="min-h-screen bg-background">
        <div className="container mx-auto max-w-5xl space-y-6 px-4 pt-24">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
          </div>
          <Skeleton className="h-56 rounded-card" />
        </div>
      </Loading>
    );
  }
  return <>{children}</>;
}
