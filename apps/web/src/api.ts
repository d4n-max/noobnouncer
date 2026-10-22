const API_URL = import.meta.env.VITE_API_URL ?? "/api";
let csrfToken = "";
export type SessionInfo = { user: { id: string; username: string; avatar_url: string | null }; csrfToken: string; isBotOwner: boolean };
// Discard credentials left by the obsolete password login. Preferences remain local.
localStorage.removeItem("scheduler_token");
sessionStorage.removeItem("scheduler_token");
export const discordLoginUrl = `${API_URL}/auth/discord`;
export function clearSession() { csrfToken = ""; }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes((options.method ?? "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      clearSession();
      window.dispatchEvent(new CustomEvent("scheduler:auth-expired"));
    }
    if (response.status === 403) window.dispatchEvent(new CustomEvent("scheduler:access-denied"));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function validateSession() {
  const session = await api<SessionInfo>("/auth/me");
  csrfToken = session.csrfToken;
  return session;
}
