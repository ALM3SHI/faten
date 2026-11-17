import { firebaseRequested, hasSignedInHint, loadFirebase } from "@/lib/firebase/lazy";

export const AGENT_BASE_URL = process.env.NEXT_PUBLIC_AGENT_BASE_URL || "http://localhost:8000";

/** Error from the API (or the network) with an Arabic message for the student. */
export class ApiError extends Error {
  /** HTTP status; 0 when the server could not be reached at all. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const NETWORK_ERROR_MESSAGE = "تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.";

/** Arabic message from an error response body (`detail` is a string, or {message}). */
export function errorMessageFromBody(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  const nested = (detail as { message?: unknown } | null)?.message;
  if (typeof nested === "string" && nested.trim()) return nested;
  return `تعذّر إكمال الطلب (رمز الخطأ ${status}). حاول مرة أخرى بعد قليل.`;
}

export const TIMEOUT_MESSAGE = "الخادم تأخر في الرد. حاول مرة أخرى بعد لحظات.";

// The server sleeps when idle (Render free plan) and takes up to a minute to
// wake, so a request gets longer while it is waking.
const TIMEOUT_MS = 30_000;
const WAKING_TIMEOUT_MS = 75_000;
const RETRY_DELAYS_MS = [1_000, 3_000];
const RETRYABLE_STATUS = new Set([0, 502, 503, 504]);

// backend-status registers these (it imports this module, so not the reverse).
let isServerReady: () => boolean = () => true;
let onServerUnreachable: () => void = () => {};
export function connectBackendStatus(ready: () => boolean, unreachable: () => void): void {
  isServerReady = ready;
  onServerUnreachable = unreachable;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with a timeout (until the response headers arrive, so streamed
 * bodies are not cut), retries for idempotent requests when the server is
 * unreachable or restarting, and "could not connect" as an ApiError with
 * status 0. A caller's own abort is passed through untouched.
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const retries = method === "GET" || method === "HEAD" ? RETRY_DELAYS_MS.length : 0;

  for (let attempt = 0; ; attempt++) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), isServerReady() ? TIMEOUT_MS : WAKING_TIMEOUT_MS);
    // AbortSignal.any is missing before Safari 17.4: keep the caller's signal there.
    const signal = !init.signal
      ? timeout.signal
      : typeof AbortSignal.any === "function"
        ? AbortSignal.any([init.signal, timeout.signal])
        : init.signal;
    let failure: ApiError;
    try {
      const res = await fetch(url, { ...init, signal });
      if (!RETRYABLE_STATUS.has(res.status) || attempt >= retries) {
        if (RETRYABLE_STATUS.has(res.status)) onServerUnreachable();
        return res;
      }
      failure = new ApiError(errorMessageFromBody(null, res.status), res.status);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      failure = timeout.signal.aborted ? new ApiError(TIMEOUT_MESSAGE, 408) : new ApiError(NETWORK_ERROR_MESSAGE, 0);
    } finally {
      clearTimeout(timer);
    }
    onServerUnreachable();
    if (attempt >= retries) throw failure;
    await wait(RETRY_DELAYS_MS[attempt]);
  }
}

async function getAuthToken() {
  // Never load Firebase just to learn there is no user.
  if (!firebaseRequested() && !hasSignedInHint()) return null;
  const { auth } = await loadFirebase();
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
}

/** Like fetchWithAuth but returns the raw Response (for streaming bodies). */
export async function fetchRawWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return send(`${AGENT_BASE_URL}${path}`, { ...options, headers });
}

export async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await send(`${AGENT_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(errorMessageFromBody(errorData, response.status), response.status);
  }

  return response.json();
}

export const api = {
  get: (path: string, options?: RequestInit) => fetchWithAuth(path, { ...options, method: "GET" }),
  post: (path: string, body: unknown, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "POST", body: JSON.stringify(body) }),
  patch: (path: string, body: unknown, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "PATCH", body: JSON.stringify(body) }),
  put: (path: string, body: unknown, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "PUT", body: JSON.stringify(body) }),
  delete: (path: string, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "DELETE" }),
};
