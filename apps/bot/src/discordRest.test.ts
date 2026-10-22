import assert from "node:assert/strict";
import { test } from "node:test";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "fixture", DISCORD_CLIENT_ID: "100000000000000001", DISCORD_CLIENT_SECRET: "fixture", DISCORD_REDIRECT_URI: "http://localhost:5173/api/auth/discord/callback", BOT_OWNER_DISCORD_ID: "100000000000000002", SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "fixture", CORS_ORIGIN: "http://localhost:5173" });
const { createDiscordRest } = await import("./discordRest.js");
function fixture(responses: (Response | Error)[]) {
  let now = 0, calls = 0;
  const waits: number[] = [];
  const rest = createDiscordRest(async () => {
    const value = responses[calls++];
    if (value instanceof Error) throw value;
    assert.ok(value, "Unexpected extra Discord request"); return value;
  }, { now: () => now, sleep: async ms => { waits.push(ms); now += ms; }, jitter: () => 0 });
  return { rest, waits, calls: () => calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
test("429 respects the longest provider retry delay before retrying", async () => {
  const f = fixture([json({ retry_after: 0.2 }, 429, { "Retry-After": "0.5" }), json({ ok: true })]);
  assert.deepEqual(await f.rest.request("/guilds/100000000000000001"), { ok: true });
  assert.deepEqual(f.waits, [500]); assert.equal(f.calls(), 2);
});
test("Long 429 cooldown fails closed immediately, with Retry-After, and gates later requests", async () => {
  const f = fixture([json({ retry_after: 30 }, 429)]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 503 && e.retryAfter === 30);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 503);
  assert.equal(f.calls(), 1); assert.deepEqual(f.waits, []);
});
test("Global 429 cooldown applies across unrelated routes", async () => {
  const f = fixture([json({ retry_after: 30, global: true }, 429)]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"));
  await assert.rejects(f.rest.request("/channels/200000000000000001"));
  assert.equal(f.calls(), 1);
});
test("Remaining-zero response delays the next request without caching permission data", async () => {
  const f = fixture([json({ permission: true }, 200, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "0.1", "X-RateLimit-Bucket": "roles" }), json({ permission: false })]);
  assert.deepEqual(await f.rest.request("/guilds/100000000000000001/roles"), { permission: true });
  assert.deepEqual(await f.rest.request("/guilds/100000000000000001/roles"), { permission: false });
  assert.deepEqual(f.waits, [100]);
});
test("Transient 5xx and network errors retry with bounded backoff", async () => {
  const f = fixture([json({}, 503), new Error("network offline"), json({ ok: true })]);
  assert.deepEqual(await f.rest.request("/guilds/100000000000000001"), { ok: true });
  assert.deepEqual(f.waits, [250, 500]);
});
test("Repeated transient failures exhaust after three attempts", async () => {
  const f = fixture([json({}, 500), json({}, 502), json({}, 503)]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 503);
  assert.equal(f.calls(), 3);
});
test("Forbidden/missing membership is denied without retries", async () => {
  for (const status of [403, 404]) {
    const f = fixture([json({}, status)]);
    await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 403);
    assert.equal(f.calls(), 1); assert.deepEqual(f.waits, []);
  }
});
test("Expired request deadline sends no Discord request", async () => {
  const f = fixture([]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001", 0), (e: any) => e.status === 503);
  assert.equal(f.calls(), 0);
});
test("Malformed success payload never becomes a permission decision", async () => {
  const f = fixture([new Response("invalid-json")]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 503);
});
test("503 Retry-After is respected without an early retry", async () => {
  const f = fixture([json({}, 503, { "Retry-After": "30" })]);
  await assert.rejects(f.rest.request("/guilds/100000000000000001"), (e: any) => e.status === 503 && e.retryAfter === 30);
  assert.equal(f.calls(), 1); assert.deepEqual(f.waits, []);
});
test("Error response bodies are released before retrying or denying", async () => {
  const upstream = json({ error: "temporary" }, 503);
  const f = fixture([upstream, json({ ok: true })]);
  await f.rest.request("/guilds/100000000000000001");
  assert.equal(upstream.bodyUsed, true);
  const forbidden = json({ error: "forbidden" }, 403), denied = fixture([forbidden]);
  await assert.rejects(denied.rest.request("/guilds/100000000000000001"));
  assert.equal(forbidden.bodyUsed, true);
});
