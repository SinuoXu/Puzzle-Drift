-- Puzzle Drift v0.3.1: run once after migration_v0_3.sql.
-- Additive data repair. Does not remove journeys, tasks, sessions, users or images.
begin;
alter table public.app_users add column if not exists profile_required boolean not null default false;

create or replace function public.v03_join_queue(p_puzzle_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_holder public.puzzle_journey%rowtype;
begin
  v_id := public.join_puzzle_queue(p_puzzle_id, p_user_id);
  select * into v_holder from public.puzzle_journey where puzzle_id = p_puzzle_id and status = 'current' limit 1;
  if found and (v_holder.is_owner_start or v_holder.received_on is not null) then
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
  insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind) values(p_puzzle_id,v_turn.id,p_user_id,'shipping_fee') on conflict do nothing;
  insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind) values(p_puzzle_id,v_turn.id,p_user_id,'ship') on conflict do nothing;
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
    -- The recipient needs a receive task first. Their shipping tasks are created by v03_receive.
  end if;
  update public.puzzle_tasks set status='done', completed_at=now() where journey_id=v_turn.id and kind='ship' and status='open';
  return case when p_return then v_owner else v_next.user_id end;
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
    update public.puzzle_tasks set status='cancelled' where puzzle_id=p_puzzle_id and kind in ('ship','shipping_fee') and status='open'
      and journey_id in (select id from public.puzzle_journey where puzzle_id=p_puzzle_id and status='current' and is_owner_start);
  end if;
  return v_cancelled;
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
    insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
      values(p_puzzle_id,v_next.id,v_next.user_id,'shipping_fee') on conflict do nothing;
    insert into public.puzzle_tasks(puzzle_id,journey_id,user_id,kind)
      values(p_puzzle_id,v_next.id,v_next.user_id,'ship') on conflict do nothing;
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

-- Keep postal shipping tasks behind the receiving record. Preserve old rows as
-- cancelled history; v03_receive will create fresh open rows after receipt.
update public.puzzle_tasks t set status='cancelled'
from public.puzzle_journey j
where t.journey_id=j.id and j.status='current' and not j.is_owner_start
  and j.received_on is null and t.kind in ('ship','shipping_fee') and t.status='open';

insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id,j.id,j.user_id,'receive'
from public.puzzle_journey j
join public.puzzles p on p.id=j.puzzle_id
where j.status='current' and not j.is_owner_start and j.received_on is null
  and p.availability <> 'retired'
  and not exists (select 1 from public.puzzle_tasks t where t.journey_id=j.id and t.kind='receive' and t.status in ('open','done'))
on conflict do nothing;

insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id,j.id,j.user_id,'shipping_fee'
from public.puzzle_journey j
join public.puzzles p on p.id=j.puzzle_id
where j.status='current' and j.is_owner_start and p.availability <> 'retired'
  and exists (select 1 from public.puzzle_journey n where n.puzzle_id=j.puzzle_id and n.status='waiting' and n.seq>j.seq)
  and not exists (select 1 from public.puzzle_tasks t where t.journey_id=j.id and t.kind='shipping_fee' and t.status in ('open','done'))
on conflict do nothing;

-- Repair missing current-turn todos. A completed receipt, including one recorded by
-- handoff, means the participant may need to ship onward or return to the owner.
insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, kind)
select j.puzzle_id,j.id,j.user_id,k.kind
from public.puzzle_journey j
join public.puzzles p on p.id=j.puzzle_id
cross join (values ('ship'),('shipping_fee')) as k(kind)
where j.status='current' and not j.is_owner_start and j.received_on is not null
  and j.shipped_on is null and p.availability <> 'retired'
  and not exists (select 1 from public.puzzle_tasks t where t.journey_id=j.id and t.user_id=j.user_id and t.kind=k.kind and t.status in ('open','done'))
on conflict do nothing;

-- A submitted postal fee must have a corresponding payment task. Existing completed
-- or open payment records are respected. Face-to-face handoffs have no fee record.
insert into public.puzzle_tasks(puzzle_id, journey_id, user_id, payee_id, kind, amount_cents)
select j.puzzle_id, n.id, n.user_id, j.user_id, 'pay_shipping', fee.amount_cents
from public.puzzle_tasks fee
join public.puzzle_journey j on j.id=fee.journey_id
join lateral (
  select n0.* from public.puzzle_journey n0
  where n0.puzzle_id=j.puzzle_id and n0.seq>j.seq and n0.status <> 'cancelled'
  order by n0.seq limit 1
) n on true
where fee.kind='shipping_fee' and fee.status='done' and fee.amount_cents is not null
  and not exists (select 1 from public.puzzle_tasks t where t.journey_id=n.id and t.kind='pay_shipping' and t.user_id=n.user_id and t.status in ('open','done'))
on conflict do nothing;

commit;
