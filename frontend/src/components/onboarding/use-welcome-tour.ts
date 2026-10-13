"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { markTourDone, readTourDone } from "@/lib/firebase/sync";
import { TOUR_LOCAL_KEY, TOUR_REPLAY_KEY, TOUR_VERSION, readStorage, writeStorage } from "@/lib/tour";

const localMark = (uid: string) => `${uid}:${TOUR_VERSION}`;

/** Replay request, else this device's mark, else the account flag in Firestore. */
async function shouldOpen(uid: string): Promise<boolean> {
  if (readStorage("session", TOUR_REPLAY_KEY)) return true;
  if (readStorage("local", TOUR_LOCAL_KEY) === localMark(uid)) return false;
  const done = await readTourDone(uid, TOUR_VERSION);
  if (done) writeStorage("local", TOUR_LOCAL_KEY, localMark(uid));
  return !done;
}

/**
 * Opens the welcome tour once per account: this device remembers it, and
 * the account flag in Firestore covers other devices. A replay request
 * from the profile page opens it again.
 */
export function useWelcomeTour(): { open: boolean; close: () => void } {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    shouldOpen(uid)
      .then((show) => {
        if (cancelled || !show) return;
        // Cleared only once shown, so a cancelled first run keeps the request.
        writeStorage("session", TOUR_REPLAY_KEY, null);
        setOpen(true);
      })
      .catch(() => {
        // Offline or blocked: try again on the next visit rather than nag now.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const close = useCallback(() => {
    setOpen(false);
    if (!uid) return;
    writeStorage("local", TOUR_LOCAL_KEY, localMark(uid));
    markTourDone(uid, TOUR_VERSION).catch((err) => console.warn("[tour] could not save:", err));
  }, [uid]);

  return { open, close };
}
