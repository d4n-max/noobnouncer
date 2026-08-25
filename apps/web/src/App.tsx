import {
  ArrowClockwise,
  CalendarBlank,
  GearSix,
  LinkSimple,
  ListBullets,
  PencilSimple,
  Plus,
  Prohibit,
  Trash,
  Users,
  X
} from "@phosphor-icons/react";
import { DateTime } from "luxon";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { extractDiscordMentions, isAnnouncementMediaUrl, type AllowedUser, type Announcement } from "@scheduler/shared";
import { api, clearStoredToken, getStoredToken, login, setStoredToken, validateSession } from "./api";
import { GiphyPickerModal } from "./GiphyPickerModal";
import { MentionPickerModal, type MentionSelection } from "./MentionPickerModal";
import { TIMEZONE_OPTIONS } from "./timezones";

const AUTO_DELETE_LABEL = "1 hour";
const initialAuthToken = getStoredToken();
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY?.trim() ?? "";

type Guild = { id: string; name: string; icon_url: string | null };
type Channel = { id: string; guild_id: string; name: string; can_send: boolean; can_mention_everyone?: boolean };
type Role = { id: string; name: string; color: string | null; mentionable: boolean };
type MentionMember = { id: string; username: string; display_name: string; nickname: string | null; avatar_url: string; bot: boolean };
type AnnouncementSaveResponse = Announcement & { movedToNextOccurrence?: boolean };
type DiscordUser = {
  discord_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};
type Page = "announcements" | "users" | "settings";

const preferenceKeys = {
  guildId: "noobnouncer_last_guild_id",
  channelByGuild: "noobnouncer_last_channel_by_guild"
};

function todayDate() {
  return DateTime.now().toISODate() ?? "";
}

function getStoredChannelMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(preferenceKeys.channelByGuild) || "{}");
  } catch {
    return {};
  }
}

function getStoredChannelForGuild(guildId: string) {
  return getStoredChannelMap()[guildId] || "";
}

function storeChannelForGuild(guildId: string, channelId: string) {
  if (!guildId || !channelId) return;
  localStorage.setItem(
    preferenceKeys.channelByGuild,
    JSON.stringify({ ...getStoredChannelMap(), [guildId]: channelId })
  );
}

const defaultForm = {
  title: "",
  guild_id: "",
  channel_id: "",
  message: "",
  gif_url: "",
  giphy_id: "",
  giphy_title: "",
  date: todayDate(),
  time: "",
  timezone: "UTC",
  repeat_type: "none",
  status: "scheduled"
};

function createEmptyForm(overrides: Partial<typeof defaultForm> = {}) {
  return {
    ...defaultForm,
    date: todayDate(),
    time: "",
    timezone: "UTC",
    repeat_type: "none",
    title: "",
    message: "",
    ...overrides
  };
}

export function App() {
  const [token, setToken] = useState(initialAuthToken);
  const [isCheckingSession, setIsCheckingSession] = useState(Boolean(initialAuthToken));
  const [page, setPage] = useState<Page>("announcements");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedGuild, setSelectedGuild] = useState(localStorage.getItem(preferenceKeys.guildId) || "");
  const [userSearch, setUserSearch] = useState("");
  const [suggestions, setSuggestions] = useState<DiscordUser[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [toast, setToast] = useState("");
  const [isRefreshingGuilds, setIsRefreshingGuilds] = useState(false);
  const [isGiphyPickerOpen, setIsGiphyPickerOpen] = useState(false);
  const [isMentionPickerOpen, setIsMentionPickerOpen] = useState(false);
  const [mentionMembers, setMentionMembers] = useState<Record<string, MentionMember>>({});
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const channelById = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
    [channels]
  );

  useEffect(() => {
    function handleExpiredSession() {
      clearStoredToken();
      setToken(null);
      setLoginError("Session expired. Please log in again.");
    }

    window.addEventListener("scheduler:auth-expired", handleExpiredSession);
    return () => window.removeEventListener("scheduler:auth-expired", handleExpiredSession);
  }, []);

  async function loadGuilds(preferredGuildId = selectedGuild) {
    const loadedGuilds = await api<Guild[]>("/guilds");
    setGuilds(loadedGuilds);
    const storedGuildId = localStorage.getItem(preferenceKeys.guildId) || "";
    const initialGuild =
      loadedGuilds.find((guild) => guild.id === preferredGuildId)?.id ||
      loadedGuilds.find((guild) => guild.id === storedGuildId)?.id ||
      loadedGuilds.find((guild) => guild.id === form.guild_id)?.id ||
      loadedGuilds[0]?.id ||
      "";
    setSelectedGuild(initialGuild);
    if (initialGuild) localStorage.setItem(preferenceKeys.guildId, initialGuild);
    setForm((current) => ({ ...current, guild_id: initialGuild, date: current.date || todayDate() }));

    if (initialGuild) {
      const loadedChannels = await api<Channel[]>(`/guilds/${initialGuild}/channels`);
      setChannels(loadedChannels);
      setRoles(await api<Role[]>(`/guilds/${initialGuild}/roles`));
      const storedChannelId = getStoredChannelForGuild(initialGuild);
      setForm((current) => {
        const nextChannelId =
          loadedChannels.find((channel) => channel.id === current.channel_id)?.id ||
          loadedChannels.find((channel) => channel.id === storedChannelId)?.id ||
          loadedChannels[0]?.id ||
          "";
        if (nextChannelId) storeChannelForGuild(initialGuild, nextChannelId);
        return { ...current, channel_id: nextChannelId };
      });
    } else {
      setChannels([]);
      setRoles([]);
      setToast("Bot needs to be invited to the server first");
    }

    return loadedGuilds;
  }

  async function loadBase() {
    const loadedGuilds = await loadGuilds();
    const initialGuild = selectedGuild || form.guild_id || loadedGuilds[0]?.id || "";
    setAnnouncements(await api<Announcement[]>("/announcements"));
    setAllowedUsers(await api<AllowedUser[]>(initialGuild ? `/allowed-users?guild_id=${initialGuild}` : "/allowed-users"));
    setSettings(await api<Record<string, unknown>>("/settings"));
  }

  useEffect(() => {
    if (!token) {
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;
    async function bootstrapSession() {
      setIsCheckingSession(true);
      try {
        await validateSession();
        if (!cancelled) {
          setLoginError("");
          await loadBase();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!cancelled) {
          setToken(null);
          if (message === "Unauthorized" || message.includes("401")) {
            clearStoredToken();
            setLoginError("Session expired. Please log in again.");
          } else {
            setLoginError("Cannot connect to server. Check that the bot/API is running.");
          }
        }
      } finally {
        if (!cancelled) setIsCheckingSession(false);
      }
    }

    void bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!selectedGuild || !token) return;
    localStorage.setItem(preferenceKeys.guildId, selectedGuild);
    void api<Channel[]>(`/guilds/${selectedGuild}/channels`).then((loadedChannels) => {
      setChannels(loadedChannels);
      setForm((current) => ({
        ...current,
        guild_id: selectedGuild,
        channel_id: loadedChannels.some((channel) => channel.id === current.channel_id)
          ? current.channel_id
          : loadedChannels.find((channel) => channel.id === getStoredChannelForGuild(selectedGuild))?.id ||
            loadedChannels[0]?.id ||
            ""
      }));
    });
    void api<Role[]>(`/guilds/${selectedGuild}/roles`).then(setRoles).catch((err) => setError(err.message));
    void api<AllowedUser[]>(`/allowed-users?guild_id=${selectedGuild}`).then(setAllowedUsers);
  }, [selectedGuild, token]);

  useEffect(() => {
    if (form.guild_id && form.channel_id) {
      storeChannelForGuild(form.guild_id, form.channel_id);
    }
  }, [form.guild_id, form.channel_id]);

  async function refreshGuilds() {
    setIsRefreshingGuilds(true);
    try {
      const beforeIds = new Set(guilds.map((guild) => guild.id));
      const result = await api<{ guilds: Guild[]; added: number }>("/guilds/refresh", { method: "POST" });
      setGuilds(result.guilds);

      const nextGuildId =
        result.guilds.find((guild) => guild.id === selectedGuild)?.id ||
        result.guilds.find((guild) => guild.id === localStorage.getItem(preferenceKeys.guildId))?.id ||
        result.guilds.find((guild) => !beforeIds.has(guild.id))?.id ||
        result.guilds[0]?.id ||
        "";
      setSelectedGuild(nextGuildId);

      if (!result.guilds.length) {
        setToast("Bot needs to be invited to the server first");
      } else {
        setToast(result.added > 0 ? "Servers refreshed" : "No new servers found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh servers");
    } finally {
      setIsRefreshingGuilds(false);
    }
  }

  async function openInviteUrl() {
    try {
      const { url } = await api<{ url: string }>("/bot/invite-url");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invite link");
    }
  }

  useEffect(() => {
    if (!selectedGuild || userSearch.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void api<DiscordUser[]>(`/guilds/${selectedGuild}/users?search=${encodeURIComponent(userSearch)}`)
        .then(setSuggestions)
        .catch((err) => setError(err.message));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [userSearch, selectedGuild]);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password") as string;
    const rememberDevice = new FormData(event.currentTarget).get("rememberDevice") === "on";

    try {
      const { token: nextToken } = await login(password, rememberDevice);
      setStoredToken(nextToken, rememberDevice);
      setLoginError("");
      setToken(nextToken);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Invalid password");
    }
  }

  async function saveAnnouncement(event: FormEvent) {
    event.preventDefault();
    if (!form.time) {
      setError("Please select a time.");
      return;
    }

    const scheduledAt = DateTime.fromISO(`${form.date}T${form.time}`, { zone: form.timezone }).toUTC().toISO();
    if (!scheduledAt) {
      setError("Please select a valid date and time.");
      return;
    }
    if (form.gif_url && !isAnnouncementMediaUrl(form.gif_url)) {
      setError("Please enter a valid GIF or image URL.");
      return;
    }

    const payload = {
      guild_id: form.guild_id,
      channel_id: form.channel_id,
      title: form.title,
      message: form.message,
      gif_url: form.gif_url || null,
      giphy_id: form.giphy_id || null,
      giphy_title: form.giphy_title || null,
      scheduled_at: scheduledAt,
      timezone: form.timezone,
      repeat_type: form.repeat_type,
      status: form.status
    };
    const isEditing = Boolean(editingId);
    setIsSavingAnnouncement(true);
    setError("");
    try {
      const saved = isEditing
        ? await api<AnnouncementSaveResponse>(`/announcements/${editingId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
          })
        : await api<AnnouncementSaveResponse>("/announcements", {
            method: "POST",
            body: JSON.stringify(payload)
          });

      localStorage.setItem(preferenceKeys.guildId, form.guild_id);
      storeChannelForGuild(form.guild_id, form.channel_id);
      setForm(createEmptyForm({ guild_id: form.guild_id, channel_id: form.channel_id, date: form.date }));
      setEditingId(null);
      setAnnouncements(await api<Announcement[]>("/announcements"));

      if (saved.movedToNextOccurrence) {
        const nextSend = DateTime.fromISO(saved.scheduled_at)
          .setZone(saved.timezone)
          .toFormat("DD T");
        setToast(`This recurring reminder was moved to the next future occurrence: ${nextSend}.`);
      } else {
        setToast(isEditing ? "Changes saved." : "Announcement created.");
      }
    } catch (error) {
      console.error("Announcement save failed", error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("announcements.gif_url") || message.includes("announcements.giphy_")) {
        setError("Database schema is missing required GIF fields. Run the Supabase migration and try again.");
      } else {
        setError(message || (isEditing ? "Could not save changes." : "Could not create announcement."));
      }
    } finally {
      setIsSavingAnnouncement(false);
    }
  }

  function setQuickTime(kind: "plus15" | "plus30" | "plus60" | "tonight") {
    const zone = form.timezone || "UTC";
    const nextTime =
      kind === "tonight"
        ? "20:00"
        : DateTime.now()
            .setZone(zone)
            .plus({ minutes: kind === "plus15" ? 15 : kind === "plus30" ? 30 : 60 })
            .toFormat("HH:mm");
    setForm((current) => ({ ...current, time: nextTime }));
  }

  function addMention(selection: MentionSelection) {
    const textarea = messageRef.current;
    const start = textarea?.selectionStart ?? form.message.length;
    const end = textarea?.selectionEnd ?? form.message.length;
    if (form.message.includes(selection.syntax)) return;

    const nextMessage = `${form.message.slice(0, start)}${selection.syntax}${form.message.slice(end)}`;
    setForm((current) => ({ ...current, message: nextMessage }));
    if (selection.member) {
      setMentionMembers((current) => ({ ...current, [selection.member!.id]: selection.member! }));
    }
    if (selection.roleMayNotPing) {
      setToast("This role may not ping unless it is mentionable or the bot has permission to mention roles.");
    }
    if (selection.kind === "special") {
      const channel = channels.find((item) => item.id === form.channel_id);
      if (channel && !channel.can_mention_everyone) {
        setToast("Noobnouncer cannot use @everyone or @here in this channel. Grant the bot the Mention Everyone permission.");
      }
    }
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + selection.syntax.length, start + selection.syntax.length);
    }, 0);
  }

  const mentionChips = useMemo(() => {
    const mentions = extractDiscordMentions(form.message);
    const userSyntaxById = new Map(
      Array.from(form.message.matchAll(/<@!?(\d{17,20})>/g), (match) => [match[1], match[0]])
    );
    return [
      ...mentions.users.map((id) => ({ syntax: userSyntaxById.get(id) || `<@${id}>`, label: `@${mentionMembers[id]?.display_name || "member"}` })),
      ...mentions.roles.map((id) => ({ syntax: `<@&${id}>`, label: `@${roles.find((role) => role.id === id)?.name || "role"}` })),
      ...mentions.special.map((syntax) => ({ syntax, label: syntax }))
    ];
  }, [form.message, mentionMembers, roles]);

  function removeMention(syntax: string) {
    setForm((current) => ({
      ...current,
      message: current.message.split(syntax).join("").replace(/\s{2,}/g, " ").trim()
    }));
  }

  function editAnnouncement(item: Announcement) {
    const local = DateTime.fromISO(item.scheduled_at, { zone: item.timezone });
    setEditingId(item.id);
    setSelectedGuild(item.guild_id);
    setForm({
      title: item.title,
      guild_id: item.guild_id,
      channel_id: item.channel_id,
      message: item.message,
      gif_url: item.gif_url || "",
      giphy_id: item.giphy_id || "",
      giphy_title: item.giphy_title || "",
      date: local.toISODate() ?? "",
      time: local.toFormat("HH:mm"),
      timezone: item.timezone,
      repeat_type: item.repeat_type,
      status: item.status
    });
  }

  async function deleteAnnouncement(id: string) {
    await api(`/announcements/${id}`, { method: "DELETE" });
    setAnnouncements((items) => items.filter((item) => item.id !== id));
  }

  async function setStatus(item: Announcement, status: "scheduled" | "disabled") {
    await api<Announcement>(`/announcements/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    setAnnouncements(await api<Announcement[]>("/announcements"));
  }

  async function addAllowedUser(user: DiscordUser) {
    await api("/allowed-users", {
      method: "POST",
      body: JSON.stringify({ ...user, guild_id: selectedGuild })
    });
    setAllowedUsers(await api<AllowedUser[]>(`/allowed-users?guild_id=${selectedGuild}`));
    setUserSearch("");
    setSuggestions([]);
  }

  async function removeAllowedUser(id: string) {
    await api(`/allowed-users/${id}`, { method: "DELETE" });
    setAllowedUsers((users) => users.filter((user) => user.id !== id));
  }

  function logout() {
    clearStoredToken();
    setToken(null);
    setLoginError("");
  }

  if (!token || isCheckingSession) {
    return (
      <main className="login-screen">
        <form className="login-panel" onSubmit={onLogin}>
          <div className="mark">DS</div>
          <h1>Discord Scheduler</h1>
          <p>Admin access for announcement scheduling.</p>
          {loginError && <div className="login-error">{loginError}</div>}
          <input name="password" type="password" placeholder="Admin password" required />
          <label className="remember-device">
            <input name="rememberDevice" type="checkbox" defaultChecked />
            <span>Remember this device</span>
          </label>
          <button type="submit" disabled={isCheckingSession}>
            {isCheckingSession ? "Checking session" : "Log in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>DS</span><strong>Scheduler</strong></div>
        <nav>
          <button className={page === "announcements" ? "active" : ""} onClick={() => setPage("announcements")}><ListBullets /> Announcements</button>
          <button className={page === "users" ? "active" : ""} onClick={() => setPage("users")}><Users /> Allowed Users</button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}><GearSix /> Settings</button>
        </nav>
        <button className="logout" onClick={logout}>Log out</button>
      </aside>

      <main className="workspace">
        {error && <div className="notice"><span>{error}</span><button onClick={() => setError("")}><X /></button></div>}
        {toast && <div className="toast"><span>{toast}</span><button onClick={() => setToast("")}><X /></button></div>}
        {page === "announcements" && (
          <>
            <header className="topbar">
              <div>
                <p>Announcements</p>
                <h1>Schedule Discord messages</h1>
              </div>
              <div className="server-controls">
                <select value={selectedGuild} onChange={(event) => setSelectedGuild(event.target.value)}>
                  {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
                </select>
                <button type="button" onClick={refreshGuilds} disabled={isRefreshingGuilds}>
                  <ArrowClockwise /> {isRefreshingGuilds ? "Refreshing" : "Refresh servers"}
                </button>
                <button type="button" onClick={openInviteUrl}>
                  <LinkSimple /> Invite bot
                </button>
              </div>
            </header>

            <section className="panel">
              <form className="announcement-form" onSubmit={saveAnnouncement}>
                <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                <div className="field-grid">
                  <select value={form.guild_id} onChange={(e) => setSelectedGuild(e.target.value)} required>
                    {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
                  </select>
                  <select value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })} required>
                    {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
                  </select>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                  <div className="time-field">
                    <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
                    <div className="quick-times">
                      <button type="button" onClick={() => setQuickTime("plus15")}>+15 min</button>
                      <button type="button" onClick={() => setQuickTime("plus30")}>+30 min</button>
                      <button type="button" onClick={() => setQuickTime("plus60")}>+1 hour</button>
                      <button type="button" onClick={() => setQuickTime("tonight")}>Tonight 20:00</button>
                    </div>
                  </div>
                  <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {TIMEZONE_OPTIONS.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone}
                      </option>
                    ))}
                  </select>
                  <select value={form.repeat_type} onChange={(e) => setForm({ ...form, repeat_type: e.target.value })}>
                    <option value="none">No repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="every_two_weeks">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="message-tools"><button type="button" onClick={() => setIsMentionPickerOpen(true)}>Add mention</button></div>
                <textarea ref={messageRef} placeholder="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
                {mentionChips.length > 0 && <div className="mention-chips">{mentionChips.map((chip) => <button key={chip.syntax} type="button" onClick={() => removeMention(chip.syntax)} title={`Remove ${chip.label}`}>{chip.label} <X /></button>)}</div>}
                <div className="gif-picker-controls">
                  <button
                    type="button"
                    className="gif-button"
                    onClick={() => setIsGiphyPickerOpen(true)}
                    disabled={!GIPHY_API_KEY}
                  >
                    {form.gif_url ? "Change GIF" : "GIF"}
                  </button>
                  {form.gif_url && (
                    <button
                      type="button"
                      className="remove-gif-button"
                      onClick={() => setForm((current) => ({ ...current, gif_url: "", giphy_id: "", giphy_title: "" }))}
                    >
                      Remove GIF
                    </button>
                  )}
                  {!GIPHY_API_KEY && <span>GIPHY is not configured.</span>}
                </div>
                {form.gif_url && (
                  <div className="selected-gif-preview">
                    <img src={form.gif_url} alt={form.giphy_title || "Selected GIF"} />
                    <span>{form.giphy_title || "Selected GIF"}</span>
                  </div>
                )}
                {form.guild_id && !channels.length && (
                  <div className="helper-message">
                    No available text channels found. The bot may need View Channels and Send Messages permissions in this server.
                  </div>
                )}
                <div className="form-actions">
                  <button className="primary" type="submit" disabled={!channels.length || isSavingAnnouncement}><Plus /> {isSavingAnnouncement ? (editingId ? "Saving..." : "Creating...") : editingId ? "Save changes" : "Create announcement"}</button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(createEmptyForm({ guild_id: selectedGuild, channel_id: form.channel_id, date: form.date })); }}>Cancel</button>}
                </div>
              </form>
            </section>

            <section className="list">
              {announcements.map((item) => (
                <article className="announcement" key={item.id}>
                  <div className="announcement-main">
                    <div className="icon-cell"><CalendarBlank /></div>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.message.slice(0, 140)}{item.message.length > 140 ? "..." : ""}</p>
                      <div className="meta">
                        <span>#{channelById[item.channel_id]?.name ?? item.channel_id}</span>
                        <span>{DateTime.fromISO(item.scheduled_at).setZone(item.timezone).toFormat("DD T")}</span>
                        <span>{item.repeat_type}</span>
                        {item.gif_url && <span>GIF</span>}
                        <span>Auto-delete: {AUTO_DELETE_LABEL}</span>
                        <span className={`status ${item.status}`}>{item.status}</span>
                      </div>
                    </div>
                  </div>
                  <div className="row-actions">
                    <button title="Edit" onClick={() => editAnnouncement(item)}><PencilSimple /></button>
                    <button title="Disable" onClick={() => setStatus(item, item.status === "disabled" ? "scheduled" : "disabled")}><Prohibit /></button>
                    <button title="Delete" className="danger" onClick={() => deleteAnnouncement(item.id)}><Trash /></button>
                  </div>
                </article>
              ))}
              {!announcements.length && <div className="empty">No announcements yet.</div>}
            </section>
          </>
        )}

        {page === "users" && (
          <section className="panel users-panel">
            <header className="section-header">
              <div><p>Allowed Users</p><h1>Control command access</h1></div>
              <select value={selectedGuild} onChange={(event) => setSelectedGuild(event.target.value)}>
                {guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
              </select>
            </header>
            <div className="search-box">
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search username or display name" />
              {suggestions.length > 0 && (
                <div className="suggestions">
                  {suggestions.map((user) => (
                    <button key={user.discord_user_id} onClick={() => addAllowedUser(user)}>
                      {user.avatar_url && <img src={user.avatar_url} alt="" />}
                      <span>{user.display_name || user.username}</span>
                      <small>@{user.username}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="user-list">
              {allowedUsers.map((user) => (
                <div className="user-row" key={user.id}>
                  {user.avatar_url && <img src={user.avatar_url} alt="" />}
                  <strong>{user.display_name || user.username}</strong>
                  <span>@{user.username}</span>
                  <button onClick={() => removeAllowedUser(user.id)}><Trash /></button>
                </div>
              ))}
            </div>
          </section>
        )}

        {page === "settings" && (
          <section className="panel settings-panel">
            <header className="section-header">
              <div><p>Settings</p><h1>Runtime status</h1></div>
              <div className="server-controls">
                <button type="button" onClick={refreshGuilds} disabled={isRefreshingGuilds}>
                  <ArrowClockwise /> {isRefreshingGuilds ? "Refreshing" : "Refresh servers"}
                </button>
                <button type="button" onClick={openInviteUrl}><LinkSimple /> Invite bot</button>
              </div>
            </header>
            <dl>
              <div><dt>Default timezone</dt><dd>{String(settings?.defaultTimezone ?? "Europe/Bucharest")}</dd></div>
              <div><dt>Bot user</dt><dd>{settings?.botUser ? JSON.stringify(settings.botUser) : "Not ready"}</dd></div>
              <div><dt>Guilds</dt><dd>{String(settings?.guildCount ?? 0)}</dd></div>
            </dl>
          </section>
        )}
      </main>
      {isGiphyPickerOpen && GIPHY_API_KEY && (
        <GiphyPickerModal
          apiKey={GIPHY_API_KEY}
          onClose={() => setIsGiphyPickerOpen(false)}
          onSelect={(gif) => {
            setForm((current) => ({
              ...current,
              gif_url: gif.url,
              giphy_id: gif.id,
              giphy_title: gif.title
            }));
            setIsGiphyPickerOpen(false);
          }}
        />
      )}
      {isMentionPickerOpen && form.guild_id && (
        <MentionPickerModal
          guildId={form.guild_id}
          roles={roles}
          selectedMessage={form.message}
          onClose={() => setIsMentionPickerOpen(false)}
          onSelect={(selection) => {
            addMention(selection);
            setIsMentionPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
