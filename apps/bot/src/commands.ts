import type { Message } from "discord.js";
import { supabase } from "./supabase.js";

export async function handleMessage(message: Message) {
  if (message.author.bot || !message.guild || !message.content.startsWith(".")) return;

  const [command] = message.content.trim().split(/\s+/);
  if (command !== ".list") return;

  const { data: allowed } = await supabase
    .from("allowed_users")
    .select("id")
    .eq("guild_id", message.guild.id)
    .eq("discord_user_id", message.author.id)
    .maybeSingle();

  if (!allowed) {
    await message.reply("You are not allowed to use scheduler commands in this server.");
    return;
  }

  const { data, error } = await supabase
    .from("announcements")
    .select("title,channel_id,scheduled_at,repeat_type")
    .eq("guild_id", message.guild.id)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);

  if (error) {
    await message.reply("I could not load scheduled announcements right now.");
    return;
  }

  if (!data?.length) {
    await message.reply("No upcoming announcements are scheduled for this server.");
    return;
  }

  const lines = data.map(
    (item, index) =>
      `${index + 1}. **${item.title}** in <#${item.channel_id}> at ${new Date(
        item.scheduled_at
      ).toLocaleString()} (${item.repeat_type})`
  );
  await message.reply(lines.join("\n"));
}
