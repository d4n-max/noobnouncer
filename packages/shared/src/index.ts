export const repeatTypes = ["none", "daily", "weekly", "monthly"] as const;
export const announcementStatuses = ["scheduled", "sent", "disabled"] as const;

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
