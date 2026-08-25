export const repeatTypes = ["none", "daily", "weekly", "every_two_weeks", "monthly"] as const;
export const announcementStatuses = ["scheduled", "sent", "disabled"] as const;
export const ANNOUNCEMENT_DELETE_AFTER_MINUTES = 60;

export function isAnnouncementMediaUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractDiscordMentions(content: string) {
  const users = Array.from(content.matchAll(/<@!?(\d{17,20})>/g), (match) => match[1]);
  const roles = Array.from(content.matchAll(/<@&(\d{17,20})>/g), (match) => match[1]);
  const special = Array.from(content.matchAll(/(?:^|\s)@(everyone|here)\b/g), (match) => `@${match[1]}`);

  return {
    users: [...new Set(users)],
    roles: [...new Set(roles)],
    special: [...new Set(special)],
    everyone: special.length > 0
  };
}

export type RepeatType = (typeof repeatTypes)[number];
export type AnnouncementStatus = (typeof announcementStatuses)[number];

export interface GuildRecord {
  id: string;
  name: string;
  icon_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelRecord {
  id: string;
  guild_id: string;
  name: string;
  type: string;
  can_send: boolean;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  guild_id: string;
  channel_id: string;
  title: string;
  message: string;
  gif_url: string | null;
  giphy_id: string | null;
  giphy_title: string | null;
  scheduled_at: string;
  timezone: string;
  repeat_type: RepeatType;
  status: AnnouncementStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_sent_at: string | null;
  locked_until?: string | null;
}

export interface AllowedUser {
  id: string;
  guild_id: string;
  discord_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}
