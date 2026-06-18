import { DateTime } from "luxon";
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

function nextScheduledAt(item: DueAnnouncement) {
  const zone = item.timezone || "Europe/Bucharest";
  const current = DateTime.fromISO(item.scheduled_at, { zone });
  if (item.repeat_type === "daily") return current.plus({ days: 1 }).toUTC().toISO();
  if (item.repeat_type === "weekly") return current.plus({ weeks: 1 }).toUTC().toISO();
  if (item.repeat_type === "monthly") return current.plus({ months: 1 }).toUTC().toISO();
  return null;
}

async function logDelivery(item: DueAnnouncement, status: "sent" | "failed", errorMessage?: string) {
  await supabase.from("delivery_logs").insert({
    announcement_id: item.id,
    guild_id: item.guild_id,
    channel_id: item.channel_id,
    status,
    error_message: errorMessage ?? null,
    sent_at: new Date().toISOString()
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
  await channel.send({
    content: item.message,
    allowedMentions: {
      parse: [],
      roles: [...new Set(roleIds)],
      users: [],
      repliedUser: false
    }
  });
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

      await sendAnnouncement(item);
      await logDelivery(item, "sent");

      const next = nextScheduledAt(item);
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
      const message = error instanceof Error ? error.message : "Unknown scheduler error";
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
  setInterval(() => void runSchedulerOnce(), 60_000);
}
