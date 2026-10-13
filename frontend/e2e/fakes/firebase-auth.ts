/**
 * E2E stand-in for `firebase/auth`. A signed-in user lives in localStorage
 * (`__e2e_auth_user__`) so tests can start signed in by seeding it, or sign
 * in through the real login form (any password of 8+ chars works; the
 * address `wrong@test.local` is rejected to exercise the error path).
 */

import { readJson, writeJson } from "./store";

const USER_KEY = "__e2e_auth_user__";

type Stored = { uid: string; email: string; displayName: string | null; emailVerified: boolean };

export interface User extends Stored {
  providerData: { providerId: string }[];
  getIdToken: () => Promise<string>;
  reload: () => Promise<void>;
}

type Listener = (user: User | null) => void;

function toUser(s: Stored | null): User | null {
  if (!s) return null;
  return { ...s, providerData: [{ providerId: "password" }], getIdToken: async () => `e2e-token-${s.uid}`, reload: async () => {} };
}

class FakeAuth {
  currentUser: User | null = null;
  listeners = new Set<Listener>();
  constructor() {
    if (typeof window !== "undefined") this.currentUser = toUser(readJson<Stored | null>(USER_KEY, null));
  }
  set(s: Stored | null) {
    writeJson(USER_KEY, s);
    this.currentUser = toUser(s);
    for (const l of this.listeners) l(this.currentUser);
  }
}

let instance: FakeAuth | null = null;

export function getAuth(): FakeAuth {
  if (!instance) instance = new FakeAuth();
  return instance;
}

export class GoogleAuthProvider {}

export function onAuthStateChanged(auth: FakeAuth, cb: Listener): () => void {
  auth.listeners.add(cb);
  setTimeout(() => cb(auth.currentUser), 0);
  return () => auth.listeners.delete(cb);
}

function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function uidFor(email: string): string {
  return "e2e-" + email.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

export async function signInWithEmailAndPassword(auth: FakeAuth, email: string, password: string) {
  if (email === "wrong@test.local" || password.length < 8) throw authError("auth/invalid-credential");
  auth.set({ uid: uidFor(email), email, displayName: "طالب تجريبي", emailVerified: true });
  return { user: auth.currentUser! };
}

export async function createUserWithEmailAndPassword(auth: FakeAuth, email: string, _password: string) {
  auth.set({ uid: uidFor(email), email, displayName: null, emailVerified: false });
  return { user: auth.currentUser! };
}

export async function signInWithPopup(auth: FakeAuth) {
  auth.set({ uid: "e2e-google", email: "google@test.local", displayName: "طالب تجريبي", emailVerified: true });
  return { user: auth.currentUser! };
}

export async function sendEmailVerification(): Promise<void> {}

export async function signOut(auth: FakeAuth): Promise<void> {
  auth.set(null);
}
