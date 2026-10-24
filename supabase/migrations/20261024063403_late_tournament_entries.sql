-- Additive late admission for the random-pairing format only. Existing matches and results are untouched.
begin;

create function public.app_tournament_late_entry(
  p_session_hash text,p_id uuid,p_revision integer,p_entry_id uuid,p_name text,
  p_checked_in boolean,p_initial_god text,p_group text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid;v_admin boolean;v_t public.tournaments;v_e public.tournament_entries;
  v_state jsonb;v_player jsonb;v_event jsonb;v_count integer;v_event_id uuid;
begin
  v_actor:=app_private.assert_actor(p_session_hash,false);
  select role='admin' into v_admin from public.profiles where id=v_actor;
  select * into v_t from public.tournaments where id=p_id for update;
  if not found then raise exception 'not found' using errcode='P0002';end if;
  if v_t.owner_id<>v_actor and not v_admin then raise exception 'forbidden' using errcode='42501';end if;
  if p_revision is null or v_t.revision<>p_revision then raise exception 'revision conflict' using errcode='40001';end if;
  if v_t.format<>'three_gods' then raise exception 'late entry unsupported format' using errcode='23514';end if;
  v_state:=v_t.special_state;
  if v_t.status<>'running' or v_state is null or coalesce(v_state->>'phase','') not in ('setup','main')
    or coalesce(v_state#>>'{revival,status}','')<>'idle'
    or jsonb_typeof(v_state->'players') is distinct from 'array'
    or jsonb_typeof(v_state->'events') is distinct from 'array' then
    raise exception 'late entry window closed' using errcode='23514';end if;
  if v_state->>'phase'='main' and (v_state->>'deadlineAt' is null
    or not isfinite((v_state->>'deadlineAt')::timestamptz)
    or (v_state->>'deadlineAt')::timestamptz<=now()) then
    raise exception 'late entry window closed' using errcode='23514';end if;
  if (now() at time zone v_t.timezone)::date<>(v_t.starts_at at time zone v_t.timezone)::date then
    raise exception 'late entry only on event day' using errcode='23514';end if;
  if p_checked_in is null or p_group is null or p_group not in ('all','A','B')
    or (p_initial_god is not null and p_initial_god not in ('slifer','obelisk','ra'))
    or (v_t.special_grouping='single' and p_group<>'all')
    or (v_t.special_grouping='ab' and p_group not in ('A','B')) then
    raise exception 'invalid late entry configuration' using errcode='22023';end if;
  if coalesce(v_state->'stoppedGroups','[]'::jsonb) ? p_group
    or coalesce(v_state->'selectedCandidates','{}'::jsonb) ? p_group then
    raise exception 'late entry window closed' using errcode='23514';end if;

  if p_entry_id is null then
    if p_name is null or length(btrim(p_name)) not between 1 and 30 then
      raise exception 'invalid late entry configuration' using errcode='22023';end if;
    if exists(select 1 from public.tournament_entries where tournament_id=p_id and status<>'withdrawn'
      and lower(btrim(normalize(name,NFKC)))=lower(btrim(normalize(p_name,NFKC)))) then
      raise exception 'duplicate entry name; confirm existing entry checkin' using errcode='23505';end if;
    select count(*) into v_count from public.tournament_entries where tournament_id=p_id and status<>'withdrawn';
    if v_count>=v_t.capacity then raise exception 'full' using errcode='23514';end if;
    insert into public.tournament_entries(tournament_id,user_id,name,status,checked_in_at)
      values(p_id,null,btrim(p_name),case when p_checked_in then 'checked_in' else 'preregistered' end,
        case when p_checked_in then now() else null end) returning * into v_e;
  else
    if not p_checked_in then raise exception 'invalid late entry configuration' using errcode='22023';end if;
    select * into v_e from public.tournament_entries where tournament_id=p_id and id=p_entry_id for update;
    if not found then raise exception 'entry not found' using errcode='P0002';end if;
    if v_e.status<>'preregistered' then
      raise exception 'late entry already checked in or withdrawn' using errcode='23514';end if;
    update public.tournament_entries set status='checked_in',checked_in_at=now() where id=v_e.id;
  end if;

  if p_checked_in then
    if exists(select 1 from jsonb_array_elements(v_state->'players') p where p->>'id'=v_e.id::text) then
      raise exception 'late entry already in pool' using errcode='23505';end if;
    if jsonb_array_length(v_state->'players')>=128 then raise exception 'full' using errcode='23514';end if;
    -- Match specialRoster defaults, with initial issuance explicitly confirmed by the organizer.
    -- No historical round, score, revival qualification, time limit or pairing is manufactured.
    v_player:=jsonb_build_object(
      'id',v_e.id,'name',v_e.name,'group',p_group,'initialGod',p_initial_god,'initialAssigned',true,
      'stock',jsonb_build_object('slifer',case when p_initial_god='slifer' then 1 else 0 end,
        'obelisk',case when p_initial_god='obelisk' then 1 else 0 end,'ra',case when p_initial_god='ra' then 1 else 0 end),
      'points',0,'revivalPoints',0,'extraLife',p_initial_god is null,'zeroBonusGranted',p_initial_god is null,
      'assignedMatches',0,'completedMatches',0,'mainMatches',0,'initialArrangements',0,
      'revivalEligible',false,'hold','none','status','waiting','lateEntry',true);
    v_event_id:=gen_random_uuid();
    v_event:=jsonb_build_object('id',v_event_id,'kind','late_entry','at',now(),'players',jsonb_build_array(v_e.id),
      'note','主办方核对开赛后报到与初始幻神，加入后续匹配池',
      'facts',jsonb_build_object('initialGod',p_initial_god,'group',p_group,'zeroHistoricalRounds',true,
        'noExistingMatchesChanged',true,'revivalEligible',false));
    v_state:=jsonb_set(jsonb_set(v_state,'{players}',(v_state->'players')||jsonb_build_array(v_player)),
      '{events}',(v_state->'events')||jsonb_build_array(v_event));
  end if;
  update public.tournaments set special_state=v_state,revision=revision+1,updated_at=now() where id=p_id;
  insert into public.audit_log(actor_user_id,action,reason,affected_count)
    values(v_actor,'tournament_late_entry',p_id::text||' '||v_e.id::text||case when p_checked_in then ' checked_in' else ' preregistered' end,1);
  return jsonb_build_object('id',v_e.id);
end;$$;

revoke all on function public.app_tournament_late_entry(text,uuid,integer,uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.app_tournament_late_entry(text,uuid,integer,uuid,text,boolean,text,text) to service_role;
commit;
