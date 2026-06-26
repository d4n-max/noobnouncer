create extension if not exists pgcrypto;

create table if not exists public.guilds (
  id text primary key,
  name text not null,
  icon_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.channels (
  id text primary key,
  guild_id text not null references public.guilds(id) on delete cascade,
  name text not null,
  type text not null default 'text',
  can_send boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds(id) on delete cascade,
  channel_id text not null references public.channels(id) on delete cascade,
  title text not null,
  message text not null,
  scheduled_at timestamptz not null,
  timezone text not null default 'Europe/Bucharest',
  repeat_type text not null default 'none' check (repeat_type in ('none', 'daily', 'weekly', 'monthly')),
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'disabled')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  locked_until timestamptz
);

create table if not exists public.allowed_users (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references public.guilds(id) on delete cascade,
  discord_user_id text not null,
  username text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  unique (guild_id, discord_user_id)
);

create table if not exists public.delivery_logs (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  guild_id text not null references public.guilds(id) on delete cascade,
  channel_id text not null references public.channels(id) on delete cascade,
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  sent_at timestamptz not null default now(),
  discord_message_id text,
  delete_at timestamptz,
  deleted_at timestamptz,
  delete_status text check (delete_status in ('pending', 'deleted', 'failed')),
  delete_error_message text
);

alter table public.delivery_logs add column if not exists discord_message_id text;
alter table public.delivery_logs add column if not exists delete_at timestamptz;
alter table public.delivery_logs add column if not exists deleted_at timestamptz;
alter table public.delivery_logs add column if not exists delete_status text;
alter table public.delivery_logs add column if not exists delete_error_message text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'delivery_logs_delete_status_check'
      and conrelid = 'public.delivery_logs'::regclass
  ) then
    alter table public.delivery_logs
      add constraint delivery_logs_delete_status_check
      check (delete_status in ('pending', 'deleted', 'failed'));
  end if;
end;
$$;

create index if not exists announcements_due_idx
  on public.announcements (status, scheduled_at)
  where status = 'scheduled';

update public.announcements
set status = 'scheduled',
    updated_at = now()
where status = 'sent'
  and scheduled_at > now();

update public.announcements
set status = 'scheduled',
    updated_at = now()
where status = 'sent'
  and repeat_type <> 'none';

create index if not exists announcements_guild_idx on public.announcements (guild_id);
create index if not exists allowed_users_guild_idx on public.allowed_users (guild_id);
create index if not exists delivery_logs_announcement_idx on public.delivery_logs (announcement_id);
create index if not exists delivery_logs_pending_delete_idx
  on public.delivery_logs (delete_status, delete_at)
  where delete_status = 'pending';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_guilds_updated_at on public.guilds;
create trigger touch_guilds_updated_at
before update on public.guilds
for each row execute function public.touch_updated_at();

drop trigger if exists touch_channels_updated_at on public.channels;
create trigger touch_channels_updated_at
before update on public.channels
for each row execute function public.touch_updated_at();

drop trigger if exists touch_announcements_updated_at on public.announcements;
create trigger touch_announcements_updated_at
before update on public.announcements
for each row execute function public.touch_updated_at();

alter table public.guilds enable row level security;
alter table public.channels enable row level security;
alter table public.announcements enable row level security;
alter table public.allowed_users enable row level security;
alter table public.delivery_logs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.guilds to service_role;
grant select, insert, update, delete on public.channels to service_role;
grant select, insert, update, delete on public.announcements to service_role;
grant select, insert, update, delete on public.allowed_users to service_role;
grant select, insert, update, delete on public.delivery_logs to service_role;
grant usage, select on all sequences in schema public to service_role;
