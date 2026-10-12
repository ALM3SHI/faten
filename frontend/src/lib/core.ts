/**
 * UQU CORE - App State & Storage Utilities
 */

export const STORAGE_KEYS = {
  PROFILE: 'uqu_profile_v2',
  PLAN: 'uqu_plan_v5',
  GPA: 'uqu_gpa_v1',
  TASKS: 'uqu_tasks_v1',
  // Must match the key used by theme-toggle.tsx and the inline script in
  // app/layout.tsx — logout preserves this key so the theme survives.
  THEME: 'uqu-theme',
  AUTH: 'uqu_auth_v1'
};

export const Storage = {
  get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return fallback;
    }
  },

  set<T>(key: string, value: T): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`Error writing localStorage key "${key}":`, error);
      return false;
    }
  },

  remove(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  },

  update<T>(key: string, patcher: (current: T) => T, fallback: T): T {
    const current = this.get(key, fallback);
    const next = patcher(current);
    this.set(key, next);
    return next;
  }
};

