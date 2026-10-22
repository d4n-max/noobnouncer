import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { HttpError, type Identity } from "./auth.js";
import { createDiscordRest } from "./discordRest.js";
export type DashboardRole = "BOT_OWNER" | "SERVER_ADMIN" | "EDITOR";
export type LiveGuild = { id: string; name: string; icon: string | null; owner_id: string };
export type LiveMember = { roles: string[]; user: { id: string; username: string; avatar: string | null } };
export function createAuthorization(db: SupabaseClient, fetcher: typeof fetch = fetch, rest = createDiscordRest(fetcher)) {
  // Only transport cooldowns span requests. Permission results never do.
  function forRequest() {
    const deadline = rest.now() + 15_000;
    const decisions = new Map<string, Promise<DashboardRole>>();
    let discoveryIncomplete = false;
    let discoveryRetryAfter = 1;
    const discord = <T>(route: string) => rest.request<T>(route, deadline);
    async function resolveRole(user: Identity, guildId: string): Promise<DashboardRole> {
      const guild = await discord<LiveGuild>(`/guilds/${guildId}`);
      if (user.id === env.BOT_OWNER_DISCORD_ID) return "BOT_OWNER";
      const member = await discord<LiveMember>(`/guilds/${guildId}/members/${user.id}`);
      if (guild.owner_id === user.id) return "SERVER_ADMIN";
      const roles = await discord<{ id: string; permissions: string }[]>(`/guilds/${guildId}/roles`);
      const permissions = roles.filter(r => r.id === guildId || member.roles.includes(r.id)).reduce((bits, r) => bits | BigInt(r.permissions), 0n);
      if ((permissions & (8n | 32n)) !== 0n) return "SERVER_ADMIN";
      const { data, error } = await db.from("dashboard_access").select("role").eq("guild_id", guildId).eq("discord_user_id", user.id).maybeSingle();
      if (error) throw new HttpError(503, "Access service unavailable");
      if (data?.role === "EDITOR") return "EDITOR";
      throw new HttpError(403, "You do not have permission for this server.");
    }
    async function role(user: Identity, guildId: string, manage = false): Promise<DashboardRole> {
      if (!/^\d{17,20}$/.test(guildId)) throw new HttpError(400, "Invalid server ID");
      const key = `${user.id}:${guildId}`;
      let pending = decisions.get(key);
      if (!pending) { pending = resolveRole(user, guildId); decisions.set(key, pending); }
      const result = await pending;
      if (manage && result === "EDITOR") throw new HttpError(403, "You do not have permission for this server.");
      return result;
    }
    async function guilds(user: Identity) {
      const result: { id: string; name: string; icon_url: string | null; role: DashboardRole }[] = [];
      let after = "0";
      while (true) {
        const page = await discord<{ id: string; name: string; icon: string | null }[]>(`/users/@me/guilds?limit=200&after=${after}`);
        for (const guild of page) {
          try {
            // A fresh bot guild list already proves installation for the global owner.
            const accessRole = user.id === env.BOT_OWNER_DISCORD_ID ? "BOT_OWNER" : await role(user, guild.id);
            result.push({ id: guild.id, name: guild.name, icon_url: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null, role: accessRole });
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            if (error.status === 503) {
              discoveryIncomplete = true;
              discoveryRetryAfter = Math.max(discoveryRetryAfter, error.retryAfter ?? 1);
              continue;
            }
            if (error.status !== 403) throw error;
          }
        }
        if (page.length < 200) break;
        const next = page[page.length - 1].id;
        if (BigInt(next) <= BigInt(after)) throw new HttpError(503, "Discord server discovery could not be completed.");
        after = next;
      }
      if (discoveryIncomplete && !result.length) throw new HttpError(503, "Discord server discovery is temporarily unavailable. Please refresh shortly.", discoveryRetryAfter);
      return result;
    }
    async function channel(guildId: string, channelId: string) {
      if (!/^\d{17,20}$/.test(channelId)) throw new HttpError(400, "Invalid channel ID");
      const channel = await discord<{ guild_id?: string; type: number }>(`/channels/${channelId}`);
      if (channel.guild_id !== guildId || channel.type !== 0) throw new HttpError(403, "Channel does not belong to this server or is not a text channel.");
    }
    return { role, guilds, channel, discord, get discoveryIncomplete() { return discoveryIncomplete; } };
  }
  return { forRequest };
}
