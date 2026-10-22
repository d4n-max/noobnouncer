import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "./env.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export type Identity = { id: string; username: string; avatar: string | null };
export type Session = { token_hash: string; csrf_hash: string; discord_user_id: string; expires_at: string; revoked_at: string | null };
export type AuthContext = { user: Identity; session: Session; csrfToken: string };
export function context(res: Response): AuthContext { return res.locals.auth; }
export function cookie(req: Request, name: string) {
  return req.headers.cookie?.split(";").map(p => p.trim()).find(p => p.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
const userSchema = z.object({ id: z.string().regex(/^\d{17,20}$/), username: z.string(), avatar: z.string().nullable() });
const SESSION_MS = 24 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;

export function createAuth(db: SupabaseClient, fetcher: typeof fetch = fetch) {
  const secure = env.NODE_ENV === "production";
  const sessionName = secure ? "__Host-dashboard_session" : "dashboard_session";
  const stateName = secure ? "__Host-dashboard_oauth" : "dashboard_oauth";
  const opts = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  async function checked<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    const { data, error } = await query;
    if (error) throw new HttpError(503, "Authentication service unavailable");
    return data;
  }
  async function discordJson(url: string, init: RequestInit) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new HttpError(502, "Discord authentication failed. Please try again.");
    return response.json();
  }
  // The CSRF secret is derived from the opaque session token, never from its database hash.
  const csrfFor = (token: string) => hashToken(`csrf:${token}`);
  const requireSession: RequestHandler = async (req, res, next) => {
    try {
      const token = cookie(req, sessionName);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, "Unauthorized");
      const session = await checked(db.from("dashboard_sessions").select("*").eq("token_hash", hashToken(token)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle());
      if (!session) throw new HttpError(401, "Unauthorized");
      const user = await checked(db.from("dashboard_users").select("id,username,avatar").eq("id", session.discord_user_id).maybeSingle());
      if (!user) throw new HttpError(401, "Unauthorized");
      res.locals.auth = { user, session, csrfToken: csrfFor(token) } satisfies AuthContext;
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const supplied = req.get("X-CSRF-Token") ?? "";
        if (req.get("Origin") !== env.CORS_ORIGIN || !equal(hashToken(supplied), session.csrf_hash)) throw new HttpError(403, "Invalid CSRF token or origin");
      }
      next();
    } catch (error) { next(error); }
  };
  const start: RequestHandler = async (_req, res, next) => {
    try {
      const state = randomToken(), binding = randomToken(), verifier = randomToken();
      // Opportunistic bounded-lifetime cleanup; no active session/state is removed.
      await checked(db.from("dashboard_oauth_states").delete().lt("expires_at", new Date().toISOString()));
      await checked(db.from("dashboard_sessions").delete().lt("expires_at", new Date().toISOString()));
      await checked(db.from("dashboard_oauth_states").insert({ state_hash: hashToken(state), binding_hash: hashToken(binding), verifier, expires_at: new Date(Date.now() + STATE_MS).toISOString() }));
      res.cookie(stateName, binding, { ...opts, maxAge: STATE_MS });
      const url = new URL("https://discord.com/oauth2/authorize");
      url.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: env.DISCORD_REDIRECT_URI, response_type: "code", scope: "identify guilds", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
      res.redirect(url.toString());
    } catch (error) { next(error); }
  };
  const callback: RequestHandler = async (req, res) => {
    res.clearCookie(stateName, opts);
    let accessToken: string | undefined;
    try {
      const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.state);
      const binding = cookie(req, stateName);
      if (!/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new Error("Invalid state");
      // DELETE RETURNING is atomic: a state can be consumed once across all replicas.
      const pending = await checked(db.from("dashboard_oauth_states").delete().eq("state_hash", hashToken(state)).eq("binding_hash", hashToken(binding)).gt("expires_at", new Date().toISOString()).select("verifier").maybeSingle());
      if (!pending || req.query.error || (req.query.iss !== undefined && req.query.iss !== "https://discord.com")) throw new Error("Invalid callback");
      const code = z.string().min(1).max(2048).parse(req.query.code);
      const tokens = z.object({ access_token: z.string().min(1), token_type: z.string().refine(v => v.toLowerCase() === "bearer"), scope: z.string() }).parse(await discordJson("https://discord.com/api/oauth2/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: env.DISCORD_REDIRECT_URI, code_verifier: pending.verifier })
      }));
      accessToken = tokens.access_token;
      if (!["identify", "guilds"].every(scope => tokens.scope.split(" ").includes(scope))) throw new Error("Missing scopes");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const user = userSchema.parse(await discordJson("https://discord.com/api/v10/users/@me", { headers }));
      // Exercise the granted guilds scope; authorization later uses fresh bot REST data.
      z.array(z.object({ id: z.string() })).parse(await discordJson("https://discord.com/api/v10/users/@me/guilds", { headers }));
      await checked(db.from("dashboard_users").upsert({ ...user, updated_at: new Date().toISOString() }));
      const token = randomToken();
      // Rotate any previous browser session on login.
      const previous = cookie(req, sessionName);
      if (previous) await checked(db.from("dashboard_sessions").delete().eq("token_hash", hashToken(previous)));
      await checked(db.from("dashboard_sessions").insert({ token_hash: hashToken(token), csrf_hash: hashToken(csrfFor(token)), discord_user_id: user.id, expires_at: new Date(Date.now() + SESSION_MS).toISOString() }));
      res.cookie(sessionName, token, { ...opts, maxAge: SESSION_MS });
      res.redirect(`${env.CORS_ORIGIN}/`);
    } catch {
      // No callback input or upstream error is logged or reflected.
      res.redirect(`${env.CORS_ORIGIN}/?auth_error=oauth_failed`);
    } finally {
      if (accessToken) {
        // No OAuth tokens persist. Best-effort revocation after identity discovery.
        try { await fetcher("https://discord.com/api/oauth2/token/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, token: accessToken }), signal: AbortSignal.timeout(5000) }); } catch { /* Token remains only in this request until collection. */ }
      }
    }
  };
  const logout: RequestHandler = async (_req, res, next) => {
    try {
      await checked(db.from("dashboard_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", context(res).session.token_hash));
      res.clearCookie(sessionName, opts);
      res.status(204).end();
    } catch (error) { next(error); }
  };
  return { requireSession, start, callback, logout };
}
