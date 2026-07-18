import { FormEvent, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api } from "./api";

type Role = { id: string; name: string; color: string | null; mentionable: boolean };
type GuildMember = {
  id: string;
  username: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string;
  bot: boolean;
};

export type MentionSelection = {
  syntax: string;
  label: string;
  kind: "member" | "role" | "special";
  member?: GuildMember;
  roleMayNotPing?: boolean;
};

type MentionPickerModalProps = {
  guildId: string;
  roles: Role[];
  selectedMessage: string;
  onClose: () => void;
  onSelect: (selection: MentionSelection) => void;
};

type Tab = "members" | "roles" | "special";

export function MentionPickerModal({ guildId, roles, selectedMessage, onClose, onSelect }: MentionPickerModalProps) {
  const [tab, setTab] = useState<Tab>("members");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const value = query.trim();
    if (tab !== "members" || value.length < 2) {
      setMembers([]);
      setSearchError("");
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError("");
      void api<GuildMember[]>(`/guilds/${guildId}/members/search?q=${encodeURIComponent(value)}`)
        .then((result) => {
          if (!cancelled) setMembers(result);
        })
        .catch((error) => {
          if (!cancelled) setSearchError(error instanceof Error ? error.message : "Could not search members.");
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [guildId, query, tab]);

  function choose(selection: MentionSelection) {
    if (!selectedMessage.includes(selection.syntax)) onSelect(selection);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <div className="mention-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="mention-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mention-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mention-modal-header">
          <div>
            <h2 id="mention-picker-title">Add mention</h2>
            <p>Choose who to mention</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close mention picker" title="Close mention picker">
            <X />
          </button>
        </header>
        <div className="mention-tabs" role="tablist" aria-label="Mention type">
          {(["members", "roles", "special"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div className="mention-picker-content">
          {tab === "members" && (
            <>
              <form onSubmit={submitSearch}>
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" aria-label="Search members" />
              </form>
              {query.trim().length < 2 && <p className="mention-picker-hint">Type at least 2 characters to search this server.</p>}
              {isSearching && <p className="mention-picker-hint">Searching members...</p>}
              {searchError && <p className="mention-picker-error">{searchError}</p>}
              {!isSearching && !searchError && query.trim().length >= 2 && !members.length && <p className="mention-picker-hint">No members found.</p>}
              <div className="mention-option-list">
                {members.map((member) => {
                  const syntax = `<@${member.id}>`;
                  const selected = selectedMessage.includes(syntax);
                  return (
                    <button key={member.id} type="button" disabled={selected} onClick={() => choose({ syntax, label: `@${member.display_name}`, kind: "member", member })}>
                      <img src={member.avatar_url} alt="" />
                      <span><strong>{member.display_name}</strong><small>@{member.username}{member.bot ? " · Bot" : ""}</small></span>
                      {selected && <em>Added</em>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {tab === "roles" && (
            <div className="mention-option-list">
              {roles.map((role) => {
                const syntax = `<@&${role.id}>`;
                const selected = selectedMessage.includes(syntax);
                return (
                  <button key={role.id} type="button" disabled={selected} onClick={() => choose({ syntax, label: `@${role.name}`, kind: "role", roleMayNotPing: !role.mentionable })}>
                    <i style={{ background: role.color || "#87919b" }} />
                    <span><strong>{role.name}</strong><small>{role.mentionable ? "Mentionable" : "May not ping"}</small></span>
                    {selected && <em>Added</em>}
                  </button>
                );
              })}
              {!roles.length && <p className="mention-picker-hint">No roles available for this server.</p>}
            </div>
          )}
          {tab === "special" && (
            <div className="mention-option-list special-mentions">
              <p>Mass mentions may notify many server members. Use carefully.</p>
              {["@everyone", "@here"].map((syntax) => {
                const selected = selectedMessage.includes(syntax);
                return <button key={syntax} type="button" disabled={selected} onClick={() => choose({ syntax, label: syntax, kind: "special" })}><span><strong>{syntax}</strong><small>{syntax === "@everyone" ? "Notify everyone with channel access" : "Notify online members with channel access"}</small></span>{selected && <em>Added</em>}</button>;
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
