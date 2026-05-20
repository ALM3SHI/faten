import { auth } from "./firebase";

const AGENT_BASE_URL = process.env.NEXT_PUBLIC_AGENT_BASE_URL || "http://localhost:8000";

async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
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

  const response = await fetch(`${AGENT_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: (path: string, options?: RequestInit) => fetchWithAuth(path, { ...options, method: "GET" }),
  post: (path: string, body: any, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "POST", body: JSON.stringify(body) }),
  patch: (path: string, body: unknown, options?: RequestInit) =>
    fetchWithAuth(path, { ...options, method: "PATCH", body: JSON.stringify(body) }),
};
