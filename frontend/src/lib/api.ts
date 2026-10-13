import { auth } from "./firebase";

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

/** fetch() that turns "could not connect" into an ApiError with status 0. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  }
}

async function getAuthToken() {
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
