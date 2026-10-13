/**
 * E2E stand-in for `firebase/firestore`: an in-memory document tree mirrored
 * to localStorage (`__e2e_firestore__`), so tests can seed it and read back
 * what the app wrote. Only the API surface the app uses is implemented.
 */

import { readJson, writeJson } from "./store";

const DB_KEY = "__e2e_firestore__";
type Data = Record<string, unknown>;

export type Firestore = { kind: "fake-firestore" };
const db: Firestore = { kind: "fake-firestore" };

function load(): Record<string, Data> {
  return typeof window === "undefined" ? {} : readJson<Record<string, Data>>(DB_KEY, {});
}
function save(all: Record<string, Data>) {
  writeJson(DB_KEY, all);
}

export function initializeFirestore(): Firestore {
  return db;
}
export function getFirestore(): Firestore {
  return db;
}

export interface DocumentReference {
  type: "document";
  path: string;
  id: string;
}
export interface CollectionReference {
  type: "collection";
  path: string;
}

export function doc(_db: Firestore | CollectionReference, ...segments: string[]): DocumentReference {
  const base = (_db as CollectionReference).type === "collection" ? [(_db as CollectionReference).path] : [];
  const path = [...base, ...segments].join("/");
  return { type: "document", path, id: path.split("/").pop()! };
}

export function collection(_db: Firestore, ...segments: string[]): CollectionReference {
  return { type: "collection", path: segments.join("/") };
}

function snapshot(ref: DocumentReference, data: Data | undefined) {
  return { id: ref.id, ref, exists: () => data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
}

export async function getDoc(ref: DocumentReference) {
  return snapshot(ref, load()[ref.path]);
}

export async function getDocs(col: CollectionReference) {
  const all = load();
  const prefix = col.path + "/";
  const docs = Object.keys(all)
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
    .map((p) => snapshot(doc(db, p), all[p]));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (d: (typeof docs)[number]) => void) => docs.forEach(fn) };
}

function clean(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

export async function setDoc(ref: DocumentReference, data: Data, options?: { merge?: boolean }) {
  const all = load();
  all[ref.path] = options?.merge ? { ...(all[ref.path] ?? {}), ...(clean(data) as Data) } : (clean(data) as Data);
  save(all);
}

export async function updateDoc(ref: DocumentReference, data: Data) {
  return setDoc(ref, data, { merge: true });
}

export async function deleteDoc(ref: DocumentReference) {
  const all = load();
  delete all[ref.path];
  save(all);
}

export function writeBatch() {
  const ops: (() => Promise<void>)[] = [];
  return {
    set: (ref: DocumentReference, data: Data, options?: { merge?: boolean }) => void ops.push(() => setDoc(ref, data, options)),
    update: (ref: DocumentReference, data: Data) => void ops.push(() => updateDoc(ref, data)),
    delete: (ref: DocumentReference) => void ops.push(() => deleteDoc(ref)),
    commit: async () => {
      for (const op of ops) await op();
    },
  };
}

export function serverTimestamp(): string {
  return new Date().toISOString();
}
