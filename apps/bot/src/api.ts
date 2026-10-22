import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PermissionFlagsBits } from "discord.js";
import { Announcement, isAnnouncementMediaUrl, repeatTypes } from "@scheduler/shared";
import { createAuth, context, HttpError } from "./auth.js";
import { createAuthorization, type LiveMember } from "./authorization.js";
import { normalizeAnnouncementSchedule } from "./announcementRules.js";
import { client, getGuildRoles, searchGuildMembers, syncGuild, syncGuildChannels } from "./discord.js";
import { env } from "./env.js";
import { supabase } from "./supabase.js";

const announcementSchema = z.object({
  guild_id: z.string(),
  channel_id: z.string(),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  gif_url: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .url("Please enter a valid GIF or image URL.")
      .refine(isAnnouncementMediaUrl, "Please enter a valid GIF or image URL.")
      .nullable()
      .optional()
  ),
  giphy_id: z.string().trim().min(1).max(100).nullable().optional(),
  giphy_title: z.string().trim().max(500).nullable().optional(),
  scheduled_at: z.string().datetime(),
  timezone: z.string().default(env.DEFAULT_TIMEZONE),
  repeat_type: z.enum(repeatTypes).default("none"),
  status: z.enum(["scheduled", "sent", "disabled"]).default("scheduled"),
  created_by: z.never().optional()
});

type AnnouncementRow = z.infer<typeof announcementSchema> & {
  id: string;
  status: "scheduled" | "sent" | "disabled";
  repeat_type: "none" | "daily" | "weekly" | "every_two_weeks" | "monthly";
};

async function cleanupBadAnnouncementStatuses(db = supabase) {
  const now = new Date().toISOString();

  const futureSent = await db
    .from("announcements")
    .update({ status: "scheduled", updated_at: now })
    .eq("status", "sent")
    .gt("scheduled_at", now);

  if (futureSent.error) throw futureSent.error;

  const recurringSent = await db
    .from("announcements")
    .update({ status: "scheduled", updated_at: now })
    .eq("status", "sent")
    .neq("repeat_type", "none");

  if (recurringSent.error) throw recurringSent.error;

  const { data: overdueRecurring, error: overdueRecurringError } = await db
    .from("announcements")
    .select("id,scheduled_at,timezone,repeat_type,status")
    .eq("status", "scheduled")
    .neq("repeat_type", "none")
    .lte("scheduled_at", now);

  if (overdueRecurringError) throw overdueRecurringError;

  for (const item of overdueRecurring ?? []) {
    const normalized = normalizeAnnouncementSchedule({
      scheduled_at: item.scheduled_at,
      timezone: item.timezone,
      repeat_type: item.repeat_type,
      status: item.status
    });
    if (!normalized.movedToNextOccurrence) continue;

    const { error } = await db
      .from("announcements")
      .update({
        scheduled_at: normalized.scheduled_at,
        status: normalized.status,
        updated_at: now
      })
      .eq("id", item.id);

    if (error) throw error;
  }
}

function sortAnnouncementsForDashboard<T extends {
  status: string;
  scheduled_at: string;
  last_sent_at?: string | null;
}>(items: T[], now = new Date()) {
  const nowMs = now.getTime();

  function group(item: T) {
    const scheduledAtMs = Date.parse(item.scheduled_at);
    if (item.status === "scheduled" && scheduledAtMs >= nowMs) return 0;
    if (item.status === "scheduled") return 1;
    if (item.status === "disabled") return 2;
    return 3;
  }

  return [...items].sort((left, right) => {
    const leftGroup = group(left);
    const rightGroup = group(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;

    if (leftGroup === 3) {
      const leftTime = Date.parse(left.last_sent_at || left.scheduled_at);
      const rightTime = Date.parse(right.last_sent_at || right.scheduled_at);
      return rightTime - leftTime;
    }

    return Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at);
  });
}

export function createApi(deps: { db?: typeof supabase; fetcher?: typeof fetch; maintenance?: boolean; sync?: typeof syncGuild } = {}) {
  const db = deps.db ?? supabase;
  const auth = createAuth(db, deps.fetcher);
  const access = createAuthorization(db, deps.fetcher);
  const sync = deps.sync ?? syncGuild;
  const app = express();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../../web/dist");

  if (deps.maintenance !== false) void cleanupBadAnnouncementStatuses(db).catch((error) => {
    console.error("Announcement status cleanup failed", error);
  });

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS);
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" }); next();
  });
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(webDist));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const attempts = new Map<string, { count: number; until: number }>();
  app.use("/api/auth/discord", (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip ?? "unknown";
    const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    if (attempts.size >= 10000 && !attempts.has(key)) return res.status(429).json({ error: "Try again shortly" });
    attempts.set(key, entry);
    if (++entry.count > 20) return res.status(429).json({ error: "Try again shortly" });
    next();
  });
  app.get("/api/auth/discord", auth.start);
  app.get("/api/auth/discord/callback", auth.callback);
  app.use("/api", auth.requireSession);
  const userRequests = new Map<string, { count: number; until: number }>();
  app.use("/api", (_req, res, next) => {
    const now = Date.now();
    for (const [key, value] of userRequests) if (value.until <= now) userRequests.delete(key);
    const key = context(res).user.id;
    const entry = userRequests.get(key) ?? { count: 0, until: now + 60_000 };
    if (userRequests.size >= 10000 && !userRequests.has(key)) return res.status(429).json({ error: "Try again shortly" });
    userRequests.set(key, entry);
    if (++entry.count > 120) return res.status(429).json({ error: "Too many requests. Try again shortly." });
    next();
  });
  app.get("/api/auth/me", (_req, res) => {
    const { user, csrfToken } = context(res);
    res.json({ user: { ...user, avatar_url: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null }, csrfToken, isBotOwner: user.id === env.BOT_OWNER_DISCORD_ID });
  });
  app.post("/api/auth/logout", auth.logout);
  app.get("/api/guilds", async (_req, res) => res.json(await access.guilds(context(res).user)));
  app.post("/api/guilds/refresh", async (_req, res) => {
    const guilds = await access.guilds(context(res).user);
    res.json({ guilds, added: 0 });
  });
  app.use("/api/guilds/:guildId", async (req, res, next) => {
    try { res.locals.guildRole = await access.role(context(res).user, req.params.guildId); next(); }
    catch (error) { next(error); }
  });
  const requiredGuild = (value: unknown) => z.string().regex(/^\d{17,20}$/).parse(value);
  async function resource(table: "announcements" | "allowed_users", id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid resource ID");
    const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new HttpError(503, "Data service unavailable");
    if (!data) throw new HttpError(403, "Resource unavailable");
    return data;
  }
  app.get("/api/guilds/:guildId/dashboard-access", async (req, res) => {
    await access.role(context(res).user, req.params.guildId, true);
    const { data, error } = await db.from("dashboard_access").select("*").eq("guild_id", req.params.guildId);
    if (error) throw new HttpError(503, "Data service unavailable");
    res.json(data);
  });
  app.post("/api/guilds/:guildId/dashboard-access", async (req, res) => {
    await access.role(context(res).user, req.params.guildId, true);
    const { discord_user_id } = z.object({ discord_user_id: z.string().regex(/^\d{17,20}$/) }).strict().parse(req.body);
    await access.discord<LiveMember>(`/guilds/${req.params.guildId}/members/${discord_user_id}`);
    await sync(req.params.guildId);
    const { data, error } = await db.from("dashboard_access").upsert({ guild_id: req.params.guildId, discord_user_id, role: "EDITOR", granted_by: context(res).user.id, updated_at: new Date().toISOString() }, { onConflict: "guild_id,discord_user_id" }).select().single();
    if (error) throw new HttpError(503, "Data service unavailable");
    res.status(201).json(data);
  });
  app.delete("/api/guilds/:guildId/dashboard-access/:userId", async (req, res) => {
    await access.role(context(res).user, req.params.guildId, true);
    const { error } = await db.from("dashboard_access").delete().eq("guild_id", req.params.guildId).eq("discord_user_id", requiredGuild(req.params.userId));
    if (error) throw new HttpError(503, "Data service unavailable");
    res.status(204).end();
  });

  app.get("/api/bot/invite-url", (_req, res) => {
    if (!env.DISCORD_CLIENT_ID) {
      res.status(400).json({ error: "DISCORD_CLIENT_ID is not configured" });
      return;
    }

    const permissions = String(
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.ReadMessageHistory |
      PermissionFlagsBits.MentionEveryone
    );
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
    url.searchParams.set("scope", "bot");
    url.searchParams.set("permissions", permissions);
    res.json({ url: url.toString() });
  });

  app.get("/api/guilds/:guildId/channels", async (req, res) => {
    const guild = await sync(req.params.guildId);
    res.json(await syncGuildChannels(guild));
  });

  app.get("/api/guilds/:guildId/roles", async (req, res) => {
    try {
      res.json(await getGuildRoles(req.params.guildId));
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? "Data service unavailable" : "Could not load roles"
      });
    }
  });

  app.get("/api/guilds/:guildId/members/search", async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      res.json([]);
      return;
    }

    try {
      res.json(await searchGuildMembers(req.params.guildId, query));
    } catch (error) {
      const message = error instanceof Error ? "Data service unavailable" : "Could not search server members.";
      res.status(message.includes("invited") ? 404 : 500).json({ error: message });
    }
  });

  app.get("/api/guilds/:guildId/users", async (req, res) => {
    await access.role(context(res).user, req.params.guildId, true);
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

  app.get("/api/announcements", async (req, res) => {
    const guildIds = req.query.guild_id ? [requiredGuild(req.query.guild_id)] : (await access.guilds(context(res).user)).map(g => g.id);
    if (req.query.guild_id) await access.role(context(res).user, guildIds[0]);
    if (!guildIds.length) return res.json([]);
    const { data, error } = await db
      .from("announcements")
      .select("*").in("guild_id", guildIds);
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.json(sortAnnouncementsForDashboard(data ?? []));
  });

  app.post("/api/announcements", async (req, res) => {
    const payload = announcementSchema.parse(req.body);
    await access.role(context(res).user, payload.guild_id);
    await access.channel(payload.guild_id, payload.channel_id);
    await sync(payload.guild_id);
    const normalized = normalizeAnnouncementSchedule(payload);
    const normalizedPayload = {
      ...payload,
      created_by: context(res).user.id,
      scheduled_at: normalized.scheduled_at,
      status: normalized.status
    };
    const { data, error } = await db.from("announcements").insert(normalizedPayload).select().single();
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.status(201).json({ ...data, movedToNextOccurrence: normalized.movedToNextOccurrence });
  });

  app.put("/api/announcements/:id", async (req, res) => {
    const payload = announcementSchema.partial().parse(req.body);
    const existing = await resource("announcements", req.params.id);
    await access.role(context(res).user, existing.guild_id);
    if (payload.guild_id !== undefined && payload.guild_id !== existing.guild_id) throw new HttpError(403, "Announcements cannot move between servers");
    await access.channel(existing.guild_id, payload.channel_id ?? existing.channel_id);
    if (payload.channel_id) await sync(existing.guild_id);

    const nextValues = {
      ...(existing as AnnouncementRow),
      ...payload
    };
    const normalized = normalizeAnnouncementSchedule({
      scheduled_at: nextValues.scheduled_at,
      timezone: nextValues.timezone,
      repeat_type: nextValues.repeat_type,
      status:
        payload.status === undefined && existing.status === "disabled"
          ? "disabled"
          : nextValues.status
    });
    const normalizedPayload = {
      ...payload,
      scheduled_at: normalized.scheduled_at,
      status: normalized.status
    };

    const { data, error } = await db
      .from("announcements")
      .update({ ...normalizedPayload, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("guild_id", existing.guild_id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.json({ ...data, movedToNextOccurrence: normalized.movedToNextOccurrence });
  });

  app.delete("/api/announcements/:id", async (req, res) => {
    const existing = await resource("announcements", req.params.id);
    await access.role(context(res).user, existing.guild_id);
    const { error } = await db.from("announcements").delete().eq("id", req.params.id).eq("guild_id", existing.guild_id);
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.status(204).end();
  });

  app.get("/api/allowed-users", async (req, res) => {
    const guildId = requiredGuild(req.query.guild_id);
    await access.role(context(res).user, guildId, true);
    const query = db.from("allowed_users").select("*").eq("guild_id", guildId).order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: "Data service unavailable" });
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
    await access.role(context(res).user, payload.guild_id, true);
    const member = await access.discord<LiveMember>(`/guilds/${payload.guild_id}/members/${requiredGuild(payload.discord_user_id)}`);
    payload.username = member.user.username;
    await sync(payload.guild_id);
    const { data, error } = await db
      .from("allowed_users")
      .upsert(payload, { onConflict: "guild_id,discord_user_id" })
      .select()
      .single();
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.status(201).json(data);
  });

  app.delete("/api/allowed-users/:id", async (req, res) => {
    const existing = await resource("allowed_users", req.params.id);
    await access.role(context(res).user, existing.guild_id, true);
    const { error } = await db.from("allowed_users").delete().eq("id", req.params.id).eq("guild_id", existing.guild_id);
    if (error) return res.status(500).json({ error: "Data service unavailable" });
    res.status(204).end();
  });

  app.get("/api/settings", (_req, res) => {
    if (context(res).user.id !== env.BOT_OWNER_DISCORD_ID) throw new HttpError(403, "Bot Owner access required");
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

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return void res.status(400).json({ error: "Invalid request data" });
    res.status(503).json({ error: "Service unavailable. Please try again." });
  };
  app.use(errorHandler);
  return app;
}

export type AnnouncementPayload = Omit<Announcement, "id" | "created_at" | "updated_at">;
