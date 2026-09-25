begin;
create or replace function public.bot_reservation_slots(
  p_start_date date, p_end_date date, p_max_members integer default 5, p_include_notes boolean default false
) returns table(reservation_date date, slot_index integer, total_count bigint, members jsonb)
language plpgsql stable security invoker set search_path = '' set statement_timeout = '6s' as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_monday date := v_today - (extract(isodow from v_today)::integer - 1);
begin
  if p_start_date is null or p_end_date is null or p_start_date < v_monday
    or p_end_date > v_monday + 13 or p_end_date < p_start_date or p_end_date - p_start_date > 6
    or p_max_members is null or p_max_members not between 1 and 5 then
    raise exception 'invalid bot query bounds' using errcode = '22023';
  end if;
  return query
  with active as (
    select (m.week_key::date + m.day_index) as day, m.slot_index as slot,
      m.nickname, coalesce(nullif(btrim(m.location), ''), '皆可') as location, m.note,
      row_number() over (partition by m.week_key,m.day_index,m.slot_index order by m.created_at,m.id) as rn,
      count(*) over (partition by m.week_key,m.day_index,m.slot_index) as n
    from public.marks m join public.profiles p on p.id=m.user_id
    where m.week_key in (v_monday::text, (v_monday+7)::text)
      and m.week_key::date + m.day_index between p_start_date and p_end_date
      and m.deleted_at is null and p.status='active' and p.deleted_at is null
  )
  select a.day,a.slot,max(a.n),
    jsonb_agg(jsonb_strip_nulls(jsonb_build_object('nickname',a.nickname,'location',a.location,
      'note',case when p_include_notes then left(a.note,80) else null end)) order by a.rn)
  from active a where a.rn <= p_max_members
  group by a.day,a.slot order by a.day,a.slot;
end;
$$;
revoke all on function public.bot_reservation_slots(date,date,integer,boolean) from public,anon,authenticated;
grant execute on function public.bot_reservation_slots(date,date,integer,boolean) to service_role;
commit;
