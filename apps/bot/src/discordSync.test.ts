import assert from "node:assert/strict";
import { test } from "node:test";
Object.assign(process.env, { NODE_ENV: "test", DISCORD_TOKEN: "fixture", DISCORD_CLIENT_ID: "100000000000000001", DISCORD_CLIENT_SECRET: "fixture", DISCORD_REDIRECT_URI: "http://localhost:5173/api/auth/discord/callback", BOT_OWNER_DISCORD_ID: "100000000000000002", SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "fixture", CORS_ORIGIN: "http://localhost:5173" });
const { client, syncGuild, syncGuildChannels } = await import("./discord.js");
const { supabase } = await import("./supabase.js");
test("Metadata-only sync avoids channel enumeration; channel discovery enumerates once", async () => {
  let enumerations = 0, upserts = 0;
  const originalFetch = client.guilds.fetch, originalFrom = supabase.from;
  const guild = { id: "200000000000000001", name: "Fixture", iconURL: () => null, channels: { fetch: async () => { enumerations++; return []; } } };
  (client.guilds as any).fetch = async () => guild;
  (supabase as any).from = () => ({ upsert: async () => { upserts++; return { error: null }; } });
  try {
    const metadata = await syncGuild(guild.id, { channels: false });
    assert.equal(upserts, 1); assert.equal(enumerations, 0);
    await syncGuildChannels(metadata);
    assert.equal(enumerations, 1, "The channel endpoint's metadata-sync plus channel-sync should enumerate once");
    await syncGuild(guild.id);
    assert.equal(enumerations, 2, "Existing callers retain channel sync by default");
  } finally { client.guilds.fetch = originalFetch; supabase.from = originalFrom; }
});
