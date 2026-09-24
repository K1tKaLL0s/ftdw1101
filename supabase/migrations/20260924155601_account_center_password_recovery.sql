begin;

alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists avatar_version integer not null default 0;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists self_password_change_attempt uuid;
alter table public.marks add column if not exists note text not null default '';
do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_display_name_check') then
    alter table public.profiles add constraint profiles_display_name_check
      check(display_name='' or length(btrim(display_name)) between 1 and 30);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_avatar_version_check') then
    alter table public.profiles add constraint profiles_avatar_version_check check(avatar_version>=0);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.marks'::regclass and conname='marks_note_length_check') then
    alter table public.marks add constraint marks_note_length_check check(length(note)<=200);
  end if;
end;
$$;

create table public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','resolved','dismissed')),
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  constraint password_reset_requests_handled_check check(
    (status='pending' and handled_at is null and handled_by is null)
    or (status<>'pending' and handled_at is not null)
  )
);
create unique index password_reset_requests_pending_user_uidx
  on public.password_reset_requests(user_id) where status='pending';
create index password_reset_requests_pending_page_idx
  on public.password_reset_requests(requested_at desc,id desc) where status='pending';
alter table public.password_reset_requests enable row level security;
revoke all on table public.password_reset_requests from public,anon,authenticated;
grant all on table public.password_reset_requests to service_role;

create table public.password_change_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  session_hash text not null check(session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_attempt uuid,
  consumed_at timestamptz,
  constraint password_change_grants_consumption_check check(
    (claimed_attempt is null and consumed_at is null) or (claimed_attempt is not null and consumed_at is not null)
  )
);
alter table public.password_change_grants enable row level security;
revoke all on table public.password_change_grants from public,anon,authenticated;
grant all on table public.password_change_grants to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,262144,array['image/webp']::text[])
on conflict(id) do nothing;
do $$
begin
  if not exists(select 1 from storage.buckets b where b.id='avatars' and b.name='avatars'
    and b.public=false and b.file_size_limit=262144 and b.allowed_mime_types=array['image/webp']::text[]) then
    raise exception 'avatars bucket exists with unexpected settings; resolve manually';
  end if;
end;
$$;

create or replace function public.app_get_session_context(p_token_hash text)
returns table(user_id uuid,username text,is_admin boolean,expires_at timestamptz,auth_email text,
  auth_epoch bigint,must_change_password boolean,display_name text,avatar_version integer,
  can_change_password_without_current boolean)
language plpgsql security definer set search_path = '' as $$
begin
  return query select p.id,p.username,p.role='admin',s.expires_at,p.auth_email,p.auth_epoch,
    p.must_change_password,p.display_name,p.avatar_version,
    (p.role='admin' and exists(select 1 from public.password_change_grants g where g.user_id=p.id
      and g.session_hash=s.token_hash and g.expires_at>now() and g.claimed_attempt is null and g.consumed_at is null))
  from public.app_sessions s join public.profiles p on p.id=s.user_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and p.status='active';
end;
$$;
revoke all on function public.app_get_session_context(text) from public,anon,authenticated;
grant execute on function public.app_get_session_context(text) to service_role;

drop function public.app_list_week(text,text);
create function public.app_list_week(p_session_hash text,p_week_key text)
returns table(day_index integer,slot_index integer,mark_count bigint,mine boolean,preview jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  perform app_private.assert_week_window(p_week_key,-8,4);
  return query
  with visible_marks as (
    select m.day_index,m.slot_index,m.user_id,m.nickname,m.created_at,m.id,
      count(*) over(partition by m.day_index,m.slot_index)::bigint as cell_count,
      bool_or(m.user_id=v_actor) over(partition by m.day_index,m.slot_index) as cell_mine,
      row_number() over(partition by m.day_index,m.slot_index order by m.created_at desc,m.id desc) as position,
      jsonb_build_object('user_id',m.user_id,'nickname',m.nickname,'avatar_version',p.avatar_version) as member
    from public.marks m join public.profiles p on p.id=m.user_id and p.status='active'
    where m.week_key=p_week_key and m.deleted_at is null
  )
  select v.day_index,v.slot_index,max(v.cell_count),bool_or(v.cell_mine),
    coalesce(jsonb_agg(v.member order by v.created_at desc,v.id desc) filter(where v.position<=3),'[]'::jsonb)
  from visible_marks v group by v.day_index,v.slot_index;
end;
$$;
revoke all on function public.app_list_week(text,text) from public,anon,authenticated;
grant execute on function public.app_list_week(text,text) to service_role;

create or replace function public.app_list_cell(p_session_hash text,p_week_key text,p_day_index integer,p_slot_index integer,
  p_before_created_at timestamptz default null,p_before_id uuid default null,p_page_size integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_total bigint;v_items jsonb;v_more boolean;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  perform app_private.assert_week_window(p_week_key,-8,4);
  if p_day_index not between 0 and 6 or p_slot_index not between 0 and 4 or p_page_size not between 1 and 50 then
    raise exception 'invalid cell request' using errcode='22023';
  end if;
  select count(*) into v_total from public.marks m join public.profiles p on p.id=m.user_id and p.status='active'
  where m.week_key=p_week_key and m.day_index=p_day_index and m.slot_index=p_slot_index and m.deleted_at is null;
  with page as (
    select m.id,m.user_id,m.nickname,m.location,m.note,m.created_at,p.avatar_version
    from public.marks m join public.profiles p on p.id=m.user_id and p.status='active'
    where m.week_key=p_week_key and m.day_index=p_day_index and m.slot_index=p_slot_index and m.deleted_at is null
      and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
    order by m.created_at desc,m.id desc limit p_page_size+1
  ), numbered as(select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'nickname',nickname,'location',location,
      'note',note,'created_at',created_at,'avatar_version',avatar_version) order by created_at desc,id desc)
      filter(where rn<=p_page_size),'[]'::jsonb),
    coalesce(bool_or(rn>p_page_size),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'hasMore',v_more);
end;
$$;

create or replace function public.app_account_profile(p_session_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_profile public.profiles%rowtype;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select * into v_profile from public.profiles p where p.id=v_actor;
  return jsonb_build_object('id',v_profile.id,'username',v_profile.username,'display_name',v_profile.display_name,
    'avatar_version',v_profile.avatar_version,'role',v_profile.role,'must_change_password',v_profile.must_change_password);
end;
$$;

create or replace function public.app_update_display_name(p_session_hash text,p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_name text;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  v_name:=btrim(coalesce(p_display_name,''));
  if length(v_name)>30 then raise exception 'display name too long' using errcode='22023'; end if;
  update public.profiles set display_name=v_name,updated_at=now() where id=v_actor and status='active';
  if not found then raise exception 'account unavailable' using errcode='28000'; end if;
  return jsonb_build_object('display_name',v_name);
end;
$$;

create or replace function public.app_increment_avatar_version(p_session_hash text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_version integer;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  update public.profiles set avatar_version=avatar_version+1,updated_at=now()
    where id=v_actor and status='active' returning avatar_version into v_version;
  if v_version is null then raise exception 'account unavailable' using errcode='28000'; end if;
  return v_version;
end;
$$;

create or replace function public.app_prepare_self_password_change(p_session_hash text,p_expected_auth_epoch bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_auth_epoch bigint;v_attempt uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select p.auth_epoch into v_auth_epoch from public.profiles p where p.id=v_actor and p.status='active' for update;
  if not found then raise exception 'account unavailable' using errcode='28000'; end if;
  if v_auth_epoch is distinct from p_expected_auth_epoch then raise exception 'authentication epoch changed' using errcode='40001'; end if;
  v_attempt:=gen_random_uuid();
  update public.profiles set status='reset_pending',auth_epoch=auth_epoch+1,password_reset_attempt=v_attempt,
    self_password_change_attempt=v_attempt,
    password_reset_started_at=now(),updated_at=now() where id=v_actor and status='active';
  if not found then raise exception 'account state changed' using errcode='40001'; end if;
  update public.app_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=v_actor and revoked_at is null;
  insert into public.audit_log(actor_user_id,target_user_id,action,reason,affected_count)
    values(v_actor,v_actor,'prepare_self_password_change','self password change started',1);
  return v_attempt;
end;
$$;

create or replace function public.app_prepare_recovery_password_change(p_session_hash text,p_expected_auth_epoch bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_role text;v_auth_epoch bigint;v_attempt uuid;
begin
  select s.user_id,p.role,p.auth_epoch into v_actor,v_role,v_auth_epoch
  from public.app_sessions s join public.profiles p on p.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and p.status='active'
  for update of p;
  if v_actor is null then raise exception 'unauthenticated' using errcode='28000'; end if;
  if v_role<>'admin' then raise exception 'forbidden' using errcode='42501'; end if;
  if v_auth_epoch is distinct from p_expected_auth_epoch then raise exception 'authentication epoch changed' using errcode='40001'; end if;
  v_attempt:=gen_random_uuid();
  update public.password_change_grants g set claimed_attempt=v_attempt,consumed_at=now()
    where g.user_id=v_actor and g.session_hash=p_session_hash and g.expires_at>now()
      and g.claimed_attempt is null and g.consumed_at is null;
  if not found then raise exception 'password change grant unavailable' using errcode='42501'; end if;
  update public.profiles set status='reset_pending',auth_epoch=auth_epoch+1,password_reset_attempt=v_attempt,
    self_password_change_attempt=v_attempt,
    password_reset_started_at=now(),updated_at=now() where id=v_actor and status='active';
  if not found then raise exception 'account state changed' using errcode='40001'; end if;
  update public.app_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=v_actor and revoked_at is null;
  insert into public.audit_log(actor_user_id,target_user_id,action,reason,affected_count)
    values(v_actor,v_actor,'claim_password_change_grant','one-time administrator password recovery claimed',1);
  return v_attempt;
end;
$$;

create or replace function public.app_finish_self_password_change(p_user_id uuid,p_attempt_id uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer;v_must_change boolean;
begin
  if p_outcome is null or p_outcome not in ('changed','rejected') then raise exception 'invalid password change outcome' using errcode='22023'; end if;
  update public.profiles set status='active',auth_epoch=auth_epoch+1,password_reset_attempt=null,
    password_reset_started_at=null,self_password_change_attempt=null,
    must_change_password=case when p_outcome='changed' then false else must_change_password end,
    updated_at=now()
  where id=p_user_id and status='reset_pending' and password_reset_attempt=p_attempt_id
    and self_password_change_attempt=p_attempt_id
  returning must_change_password into v_must_change;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'password change is not pending for this attempt' using errcode='23514'; end if;
  insert into public.audit_log(actor_user_id,target_user_id,action,reason,affected_count)
    values(p_user_id,p_user_id,case when p_outcome='changed' then 'complete_self_password_change' else 'reject_self_password_change' end,
      case when p_outcome='changed' then 'Auth accepted self password change' else 'Auth rejected self password change' end,1);
  return jsonb_build_object('status','active','must_change_password',v_must_change);
end;
$$;

create or replace function public.app_active_avatar_version(p_session_hash text,p_user_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_version integer;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select p.avatar_version into v_version from public.profiles p where p.id=p_user_id and p.status='active';
  if v_version is null then raise exception 'user not found' using errcode='P0002'; end if;
  return v_version;
end;
$$;

create or replace function public.app_user_week(p_session_hash text,p_user_id uuid,p_week_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_name text;v_version integer;v_items jsonb;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  perform app_private.assert_week_window(p_week_key,-8,4);
  select coalesce(nullif(btrim(p.display_name),''),'牌友'),p.avatar_version into v_name,v_version
    from public.profiles p where p.id=p_user_id and p.status='active';
  if v_version is null then raise exception 'user not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'day_index',m.day_index,'slot_index',m.slot_index,
      'nickname',m.nickname,'location',m.location,'note',m.note,'created_at',m.created_at)
      order by m.day_index,m.slot_index,m.created_at desc,m.id desc),'[]'::jsonb)
    into v_items from public.marks m join public.profiles p on p.id=m.user_id and p.status='active'
    where m.user_id=p_user_id and m.week_key=p_week_key and m.deleted_at is null;
  return jsonb_build_object('user',jsonb_build_object('id',p_user_id,'display_name',v_name,'avatar_version',v_version),
    'week_key',p_week_key,'items',v_items);
end;
$$;

create or replace function public.app_request_password_reset(p_username text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;v_latest_handled timestamptz;
begin
  select p.id into v_user_id from public.profiles p where p.username=lower(btrim(p_username)) and p.status='active';
  if v_user_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('password-reset-request:'||v_user_id::text,0));
  if exists(select 1 from public.password_reset_requests r where r.user_id=v_user_id and r.status='pending') then return false; end if;
  select max(r.handled_at) into v_latest_handled from public.password_reset_requests r
    where r.user_id=v_user_id and r.status in ('resolved','dismissed');
  if v_latest_handled is not null and v_latest_handled>now()-interval '24 hours' then return false; end if;
  insert into public.password_reset_requests(user_id) values(v_user_id);
  return true;
end;
$$;

create or replace function public.app_admin_list_password_reset_requests(p_session_hash text,
  p_before_requested_at timestamptz default null,p_before_id uuid default null,p_page_size integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_items jsonb;v_total bigint;v_more boolean;
begin
  v_actor:=app_private.assert_actor(p_session_hash,true);
  if p_page_size not between 1 and 30 then raise exception 'invalid page size' using errcode='22023'; end if;
  select count(*) into v_total from public.password_reset_requests r where r.status='pending';
  with page as (
    select r.id,r.user_id,p.username,p.status,r.requested_at from public.password_reset_requests r
      join public.profiles p on p.id=r.user_id
    where r.status='pending' and (p_before_requested_at is null or (r.requested_at,r.id)<(p_before_requested_at,p_before_id))
    order by r.requested_at desc,r.id desc limit p_page_size+1
  ), numbered as(select page.*,row_number() over(order by requested_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'username',username,'status',status,'requested_at',requested_at)
      order by requested_at desc,id desc) filter(where rn<=p_page_size),'[]'::jsonb),
    coalesce(bool_or(rn>p_page_size),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'hasMore',v_more);
end;
$$;

create or replace function public.app_admin_prepare_request_password_reset(p_session_hash text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_user_id uuid;v_result jsonb;v_attempt uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,true);
  select r.user_id into v_user_id from public.password_reset_requests r
    where r.id=p_request_id and r.status='pending' for update;
  if v_user_id is null then raise exception 'reset request not found' using errcode='P0002'; end if;
  v_result:=public.app_admin_action(p_session_hash,v_user_id,'prepare_password_reset','administrator approved user password reset request');
  v_attempt:=(v_result->>'reset_attempt')::uuid;
  if v_attempt is null then raise exception 'password reset already pending' using errcode='23514'; end if;
  return jsonb_build_object('target_user_id',v_user_id,'reset_attempt',v_attempt);
end;
$$;

create or replace function public.app_admin_dismiss_password_reset_request(p_session_hash text,p_request_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_count integer;
begin
  v_actor:=app_private.assert_actor(p_session_hash,true);
  update public.password_reset_requests set status='dismissed',handled_at=now(),handled_by=v_actor
    where id=p_request_id and status='pending';
  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'reset request not found' using errcode='P0002'; end if;
  insert into public.audit_log(actor_user_id,action,reason,affected_count)
    values(v_actor,'dismiss_password_reset_request','administrator dismissed password reset request',1);
  return v_count;
end;
$$;

create or replace function public.app_admin_finish_password_reset_with_change(p_session_hash text,p_target_user_id uuid,p_attempt_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_count integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 4 and 300 then raise exception 'reason must be 4 to 300 characters' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-action',0));
  v_actor:=app_private.assert_actor(p_session_hash,true);
  if v_actor=p_target_user_id then raise exception 'cannot reset your own password here' using errcode='42501'; end if;
  update public.profiles set status='active',auth_epoch=auth_epoch+1,password_reset_attempt=null,
    password_reset_started_at=null,must_change_password=true,updated_at=now()
  where id=p_target_user_id and status='reset_pending' and password_reset_attempt=p_attempt_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'password reset is not pending' using errcode='23514'; end if;
  update public.password_reset_requests set status='resolved',handled_at=now(),handled_by=v_actor
    where user_id=p_target_user_id and status='pending';
  insert into public.audit_log(actor_user_id,target_user_id,action,reason,affected_count)
  values(v_actor,p_target_user_id,'complete_password_reset',btrim(p_reason),1);
  return jsonb_build_object('target_user_id',p_target_user_id,'status','active','must_change_password',true);
end;
$$;

create or replace function public.app_upsert_marks_with_note(p_session_hash text,p_week_key text,p_items jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_week date;v_count integer;v_changed integer;v_note text;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  v_week:=app_private.assert_week_window(p_week_key,0,4);
  if jsonb_typeof(p_items)<>'array' then raise exception 'items must be an array' using errcode='22023'; end if;
  v_count:=jsonb_array_length(p_items);
  if v_count not between 1 and 35 then raise exception 'items must contain 1 to 35 cells' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) as item(value)
    where item.value->>'schedule_version' is distinct from 'daily-08-22-v1') then
    raise exception 'schedule version mismatch' using errcode='22023';
  end if;
  v_note:=case when p_note is null then null else btrim(p_note) end;
  if v_note is not null and length(v_note)>200 then raise exception 'note too long' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(day_index integer,slot_index integer,nickname text,location text)
    where day_index is null or day_index not between 0 and 6 or slot_index is null or slot_index not between 0 and 4
      or nickname is null or length(btrim(nickname)) not between 1 and 30
      or (location is not null and length(btrim(location))>100)) then
    raise exception 'invalid mark item' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(day_index integer,slot_index integer,nickname text,location text)
    group by day_index,slot_index having count(*)>1) then raise exception 'duplicate cell in request' using errcode='22023'; end if;
  with input as(
    select x.day_index,x.slot_index,btrim(x.nickname) nickname,coalesce(nullif(btrim(x.location),''),'皆可') location
    from jsonb_to_recordset(p_items) as x(day_index integer,slot_index integer,nickname text,location text)
  ), saved as(
    insert into public.marks(user_id,week_key,day_index,slot_index,nickname,location,note)
    select v_actor,p_week_key,i.day_index,i.slot_index,i.nickname,i.location,coalesce(v_note,'') from input i
    on conflict(user_id,week_key,day_index,slot_index) do update
      set nickname=excluded.nickname,location=excluded.location,
        note=case when v_note is null then public.marks.note else v_note end,
        deleted_at=null,updated_at=now()
      where (public.marks.nickname,public.marks.location,public.marks.note,public.marks.deleted_at)
        is distinct from (excluded.nickname,excluded.location,
          case when v_note is null then public.marks.note else v_note end,null::timestamptz)
    returning 1
  ) select count(*) into v_changed from saved;
  return jsonb_build_object('accepted',v_count,'changed',v_changed,'week_key',p_week_key,'week_end',v_week+6);
end;
$$;

create or replace function public.app_admin_list_deleted_marks(p_session_hash text,p_week_key text,p_before_created_at timestamptz default null,p_before_id uuid default null,p_page_size integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_items jsonb;v_total bigint;v_more boolean;
begin
  v_actor:=app_private.assert_actor(p_session_hash,true);
  perform app_private.assert_week_window(p_week_key,-8,4);
  if p_page_size not between 1 and 100 then raise exception 'invalid page size' using errcode='22023'; end if;
  select count(*) into v_total from public.marks where week_key=p_week_key and deleted_at is not null;
  with page as(
    select m.id,m.user_id,p.username,m.day_index,m.slot_index,m.nickname,m.location,m.note,m.created_at,m.deleted_at
    from public.marks m join public.profiles p on p.id=m.user_id
    where m.week_key=p_week_key and m.deleted_at is not null
      and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
    order by m.created_at desc,m.id desc limit p_page_size+1
  ), numbered as(select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'username',username,'day_index',day_index,
      'slot_index',slot_index,'nickname',nickname,'location',location,'note',note,'created_at',created_at,'deleted_at',deleted_at)
      order by created_at desc,id desc) filter(where rn<=p_page_size),'[]'::jsonb),
    coalesce(bool_or(rn>p_page_size),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'hasMore',v_more);
end;
$$;

create or replace function public.app_admin_list_active_marks(p_session_hash text,p_week_key text,p_before_created_at timestamptz default null,p_before_id uuid default null,p_page_size integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_items jsonb;v_total bigint;v_more boolean;
begin
  v_actor:=app_private.assert_actor(p_session_hash,true);
  perform app_private.assert_week_window(p_week_key,-8,4);
  if p_page_size not between 1 and 100 then raise exception 'invalid page size' using errcode='22023'; end if;
  select count(*) into v_total from public.marks where week_key=p_week_key and deleted_at is null;
  with page as(
    select m.id,m.user_id,p.username,m.day_index,m.slot_index,m.nickname,m.location,m.note,m.created_at,m.deleted_at
    from public.marks m join public.profiles p on p.id=m.user_id
    where m.week_key=p_week_key and m.deleted_at is null
      and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
    order by m.created_at desc,m.id desc limit p_page_size+1
  ), numbered as(select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'username',username,'day_index',day_index,
      'slot_index',slot_index,'nickname',nickname,'location',location,'note',note,'created_at',created_at,'deleted_at',deleted_at)
      order by created_at desc,id desc) filter(where rn<=p_page_size),'[]'::jsonb),
    coalesce(bool_or(rn>p_page_size),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'hasMore',v_more);
end;
$$;

revoke all on function public.app_account_profile(text) from public,anon,authenticated;
revoke all on function public.app_update_display_name(text,text) from public,anon,authenticated;
revoke all on function public.app_increment_avatar_version(text) from public,anon,authenticated;
revoke all on function public.app_active_avatar_version(text,uuid) from public,anon,authenticated;
revoke all on function public.app_user_week(text,uuid,text) from public,anon,authenticated;
revoke all on function public.app_request_password_reset(text) from public,anon,authenticated;
revoke all on function public.app_admin_list_password_reset_requests(text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.app_admin_prepare_request_password_reset(text,uuid) from public,anon,authenticated;
revoke all on function public.app_admin_dismiss_password_reset_request(text,uuid) from public,anon,authenticated;
revoke all on function public.app_admin_finish_password_reset_with_change(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.app_prepare_self_password_change(text,bigint) from public,anon,authenticated;
revoke all on function public.app_prepare_recovery_password_change(text,bigint) from public,anon,authenticated;
revoke all on function public.app_finish_self_password_change(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.app_upsert_marks_with_note(text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.app_admin_list_deleted_marks(text,text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.app_admin_list_active_marks(text,text,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.app_account_profile(text) to service_role;
grant execute on function public.app_update_display_name(text,text) to service_role;
grant execute on function public.app_increment_avatar_version(text) to service_role;
grant execute on function public.app_active_avatar_version(text,uuid) to service_role;
grant execute on function public.app_user_week(text,uuid,text) to service_role;
grant execute on function public.app_request_password_reset(text) to service_role;
grant execute on function public.app_admin_list_password_reset_requests(text,timestamptz,uuid,integer) to service_role;
grant execute on function public.app_admin_prepare_request_password_reset(text,uuid) to service_role;
grant execute on function public.app_admin_dismiss_password_reset_request(text,uuid) to service_role;
grant execute on function public.app_admin_finish_password_reset_with_change(text,uuid,uuid,text) to service_role;
grant execute on function public.app_prepare_self_password_change(text,bigint) to service_role;
grant execute on function public.app_prepare_recovery_password_change(text,bigint) to service_role;
grant execute on function public.app_finish_self_password_change(uuid,uuid,text) to service_role;
grant execute on function public.app_upsert_marks_with_note(text,text,jsonb,text) to service_role;
grant execute on function public.app_admin_list_deleted_marks(text,text,timestamptz,uuid,integer) to service_role;
grant execute on function public.app_admin_list_active_marks(text,text,timestamptz,uuid,integer) to service_role;

commit;
