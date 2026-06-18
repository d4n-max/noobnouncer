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
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AllowedUser, Announcement } from "@scheduler/shared";
import { api, login } from "./api";
import { TIMEZONE_OPTIONS } from "./timezones";

type Guild = { id: string; name: string; icon_url: string | null };
type Channel = { id: string; guild_id: string; name: string; can_send: boolean };
type DiscordUser = {
  discord_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
};
type Page = "announcements" | "users" | "settings";

const defaultForm = {
  title: "",
  guild_id: "",
  channel_id: "",
  message: "",
  date: DateTime.now().setZone("Europe/Bucharest").toISODate() ?? "",
  time: DateTime.now().setZone("Europe/Bucharest").plus({ hours: 1 }).toFormat("HH:mm"),
  timezone: "Europe/Bucharest",
  repeat_type: "none",
  status: "scheduled"
};

export function App() {
  const [token, setToken] = useState(localStorage.getItem("scheduler_token"));
  const [page, setPage] = useState<Page>("announcements");
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUser[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedGuild, setSelectedGuild] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [suggestions, setSuggestions] = useState<DiscordUser[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [isRefreshingGuilds, setIsRefreshingGuilds] = useState(false);

  const channelById = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
    [channels]
  );

  async function loadGuilds(preferredGuildId = selectedGuild) {
    const loadedGuilds = await api<Guild[]>("/guilds");
    setGuilds(loadedGuilds);
    const initialGuild = preferredGuildId || form.guild_id || loadedGuilds[0]?.id || "";
    setSelectedGuild(initialGuild);
    setForm((current) => ({ ...current, guild_id: current.guild_id || initialGuild }));

    if (initialGuild) {
      const loadedChannels = await api<Channel[]>(`/guilds/${initialGuild}/channels`);
      setChannels(loadedChannels);
      setForm((current) => ({ ...current, channel_id: current.channel_id || loadedChannels[0]?.id || "" }));
    } else {
      setChannels([]);
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
    if (!token) return;
    void loadBase().catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!selectedGuild || !token) return;
    void api<Channel[]>(`/guilds/${selectedGuild}/channels`).then((loadedChannels) => {
      setChannels(loadedChannels);
      setForm((current) => ({
        ...current,
        guild_id: selectedGuild,
        channel_id: loadedChannels.some((channel) => channel.id === current.channel_id)
          ? current.channel_id
          : loadedChannels[0]?.id ?? ""
      }));
    });
    void api<AllowedUser[]>(`/allowed-users?guild_id=${selectedGuild}`).then(setAllowedUsers);
  }, [selectedGuild, token]);

  async function refreshGuilds() {
    setIsRefreshingGuilds(true);
    try {
      const beforeIds = new Set(guilds.map((guild) => guild.id));
      const result = await api<{ guilds: Guild[]; added: number }>("/guilds/refresh", { method: "POST" });
      setGuilds(result.guilds);

      const nextGuildId =
        result.guilds.find((guild) => guild.id === selectedGuild)?.id ||
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
    const { token: nextToken } = await login(password);
    localStorage.setItem("scheduler_token", nextToken);
    setToken(nextToken);
  }

  async function saveAnnouncement(event: FormEvent) {
    event.preventDefault();
    const scheduledAt = DateTime.fromISO(`${form.date}T${form.time}`, { zone: form.timezone }).toUTC().toISO();
    if (!scheduledAt) return;

    const payload = {
      guild_id: form.guild_id,
      channel_id: form.channel_id,
      title: form.title,
      message: form.message,
      scheduled_at: scheduledAt,
      timezone: form.timezone,
      repeat_type: form.repeat_type,
      status: form.status
    };
    if (editingId) {
      await api(`/announcements/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/announcements", { method: "POST", body: JSON.stringify(payload) });
    }
    setForm({ ...defaultForm, guild_id: selectedGuild, channel_id: channels[0]?.id ?? "" });
    setEditingId(null);
    setAnnouncements(await api<Announcement[]>("/announcements"));
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
    const updated = await api<Announcement>(`/announcements/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    setAnnouncements((items) => items.map((row) => (row.id === item.id ? updated : row)));
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

  if (!token) {
    return (
      <main className="login-screen">
        <form className="login-panel" onSubmit={onLogin}>
          <div className="mark">DS</div>
          <h1>Discord Scheduler</h1>
          <p>Admin access for announcement scheduling.</p>
          <input name="password" type="password" placeholder="Admin password" required />
          <button type="submit">Log in</button>
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
        <button className="logout" onClick={() => { localStorage.removeItem("scheduler_token"); setToken(null); }}>Log out</button>
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
                  <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required />
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
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <textarea placeholder="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
                {form.guild_id && !channels.length && (
                  <div className="helper-message">
                    No available text channels found. The bot may need View Channels and Send Messages permissions in this server.
                  </div>
                )}
                <div className="form-actions">
                  <button className="primary" type="submit" disabled={!channels.length}><Plus /> {editingId ? "Save changes" : "Create announcement"}</button>
                  {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(defaultForm); }}>Cancel</button>}
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
    </div>
  );
}
