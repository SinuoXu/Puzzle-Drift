-- Puzzle Drift v0.3: additive migration for databases already on v0.2.
-- Run only after taking a verified database and Storage backup.
-- Never run schema_fresh.sql against an existing database.
create extension if not exists pgcrypto;

alter table public.app_users add column if not exists pin_hash text;
alter table public.app_users add column if not exists pin_failed_count integer not null default 0;
alter table public.app_users add column if not exists pin_locked_until timestamptz;
alter table public.app_users add column if not exists session_version integer not null default 1;
alter table public.app_sessions add column if not exists session_version integer not null default 1;
alter table public.app_users add column if not exists shipping_address text;
alter table public.app_users add column if not exists payment_qr_url text;
update public.app_users set is_admin = true where username_normalized = 'nono';

create or replace function public.v03_pin_failed(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  select pin_failed_count into v_count from public.app_users where id=p_user_id for update;
  if not found then return; end if;
  if v_count + 1 >= 5 then
    update public.app_users set pin_failed_count=0,pin_locked_until=now()+interval '15 minutes' where id=p_user_id;
  else
    update public.app_users set pin_failed_count=v_count+1 where id=p_user_id;
  end if;
end $$;

create or replace function public.v03_pin_succeeded(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.app_users set pin_failed_count=0,pin_locked_until=null where id=p_user_id;
end $$;

create or replace function public.v03_claim_pin(p_user_id uuid, p_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.app_users set pin_hash=p_hash,pin_failed_count=0,pin_locked_until=null,session_version=session_version+1
  where id=p_user_id and pin_hash is null;
  if not found then return false; end if;
  return true;
end $$;

create or replace function public.v03_reset_pin(p_user_id uuid, p_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.app_users set pin_hash=p_hash,pin_failed_count=0,pin_locked_until=null,session_version=session_version+1 where id=p_user_id;
  if not found then return false; end if;
  return true;
end $$;

alter table public.puzzles add column if not exists in_transit boolean not null default false;
alter table public.puzzle_journey add column if not exists received_photo_urls jsonb not null default '[]'::jsonb;
alter table public.puzzle_journey add column if not exists shipping_photo_urls jsonb not null default '[]'::jsonb;
update public.puzzle_journey set received_photo_urls = jsonb_build_array(received_photo_url)
  where received_photo_url is not null and received_photo_urls = '[]'::jsonb;
update public.puzzle_journey set shipping_photo_urls = jsonb_build_array(shipping_photo_url)
  where shipping_photo_url is not null and shipping_photo_urls = '[]'::jsonb;

create table if not exists public.puzzle_tasks (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.puzzles(id) on delete restrict,
  journey_id uuid references public.puzzle_journey(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  payee_id uuid references public.app_users(id) on delete restrict,
  kind text not null check (kind in ('receive', 'ship', 'shipping_fee', 'pay_shipping', 'pay_return')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  tracking_number text,
  receipt_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists puzzle_tasks_user_open_idx on public.puzzle_tasks(user_id, status, created_at);
create index if not exists puzzle_tasks_puzzle_idx on public.puzzle_tasks(puzzle_id, created_at);
create unique index if not exists puzzle_tasks_one_kind_per_turn on public.puzzle_tasks(journey_id, kind, user_id)
  where kind <> 'pay_return' and status <> 'cancelled';
alter table public.puzzle_tasks enable row level security;
revoke all on public.puzzle_tasks from anon, authenticated;
grant all on public.puzzle_tasks to service_role;

create table if not exists public.puzzle_handoffs (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.puzzles(id) on delete restrict,
  from_user_id uuid not null references public.app_users(id) on delete restrict,
  to_user_id uuid not null references public.app_users(id) on delete restrict,
  return_home boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists puzzle_handoffs_puzzle_idx on public.puzzle_handoffs(puzzle_id,created_at);
alter table public.puzzle_handoffs enable row level security;
revoke all on public.puzzle_handoffs from anon, authenticated;
grant all on public.puzzle_handoffs to service_role;

-- Seed work still outstanding on existing v0.2 journeys without changing completed history.
insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id, j.id, j.user_id, 'receive'
from public.puzzle_journey j where j.status = 'current' and not j.is_owner_start and j.received_on is null
on conflict do nothing;
insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id, j.id, j.user_id, 'shipping_fee'
from public.puzzle_journey j where j.status = 'current' and exists
  (select 1 from public.puzzle_journey n where n.puzzle_id = j.puzzle_id and n.status = 'waiting' and n.seq > j.seq)
on conflict do nothing;
insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id, j.id, j.user_id, 'ship'
from public.puzzle_journey j where j.status = 'current' and not j.is_owner_start and j.shipped_on is null
  and exists (select 1 from public.puzzle_journey n where n.puzzle_id = j.puzzle_id and n.status = 'waiting' and n.seq > j.seq)
on conflict do nothing;

-- Tasks are created in the same transaction as queue changes.
create or replace function public.v03_join_queue(p_puzzle_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_holder public.puzzle_journey%rowtype;
begin
  v_id := public.join_puzzle_queue(p_puzzle_id, p_user_id);
  select * into v_holder from public.puzzle_journey where puzzle_id = p_puzzle_id and status = 'current' limit 1;
  if found then
    insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
    values (p_puzzle_id, v_holder.id, v_holder.user_id, 'shipping_fee') on conflict do nothing;
    if not v_holder.is_owner_start then
      insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
      values (p_puzzle_id, v_holder.id, v_holder.user_id, 'ship') on conflict do nothing;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.v03_receive(p_puzzle_id uuid, p_user_id uuid, p_date date, p_urls jsonb, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_turn public.puzzle_journey%rowtype;
begin
  if jsonb_typeof(p_urls) <> 'array' or jsonb_array_length(p_urls) < 1 or jsonb_array_length(p_urls) > 12 then raise exception 'Invalid photos'; end if;
  perform 1 from public.puzzles where id = p_puzzle_id for update;
  select * into v_turn from public.puzzle_journey where puzzle_id = p_puzzle_id and user_id = p_user_id and status = 'current' for update;
  if not found or v_turn.is_owner_start or v_turn.received_on is not null then raise exception 'Receiving unavailable'; end if;
  update public.puzzle_journey set received_on = p_date, received_photo_url = p_urls->>0,
    received_photo_urls = p_urls, receiving_note = left(coalesce(p_note,''),1000) where id = v_turn.id;
  update public.puzzles set in_transit = false where id = p_puzzle_id;
  update public.puzzle_tasks set status='done', completed_at=now() where journey_id=v_turn.id and kind='receive' and status='open';
  return true;
end $$;

create or replace function public.v03_ship(p_puzzle_id uuid, p_user_id uuid, p_date date, p_urls jsonb, p_note text, p_return boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_turn public.puzzle_journey%rowtype; v_next public.puzzle_journey%rowtype; v_owner uuid;
begin
  perform 1 from public.puzzles where id=p_puzzle_id for update;
  select owner_id into v_owner from public.puzzles where id=p_puzzle_id;
  select * into v_turn from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='current' for update;
  if not found or v_turn.shipped_on is not null then raise exception 'Shipping unavailable'; end if;
  if not v_turn.is_owner_start and v_turn.received_on is null then raise exception 'Receive first'; end if;
  if not v_turn.is_owner_start and (jsonb_typeof(p_urls) <> 'array' or jsonb_array_length(p_urls) < 1 or jsonb_array_length(p_urls)>12) then raise exception 'Invalid photos'; end if;
  if not exists (select 1 from public.puzzle_tasks where journey_id=v_turn.id and kind='shipping_fee' and status='done') then raise exception 'Fee first'; end if;
  select * into v_next from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_turn.seq order by seq limit 1 for update;
  if p_return then
    if v_turn.is_owner_start or found then raise exception 'Return unavailable'; end if;
    update public.puzzle_journey set shipped_on=p_date, shipping_photo_url=p_urls->>0,
      shipping_photo_urls=p_urls, shipping_note=left(coalesce(p_note,''),1000), status='completed' where id=v_turn.id;
    update public.puzzles set availability='retired', in_transit=true, current_holder_id=v_owner where id=p_puzzle_id;
  else
    if not found then raise exception 'Nobody is waiting next'; end if;
    update public.puzzle_journey set shipped_on=p_date, shipping_photo_url=p_urls->>0,
      shipping_photo_urls=p_urls, shipping_note=left(coalesce(p_note,''),1000), status='completed' where id=v_turn.id;
    update public.puzzle_journey set status='current' where id=v_next.id;
    update public.puzzles set current_holder_id=v_next.user_id, in_transit=true where id=p_puzzle_id;
    insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
      values(p_puzzle_id,v_next.id,v_next.user_id,'receive') on conflict do nothing;
    if exists(select 1 from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_next.seq) then
      insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
        values(p_puzzle_id,v_next.id,v_next.user_id,'shipping_fee') on conflict do nothing;
      insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
        values(p_puzzle_id,v_next.id,v_next.user_id,'ship') on conflict do nothing;
    end if;
  end if;
  update public.puzzle_tasks set status='done', completed_at=now() where journey_id=v_turn.id and kind='ship' and status='open';
  return case when p_return then v_owner else v_next.user_id end;
end $$;

create or replace function public.v03_fee(p_puzzle_id uuid, p_user_id uuid, p_amount_cents integer, p_tracking text, p_receipt text, p_return boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_turn public.puzzle_journey%rowtype; v_next public.puzzle_journey%rowtype; v_count integer; v_base integer; v_extra integer; v_row record; v_index integer:=0; v_share integer;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 10000000 then raise exception 'Invalid amount'; end if;
  perform 1 from public.puzzles where id=p_puzzle_id for update;
  select * into v_turn from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='current' for update;
  if not found then raise exception 'Not holder'; end if;
  select * into v_next from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_turn.seq order by seq limit 1;
  if p_return then
    if v_turn.is_owner_start or found then raise exception 'Return unavailable'; end if;
  else
    if not found then raise exception 'No next holder'; end if;
  end if;
  update public.puzzle_tasks set status='done', amount_cents=p_amount_cents, tracking_number=left(p_tracking,120),
    receipt_url=p_receipt, completed_at=now() where journey_id=v_turn.id and kind='shipping_fee' and status='open';
  if not found then raise exception 'Fee already submitted'; end if;
  if p_return then
    select count(distinct user_id) into v_count from public.puzzle_journey where puzzle_id=p_puzzle_id and not is_owner_start and status <> 'cancelled';
    if v_count < 1 then raise exception 'No participants'; end if;
    v_base := p_amount_cents / v_count; v_extra := p_amount_cents % v_count;
    for v_row in select distinct user_id from public.puzzle_journey where puzzle_id=p_puzzle_id and not is_owner_start and status <> 'cancelled' order by user_id loop
      v_share := v_base + case when v_index < v_extra then 1 else 0 end;
      if v_row.user_id <> p_user_id then
        insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, payee_id, kind, amount_cents)
        values(p_puzzle_id,v_turn.id,v_row.user_id,p_user_id,'pay_return',v_share);
      end if;
      v_index := v_index + 1;
    end loop;
  else
    insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, payee_id, kind, amount_cents)
    values(p_puzzle_id,v_next.id,v_next.user_id,p_user_id,'pay_shipping',p_amount_cents) on conflict do nothing;
    if v_turn.is_owner_start then
      perform public.v03_ship(p_puzzle_id,p_user_id,current_date,'[]'::jsonb,'',false);
    end if;
  end if;
  return true;
end $$;

create or replace function public.v03_mark_paid(p_task_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.puzzle_tasks set status='done', completed_at=now()
  where id=p_task_id and user_id=p_user_id and kind in ('pay_shipping','pay_return') and status='open';
  return found;
end $$;

create or replace function public.v03_prepare_return(p_puzzle_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_turn public.puzzle_journey%rowtype;
begin
  perform 1 from public.puzzles where id=p_puzzle_id and availability <> 'retired' for update;
  if not found then raise exception 'Return unavailable'; end if;
  select * into v_turn from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='current' and not is_owner_start and received_on is not null for update;
  if not found or exists(select 1 from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting') then raise exception 'Return unavailable'; end if;
  insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind) values(p_puzzle_id,v_turn.id,p_user_id,'shipping_fee') on conflict do nothing;
  insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind) values(p_puzzle_id,v_turn.id,p_user_id,'ship') on conflict do nothing;
  return true;
end $$;

create or replace function public.v03_cancel_queue(p_puzzle_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_turn public.puzzle_journey%rowtype; v_cancelled boolean;
begin
  perform 1 from public.puzzles where id=p_puzzle_id for update;
  select * into v_turn from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='waiting' for update;
  if not found then return false; end if;
  if exists(select 1 from public.puzzle_tasks where journey_id=v_turn.id and kind='pay_shipping') then
    raise exception 'Shipping fee has already been assigned';
  end if;
  v_cancelled := public.cancel_puzzle_queue(p_puzzle_id,p_user_id);
  if not exists(select 1 from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting') then
    update public.puzzle_tasks set status='cancelled' where puzzle_id=p_puzzle_id and kind in ('ship','shipping_fee') and status='open';
  end if;
  return v_cancelled;
end $$;

create or replace function public.v03_move_queue(p_puzzle_id uuid, p_user_id uuid, p_direction integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_mine public.puzzle_journey%rowtype; v_other public.puzzle_journey%rowtype; v_temp integer;
begin
  if p_direction not in (-1,1) then raise exception 'Invalid direction'; end if;
  perform 1 from public.puzzles where id=p_puzzle_id for update;
  select * into v_mine from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='waiting' for update;
  if not found then raise exception 'Not waiting'; end if;
  if p_direction=-1 then
    select * into v_other from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq<v_mine.seq order by seq desc limit 1 for update;
  else
    select * into v_other from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_mine.seq order by seq asc limit 1 for update;
  end if;
  if not found then return false; end if;
  if exists(select 1 from public.puzzle_tasks where journey_id in (v_mine.id,v_other.id) and kind='pay_shipping') then
    raise exception 'A shipment is already assigned';
  end if;
  select coalesce(max(seq),0)+1 into v_temp from public.puzzle_journey where puzzle_id=p_puzzle_id;
  update public.puzzle_journey set seq=v_temp where id=v_mine.id;
  update public.puzzle_journey set seq=v_mine.seq where id=v_other.id;
  update public.puzzle_journey set seq=v_other.seq where id=v_mine.id;
  insert into public.puzzle_activity(type,puzzle_id,actor_id,payload)
    values('queue_moved',p_puzzle_id,p_user_id,jsonb_build_object('from',v_mine.seq,'to',v_other.seq));
  return true;
end $$;

create or replace function public.v03_handoff(p_puzzle_id uuid, p_user_id uuid, p_return boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_turn public.puzzle_journey%rowtype; v_next public.puzzle_journey%rowtype; v_owner uuid; v_target uuid;
begin
  perform 1 from public.puzzles where id=p_puzzle_id and availability <> 'retired' for update;
  if not found then raise exception 'Handoff unavailable'; end if;
  select owner_id into v_owner from public.puzzles where id=p_puzzle_id;
  select * into v_turn from public.puzzle_journey where puzzle_id=p_puzzle_id and user_id=p_user_id and status='current' for update;
  if not found or v_turn.shipped_on is not null or (not v_turn.is_owner_start and v_turn.received_on is null) then raise exception 'Handoff unavailable'; end if;
  select * into v_next from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_turn.seq order by seq limit 1 for update;
  if p_return then
    if v_turn.is_owner_start or found then raise exception 'Return unavailable'; end if;
    v_target := v_owner;
  else
    if not found then raise exception 'No next holder'; end if;
    v_target := v_next.user_id;
  end if;
  if exists(select 1 from public.puzzle_tasks where journey_id=v_turn.id and kind='shipping_fee' and status='done')
    or exists(select 1 from public.puzzle_tasks where journey_id=v_next.id and kind='pay_shipping') then
    raise exception 'Shipping fee already assigned';
  end if;
  perform set_config('puzzle_drift.handoff','on',true);
  update public.puzzle_journey set shipped_on=current_date,status='completed' where id=v_turn.id;
  if not p_return then
    update public.puzzle_journey set status='current',received_on=current_date where id=v_next.id;
    if exists(select 1 from public.puzzle_journey where puzzle_id=p_puzzle_id and status='waiting' and seq>v_next.seq) then
      insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
        values(p_puzzle_id,v_next.id,v_next.user_id,'shipping_fee') on conflict do nothing;
      insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
        values(p_puzzle_id,v_next.id,v_next.user_id,'ship') on conflict do nothing;
    end if;
  end if;
  update public.puzzles set current_holder_id=v_target,in_transit=false,
    availability=case when p_return then 'retired' else availability end where id=p_puzzle_id;
  update public.puzzle_tasks set status='cancelled' where puzzle_id=p_puzzle_id and status='open'
    and (journey_id=v_turn.id or (journey_id=v_next.id and kind='receive'))
    and kind in ('receive','ship','shipping_fee');
  insert into public.puzzle_handoffs(puzzle_id,from_user_id,to_user_id,return_home)
    values(p_puzzle_id,p_user_id,v_target,p_return);
  return v_target;
end $$;

-- Suppress ordinary shipping/receiving activity during handoff; retain one handoff record.
create or replace function public.log_journey_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('puzzle_drift.handoff',true)='on' then return new; end if;
  if old.received_on is null and new.received_on is not null then
    insert into public.puzzle_activity(type,puzzle_id,actor_id,payload) values('received',new.puzzle_id,new.user_id,jsonb_build_object('received_on',new.received_on));
  end if;
  if old.shipped_on is null and new.shipped_on is not null then
    insert into public.puzzle_activity(type,puzzle_id,actor_id,payload) values('shipped',new.puzzle_id,new.user_id,jsonb_build_object('shipped_on',new.shipped_on));
  end if;
  if old.status='waiting' and new.status='current' then
    insert into public.puzzle_activity(type,puzzle_id,actor_id,payload) values('became_holder',new.puzzle_id,new.user_id,jsonb_build_object('seq',new.seq));
  end if;
  return new;
end $$;

create or replace function public.log_puzzle_status_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if current_setting('puzzle_drift.handoff',true)='on' then return new; end if;
  if old.availability is distinct from new.availability then
    insert into public.puzzle_activity(type,puzzle_id,actor_id,payload)
      values('availability_changed',new.id,new.owner_id,jsonb_build_object('availability',new.availability));
  end if;
  return new;
end $$;

revoke all on function public.v03_join_queue(uuid,uuid), public.v03_receive(uuid,uuid,date,jsonb,text), public.v03_ship(uuid,uuid,date,jsonb,text,boolean), public.v03_fee(uuid,uuid,integer,text,text,boolean), public.v03_mark_paid(uuid,uuid), public.v03_prepare_return(uuid,uuid), public.v03_cancel_queue(uuid,uuid), public.v03_move_queue(uuid,uuid,integer), public.v03_handoff(uuid,uuid,boolean), public.v03_pin_failed(uuid), public.v03_pin_succeeded(uuid), public.v03_claim_pin(uuid,text), public.v03_reset_pin(uuid,text) from public, anon, authenticated;
grant execute on function public.v03_join_queue(uuid,uuid), public.v03_receive(uuid,uuid,date,jsonb,text), public.v03_ship(uuid,uuid,date,jsonb,text,boolean), public.v03_fee(uuid,uuid,integer,text,text,boolean), public.v03_mark_paid(uuid,uuid), public.v03_prepare_return(uuid,uuid), public.v03_cancel_queue(uuid,uuid), public.v03_move_queue(uuid,uuid,integer), public.v03_handoff(uuid,uuid,boolean), public.v03_pin_failed(uuid), public.v03_pin_succeeded(uuid), public.v03_claim_pin(uuid,text), public.v03_reset_pin(uuid,text) to service_role;
