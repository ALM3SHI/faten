/**
 * The original lecture PDFs, kept on this device (IndexedDB) so the tutor can
 * show the actual slide behind an explanation. Keyed by the file's SHA-256 —
 * the same id the server uses — so a file attached on another device is
 * matched to its lecture. Nothing here leaves the device; logout clears it.
 *
 * Every call is best-effort: private windows or blocked storage just mean
 * "no local copy", never an error the student sees.
 */

const DB_NAME = "faten_lectures";
const STORE = "files";
const MAX_FILES = 12;

interface Row {
  hash: string;
  name: string;
  savedAt: number;
  data: Blob;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "hash" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export async function saveLectureFile(hash: string, file: Blob, name: string): Promise<void> {
  await run("readwrite", (s) => s.put({ hash, name, savedAt: Date.now(), data: file } satisfies Row));
  // Keep the newest MAX_FILES only.
  const keys = ((await run("readonly", (s) => s.getAll())) as Row[] | null) ?? [];
  if (keys.length > MAX_FILES) {
    const old = [...keys].sort((a, b) => a.savedAt - b.savedAt).slice(0, keys.length - MAX_FILES);
    for (const r of old) await run("readwrite", (s) => s.delete(r.hash));
  }
}

export async function getLectureFile(hash: string): Promise<Blob | null> {
  const row = (await run("readonly", (s) => s.get(hash))) as Row | null;
  return row?.data ?? null;
}

export async function removeLectureFile(hash: string): Promise<void> {
  await run("readwrite", (s) => s.delete(hash));
}

/** Logout: drop every stored lecture file. */
export function clearLectureFiles(): void {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(DB_NAME);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
