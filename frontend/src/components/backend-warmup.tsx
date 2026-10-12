"use client";

import { useEffect } from "react";
import { warmupBackend } from "@/lib/backend-status";

/** Mounted once in the root layout: wakes the API server early. */
export function BackendWarmup() {
  useEffect(() => {
    warmupBackend();
  }, []);
  return null;
}
