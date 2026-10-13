/**
 * Route helpers shared by the navbar, bottom nav and the auth guard.
 *
 * The site is exported with `trailingSlash: true`, so the browser path is
 * "/chat/" while links are written as "/chat" — always compare through
 * normalizePath().
 */

export function normalizePath(path: string | null | undefined): string {
  if (!path) return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Pages that show personal data and need a signed-in user. */
const PROTECTED = ["/dashboard", "/chat", "/gpa", "/plan", "/profile", "/schedule", "/transcript", "/community", "/attendance", "/study", "/exams"];

export function isProtectedPath(path: string | null | undefined): boolean {
  const p = normalizePath(path);
  return PROTECTED.some((r) => p === r || p.startsWith(r + "/"));
}

export function isActivePath(current: string | null | undefined, href: string): boolean {
  const p = normalizePath(current);
  const h = normalizePath(href);
  return h === "/" ? p === "/" : p === h || p.startsWith(h + "/");
}

/** Where to send the user after signing in (only same-site paths). */
export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
