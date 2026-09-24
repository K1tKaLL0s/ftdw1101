begin;

lock table public.marks in access exclusive mode;

do $$
begin
  if exists(select 1 from public.marks) then
    raise exception 'five-slot migration stopped: public.marks contains existing rows; resolve the old schedule explicitly before retrying'
      using errcode='55000';
  end if;
end;
$$;

alter table public.marks drop constraint if exists marks_slot_index_check;
alter table public.marks add constraint marks_slot_index_check check(slot_index>=0 and slot_index<=4);

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
    select m.id,m.user_id,m.nickname,m.location,m.created_at
    from public.marks m join public.profiles p on p.id=m.user_id and p.status='active'
    where m.week_key=p_week_key and m.day_index=p_day_index and m.slot_index=p_slot_index and m.deleted_at is null
      and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
    order by m.created_at desc,m.id desc limit p_page_size+1
  ), numbered as(select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'nickname',nickname,'location',location,'created_at',created_at)
      order by created_at desc,id desc) filter(where rn<=p_page_size),'[]'::jsonb),
    coalesce(bool_or(rn>p_page_size),false) into v_items,v_more from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'hasMore',v_more);
end;
$$;

create or replace function public.app_upsert_marks(p_session_hash text,p_week_key text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;v_week date;v_count integer;v_changed integer;
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
    insert into public.marks(user_id,week_key,day_index,slot_index,nickname,location)
    select v_actor,p_week_key,i.day_index,i.slot_index,i.nickname,i.location from input i
    on conflict(user_id,week_key,day_index,slot_index) do update
      set nickname=excluded.nickname,location=excluded.location,deleted_at=null,updated_at=now()
      where (public.marks.nickname,public.marks.location,public.marks.deleted_at)
        is distinct from (excluded.nickname,excluded.location,null::timestamptz)
    returning 1
  ) select count(*) into v_changed from saved;
  return jsonb_build_object('accepted',v_count,'changed',v_changed,'week_key',p_week_key,'week_end',v_week+6);
end;
$$;

revoke all on function public.app_list_cell(text,text,integer,integer,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.app_list_cell(text,text,integer,integer,timestamptz,uuid,integer) to service_role;
revoke all on function public.app_upsert_marks(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_upsert_marks(text,text,jsonb) to service_role;

commit;
