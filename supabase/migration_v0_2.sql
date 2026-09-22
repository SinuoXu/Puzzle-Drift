-- Puzzle Drift v0.2 migration
-- Safe to run on top of the v0.1 database.
-- It keeps the old list_items table untouched.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Existing users: add profile/admin fields.
-- ---------------------------------------------------------------------------

alter table public.app_users
  add column if not exists avatar_url text;

alter table public.app_users
  add column if not exists is_admin boolean not null default false;

-- nono is the initial administrator.
update public.app_users
set is_admin = true
where username_normalized = 'nono';

-- ---------------------------------------------------------------------------
-- Puzzles
-- ---------------------------------------------------------------------------

create table if not exists public.puzzles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null default '',
  description text not null default '',
  cover_url text not null,
  owner_id uuid not null references public.app_users(id) on delete cascade,
  current_holder_id uuid not null references public.app_users(id) on delete restrict,
  availability text not null default 'active'
    check (availability in ('active', 'paused', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint puzzles_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint puzzles_brand_length check (char_length(brand) <= 80),
  constraint puzzles_description_length check (char_length(description) <= 1000)
);

create index if not exists puzzles_owner_idx on public.puzzles(owner_id);
create index if not exists puzzles_current_holder_idx on public.puzzles(current_holder_id);
create index if not exists puzzles_created_at_idx on public.puzzles(created_at desc);
create index if not exists puzzles_brand_idx on public.puzzles(brand);

-- ---------------------------------------------------------------------------
-- Journey / queue
-- One row represents one person's turn with a puzzle.
-- seq=0 is the owner's initial turn.
-- ---------------------------------------------------------------------------

create table if not exists public.puzzle_journey (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.puzzles(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete restrict,
  seq integer not null check (seq >= 0),
  status text not null default 'waiting'
    check (status in ('waiting', 'current', 'completed', 'cancelled')),
  is_owner_start boolean not null default false,
  joined_at timestamptz not null default now(),

  received_on date,
  received_photo_url text,
  receiving_note text not null default '',

  shipped_on date,
  shipping_photo_url text,
  shipping_note text not null default '',

  constraint puzzle_journey_seq_unique unique (puzzle_id, seq),
  constraint puzzle_journey_receiving_note_len check (char_length(receiving_note) <= 1000),
  constraint puzzle_journey_shipping_note_len check (char_length(shipping_note) <= 1000)
);

create index if not exists puzzle_journey_puzzle_idx
  on public.puzzle_journey(puzzle_id, seq);

create index if not exists puzzle_journey_user_idx
  on public.puzzle_journey(user_id);

create unique index if not exists puzzle_journey_one_active_turn_per_user
  on public.puzzle_journey(puzzle_id, user_id)
  where status in ('waiting', 'current');

-- ---------------------------------------------------------------------------
-- Activity feed ("消息中心" / public feed)
-- ---------------------------------------------------------------------------

create table if not exists public.puzzle_activity (
  id bigserial primary key,
  type text not null,
  puzzle_id uuid not null references public.puzzles(id) on delete cascade,
  actor_id uuid references public.app_users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists puzzle_activity_created_at_idx
  on public.puzzle_activity(created_at desc);

create index if not exists puzzle_activity_puzzle_idx
  on public.puzzle_activity(puzzle_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists puzzles_touch_updated_at on public.puzzles;
create trigger puzzles_touch_updated_at
before update on public.puzzles
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Activity triggers.
-- These make the feed consistent even if we add more server routes later.
-- ---------------------------------------------------------------------------

create or replace function public.log_puzzle_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
  values (
    'puzzle_created',
    new.id,
    new.owner_id,
    jsonb_build_object('name', new.name, 'brand', new.brand)
  );
  return new;
end;
$$;

drop trigger if exists puzzle_created_activity on public.puzzles;
create trigger puzzle_created_activity
after insert on public.puzzles
for each row execute function public.log_puzzle_created();

create or replace function public.log_journey_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_owner_start then
    insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
    values (
      'queue_joined',
      new.puzzle_id,
      new.user_id,
      jsonb_build_object('seq', new.seq)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists journey_insert_activity on public.puzzle_journey;
create trigger journey_insert_activity
after insert on public.puzzle_journey
for each row execute function public.log_journey_insert();

create or replace function public.log_journey_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.received_on is null and new.received_on is not null then
    insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
    values (
      'received',
      new.puzzle_id,
      new.user_id,
      jsonb_build_object('received_on', new.received_on)
    );
  end if;

  if old.shipped_on is null and new.shipped_on is not null then
    insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
    values (
      'shipped',
      new.puzzle_id,
      new.user_id,
      jsonb_build_object('shipped_on', new.shipped_on)
    );
  end if;

  if old.status = 'waiting' and new.status = 'current' then
    insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
    values (
      'became_holder',
      new.puzzle_id,
      new.user_id,
      jsonb_build_object('seq', new.seq)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists journey_update_activity on public.puzzle_journey;
create trigger journey_update_activity
after update on public.puzzle_journey
for each row execute function public.log_journey_update();

create or replace function public.log_puzzle_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.availability is distinct from new.availability then
    insert into public.puzzle_activity(type, puzzle_id, actor_id, payload)
    values (
      'availability_changed',
      new.id,
      new.owner_id,
      jsonb_build_object('availability', new.availability)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists puzzle_status_activity on public.puzzles;
create trigger puzzle_status_activity
after update on public.puzzles
for each row execute function public.log_puzzle_status_change();

-- ---------------------------------------------------------------------------
-- Atomic RPCs.
-- All multi-table state changes happen inside PostgreSQL transactions.
-- ---------------------------------------------------------------------------

create or replace function public.create_puzzle_with_owner(
  p_name text,
  p_brand text,
  p_cover_url text,
  p_description text,
  p_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puzzle_id uuid;
begin
  insert into public.puzzles(
    name, brand, cover_url, description, owner_id, current_holder_id
  )
  values (
    btrim(p_name),
    btrim(coalesce(p_brand, '')),
    p_cover_url,
    btrim(coalesce(p_description, '')),
    p_owner_id,
    p_owner_id
  )
  returning id into v_puzzle_id;

  insert into public.puzzle_journey(
    puzzle_id, user_id, seq, status, is_owner_start
  )
  values (
    v_puzzle_id, p_owner_id, 0, 'current', true
  );

  return v_puzzle_id;
end;
$$;

create or replace function public.join_puzzle_queue(
  p_puzzle_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_puzzle public.puzzles%rowtype;
  v_next_seq integer;
  v_id uuid;
begin
  select * into v_puzzle
  from public.puzzles
  where id = p_puzzle_id
  for update;

  if not found then
    raise exception 'Puzzle not found';
  end if;

  if v_puzzle.availability <> 'active' then
    raise exception 'This puzzle is not open for queueing';
  end if;

  if v_puzzle.owner_id = p_user_id then
    raise exception 'The owner cannot queue for their own puzzle';
  end if;

  if exists (
    select 1
    from public.puzzle_journey
    where puzzle_id = p_puzzle_id
      and user_id = p_user_id
      and status in ('waiting', 'current')
  ) then
    raise exception 'You are already in this queue';
  end if;

  select coalesce(max(seq), 0) + 1
  into v_next_seq
  from public.puzzle_journey
  where puzzle_id = p_puzzle_id;

  insert into public.puzzle_journey(
    puzzle_id, user_id, seq, status, is_owner_start
  )
  values (
    p_puzzle_id, p_user_id, v_next_seq, 'waiting', false
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.cancel_puzzle_queue(
  p_puzzle_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.puzzle_journey
  set status = 'cancelled'
  where puzzle_id = p_puzzle_id
    and user_id = p_user_id
    and status = 'waiting';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.mark_puzzle_received(
  p_puzzle_id uuid,
  p_user_id uuid,
  p_received_on date,
  p_received_photo_url text,
  p_receiving_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turn public.puzzle_journey%rowtype;
begin
  select * into v_turn
  from public.puzzle_journey
  where puzzle_id = p_puzzle_id
    and user_id = p_user_id
    and status = 'current'
  for update;

  if not found then
    raise exception 'You are not the current holder';
  end if;

  if v_turn.is_owner_start then
    raise exception 'The initial owner turn does not need a receiving record';
  end if;

  if v_turn.received_on is not null then
    raise exception 'Receiving record already exists';
  end if;

  update public.puzzle_journey
  set
    received_on = p_received_on,
    received_photo_url = p_received_photo_url,
    receiving_note = btrim(coalesce(p_receiving_note, ''))
  where id = v_turn.id;

  return true;
end;
$$;

create or replace function public.mark_puzzle_shipped(
  p_puzzle_id uuid,
  p_user_id uuid,
  p_shipped_on date,
  p_shipping_photo_url text,
  p_shipping_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turn public.puzzle_journey%rowtype;
  v_next public.puzzle_journey%rowtype;
begin
  -- Lock puzzle first so two shipping operations cannot advance the same puzzle.
  perform 1
  from public.puzzles
  where id = p_puzzle_id
  for update;

  if not found then
    raise exception 'Puzzle not found';
  end if;

  select * into v_turn
  from public.puzzle_journey
  where puzzle_id = p_puzzle_id
    and user_id = p_user_id
    and status = 'current'
  for update;

  if not found then
    raise exception 'You are not the current holder';
  end if;

  if v_turn.shipped_on is not null then
    raise exception 'Shipping record already exists';
  end if;

  if not v_turn.is_owner_start and v_turn.received_on is null then
    raise exception 'Please add the receiving record before shipping';
  end if;

  select * into v_next
  from public.puzzle_journey
  where puzzle_id = p_puzzle_id
    and status = 'waiting'
    and seq > v_turn.seq
  order by seq asc
  limit 1
  for update;

  if not found then
    raise exception 'Nobody is waiting next';
  end if;

  update public.puzzle_journey
  set
    shipped_on = p_shipped_on,
    shipping_photo_url = p_shipping_photo_url,
    shipping_note = btrim(coalesce(p_shipping_note, '')),
    status = 'completed'
  where id = v_turn.id;

  update public.puzzle_journey
  set status = 'current'
  where id = v_next.id;

  update public.puzzles
  set current_holder_id = v_next.user_id
  where id = p_puzzle_id;

  return v_next.user_id;
end;
$$;

-- Only the server-side service role should invoke these RPCs.
revoke all on function public.create_puzzle_with_owner(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.join_puzzle_queue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_puzzle_queue(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_puzzle_received(uuid, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.mark_puzzle_shipped(uuid, uuid, date, text, text) from public, anon, authenticated;

grant execute on function public.create_puzzle_with_owner(text, text, text, text, uuid) to service_role;
grant execute on function public.join_puzzle_queue(uuid, uuid) to service_role;
grant execute on function public.cancel_puzzle_queue(uuid, uuid) to service_role;
grant execute on function public.mark_puzzle_received(uuid, uuid, date, text, text) to service_role;
grant execute on function public.mark_puzzle_shipped(uuid, uuid, date, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket for covers and retention photos.
-- Public reads are acceptable for this no-password V0.2 architecture.
-- Uploads still go through our server and use the service role.
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'puzzle-images',
  'puzzle-images',
  true,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS / permissions.
-- Browsers never query these tables directly in this version.
-- ---------------------------------------------------------------------------

alter table public.puzzles enable row level security;
alter table public.puzzle_journey enable row level security;
alter table public.puzzle_activity enable row level security;

revoke all on table public.puzzles from anon, authenticated;
revoke all on table public.puzzle_journey from anon, authenticated;
revoke all on table public.puzzle_activity from anon, authenticated;

grant all on table public.puzzles to service_role;
grant all on table public.puzzle_journey to service_role;
grant all on table public.puzzle_activity to service_role;
grant usage, select on sequence public.puzzle_activity_id_seq to service_role;
