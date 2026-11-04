-- Sync rules enforced by the database, so every copy of the app is held to them, old ones included.
--   Rows: an upload older than the row already stored (by updated_at) is ignored. The stored row is kept and its
--   synced_at moves on, so the device that sent the older copy pulls the newer one back. A delete is a newer
--   row, so an older edit can't bring it back.
--   Settings: merged setting by setting by the time each was changed (data._t), so a device can't wipe a
--   setting it never had. Settings from before per-setting times count as oldest.

create or replace function public.koti_keep_newer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then
    return old;   -- the stored row stays; the synced_at trigger after this one still marks it as changed
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['lists', 'items', 'categories', 'transactions', 'bills', 'goals', 'income_sources', 'reminders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep_newer', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.koti_keep_newer()', t || '_keep_newer', t);
  end loop;
end $$;

create or replace function public.koti_ts(v text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  return coalesce(v::timestamptz, 'epoch'::timestamptz);
exception when others then
  return 'epoch'::timestamptz;
end $$;

create or replace function public.koti_merge_settings() returns trigger
language plpgsql set search_path = '' as $$
declare
  k text;
  merged jsonb := coalesce(old.data, '{}'::jsonb);
  old_t jsonb := coalesce(old.data -> '_t', '{}'::jsonb);
  new_t jsonb := coalesce(new.data -> '_t', '{}'::jsonb);
  out_t jsonb := coalesce(old.data -> '_t', '{}'::jsonb);
begin
  if jsonb_typeof(old_t) <> 'object' then old_t := '{}'::jsonb; out_t := '{}'::jsonb; end if;
  if jsonb_typeof(new_t) <> 'object' then new_t := '{}'::jsonb; end if;
  for k in select jsonb_object_keys(coalesce(new.data, '{}'::jsonb)) loop
    continue when k = '_t';
    if public.koti_ts(new_t ->> k) >= public.koti_ts(old_t ->> k) then
      merged := jsonb_set(merged, array[k], new.data -> k, true);
      if new_t ? k then out_t := jsonb_set(out_t, array[k], new_t -> k, true); end if;
    end if;
  end loop;
  new.data := jsonb_set(merged, '{_t}', out_t, true);
  new.updated_at := greatest(old.updated_at, new.updated_at);
  return new;
end $$;

drop trigger if exists settings_merge on public.settings;
create trigger settings_merge before update on public.settings
  for each row execute function public.koti_merge_settings();
