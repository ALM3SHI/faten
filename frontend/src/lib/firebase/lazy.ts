/**
 * Firebase is ~185 KB gzipped. It is loaded on demand instead of with the
 * first paint: protected pages and /login start it right away, public pages
 * only when this browser has signed in before (so a returning student on the
 * landing page is still recognised). Every caller shares one import.
 */

type FirebaseModule = typeof import("@/lib/firebase");

let firebase: Promise<FirebaseModule> | null = null;
let loaded = false;

export function loadFirebase(): Promise<FirebaseModule> {
  firebase ??= import("@/lib/firebase").then((m) => {
    loaded = true;
    return m;
  });
  return firebase;
}

/** True once the Firebase module has been requested. */
export function firebaseRequested(): boolean {
  return firebase !== null || loaded;
}

export function loadSync() {
  return import("@/lib/firebase/sync");
}

// "Signed in on this browser before": a hint, not a credential. Firebase
// still decides who the user is; this only decides whether to ask it on a
// public page.
const HINT = "faten_signed_in";

export function hasSignedInHint(): boolean {
  try {
    return window.localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
}

export function setSignedInHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(HINT, "1");
    else window.localStorage.removeItem(HINT);
  } catch {
    /* storage blocked: public pages just won't recognise the user */
  }
}

/**
 * Has Firebase itself saved a session on this browser? Covers students who
 * signed in before the hint existed. Reads Firebase's own storage directly
 * (IndexedDB, or its localStorage fallback) without loading the SDK, and
 * never creates the database when it is absent.
 */
export async function hasSavedFirebaseSession(): Promise<boolean> {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      if (window.localStorage.key(i)?.startsWith("firebase:authUser:")) return true;
    }
  } catch {
    /* storage blocked */
  }
  if (typeof indexedDB === "undefined") return false;
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open("firebaseLocalStorageDb");
    } catch {
      return resolve(false);
    }
    req.onupgradeneeded = () => {
      // It did not exist: undo the creation and answer "no".
      req.transaction?.abort();
      resolve(false);
    };
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains("firebaseLocalStorage")) return resolve(false);
        const count = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").count();
        count.onsuccess = () => resolve(count.result > 0);
        count.onerror = () => resolve(false);
      } catch {
        resolve(false);
      } finally {
        db.close();
      }
    };
  });
}
