import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Announcement, repeatTypes } from "@scheduler/shared";
import { issueAdminToken, requireAdmin } from "./auth.js";
import { client, syncAllGuilds, syncGuild, syncGuildChannels } from "./discord.js";
import { env } from "./env.js";
import { supabase } from "./supabase.js";

const announcementSchema = z.object({
  guild_id: z.string(),
  channel_id: z.string(),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  scheduled_at: z.string().datetime(),
  timezone: z.string().default(env.DEFAULT_TIMEZONE),
  repeat_type: z.enum(repeatTypes).default("none"),
  status: z.enum(["scheduled", "sent", "disabled"]).default("scheduled"),
  created_by: z.string().optional().nullable()
});

export function createApi() {
  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../../web/dist");

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(webDist));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth/login", (req, res) => {
    if (req.body?.password !== env.ADMIN_PASSWORD) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    res.json({ token: issueAdminToken() });
  });

  app.use("/api", requireAdmin);

  app.get("/api/guilds", async (_req, res) => {
    const guilds = await syncAllGuilds();
    res.json(
      guilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon_url: guild.iconURL()
      }))
    );
  });

  app.post("/api/guilds/refresh", async (_req, res) => {
    const { data: existingGuilds, error } = await supabase.from("guilds").select("id");
    if (error) return res.status(500).json({ error: error.message });

    const previousIds = new Set((existingGuilds ?? []).map((guild) => guild.id));
    const guilds = await syncAllGuilds();
    const payload = guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL()
    }));

    res.json({
      guilds: payload,
      added: payload.filter((guild) => !previousIds.has(guild.id)).length
    });
  });

  app.get("/api/bot/invite-url", (_req, res) => {
    if (!env.DISCORD_CLIENT_ID) {
      res.status(400).json({ error: "DISCORD_CLIENT_ID is not configured" });
      return;
    }

    const permissions = String(1024 + 2048 + 65536);
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    url.searchParams.set("scope", "bot");
    url.searchParams.set("permissions", permissions);
    res.json({ url: url.toString() });
  });

  app.get("/api/guilds/:guildId/channels", async (req, res) => {
    const guild = await syncGuild(req.params.guildId);
    res.json(await syncGuildChannels(guild));
  });

  app.get("/api/guilds/:guildId/users", async (req, res) => {
    const guild = await client.guilds.fetch(req.params.guildId);
    const query = String(req.query.search ?? "").trim();
    if (!query) {
      res.json([]);
      return;
    }

    const members = await guild.members.search({ query, limit: 10 });
    res.json(
      members.map((member) => ({
        discord_user_id: member.id,
        username: member.user.username,
        display_name: member.displayName,
        avatar_url: member.user.displayAvatarURL()
      }))
    );
  });

  app.get("/api/announcements", async (_req, res) => {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("scheduled_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/announcements", async (req, res) => {
    const payload = announcementSchema.parse(req.body);
    const { data, error } = await supabase.from("announcements").insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  });

  app.put("/api/announcements/:id", async (req, res) => {
    const payload = announcementSchema.partial().parse(req.body);
    const { data, error } = await supabase
      .from("announcements")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/announcements/:id", async (req, res) => {
    const { error } = await supabase.from("announcements").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).end();
  });

  app.get("/api/allowed-users", async (req, res) => {
    let query = supabase.from("allowed_users").select("*").order("created_at", { ascending: false });
    if (req.query.guild_id) query = query.eq("guild_id", String(req.query.guild_id));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/allowed-users", async (req, res) => {
    const payload = z
      .object({
        guild_id: z.string(),
        discord_user_id: z.string(),
        username: z.string(),
        display_name: z.string().nullable().optional(),
        avatar_url: z.string().nullable().optional()
      })
      .parse(req.body);
    const { data, error } = await supabase
      .from("allowed_users")
      .upsert(payload, { onConflict: "guild_id,discord_user_id" })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  });

  app.delete("/api/allowed-users/:id", async (req, res) => {
    const { error } = await supabase.from("allowed_users").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.status(204).end();
  });

  app.get("/api/settings", (_req, res) => {
    res.json({
      defaultTimezone: env.DEFAULT_TIMEZONE,
      inviteAvailable: Boolean(env.DISCORD_CLIENT_ID),
      botUser: client.user ? { id: client.user.id, username: client.user.username } : null,
      guildCount: client.guilds.cache.size
    });
  });

  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "API route not found" });
      return;
    }

    const indexPath = path.join(webDist, "index.html");
    if (!existsSync(indexPath)) {
      res.status(404).send("Dashboard build not found. Run npm run build -w @scheduler/web.");
      return;
    }

    res.sendFile(indexPath);
  });

  return app;
}

export type AnnouncementPayload = Omit<Announcement, "id" | "created_at" | "updated_at">;
