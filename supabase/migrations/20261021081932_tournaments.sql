-- Additive migration. Requires the existing app_sessions/profiles/app_private.assert_actor.
-- No existing user, auth, reservation, or privilege is modified.
begin;

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  -- Grapheme limit 1–25 is enforced by the BFF Intl.Segmenter schema. SQL's length counts codepoints.
  title text not null check(length(btrim(title))>=1 and octet_length(title)<=8192),
  description text not null default '' check(length(description)<=2000),
  location text not null check(length(btrim(location)) between 1 and 120),
  starts_at timestamptz not null,
  registration_deadline timestamptz not null check(registration_deadline<=starts_at),
  timezone text not null default 'Asia/Shanghai' check(timezone in ('Asia/Shanghai','Asia/Hong_Kong','Asia/Tokyo','Etc/UTC')),
  capacity integer not null check(capacity between 2 and 128),
  format text not null check(format in ('swiss_cut','pseudo_double','three_gods')),
  special_grouping text not null default 'single' check(special_grouping in ('ab','single')),
  special_state jsonb check(special_state is null or jsonb_typeof(special_state)='object'),
  swiss_rounds integer not null default 3,
  top_cut integer not null default 2,
  tie_break_policy text not null check(length(btrim(tie_break_policy)) between 4 and 300),
  extra_rules text not null default '' check(length(extra_rules)<=3000),
  status text not null default 'draft' check(status in ('draft','published','running','completed','cancelled')),
  published_at timestamptz,
  revision integer not null default 0,
  state jsonb check(state is null or jsonb_typeof(state)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(format<>'swiss_cut' or (swiss_rounds between 3 and 7 and top_cut in (2,4,8,16,32,64) and top_cut<=capacity))
);
create index tournaments_calendar_idx on public.tournaments(starts_at,id);
create index tournaments_owner_idx on public.tournaments(owner_id);
create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id),
  user_id uuid not null references auth.users(id),
  name text not null check(length(btrim(name)) between 1 and 30),
  status text not null default 'preregistered' check(status in ('preregistered','checked_in','withdrawn')),
  created_at timestamptz not null default now(),
  checked_in_at timestamptz,
  unique(tournament_id,user_id)
);
create index tournament_entries_user_idx on public.tournament_entries(user_id);
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
revoke all on public.tournaments,public.tournament_entries from public,anon,authenticated,service_role;

create function app_private.tournament_summary(t public.tournaments) returns jsonb
language sql stable security invoker set search_path='' as $$
  select (to_jsonb(t)-'owner_id'-'state'-'special_state') || jsonb_build_object('state',null,'special_state',null,
    'entry_count',(select count(*) from public.tournament_entries e where e.tournament_id=t.id and e.status<>'withdrawn'),
    'checked_in_count',(select count(*) from public.tournament_entries e where e.tournament_id=t.id and e.status='checked_in'))
$$;
revoke all on function app_private.tournament_summary(public.tournaments) from public,anon,authenticated,service_role;

create function public.app_tournament_list(p_session_hash text,p_offset integer default 0,p_week_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_items jsonb;v_total bigint;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  if p_offset<0 or p_offset>100000 then raise exception 'invalid offset' using errcode='22023';end if;
  if p_week_key is not null then perform app_private.assert_week_window(p_week_key,-8,4);end if;
  select count(*) into v_total from public.tournaments t
    where (t.published_at is not null or t.owner_id=v_actor or v_admin)
      and (p_week_key is null or ((t.starts_at at time zone 'Asia/Shanghai')::date between p_week_key::date and p_week_key::date+6));
  select coalesce(jsonb_agg(item order by starts_at,id),'[]'::jsonb) into v_items from (
    select app_private.tournament_summary(t) item,t.starts_at,t.id from public.tournaments t
    where (t.published_at is not null or t.owner_id=v_actor or v_admin)
      and (p_week_key is null or ((t.starts_at at time zone 'Asia/Shanghai')::date between p_week_key::date and p_week_key::date+6))
    order by t.starts_at,t.id limit 50 offset p_offset) page;
  return jsonb_build_object('items',v_items,'nextOffset',case when p_offset+50<v_total then p_offset+50 else null end);
end;$$;

create function public.app_tournament_detail(p_session_hash text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;v_entries jsonb;v_mine uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id;
  if not found or (v_t.published_at is null and v_t.owner_id<>v_actor and not v_admin) then raise exception 'not found' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'status',e.status) order by e.created_at,e.id),'[]'::jsonb)
    into v_entries from public.tournament_entries e where e.tournament_id=p_id;
  select id into v_mine from public.tournament_entries where tournament_id=p_id and user_id=v_actor;
  return jsonb_build_object('tournament',app_private.tournament_summary(v_t)||jsonb_build_object('state',v_t.state,'special_state',v_t.special_state),
    'entrants',v_entries,'mine',v_mine,'canManage',v_admin or v_t.owner_id=v_actor);
end;$$;

create function public.app_tournament_create(p_session_hash text,p_input jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_id uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  if (p_input->>'registration_deadline')::timestamptz<=now() or (p_input->>'starts_at')::timestamptz<=now()
    or coalesce(p_input->>'status','draft') not in ('draft','published') then raise exception 'invalid schedule' using errcode='22023';end if;
  insert into public.tournaments(owner_id,title,description,location,starts_at,registration_deadline,timezone,capacity,format,
    swiss_rounds,top_cut,tie_break_policy,extra_rules,status,special_grouping,published_at)
  values(v_actor,btrim(p_input->>'title'),coalesce(p_input->>'description',''),btrim(p_input->>'location'),
    (p_input->>'starts_at')::timestamptz,(p_input->>'registration_deadline')::timestamptz,p_input->>'timezone',
    (p_input->>'capacity')::integer,p_input->>'format',(p_input->>'swiss_rounds')::integer,(p_input->>'top_cut')::integer,
    btrim(p_input->>'tie_break_policy'),coalesce(p_input->>'extra_rules',''),coalesce(p_input->>'status','draft'),coalesce(p_input->>'special_grouping','single'),case when p_input->>'status'='published' then now() else null end) returning id into v_id;
  return v_id;
end;$$;

create function public.app_tournament_registration(p_session_hash text,p_id uuid,p_action text,p_name text default '',p_entry_id uuid default null)
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

create function public.app_tournament_status(p_session_hash text,p_id uuid,p_revision integer,p_status text,p_reason text default '')
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if not ((p_status='published' and v_t.status='draft' and v_t.registration_deadline>now()) or
    (p_status='cancelled' and v_t.status in ('draft','published','running') and length(btrim(p_reason)) between 4 and 300)) then
    raise exception 'invalid transition' using errcode='23514';end if;
  update public.tournaments set status=p_status,published_at=case when p_status='published' then coalesce(published_at,now()) else published_at end,revision=revision+1,updated_at=now() where id=p_id;
  insert into public.audit_log(actor_user_id,action,reason,affected_count) values(v_actor,'tournament_'||p_status,p_id::text||' '||p_reason,1);
  return true;
end;$$;

create function public.app_tournament_commit(p_session_hash text,p_id uuid,p_revision integer,p_state jsonb,p_action text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if v_t.format='three_gods' then raise exception 'special rules pending' using errcode='23514';end if;
  if p_state is null or p_state->>'version'<>'1' or jsonb_typeof(p_state->'entrants')<>'array'
    or jsonb_typeof(p_state->'matches')<>'array' or p_action not in ('start','next_swiss','manual_swiss','cut','result','drop') then
    raise exception 'invalid state' using errcode='22023';end if;
  if p_action='start' then
    if v_t.status<>'published' or v_t.state is not null then raise exception 'already started' using errcode='23514';end if;
    if jsonb_array_length(p_state->'entrants')<2
      or jsonb_array_length(p_state->'entrants')<>(select count(*) from public.tournament_entries where tournament_id=p_id and status='checked_in')
      or exists(select 1 from jsonb_array_elements(p_state->'entrants') e where not exists(
        select 1 from public.tournament_entries r where r.tournament_id=p_id and r.id::text=e->>'id' and r.name=e->>'name' and r.status='checked_in')) then
      raise exception 'only checked-in entrants may start' using errcode='23514';end if;
  elsif v_t.status not in ('running','completed') then raise exception 'not running' using errcode='23514';end if;
  update public.tournaments set state=p_state,status=case when p_state->>'phase'='complete' then 'completed' else 'running' end,
    revision=revision+1,updated_at=now() where id=p_id;
  if p_action='drop' then
    update public.tournament_entries e set status='withdrawn' where e.tournament_id=p_id
      and e.id::text in (select p->>'id' from jsonb_array_elements(p_state->'entrants') p where p->>'active'='false');
  end if;
  insert into public.audit_log(actor_user_id,action,reason,affected_count) values(v_actor,'tournament_'||p_action,p_id::text,1);
  return true;
end;$$;

create function public.app_tournament_special_start(p_session_hash text,p_id uuid,p_revision integer,p_state jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if v_t.format<>'three_gods' or v_t.status<>'published' or v_t.special_state is not null then raise exception 'invalid start' using errcode='23514';end if;
  if p_state->>'phase' is distinct from 'setup' or p_state->>'grouping' is distinct from v_t.special_grouping
    or jsonb_array_length(p_state->'players')<2
    or jsonb_array_length(p_state->'players')<>(select count(*) from public.tournament_entries where tournament_id=p_id and status='checked_in')
    or jsonb_array_length(p_state->'players')<>(select count(distinct p->>'id') from jsonb_array_elements(p_state->'players') p)
    or exists(select 1 from jsonb_array_elements(p_state->'players') p where not exists(select 1 from public.tournament_entries e
      where e.tournament_id=p_id and e.id::text=p->>'id' and e.name=p->>'name' and e.status='checked_in')) then
    raise exception 'only checked-in entrants may start' using errcode='23514';end if;
  update public.tournaments set special_state=p_state,status='running',revision=revision+1,updated_at=now() where id=p_id;
  insert into public.audit_log(actor_user_id,action,reason,affected_count) values(v_actor,'tournament_special_start',p_id::text,1);
  return true;
end;$$;

create function public.app_tournament_special_commit(p_session_hash text,p_id uuid,p_revision integer,p_state jsonb,p_command_id text,p_fingerprint text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_admin boolean;v_t public.tournaments;v_previous text;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if v_t.format<>'three_gods' or v_t.status not in ('running','completed') or v_t.special_state is null then raise exception 'special roster required' using errcode='23514';end if;
  v_previous:=v_t.special_state->'commands'->>p_command_id;
  if v_previous is not null then
    if v_previous<>p_fingerprint then raise exception 'command conflict' using errcode='23514';end if;
    return true;
  end if;
  if v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if p_state->>'status'<>'rules_pending' or p_state->>'grouping'<>v_t.special_grouping
    or p_state->'commands'->>p_command_id is distinct from p_fingerprint then raise exception 'invalid special state' using errcode='22023';end if;
  if jsonb_array_length(p_state->'players')<>jsonb_array_length(v_t.special_state->'players')
    or exists(select 1 from jsonb_array_elements(p_state->'players') p where not exists(select 1 from jsonb_array_elements(v_t.special_state->'players') old
      where p->>'id'=old->>'id' and p->>'name'=old->>'name')) then raise exception 'roster locked' using errcode='23514';end if;
  update public.tournaments set special_state=p_state,status=case when p_state->>'phase'='complete' then 'completed' else 'running' end,revision=revision+1,updated_at=now() where id=p_id;
  update public.tournament_entries e set status=case when p->>'hold'='withdrawn' then 'withdrawn' else 'checked_in' end
    from jsonb_array_elements(p_state->'players') p where e.tournament_id=p_id and e.id::text=p->>'id';
  insert into public.audit_log(actor_user_id,action,reason,affected_count) values(v_actor,'tournament_special',p_id::text||' '||p_command_id,1);
  return true;
end;$$;

-- Business tables are never exposed directly. Only the existing server service client can call these RPCs;
-- every RPC re-checks the opaque app session and event ownership, including revoked/banned users.
revoke all on function public.app_tournament_list(text,integer,text) from public,anon,authenticated;
revoke all on function public.app_tournament_detail(text,uuid) from public,anon,authenticated;
revoke all on function public.app_tournament_create(text,jsonb) from public,anon,authenticated;
revoke all on function public.app_tournament_registration(text,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.app_tournament_status(text,uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.app_tournament_commit(text,uuid,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.app_tournament_special_commit(text,uuid,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.app_tournament_special_start(text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.app_tournament_list(text,integer,text) to service_role;
grant execute on function public.app_tournament_detail(text,uuid) to service_role;
grant execute on function public.app_tournament_create(text,jsonb) to service_role;
grant execute on function public.app_tournament_registration(text,uuid,text,text,uuid) to service_role;
grant execute on function public.app_tournament_status(text,uuid,integer,text,text) to service_role;
grant execute on function public.app_tournament_commit(text,uuid,integer,jsonb,text) to service_role;
grant execute on function public.app_tournament_special_commit(text,uuid,integer,jsonb,text,text) to service_role;
grant execute on function public.app_tournament_special_start(text,uuid,integer,jsonb) to service_role;
commit;
