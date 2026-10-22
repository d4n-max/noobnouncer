import assert from "node:assert/strict";
import { test } from "node:test";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "fixture", DISCORD_CLIENT_ID: "100000000000000001", DISCORD_CLIENT_SECRET: "fixture", DISCORD_REDIRECT_URI: "http://localhost:5173/api/auth/discord/callback", BOT_OWNER_DISCORD_ID: "100000000000000002", SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "fixture", CORS_ORIGIN: "http://localhost:5173" });
const { runSchedulerOnce, runDeleteWorkerOnce } = await import("./scheduler.js");
const { supabase } = await import("./supabase.js");
const { client } = await import("./discord.js");
const { nextRecurringScheduledAt, normalizeAnnouncementSchedule } = await import("./announcementRules.js");

test("Scheduler sends and logs independently of sessions, respects locks, advances recurrence and deletes posted messages", async () => {
  const due = new Date(Date.now() - 60_000).toISOString();
  const rows: Record<string, any>[] = [
    { id: "one", guild_id: "guild", channel_id: "channel", title: "one", message: "Hello <@400000000000000001>", gif_url: "https://example.com/test.gif", scheduled_at: due, timezone: "UTC", repeat_type: "none", status: "scheduled", locked_until: null },
    { id: "recurring", guild_id: "guild", channel_id: "channel", title: "recurring", message: "Daily", gif_url: null, scheduled_at: due, timezone: "UTC", repeat_type: "daily", status: "scheduled", locked_until: null },
    { id: "locked", guild_id: "guild", channel_id: "channel", title: "locked", message: "Locked", gif_url: null, scheduled_at: due, timezone: "UTC", repeat_type: "none", status: "scheduled", locked_until: new Date(Date.now() + 60_000).toISOString() }
  ];
  const logs: Record<string, any>[] = [], sends: any[] = [], deletes: string[] = [];
  const originalFrom = supabase.from;
  const originalFetch = client.channels.fetch;
  (supabase as any).from = (table: string) => {
    assert.ok(table === "announcements" || table === "delivery_logs", "Workers must not depend on dashboard sessions");
    const source = table === "announcements" ? rows : logs;
    const filters: ((r: any) => boolean)[] = [];
    let update: Record<string, any> | null = null, insert: Record<string, any> | null = null, single = false;
    const q: any = {
      select: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return q; },
      lte: (key: string, value: string) => { filters.push(r => r[key] <= value); return q; },
      not: (key: string, _operator: string, value: unknown) => { filters.push(r => r[key] !== value); return q; },
      or: (value: string) => { const cutoff = value.split("locked_until.lt.")[1]; filters.push(r => !r.locked_until || r.locked_until < cutoff); return q; },
      update: (value: Record<string, any>) => { update = value; return q; },
      insert: (value: Record<string, any>) => { insert = value; return q; },
      maybeSingle: () => { single = true; return q; },
      then: (resolve: (v: any) => void) => {
        if (insert) source.push({ id: "log-" + logs.length, ...insert });
        const matched = source.filter(r => filters.every(f => f(r)));
        if (update) for (const row of matched) Object.assign(row, update);
        resolve({ data: structuredClone(single ? matched[0] ?? null : matched), error: null });
      }
    };
    return q;
  };
  (client.channels as any).fetch = async () => ({
    isTextBased: () => true,
    send: async (payload: any) => { sends.push(payload); return { id: "message-" + sends.length }; },
    messages: { fetch: async (id: string) => ({ delete: async () => { deletes.push(id); } }) }
  });
  try {
    await runSchedulerOnce();
    assert.equal(sends.length, 2); assert.equal(logs.length, 2);
    assert.equal(rows[0].status, "sent"); assert.equal(rows[1].status, "scheduled");
    assert.ok(Date.parse(rows[1].scheduled_at) > Date.now());
    assert.deepEqual(sends[0].allowedMentions.users, ["400000000000000001"]);
    assert.equal(sends[0].embeds[0].data.image.url, "https://example.com/test.gif");
    assert.equal(logs[0].delete_status, "pending");
    assert.equal(Date.parse(logs[0].delete_at) - Date.parse(logs[0].sent_at), 3_600_000);
    await runSchedulerOnce(); assert.equal(sends.length, 2, "Sent/advanced/locked announcements must not be sent again");
    for (const log of logs) log.delete_at = due;
    await runDeleteWorkerOnce();
    assert.deepEqual(deletes, ["message-1", "message-2"]);
    assert.ok(logs.every(log => log.delete_status === "deleted"));
  } finally { supabase.from = originalFrom; client.channels.fetch = originalFetch; }
});

test("Daily and weekly recurrence preserve Bucharest wall-clock time across DST", () => {
  assert.equal(nextRecurringScheduledAt("2026-10-24T07:00:00.000Z", "Europe/Bucharest", "daily", new Date("2026-10-24T07:00:00Z")), "2026-10-25T08:00:00.000Z");
  assert.equal(nextRecurringScheduledAt("2026-10-24T07:00:00.000Z", "Europe/Bucharest", "weekly", new Date("2026-10-24T07:00:00Z")), "2026-10-31T08:00:00.000Z");
});
test("Monthly, disabled and one-time scheduling contracts remain unchanged", () => {
  assert.equal(nextRecurringScheduledAt("2026-01-31T10:00:00.000Z", "UTC", "monthly", new Date("2026-01-31T10:00:00Z")), "2026-02-28T10:00:00.000Z");
  assert.equal(nextRecurringScheduledAt("2026-01-31T10:00:00.000Z", "UTC", "none"), null);
  const disabled = normalizeAnnouncementSchedule({ scheduled_at: "2026-01-31T10:00:00.000Z", timezone: "UTC", repeat_type: "daily", status: "disabled" });
  assert.equal(disabled.status, "disabled"); assert.equal(disabled.movedToNextOccurrence, false);
});
