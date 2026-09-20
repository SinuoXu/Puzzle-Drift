create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_normalized text not null unique,
  created_at timestamptz not null default now(),
  constraint app_users_username_length
    check (char_length(btrim(username)) between 1 and 24)
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists app_sessions_user_id_idx
  on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx
  on public.app_sessions(expires_at);

create table if not exists public.list_items (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint list_items_content_length
    check (char_length(btrim(content)) between 1 and 200)
);

create index if not exists list_items_created_at_idx
  on public.list_items(created_at desc);
create index if not exists list_items_created_by_idx
  on public.list_items(created_by);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.list_items enable row level security;

revoke all on table public.app_users from anon, authenticated;
revoke all on table public.app_sessions from anon, authenticated;
revoke all on table public.list_items from anon, authenticated;

grant all on table public.app_users to service_role;
grant all on table public.app_sessions to service_role;
grant all on table public.list_items to service_role;
