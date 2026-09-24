begin;

create or replace function app_private.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_username text;
  v_device_hash text;
  v_count smallint;
  v_email text;
  v_app_metadata jsonb;
begin
  select u.email,u.raw_app_meta_data into v_email,v_app_metadata
  from auth.users as u where u.id=new.id;
  if not found then
    raise exception 'registration identity is unavailable' using errcode='42501';
  end if;

  v_username:=lower(coalesce(v_app_metadata->>'username',''));
  v_device_hash:=coalesce(v_app_metadata->>'device_hash','');
  if v_username !~ '^[a-z0-9_]{3,24}$' or v_device_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'registration must be created through the application service' using errcode='42501';
  end if;
  if lower(coalesce(v_email,'')) <> v_username || '@team-slots.local' then raise exception 'registration identity mapping is invalid' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_device_hash,0));
  insert into public.device_quotas(device_hash,registrations) values(v_device_hash,0) on conflict(device_hash) do nothing;
  select registrations into v_count from public.device_quotas where device_hash=v_device_hash for update;
  if v_count>=2 then raise exception 'device account quota reached' using errcode='23514'; end if;
  insert into public.profiles(id,username,auth_email,role,status) values(new.id,v_username,v_email,'user','active');
  update public.device_quotas set registrations=v_count+1,updated_at=now() where device_hash=v_device_hash;
  return new;
end;
$$;

drop trigger if exists app_auth_user_created on auth.users;
create constraint trigger app_auth_user_created
after insert on auth.users
deferrable initially deferred
for each row execute function app_private.on_auth_user_created();

commit;
