import type { SessionInfo } from "./api";
type Props = { session: SessionInfo; error: string; refreshing: boolean; onRefresh: () => void; onInvite: () => void; onLogout: () => void };
export function EmptyGuildState({ session, error, refreshing, onRefresh, onInvite, onLogout }: Props) {
  return <main className="login-screen"><section className="login-panel">
    <h1>No authorized servers</h1>
    <p>{session.isBotOwner
      ? `Signed in as ${session.user.username}. Invite Noobnouncer to a server, then refresh to start scheduling.`
      : `Signed in as ${session.user.username}. Ask a server administrator to grant editor access, or use an account with Manage Server permission.`}</p>
    {error && <p role="alert">{error}</p>}
    {session.isBotOwner && <button onClick={onInvite}>Invite bot</button>}
    <button onClick={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing" : "Refresh servers"}</button>
    <button onClick={onLogout}>Logout</button>
  </section></main>;
}
