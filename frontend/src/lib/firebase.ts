import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAVxQUiLmLQK7Hc_j97vMq2YLEgN1-PoTo",
  authDomain: "fatan-2648a.firebaseapp.com",
  projectId: "fatan-2648a",
  storageBucket: "fatan-2648a.firebasestorage.app",
  messagingSenderId: "270666822809",
  appId: "1:270666822809:web:fb2dc16f256ea942adf408",
  measurementId: "G-EE12XVF3PK"
};

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
// initializeFirestore lets us opt into ignoreUndefinedProperties so writes
// don't fail when an optional field (e.g. ScheduleSlot.room) is `undefined`.
// It throws on second call (Fast Refresh re-imports), so fall back to getFirestore.
let db: Firestore;
try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
} catch {
  db = getFirestore(app);
}
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, googleProvider };
