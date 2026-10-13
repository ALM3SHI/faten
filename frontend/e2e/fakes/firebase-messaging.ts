/** E2E stand-in for `firebase/messaging` — push is never available in tests. */

export function getMessaging(): Record<string, never> {
  return {};
}

export async function isSupported(): Promise<boolean> {
  return false;
}

export async function getToken(): Promise<string> {
  throw new Error("messaging/unsupported-browser");
}

export async function deleteToken(): Promise<boolean> {
  return true;
}

export function onMessage(): () => void {
  return () => {};
}
