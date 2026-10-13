/**
 * Phone/browser notifications via Firebase Cloud Messaging.
 *
 * The page registers /push-sw.js, asks for permission, gets an FCM token
 * and stores it with the backend (users/{uid}/devices). The backend sends
 * reminders from the notification jobs: "محاضرة بعد ساعة",
 * "باقي لك غيابين", "اختبارك بعد 3 أيام".
 *
 * Needs NEXT_PUBLIC_FIREBASE_VAPID_KEY (Firebase console → Project settings
 * → Cloud Messaging → Web Push certificates). On iPhone, web push only
 * works after "Add to Home Screen" (iOS 16.4+).
 */

import { getMessaging, getToken, deleteToken, isSupported } from "firebase/messaging";
import { app } from "@/lib/firebase";
import { api } from "@/lib/api";

export const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";
const DEVICE_KEY = "uqu_push_device";
const SW_URL = "/push-sw.js";

export type PushState =
  | "unsupported" // browser has no web push (or iPhone outside the home-screen app)
  | "not-configured" // no VAPID key in this build
  | "denied" // the student blocked notifications in the browser
  | "off"
  | "on";

export interface NotificationPrefs {
  lectures: boolean;
  attendance: boolean;
  exams: boolean;
}

function storedDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (!VAPID_KEY) return "not-configured";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && storedDeviceId() ? "on" : "off";
}

/** Ask permission, register this device, return the new state. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "not-configured") return state;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  const res = (await api.post("/api/notifications/devices", { token, platform: "web" })) as { id: string };
  try {
    localStorage.setItem(DEVICE_KEY, res.id);
  } catch {
    /* private mode — the device stays registered server-side */
  }
  return "on";
}

/** Stop notifications on this device (also used on logout). */
export async function disablePush(): Promise<void> {
  const id = storedDeviceId();
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
  if (id) await api.delete(`/api/notifications/devices/${id}`).catch(() => undefined);
  if (await isSupported().catch(() => false)) await deleteToken(getMessaging(app)).catch(() => undefined);
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const res = (await api.get("/api/notifications/prefs")) as { prefs: NotificationPrefs };
  return res.prefs;
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const res = (await api.put("/api/notifications/prefs", prefs)) as { prefs: NotificationPrefs };
  return res.prefs;
}

export async function sendTestPush(): Promise<void> {
  await api.post("/api/notifications/test", {});
}

/** True on this device if notifications were turned on here. */
export function hasPushDevice(): boolean {
  return !!storedDeviceId();
}
