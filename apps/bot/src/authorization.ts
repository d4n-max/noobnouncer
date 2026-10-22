import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { HttpError, type Identity } from "./auth.js";
export type DashboardRole = "BOT_OWNER" | "SERVER_ADMIN" | "EDITOR";
export type LiveGuild = { id: string; name: string; icon: string | null; owner_id: string };
export type LiveMember = { roles: string[]; user: { id: string; username: string; avatar: string | null } };
export function createAuthorization(db: SupabaseClient, fetcher: typeof fetch = fetch) {
  async function discord<T>(route: string): Promise<T> {
    try {
      const response = await fetcher(`https://discord.com/api/v10${route}`, { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("Unavailable");
      return await response.json() as T;
    } catch { throw new HttpError(403, "Server access could not be verified. Refresh or contact a server administrator."); }
  }
  async function role(user: Identity, guildId: string, manage = false): Promise<DashboardRole> {
    if (!/^\d{17,20}$/.test(guildId)) throw new HttpError(400, "Invalid server ID");
    // Bot REST access to this guild proves it is installed; no DB-only/stale guild access.
    const guild = await discord<LiveGuild>(`/guilds/${guildId}`);
    if (user.id === env.BOT_OWNER_DISCORD_ID) return "BOT_OWNER";
    const member = await discord<LiveMember>(`/guilds/${guildId}/members/${user.id}`);
    const roles = await discord<{ id: string; permissions: string }[]>(`/guilds/${guildId}/roles`);
    const permissions = roles.filter(r => r.id === guildId || member.roles.includes(r.id)).reduce((bits, r) => bits | BigInt(r.permissions), 0n);
    if (guild.owner_id === user.id || (permissions & (8n | 32n)) !== 0n) return "SERVER_ADMIN";
    if (!manage) {
      const { data, error } = await db.from("dashboard_access").select("role").eq("guild_id", guildId).eq("discord_user_id", user.id).maybeSingle();
      if (error) throw new HttpError(503, "Access service unavailable");
      if (data?.role === "EDITOR") return "EDITOR";
    }
    throw new HttpError(403, "You do not have permission for this server.");
  }
  async function guilds(user: Identity) {
    const result: { id: string; name: string; icon_url: string | null; role: DashboardRole }[] = [];
    // Paginate bot guilds rather than trusting user-supplied guild IDs or session snapshots.
    let after = "0";
    while (true) {
      const page = await discord<{ id: string; name: string; icon: string | null }[]>(`/users/@me/guilds?limit=200&after=${after}`);
      for (const guild of page) {
        try {
          const accessRole = await role(user, guild.id);
          result.push({ id: guild.id, name: guild.name, icon_url: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null, role: accessRole });
        } catch (error) { if (!(error instanceof HttpError) || error.status !== 403) throw error; }
      }
      if (page.length < 200) break;
      after = page[page.length - 1].id;
    }
    return result;
  }
  async function channel(guildId: string, channelId: string) {
    if (!/^\d{17,20}$/.test(channelId)) throw new HttpError(400, "Invalid channel ID");
    const channel = await discord<{ guild_id?: string; type: number }>(`/channels/${channelId}`);
    if (channel.guild_id !== guildId || channel.type !== 0) throw new HttpError(403, "Channel does not belong to this server or is not a text channel.");
  }
  return { role, guilds, channel, discord };
}
