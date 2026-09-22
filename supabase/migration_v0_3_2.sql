-- Puzzle Drift v0.3.2: administrator controls.
-- Run once after migration_v0_3_1.sql. Storage objects are intentionally not removed.
begin;

create or replace function public.v03_admin_force_retire(p_puzzle_id uuid, p_admin_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_puzzle public.puzzles%rowtype;
begin
  if not exists (select 1 from public.app_users where id=p_admin_id and is_admin) then
    raise exception 'Admin required';
  end if;

  select * into v_puzzle from public.puzzles where id=p_puzzle_id for update;
  if not found then raise exception 'Puzzle not found'; end if;

  update public.puzzle_tasks set status='cancelled', completed_at=now()
  where puzzle_id=p_puzzle_id and status='open';
  update public.puzzle_journey set status='cancelled'
  where puzzle_id=p_puzzle_id and status='waiting';
  update public.puzzles set availability='retired', in_transit=false where id=p_puzzle_id;
  insert into public.puzzle_activity(type,puzzle_id,actor_id,payload)
  values ('admin_forced_end',p_puzzle_id,p_admin_id,jsonb_build_object('previous_availability',v_puzzle.availability));
  return true;
end $$;

create or replace function public.v03_admin_delete_puzzle(p_puzzle_id uuid, p_admin_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.app_users where id=p_admin_id and is_admin) then
    raise exception 'Admin required';
  end if;
  perform 1 from public.puzzles where id=p_puzzle_id for update;
  if not found then raise exception 'Puzzle not found'; end if;

  -- Remove dependent database rows so the puzzle deletion can cascade its journey
  -- and activity history. Uploaded Storage files deliberately remain recoverable.
  delete from public.puzzle_tasks where puzzle_id=p_puzzle_id;
  delete from public.puzzle_handoffs where puzzle_id=p_puzzle_id;
  delete from public.puzzles where id=p_puzzle_id;
  return true;
end $$;

create or replace function public.v03_admin_delete_activity(p_activity_id bigint, p_admin_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.app_users where id=p_admin_id and is_admin) then
    raise exception 'Admin required';
  end if;
  delete from public.puzzle_activity where id=p_activity_id;
  return found;
end $$;

revoke all on function public.v03_admin_force_retire(uuid,uuid), public.v03_admin_delete_puzzle(uuid,uuid), public.v03_admin_delete_activity(bigint,uuid) from public, anon, authenticated;
grant execute on function public.v03_admin_force_retire(uuid,uuid), public.v03_admin_delete_puzzle(uuid,uuid), public.v03_admin_delete_activity(bigint,uuid) to service_role;

commit;
