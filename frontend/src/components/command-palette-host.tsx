"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { create } from "zustand";

/** Open/close state, shared by the keyboard shortcut and the search buttons. */
export const useCommandPalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

// The palette (and the search index it pulls in) is downloaded the first time
// it is opened, so it adds nothing to the pages' initial JavaScript.
const CommandPalette = dynamic(() => import("@/components/command-palette"), { ssr: false });

/** Mounted once in the root layout: listens for Ctrl+K / ⌘K everywhere. */
export function CommandPaletteHost() {
  const { open, setOpen } = useCommandPalette();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useCommandPalette.getState().open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the palette's code on first open, then keep it mounted
    if (open) setLoaded(true);
  }, [open]);

  return loaded ? <CommandPalette open={open} onOpenChange={setOpen} /> : null;
}
