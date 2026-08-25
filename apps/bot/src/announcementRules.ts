import { DateTime } from "luxon";

export type RepeatType = "none" | "daily" | "weekly" | "every_two_weeks" | "monthly";
export type AnnouncementStatus = "scheduled" | "sent" | "disabled";

type StatusInput = {
  scheduled_at: string;
  repeat_type: RepeatType;
  status?: AnnouncementStatus | null;
};

type ScheduleInput = StatusInput & {
  timezone: string;
};

export function normalizeAnnouncementStatus(
  input: StatusInput,
  now = new Date()
): AnnouncementStatus {
  if (input.status === "disabled") return "disabled";
  if (input.repeat_type !== "none") return "scheduled";
  if (Date.parse(input.scheduled_at) > now.getTime()) return "scheduled";
  return input.status ?? "scheduled";
}

export function nextRecurringScheduledAt(
  scheduledAt: string,
  timezone: string,
  repeatType: RepeatType,
  now = new Date()
) {
  if (repeatType === "none") return null;

  const zone = timezone || "Europe/Bucharest";
  let next = DateTime.fromISO(scheduledAt, { zone });
  const reference = DateTime.fromJSDate(now).setZone(zone);

  do {
    if (repeatType === "daily") next = next.plus({ days: 1 });
    if (repeatType === "weekly") next = next.plus({ weeks: 1 });
    if (repeatType === "every_two_weeks") next = next.plus({ weeks: 2 });
    if (repeatType === "monthly") next = next.plus({ months: 1 });
  } while (next <= reference);

  return next.toUTC().toISO();
}

export function normalizeAnnouncementSchedule(input: ScheduleInput, now = new Date()) {
  const status = normalizeAnnouncementStatus(input, now);
  const shouldAdvanceRecurring =
    status !== "disabled" &&
    input.repeat_type !== "none" &&
    Date.parse(input.scheduled_at) <= now.getTime();

  if (!shouldAdvanceRecurring) {
    return {
      scheduled_at: input.scheduled_at,
      status,
      movedToNextOccurrence: false
    };
  }

  return {
    scheduled_at: nextRecurringScheduledAt(
      input.scheduled_at,
      input.timezone,
      input.repeat_type,
      now
    ) ?? input.scheduled_at,
    status: "scheduled" as const,
    movedToNextOccurrence: true
  };
}
