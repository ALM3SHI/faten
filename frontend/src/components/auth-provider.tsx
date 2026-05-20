"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  attachStoreSync,
  hydrateUserWorkspace,
  pauseSyncForLogout,
} from '@/lib/firebase/sync';
import { hydrateWorkspaceFromApi } from '@/lib/workspace';
import { fetchPomodoroStats } from '@/lib/pomodoro';
import { usePomodoroStore } from '@/store/pomodoroStore';

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wire Zustand → Firestore subscriptions once for the lifetime of the
    // app. attachStoreSync() is idempotent; the listeners stay attached
    // across auth state changes and gate themselves on auth.currentUser.
    attachStoreSync();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Sync with Firestore
        const docRef = doc(db, 'users', user.uid);
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
            courses: []
          };
          await setDoc(docRef, initialProfile);
          setProfile(initialProfile);
        }

        // Phase 1: prefer backend workspace loader; fall back to direct
        // Firestore pull if the API is unreachable.
        const hydratedFromApi = await hydrateWorkspaceFromApi();
        if (!hydratedFromApi) {
          try {
            await hydrateUserWorkspace(user.uid);
          } catch (err) {
            console.error('[auth] hydrateUserWorkspace failed:', err);
          }
        }

        try {
          const stats = await fetchPomodoroStats();
          usePomodoroStore.getState().setCompletedSessions(stats.todaySessions);
        } catch (err) {
          console.warn('[auth] fetchPomodoroStats failed:', err);
        }
      } else {
        // Logout: stop sync immediately so any in-flight debounced pushes
        // don't fire under a stale or missing UID.
        pauseSyncForLogout();
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
