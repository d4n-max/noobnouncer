import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
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

export async function syncGuild(guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  await supabase.from("guilds").upsert({
    id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL(),
    updated_at: new Date().toISOString()
  });

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
    await supabase.from("channels").upsert(rows);
  }

  return guild;
}
