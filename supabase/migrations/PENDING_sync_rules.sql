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

-- AI uses: the day is Helsinki's, and a use is given back when the reading itself failed (by the server only).
create or replace function public.koti_ai_use(daily_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Europe/Helsinki')::date;
  n integer;
begin
  if uid is null then raise exception 'Sign in to use AI'; end if;
  insert into public.ai_usage (user_id, day, count) values (uid, today, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  if n > daily_limit then
    raise exception 'Daily AI limit reached (%). It resets at midnight.', daily_limit;   -- rolls the count back
  end if;
  return n;
end $$;
revoke execute on function public.koti_ai_use(integer) from public, anon;
grant execute on function public.koti_ai_use(integer) to authenticated;

create or replace function public.koti_ai_refund(u uuid)
returns void language sql security definer set search_path = '' as $$
  update public.ai_usage set count = greatest(0, count - 1)
   where user_id = u and day = (now() at time zone 'Europe/Helsinki')::date;
$$;
revoke all on function public.koti_ai_refund(uuid) from public, anon, authenticated;
grant execute on function public.koti_ai_refund(uuid) to service_role;

-- Shared lists: adds to one list happen one at a time, so the 300-item limit holds; at most 30 adds a minute,
-- and at most 2000 items ever (deleted ones count), so a link can't be used to fill the database.
create or replace function public.koti_share_add(t text, item_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare sh public.list_shares; n text := left(trim(item_name), 120); new_id text;
begin
  select * into sh from public.list_shares where token = t and not revoked;
  if sh.token is null or n = '' then return null; end if;
  perform 1 from public.lists where user_id = sh.user_id and id = sh.list_id and not deleted for update;
  if not found then return null; end if;
  if (select count(*) from public.share_events where user_id = sh.user_id and list_id = sh.list_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many changes at once. Try again in a minute.';
  end if;
  if (select count(*) from public.items where user_id = sh.user_id and list_id = sh.list_id and not deleted) >= 300
     or (select count(*) from public.items where user_id = sh.user_id and list_id = sh.list_id) >= 2000 then
    raise exception 'This list is full.';
  end if;
  new_id := 'item-' || encode(extensions.gen_random_bytes(6), 'hex');
  insert into public.items (user_id, id, list_id, name, priority, done, position, updated_at)
  values (sh.user_id, new_id, sh.list_id, n, 'Soon', false,
          coalesce((select max(position) + 1 from public.items where user_id = sh.user_id and list_id = sh.list_id), 0), now());
  insert into public.share_events (user_id, list_id, item_name) values (sh.user_id, sh.list_id, n);
  return new_id;
end $$;
revoke all on function public.koti_share_add(text, text) from public;
grant execute on function public.koti_share_add(text, text) to anon, authenticated;

-- Push subscriptions: only the browsers' own push services (Google, Mozilla, Apple, Microsoft).
alter table public.push_subscriptions drop constraint if exists push_endpoint_known;
alter table public.push_subscriptions add constraint push_endpoint_known check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
) not valid;
