import { PermissionFlagsBits } from "discord.js";
import { ANNOUNCEMENT_DELETE_AFTER_MINUTES } from "@scheduler/shared";
import { nextRecurringScheduledAt } from "./announcementRules.js";
import { client } from "./discord.js";
import { supabase } from "./supabase.js";

type DueAnnouncement = {
  id: string;
  guild_id: string;
  channel_id: string;
  title: string;
  message: string;
  scheduled_at: string;
  timezone: string;
  repeat_type: "none" | "daily" | "weekly" | "monthly";
};

type PendingDeleteLog = {
  id: string;
  channel_id: string;
  discord_message_id: string;
};

async function logDelivery(
  item: DueAnnouncement,
  status: "sent" | "failed",
  errorMessage?: string,
  discordMessageId?: string,
  sentAt = new Date()
) {
  await supabase.from("delivery_logs").insert({
    announcement_id: item.id,
    guild_id: item.guild_id,
    channel_id: item.channel_id,
    status,
    error_message: errorMessage ?? null,
    sent_at: sentAt.toISOString(),
    discord_message_id: discordMessageId ?? null,
    delete_at:
      status === "sent" && discordMessageId
        ? new Date(sentAt.getTime() + ANNOUNCEMENT_DELETE_AFTER_MINUTES * 60_000).toISOString()
        : null,
    delete_status: status === "sent" && discordMessageId ? "pending" : null
  });
}

async function claim(item: DueAnnouncement) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("announcements")
    .update({ locked_until: lockUntil, updated_at: now.toISOString() })
    .eq("id", item.id)
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function sendAnnouncement(item: DueAnnouncement) {
  const channel = await client.channels.fetch(item.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("Channel is not text based or could not be fetched");
  }

  const roleIds = Array.from(item.message.matchAll(/<@&(\d{17,20})>/g), (match) => match[1]);
  const message = await channel.send({
    content: item.message,
    allowedMentions: {
      parse: [],
      roles: [...new Set(roleIds)],
      users: [],
      repliedUser: false
    }
  });
  return message.id;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function getDiscordErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

async function markDeleteDeleted(logId: string) {
  await supabase
    .from("delivery_logs")
    .update({
      delete_status: "deleted",
      deleted_at: new Date().toISOString(),
      delete_error_message: null
    })
    .eq("id", logId);
}

async function markDeleteFailed(logId: string, errorMessage: string) {
  await supabase
    .from("delivery_logs")
    .update({
      delete_status: "failed",
      delete_error_message: errorMessage
    })
    .eq("id", logId);
}

async function deletePostedMessage(log: PendingDeleteLog) {
  const channel = await client.channels.fetch(log.channel_id);
  if (!channel?.isTextBased() || !("messages" in channel)) {
    throw new Error("Channel is not text based or could not be fetched");
  }

  if ("permissionsFor" in channel && channel.guild?.members.me) {
    const permissions = channel.permissionsFor(channel.guild.members.me);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      throw new Error("Missing View Channel or Read Message History permission");
    }
  }

  const message = await channel.messages.fetch(log.discord_message_id);
  await message.delete();
}

export async function runDeleteWorkerOnce() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("delivery_logs")
    .select("id,channel_id,discord_message_id")
    .eq("delete_status", "pending")
    .lte("delete_at", now)
    .not("discord_message_id", "is", null)
    .limit(25);

  if (error) {
    console.error("Delete worker query failed", error);
    return;
  }

  for (const log of (data ?? []) as PendingDeleteLog[]) {
    try {
      await deletePostedMessage(log);
      await markDeleteDeleted(log.id);
    } catch (error) {
      const code = getDiscordErrorCode(error);
      if (code === "10008") {
        await markDeleteDeleted(log.id);
        continue;
      }

      const message = getErrorMessage(error);
      console.error(`Delivery log ${log.id} delete failed`, message);
      await markDeleteFailed(log.id, message);
    }
  }
}

export async function runSchedulerOnce() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcements")
    .select("id,guild_id,channel_id,title,message,scheduled_at,timezone,repeat_type")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .limit(25);

  if (error) {
    console.error("Scheduler query failed", error);
    return;
  }

  for (const item of (data ?? []) as DueAnnouncement[]) {
    try {
      const didClaim = await claim(item);
      if (!didClaim) continue;

      const discordMessageId = await sendAnnouncement(item);
      const sentAt = new Date();
      await logDelivery(item, "sent", undefined, discordMessageId, sentAt);

      const next = nextRecurringScheduledAt(
        item.scheduled_at,
        item.timezone,
        item.repeat_type
      );
      await supabase
        .from("announcements")
        .update({
          status: next ? "scheduled" : "sent",
          scheduled_at: next ?? item.scheduled_at,
          last_sent_at: new Date().toISOString(),
          locked_until: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`Announcement ${item.id} failed`, message);
      await logDelivery(item, "failed", message);
      await supabase
        .from("announcements")
        .update({ locked_until: null, updated_at: new Date().toISOString() })
        .eq("id", item.id);
    }
  }
}

export function startScheduler() {
  void runSchedulerOnce();
  void runDeleteWorkerOnce();
  setInterval(() => void runSchedulerOnce(), 60_000);
  setInterval(() => void runDeleteWorkerOnce(), 60_000);
}
