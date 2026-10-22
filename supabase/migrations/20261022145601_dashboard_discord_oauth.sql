-- Apply only this migration to the existing scheduler database. No existing rows are changed.
begin;
create table if not exists public.dashboard_users (
  id text primary key check (id ~ '^[0-9]{17,20}$'),
  username text not null,
  avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.dashboard_access (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds(id) on delete cascade,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  role text not null default 'EDITOR' check (role = 'EDITOR'),
  granted_by text not null references public.dashboard_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, discord_user_id)
);
-- Grantees may not have logged in yet, so discord_user_id deliberately has no users FK.
create index if not exists dashboard_access_user_idx on public.dashboard_access(discord_user_id);
create index if not exists dashboard_access_granter_idx on public.dashboard_access(granted_by);
create table if not exists public.dashboard_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[a-f0-9]{64}$'),
  discord_user_id text not null references public.dashboard_users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dashboard_sessions_user_idx on public.dashboard_sessions(discord_user_id);
create index if not exists dashboard_sessions_expiry_idx on public.dashboard_sessions(expires_at);
create table if not exists public.dashboard_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[a-f0-9]{64}$'),
  verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists dashboard_oauth_states_expiry_idx on public.dashboard_oauth_states(expires_at);
alter table public.dashboard_users enable row level security;
alter table public.dashboard_access enable row level security;
alter table public.dashboard_sessions enable row level security;
alter table public.dashboard_oauth_states enable row level security;
revoke all on public.dashboard_users, public.dashboard_access, public.dashboard_sessions, public.dashboard_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_users, public.dashboard_access, public.dashboard_sessions, public.dashboard_oauth_states to service_role;
commit;
