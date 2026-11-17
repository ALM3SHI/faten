"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { User } from "firebase/auth";
import {
  hasSavedFirebaseSession,
  hasSignedInHint,
  loadFirebase,
  loadSync,
  setSignedInHint,
} from "@/lib/firebase/lazy";
import { isProtectedPath, normalizePath } from "@/lib/routes";
import {
  clearAuthenticatedUidTracking,
  clearUserStores,
  purgePersistedDataIfAccountSwitched,
  setStoresOwnerUid,
} from "@/lib/auth-utils";
import { hydrateWorkspaceFromApi } from "@/lib/workspace";
import { fetchPomodoroStats } from "@/lib/pomodoro";
import { usePomodoroStore } from "@/store/pomodoroStore";

interface AuthContextType {
  user: User | null;
  /** Raw users/{uid} Firestore document (free-form). */
  profile: Record<string, unknown> | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

const noSubscribe = () => () => {};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  // Firebase is loaded on demand (see lib/firebase/lazy): protected pages and
  // /login need it now; a public page only if this browser signed in before.
  const pathname = usePathname();
  const mustStart =
    isProtectedPath(pathname) || normalizePath(pathname) === "/login";
  // null while hydrating (the server has no localStorage), then the real value.
  const hint = useSyncExternalStore(noSubscribe, hasSignedInHint, () => null);
  const [started, setStarted] = useState(false);
  // Once started, Firebase stays: navigating back to a public page keeps the session.
  if (!started && (mustStart || hint === true)) setStarted(true);
  const hintChecked = hint !== null;

  // No hint on a public page: ask Firebase's own saved session before
  // treating the visitor as signed out (students signed in before the hint).
  const [probed, setProbed] = useState(false);
  useEffect(() => {
    if (started || hint !== false) return;
    let alive = true;
    void hasSavedFirebaseSession().then((saved) => {
      if (!alive) return;
      if (saved) setStarted(true);
      setProbed(true);
    });
    return () => {
      alive = false;
    };
  }, [started, hint]);

  useEffect(() => {
    if (!started) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const [
        { auth, db },
        { onAuthStateChanged },
        { doc, getDoc, setDoc },
        sync,
      ] = await Promise.all([
        loadFirebase(),
        import("firebase/auth"),
        import("firebase/firestore"),
        loadSync(),
      ]);
      if (cancelled) return;
      const {
        attachStoreSync,
        hydrateAttendance,
        hydrateExams,
        hydrateStudyPacks,
        hydrateUserWorkspace,
        pauseSyncForLogout,
      } = sync;

      // Wire Zustand → Firestore subscriptions once for the lifetime of the
      // app. attachStoreSync() is idempotent; the listeners stay attached
      // across auth state changes and gate themselves on auth.currentUser.
      attachStoreSync();

      unsubscribe = onAuthStateChanged(auth, async (user) => {
        setUser(user);
        setSignedInHint(!!user);
        if (user) {
          purgePersistedDataIfAccountSwitched(user.uid);
          setStoresOwnerUid(user.uid);

          // Offline: everything the pages need is already saved on this
          // device. Fetching would only fail (Firestore throws when offline)
          // and keep the app on its loading screen.
          if (!navigator.onLine) {
            setLoading(false);
            return;
          }

          // Sync with Firestore. A failed read must not block the app either.
          try {
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              setProfile(docSnap.data());
            } else {
              // Create initial profile if doesn't exist
              const initialProfile = {
                uid: user.uid,
                email: user.email,
                createdAt: new Date().toISOString(),
                basic: { name: user.displayName || "" },
                goals: { currentGpa: 0, targetGpa: 0 },
              };
              await setDoc(docRef, initialProfile);
              setProfile(initialProfile);
            }
          } catch (err) {
            console.warn("[auth] profile read failed — using saved data:", err);
          }

          // Phase 1: prefer backend workspace loader; fall back to direct
          // Firestore pull if the API is unreachable.
          const hydratedFromApi = await hydrateWorkspaceFromApi();
          if (!hydratedFromApi) {
            try {
              await hydrateUserWorkspace(user.uid);
            } catch (err) {
              console.error("[auth] hydrateUserWorkspace failed:", err);
            }
          }

          // Study packs, exams and attendance live outside /api/workspace — merge them on every sign-in.
          const extra = await Promise.allSettled([
            hydrateStudyPacks(user.uid),
            hydrateExams(user.uid),
            hydrateAttendance(user.uid),
          ]);
          for (const r of extra) {
            if (r.status === "rejected")
              console.warn(
                "[auth] hydrate study/exams/attendance failed:",
                r.reason,
              );
          }

          try {
            const stats = await fetchPomodoroStats();
            const pomodoro = usePomodoroStore.getState();
            pomodoro.setCompletedSessions(stats.todaySessions);
            pomodoro.setCurrentStreak(stats.currentStreak);
          } catch (err) {
            console.warn("[auth] fetchPomodoroStats failed:", err);
          }
        } else {
          // Logout: stop sync immediately so any in-flight debounced pushes
          // don't fire under a stale or missing UID.
          pauseSyncForLogout();
          clearUserStores();
          clearAuthenticatedUidTracking();
          setProfile(null);
        }
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [started]);

  // Until Firebase answers, a page that needs it is "loading"; a public page
  // with no sign-in hint is simply signed out.
  const effectiveLoading = started || mustStart || !hintChecked || !probed ? loading : false;

  return (
    <AuthContext.Provider value={{ user, profile, loading: effectiveLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
