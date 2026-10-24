-- Append-only upgrade: existing entries, accounts, locked pools and match state are preserved.
begin;

-- An organizer may record a guest without creating an application/Auth account.
-- Account-linked entries keep their existing foreign key and per-account uniqueness.
alter table public.tournament_entries alter column user_id drop not null;

create function public.app_tournament_edit_registration(p_session_hash text,p_id uuid,p_revision integer,p_deadline timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if p_revision is null or v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if v_t.status not in ('draft','published') or v_t.state is not null or v_t.special_state is not null then
    raise exception 'registration locked after start' using errcode='23514';end if;
  if p_deadline is null or not isfinite(p_deadline) or p_deadline>v_t.starts_at then
    raise exception 'deadline must not be later than start' using errcode='22023';end if;
  if p_deadline=v_t.registration_deadline then return true;end if;
  update public.tournaments set registration_deadline=p_deadline,revision=revision+1,updated_at=now() where id=p_id;
  insert into public.audit_log(actor_user_id,action,reason,affected_count)
    values(v_actor,'tournament_edit_registration',p_id::text||' '||v_t.registration_deadline::text||' -> '||p_deadline::text,1);
  return true;
end;$$;

create function public.app_tournament_onsite(p_session_hash text,p_id uuid,p_revision integer,p_name text,p_checked_in boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;v_id uuid;v_count integer;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  -- The same lock serializes regular registration, capacity changes and pool locking.
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if p_revision is null or v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if v_t.status<>'published' or v_t.state is not null or v_t.special_state is not null then
    raise exception 'onsite registration locked after start' using errcode='23514';end if;
  if (now() at time zone v_t.timezone)::date<>(v_t.starts_at at time zone v_t.timezone)::date then
    raise exception 'onsite registration only on event day before start' using errcode='23514';end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 30 or p_checked_in is null then
    raise exception 'invalid onsite entry' using errcode='22023';end if;
  if exists(select 1 from public.tournament_entries where tournament_id=p_id and status<>'withdrawn'
    and lower(btrim(normalize(name,NFKC)))=lower(btrim(normalize(p_name,NFKC)))) then
    raise exception 'duplicate entry name; confirm existing entry checkin' using errcode='23505';end if;
  select count(*) into v_count from public.tournament_entries where tournament_id=p_id and status<>'withdrawn';
  if v_count>=v_t.capacity then raise exception 'full' using errcode='23514';end if;
  insert into public.tournament_entries(tournament_id,user_id,name,status,checked_in_at)
    values(p_id,null,btrim(p_name),case when p_checked_in then 'checked_in' else 'preregistered' end,
      case when p_checked_in then now() else null end) returning id into v_id;
  update public.tournaments set revision=revision+1,updated_at=now() where id=p_id;
  insert into public.audit_log(actor_user_id,action,reason,affected_count)
    values(v_actor,'tournament_onsite',p_id::text||' '||v_id::text||case when p_checked_in then ' checked_in' else ' preregistered' end,1);
  return jsonb_build_object('id',v_id);
end;$$;

-- Keep regular self-registration behavior, adding the same guest-name collision guard.
-- Already-active self-registration remains idempotent; no existing row is rewritten by this migration.
create or replace function public.app_tournament_registration(p_session_hash text,p_id uuid,p_action text,p_name text default '',p_entry_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;v_e public.tournament_entries;v_count integer;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if p_action='checkin' then
    if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
    select * into v_e from public.tournament_entries where id=p_entry_id and tournament_id=p_id;
    if not found then raise exception 'entry not found' using errcode='P0002';end if;
    if v_e.status='checked_in' then return jsonb_build_object('id',v_e.id);end if;
    if v_t.status<>'published' or v_e.status<>'preregistered'
      or (now() at time zone v_t.timezone)::date<>(v_t.starts_at at time zone v_t.timezone)::date then
      raise exception 'checkin only on event day before start' using errcode='23514';end if;
    update public.tournament_entries set status='checked_in',checked_in_at=now() where id=v_e.id;
  elsif p_action='join' then
    if v_t.status<>'published' or now()>=v_t.registration_deadline then raise exception 'registration closed' using errcode='23514';end if;
    select * into v_e from public.tournament_entries where tournament_id=p_id and user_id=v_actor;
    if found and v_e.status<>'withdrawn' then return jsonb_build_object('id',v_e.id);end if;
    if p_name is null or length(btrim(p_name)) not between 1 and 30 then raise exception 'invalid name' using errcode='22023';end if;
    if exists(select 1 from public.tournament_entries where tournament_id=p_id and status<>'withdrawn'
      and lower(btrim(normalize(name,NFKC)))=lower(btrim(normalize(p_name,NFKC)))) then
      raise exception 'duplicate entry name; contact organizer' using errcode='23505';end if;
    select count(*) into v_count from public.tournament_entries where tournament_id=p_id and status<>'withdrawn';
    if v_count>=v_t.capacity then raise exception 'full' using errcode='23514';end if;
    insert into public.tournament_entries(tournament_id,user_id,name) values(p_id,v_actor,btrim(p_name))
      on conflict(tournament_id,user_id) do update set name=excluded.name,status='preregistered',checked_in_at=null,created_at=now()
      returning * into v_e;
  elsif p_action='leave' then
    if v_t.status<>'published' then raise exception 'contact organizer to drop after start' using errcode='23514';end if;
    update public.tournament_entries set status='withdrawn',checked_in_at=null
      where tournament_id=p_id and user_id=v_actor returning * into v_e;
    if not found then raise exception 'entry not found' using errcode='P0002';end if;
  else raise exception 'invalid action' using errcode='22023';end if;
  update public.tournaments set revision=revision+1,updated_at=now() where id=p_id;
  return jsonb_build_object('id',v_e.id);
end;$$;

-- Match the existing BFF-only RPC boundary. No direct table or public RPC access is added.
revoke all on function public.app_tournament_edit_registration(text,uuid,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.app_tournament_onsite(text,uuid,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.app_tournament_registration(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.app_tournament_edit_registration(text,uuid,integer,timestamptz) to service_role;
grant execute on function public.app_tournament_onsite(text,uuid,integer,text,boolean) to service_role;
grant execute on function public.app_tournament_registration(text,uuid,text,text,uuid) to service_role;
commit;
