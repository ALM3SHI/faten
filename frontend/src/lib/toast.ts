import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

const DEFAULT_DURATION_MS = 3000;

interface ToastStore {
  toasts: ToastItem[];
  push: (message: string, variant: ToastVariant, durationMs?: number) => void;
  remove: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (message, variant, durationMs = DEFAULT_DURATION_MS) => {
    const id = `toast-${++nextId}`;
    set((state) => ({
      toasts: [...state.toasts, { id, message, variant }],
    }));
    window.setTimeout(() => get().remove(id), durationMs);
  },
  remove: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

/** Imperative toast API — safe to call from any client component. */
export const toast = {
  success: (message: string) => useToastStore.getState().push(message, "success"),
  error: (message: string) => useToastStore.getState().push(message, "error"),
  warning: (message: string) => useToastStore.getState().push(message, "warning"),
  info: (message: string) => useToastStore.getState().push(message, "info"),
};
