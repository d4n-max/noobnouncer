import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fake values override local configuration before importing the API; no live I/O.
Object.assign(process.env, {
  NODE_ENV: "test", DISCORD_TOKEN: "test-bot", DISCORD_CLIENT_ID: "100000000000000001",
  DISCORD_CLIENT_SECRET: "test-secret", DISCORD_REDIRECT_URI: "http://localhost:3001/api/auth/discord/callback",
  BOT_OWNER_DISCORD_ID: "100000000000000002", SUPABASE_URL: "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role", CORS_ORIGIN: "http://localhost:5173"
});
const { createApi } = await import("./api.js");
const { hashToken } = await import("./auth.js");
const { env, envSchema } = await import("./env.js");
const A = "200000000000000001", B = "200000000000000002";
const CA = "300000000000000001", CB = "300000000000000002";
const ADMIN = "400000000000000001", EDITOR = "400000000000000002", STRANGER = "400000000000000003";
type Row = Record<string, any>;

// A small in-memory PostgREST double executes the actual filters and mutations.
class Database {
  tables: Record<string, Row[]> = { dashboard_users: [], dashboard_sessions: [], dashboard_oauth_states: [], dashboard_access: [], announcements: [], allowed_users: [] };
  failTable = "";
  from(table: string) {
    let mode = "select", values: Row = {}, single = false, conflict = "id";
    const filters: ((r: Row) => boolean)[] = [];
    const query: any = {
      select: () => query, order: () => query,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return query; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return query; },
      gt: (k: string, v: string) => { filters.push(r => r[k] > v); return query; },
      lt: (k: string, v: string) => { filters.push(r => r[k] < v); return query; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return query; },
      insert: (v: Row) => { mode = "insert"; values = v; return query; },
      upsert: (v: Row, opts?: { onConflict?: string }) => { mode = "upsert"; values = v; conflict = opts?.onConflict ?? "id"; return query; },
      update: (v: Row) => { mode = "update"; values = v; return query; },
      delete: () => { mode = "delete"; return query; },
      single: () => { single = true; return query; }, maybeSingle: () => { single = true; return query; },
      then: (resolve: (value: any) => void, reject: (e: unknown) => void) => {
        try {
          if (this.failTable === table) return resolve({ data: null, error: new Error("test database failure") });
          const rows = this.tables[table] ??= [];
          let selected = rows.filter(r => filters.every(f => f(r)));
          if (mode === "insert" || mode === "upsert") {
            const found = mode === "upsert" ? rows.find(r => conflict.split(",").every(k => r[k] === values[k])) : undefined;
            const row = found ?? { id: randomUUID(), created_at: new Date().toISOString(), revoked_at: null };
            Object.assign(row, values);
            if (!found) rows.push(row);
            selected = [row];
          }
          if (mode === "update") for (const row of selected) Object.assign(row, values);
          if (mode === "delete") this.tables[table] = rows.filter(r => !selected.includes(r));
          resolve({ data: structuredClone(single ? selected[0] ?? null : selected), error: null });
        } catch (error) { reject(error); }
      }
    };
    return query;
  }
}
function announcement(guild: string, channel: string): Row {
  return { id: randomUUID(), guild_id: guild, channel_id: channel, title: "Test", message: "Hello", scheduled_at: "2099-01-01T10:00:00.000Z", timezone: "UTC", repeat_type: "none", status: "scheduled" };
}
async function fixture() {
  const db = new Database();
  db.tables.announcements.push(announcement(A, CA), announcement(B, CB));
  db.tables.allowed_users.push({ id: randomUUID(), guild_id: A, discord_user_id: EDITOR });
  db.tables.dashboard_access.push({ id: randomUUID(), guild_id: A, discord_user_id: EDITOR, role: "EDITOR" });
  const flags = { admin: true, member: true, offline: false, exchangeError: false, unavailableGuildB: false };
  let identity = EDITOR;
  const exchanges: URLSearchParams[] = [];
  const requests: string[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/oauth2/token") {
      exchanges.push(new URLSearchParams(init?.body as URLSearchParams));
      return flags.exchangeError ? json({}, 500) : json({ access_token: "private-token", token_type: "Bearer", scope: "identify guilds" });
    }
    if (url.pathname === "/api/oauth2/token/revoke") return json({});
    if (url.pathname === "/api/v10/users/@me") return json({ id: identity, username: "example", avatar: null });
    if (url.pathname === "/api/v10/users/@me/guilds") return json([{ id: A, name: "A", icon: null }, { id: B, name: "B", icon: null }]);
    if (flags.offline) return json({}, 503);
    const guild = url.pathname.includes(A) ? A : B;
    if (guild === B && flags.unavailableGuildB) return json({}, 503);
    if (/\/members\//.test(url.pathname)) {
      const id = url.pathname.split("/").at(-1)!;
      if (!flags.member || (guild === B && id !== env.BOT_OWNER_DISCORD_ID)) return json({}, 404);
      return json({ user: { id, username: "member", avatar: null }, roles: id === ADMIN && flags.admin ? ["admin-role"] : [] });
    }
    if (url.pathname.endsWith("/roles")) return json([{ id: guild, permissions: "0" }, { id: "admin-role", permissions: "32" }]);
    if (url.pathname.includes("/channels/")) return json({ guild_id: url.pathname.endsWith(CA) ? A : B, type: 0 });
    if (url.pathname.includes("/guilds/")) return json({ id: guild, owner_id: "999999999999999999", name: guild, icon: null });
    throw new Error("Unexpected mock route");
  };
  const app = createApi({ db: db as unknown as SupabaseClient, fetcher: mockFetch, maintenance: false, sync: (async (id: string) => ({ id })) as any });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, opts: RequestInit = {}) => fetch(base + path, { ...opts, redirect: "manual" });
  async function start() {
    const response = await request("/api/auth/discord?next=https://evil.example");
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get("location")!);
    return { url, cookie: response.headers.getSetCookie()[0].split(";")[0] };
  }
  async function login(id = EDITOR) {
    identity = id;
    const pending = await start();
    const response = await request(`/api/auth/discord/callback?state=${pending.url.searchParams.get("state")}&code=valid&iss=https%3A%2F%2Fdiscord.com`, { headers: { Cookie: pending.cookie } });
    assert.equal(response.headers.get("location"), env.CORS_ORIGIN + "/");
    const sessionCookie = response.headers.getSetCookie().find(c => /^(?:__Host-)?dashboard_session=/.test(c))!.split(";")[0];
    const me = await request("/api/auth/me", { headers: { Cookie: sessionCookie } });
    const body = await me.json() as { csrfToken: string };
    return { cookie: sessionCookie, csrf: body.csrfToken, pending, response };
  }
  const call = (path: string, session: { cookie: string; csrf: string }, method = "GET", body?: object) => request(path, { method, headers: { Cookie: session.cookie, Origin: env.CORS_ORIGIN, "X-CSRF-Token": session.csrf, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const close = () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  return { db, flags, exchanges, requests, request, start, login, call, close };
}
async function check(name: string, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  await test(name, async () => { const f = await fixture(); try { await run(f); } finally { await f.close(); } });
}

await check("OAuth login uses S256 PKCE, hashed opaque sessions and private cookies", async f => {
  const s = await f.login();
  assert.equal(s.pending.url.searchParams.get("scope"), "identify guilds");
  assert.equal(s.pending.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(createHash("sha256").update(f.exchanges[0].get("code_verifier")!).digest("base64url"), s.pending.url.searchParams.get("code_challenge"));
  assert.match(s.response.headers.getSetCookie().join(";"), /HttpOnly/);
  assert.match(s.response.headers.getSetCookie().join(";"), /SameSite=Lax/);
  const token = s.cookie.split("=")[1];
  assert.equal(f.db.tables.dashboard_sessions[0].token_hash, hashToken(token));
  assert.ok(!JSON.stringify(f.db.tables).includes(token));
  assert.ok(!JSON.stringify(f.db.tables).includes("private-token"));
});
await check("Invalid, expired, browser-mismatched and replayed OAuth state are rejected", async f => {
  const p = await f.start();
  const path = `/api/auth/discord/callback?state=${p.url.searchParams.get("state")}&code=valid`;
  const bad = await f.request(path, { headers: { Cookie: "dashboard_oauth=invalid" } });
  assert.match(bad.headers.get("location")!, /auth_error/);
  f.db.tables.dashboard_oauth_states[0].expires_at = "2000-01-01T00:00:00.000Z";
  assert.match((await f.request(path, { headers: { Cookie: p.cookie } })).headers.get("location")!, /auth_error/);
  const s = await f.login();
  const replay = await f.request(`/api/auth/discord/callback?state=${s.pending.url.searchParams.get("state")}&code=valid`, { headers: { Cookie: s.pending.cookie } });
  assert.match(replay.headers.get("location")!, /auth_error/);
  assert.equal(f.exchanges.length, 1);
});
await check("OAuth denial, provider errors and invalid issuer fail without creating a session", async f => {
  for (const suffix of ["&error=access_denied", "&code=x&iss=https://evil.example", "&code=x"]) {
    const p = await f.start(); f.flags.exchangeError = true;
    const response = await f.request(`/api/auth/discord/callback?state=${p.url.searchParams.get("state")}${suffix}`, { headers: { Cookie: p.cookie } });
    assert.equal(response.headers.get("location"), env.CORS_ORIGIN + "/?auth_error=oauth_failed");
    assert.equal(f.db.tables.dashboard_sessions.length, 0);
  }
});
await check("Missing, forged and expired sessions return 401; bearer JWTs are ignored", async f => {
  assert.equal((await f.request("/api/announcements")).status, 401);
  assert.equal((await f.request("/api/auth/me", { headers: { Authorization: "Bearer obsolete" } })).status, 401);
  const s = await f.login(); f.db.tables.dashboard_sessions[0].expires_at = "2000-01-01T00:00:00Z";
  assert.equal((await f.call("/api/auth/me", s)).status, 401);
});
await check("Logout revokes the database session and rejects cookie reuse", async f => {
  const s = await f.login(); assert.equal((await f.call("/api/auth/logout", s, "POST")).status, 204);
  assert.ok(f.db.tables.dashboard_sessions[0].revoked_at);
  assert.equal((await f.call("/api/auth/me", s)).status, 401);
});
await check("Owner has all installed guilds and global settings", async f => {
  const s = await f.login(env.BOT_OWNER_DISCORD_ID);
  assert.equal((await (await f.call("/api/guilds", s)).json()).length, 2);
  assert.equal((await f.call("/api/settings", s)).status, 200);
  assert.equal((await (await f.call("/api/announcements", s)).json()).length, 2);
});
await check("Server admin manages announcements, dashboard editors and allowed users", async f => {
  const s = await f.login(ADMIN);
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s)).status, 200);
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s, "POST", { discord_user_id: STRANGER })).status, 201);
  assert.equal((await f.call(`/api/allowed-users?guild_id=${A}`, s)).status, 200);
  assert.equal((await f.call("/api/announcements", s, "POST", announcement(A, CA))).status, 201);
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access/${STRANGER}`, s, "DELETE")).status, 204);
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s, "POST", { discord_user_id: STRANGER, role: "BOT_OWNER" })).status, 400);
});
await check("Editor can create, edit, disable and delete assigned announcements", async f => {
  const s = await f.login();
  assert.equal((await f.call("/api/announcements", s, "POST", announcement(A, CA))).status, 201);
  const id = f.db.tables.announcements[0].id;
  assert.equal((await f.call(`/api/announcements/${id}`, s, "PUT", { title: "Changed", status: "disabled" })).status, 200);
  assert.equal(f.db.tables.announcements[0].status, "disabled");
  assert.equal((await f.call(`/api/announcements/${id}`, s, "DELETE")).status, 204);
});
await check("Editor cannot manage dashboard access, allowed users or global settings", async f => {
  const s = await f.login();
  for (const path of [`/api/guilds/${A}/dashboard-access`, `/api/allowed-users?guild_id=${A}`, "/api/settings"]) assert.equal((await f.call(path, s)).status, 403);
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s, "POST", { discord_user_id: STRANGER })).status, 403);
  assert.equal((await f.call(`/api/allowed-users/${f.db.tables.allowed_users[0].id}`, s, "DELETE")).status, 403);
});
await check("Unauthorized identity receives empty lists and no guild resource data", async f => {
  const s = await f.login(STRANGER);
  assert.deepEqual(await (await f.call("/api/guilds", s)).json(), []);
  assert.deepEqual(await (await f.call("/api/announcements", s)).json(), []);
  assert.equal((await f.call(`/api/announcements?guild_id=${A}`, s)).status, 403);
});
await check("Guild A identity cannot read or modify Guild B through any resource path", async f => {
  const s = await f.login();
  const list = await (await f.call("/api/announcements", s)).json();
  assert.equal(list.length, 1); assert.equal(list[0].guild_id, A);
  for (const path of ["channels", "roles", "members/search?q=x", "users?search=x", "dashboard-access"]) assert.equal((await f.call(`/api/guilds/${B}/${path}`, s)).status, 403);
  assert.equal((await f.call(`/api/announcements?guild_id=${B}`, s)).status, 403);
  const id = f.db.tables.announcements[1].id;
  assert.equal((await f.call(`/api/announcements/${id}`, s, "PUT", { title: "Stolen" })).status, 403);
  assert.equal((await f.call(`/api/announcements/${id}`, s, "DELETE")).status, 403);
  assert.equal((await f.call("/api/announcements", s, "POST", announcement(B, CB))).status, 403);
  assert.equal(f.db.tables.announcements[1].title, "Test");
});
await check("Announcement guild reassignment and cross-guild channels are rejected", async f => {
  const s = await f.login(), id = f.db.tables.announcements[0].id;
  assert.equal((await f.call(`/api/announcements/${id}`, s, "PUT", { guild_id: B })).status, 403);
  assert.equal((await f.call(`/api/announcements/${id}`, s, "PUT", { channel_id: CB })).status, 403);
  assert.equal((await f.call("/api/announcements", s, "POST", announcement(A, CB))).status, 403);
  assert.equal(f.db.tables.announcements[0].channel_id, CA);
});
await check("Editor revocation and guild membership removal apply to the next request", async f => {
  const s = await f.login();
  f.db.tables.dashboard_access = [];
  assert.equal((await f.call(`/api/announcements?guild_id=${A}`, s)).status, 403);
  f.db.tables.dashboard_access.push({ guild_id: A, discord_user_id: EDITOR, role: "EDITOR" });
  f.flags.member = false;
  assert.equal((await f.call(`/api/announcements?guild_id=${A}`, s)).status, 403);
});
await check("Discord administrator revocation and unverifiable permissions fail closed", async f => {
  const s = await f.login(ADMIN);
  assert.equal((await f.call(`/api/announcements?guild_id=${A}`, s)).status, 200);
  f.flags.admin = false;
  assert.equal((await f.call(`/api/announcements?guild_id=${A}`, s)).status, 403);
  f.flags.admin = true; f.flags.offline = true;
  const unavailable = await f.call(`/api/guilds/${A}/dashboard-access`, s);
  assert.equal(unavailable.status, 503);
  assert.ok(Number(unavailable.headers.get("Retry-After")) >= 1);
});
await check("CSRF rejects missing/invalid tokens and foreign origins, including logout", async f => {
  const s = await f.login();
  const attempts: Record<string, string>[] = [{ Cookie: s.cookie }, { Cookie: s.cookie, Origin: env.CORS_ORIGIN, "X-CSRF-Token": "wrong" }, { Cookie: s.cookie, Origin: "https://evil.example", "X-CSRF-Token": s.csrf }];
  for (const headers of attempts) {
    assert.equal((await f.request("/api/auth/logout", { method: "POST", headers })).status, 403);
    assert.equal((await f.request("/api/guilds/refresh", { method: "POST", headers })).status, 403);
  }
  assert.equal((await f.call("/api/auth/me", s)).status, 200);
});
await check("Database failures fail closed without disclosing internals", async f => {
  const s = await f.login(); f.db.failTable = "dashboard_sessions";
  const response = await f.call("/api/announcements", s);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("test database"));
});
await test("Production requires same-origin HTTPS; development is loopback HTTP", () => {
  const config = { ...env, NODE_ENV: "production", CORS_ORIGIN: "https://scheduler.example", DISCORD_REDIRECT_URI: "https://scheduler.example/api/auth/discord/callback" };
  assert.equal(envSchema.safeParse(config).success, true);
  assert.equal(envSchema.safeParse({ ...config, CORS_ORIGIN: "http://scheduler.example" }).success, false);
  assert.equal(envSchema.safeParse({ ...config, DISCORD_REDIRECT_URI: "https://evil.example/api/auth/discord/callback" }).success, false);
});

await test("Production issues host-only Secure HttpOnly session and OAuth cookies", async () => {
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  const f = await fixture();
  try {
    const s = await f.login();
    assert.match(s.cookie, /^__Host-dashboard_session=/);
    assert.match(s.pending.cookie, /^__Host-dashboard_oauth=/);
    for (const header of s.response.headers.getSetCookie()) {
      assert.match(header, /Secure/);
      assert.match(header, /HttpOnly/);
      assert.match(header, /Path=\//);
      assert.ok(!header.includes("Domain="));
    }
  } finally { await f.close(); env.NODE_ENV = previous; }
});

await check("A changed state with the correct browser cookie never reaches Discord", async f => {
  const pending = await f.start();
  const response = await f.request("/api/auth/discord/callback?state=" + "a".repeat(43) + "&code=valid", { headers: { Cookie: pending.cookie } });
  assert.match(response.headers.get("location")!, /auth_error/);
  assert.equal(f.exchanges.length, 0);
});

await check("Concurrent callback replay permits only one code exchange", async f => {
  const pending = await f.start();
  const path = `/api/auth/discord/callback?state=${pending.url.searchParams.get("state")}&code=valid`;
  const responses = await Promise.all([f.request(path, { headers: { Cookie: pending.cookie } }), f.request(path, { headers: { Cookie: pending.cookie } })]);
  assert.equal(responses.filter(r => r.headers.get("location") === env.CORS_ORIGIN + "/").length, 1);
  assert.equal(f.exchanges.length, 1);
  assert.equal(f.db.tables.dashboard_sessions.length, 1);
});
await check("Authenticated API traffic has a per-user rate limit", async f => {
  const s = await f.login();
  for (let i = 0; i < 119; i++) assert.equal((await f.call("/api/auth/me", s)).status, 200);
  assert.equal((await f.call("/api/auth/me", s)).status, 429);
});
await check("Owner discovery uses the fresh bot guild list without fetching every guild", async f => {
  const s = await f.login(env.BOT_OWNER_DISCORD_ID); f.requests.length = 0;
  const response = await f.call("/api/guilds", s);
  assert.equal(response.status, 200); assert.equal((await response.json()).length, 2);
  assert.deepEqual(f.requests, ["/api/v10/users/@me/guilds"]);
});
await check("Management middleware shares decisions within one request and refreshes next request", async f => {
  const s = await f.login(ADMIN); f.requests.length = 0;
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s)).status, 200);
  assert.equal(f.requests.length, 3, "Guild, membership and roles should each be fetched once");
  f.flags.admin = false; f.requests.length = 0;
  assert.equal((await f.call(`/api/guilds/${A}/dashboard-access`, s)).status, 403);
  assert.equal(f.requests.length, 3, "The next request must revalidate revoked permissions");
});
await check("Partial guild outage excludes unverifiable servers and marks discovery incomplete", async f => {
  const s = await f.login(ADMIN); f.flags.unavailableGuildB = true;
  const response = await f.call("/api/guilds", s);
  assert.equal(response.status, 200); assert.equal(response.headers.get("X-Guild-Discovery-Partial"), "true");
  assert.deepEqual((await response.json()).map((g: any) => g.id), [A]);
  assert.equal((await f.call(`/api/announcements?guild_id=${B}`, s)).status, 503);
});
await check("A total discovery outage returns a retryable error, not an empty authorized list", async f => {
  const s = await f.login(ADMIN); f.flags.offline = true;
  const response = await f.call("/api/guilds", s);
  assert.equal(response.status, 503); assert.ok(response.headers.get("Retry-After"));
});
await check("Retained legacy rollback credentials do not reactivate password authentication", async f => {
  const parsed = envSchema.parse({ ...env, ADMIN_PASSWORD: "rollback-only-fixture", JWT_SECRET: "rollback-only-fixture-secret" });
  assert.ok(!("ADMIN_PASSWORD" in parsed)); assert.ok(!("JWT_SECRET" in parsed));
  assert.equal((await f.request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "rollback-only-fixture" }) })).status, 401);
  const session = await f.login();
  assert.equal((await f.call("/api/auth/login", session, "POST", { password: "rollback-only-fixture" })).status, 404);
});
