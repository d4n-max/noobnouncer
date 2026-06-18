import {
  ChannelType,
  Client,
  Guild,
  GatewayIntentBits,
  PermissionFlagsBits,
  Role,
  TextBasedChannel
} from "discord.js";
import { supabase } from "./supabase.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

export function canBotSend(channel: TextBasedChannel): boolean {
  if (!("permissionsFor" in channel) || !channel.guild?.members.me) return false;
  const permissions = channel.permissionsFor(channel.guild.members.me);
  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
      permissions?.has(PermissionFlagsBits.SendMessages)
  );
}

export async function upsertGuild(guild: Guild) {
  const { error } = await supabase.from("guilds").upsert({
    id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL(),
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function syncGuildChannels(guild: Guild) {
  const channels = await guild.channels.fetch();
  const rows = channels
    .filter((channel) => channel?.type === ChannelType.GuildText)
    .map((channel) => ({
      id: channel!.id,
      guild_id: guild.id,
      name: channel!.name,
      type: "text",
        can_send: canBotSend(channel as TextBasedChannel),
        updated_at: new Date().toISOString()
      }));

  if (rows.length) {
    const { error } = await supabase.from("channels").upsert(rows);
    if (error) throw error;
  }

  return rows.filter((channel) => channel.can_send);
}

export async function syncGuild(guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  await upsertGuild(guild);
  await syncGuildChannels(guild);
  return guild;
}

export async function syncAllGuilds() {
  const liveGuilds = await client.guilds.fetch();
  const guilds = await Promise.all(
    liveGuilds.map(async (liveGuild) => {
      const guild = await client.guilds.fetch(liveGuild.id);
      await upsertGuild(guild);
      return guild;
    })
  );

  return guilds;
}

export async function getGuildRoles(guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const roles = await guild.roles.fetch();

  return roles
    .filter((role): role is Role => Boolean(role) && role.id !== guild.id)
    .sort((left, right) => {
      const positionDelta = right.position - left.position;
      return positionDelta || left.name.localeCompare(right.name);
    })
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.hexColor === "#000000" ? null : role.hexColor,
      mentionable: role.mentionable
    }));
}
