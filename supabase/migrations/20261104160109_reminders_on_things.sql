-- Reminders on things: a reminder can be about a list or a goal, and a new kind of reminder fires on an amount
-- (a category passing it, or what's yours to spend falling under it).
alter table public.reminders drop constraint if exists reminders_schedule_check;
alter table public.reminders add constraint reminders_schedule_check check (schedule in ('once', 'monthly', 'weekly', 'before', 'amount'));
alter table public.reminders drop constraint if exists reminders_about_kind_check;
alter table public.reminders add constraint reminders_about_kind_check check (about_kind is null or about_kind in ('bill', 'payday', 'monthend', 'list', 'goal', 'category', 'left'));
alter table public.reminders add column if not exists amount numeric(12, 2) check (amount is null or amount >= 0);

-- Items added through a shared list's link, so the list's owner can be told. Only the server reads it.
create table if not exists public.share_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  list_id    text not null check (length(list_id) <= 80),
  item_name  text not null check (length(item_name) <= 120),
  created_at timestamptz not null default now(),
  sent       boolean not null default false
);
create index if not exists share_events_unsent on public.share_events (user_id) where not sent;
alter table public.share_events enable row level security;

-- Adding through a shared link now also records the event (otherwise unchanged).
create or replace function public.koti_share_add(t text, item_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare sh public.list_shares; n text := left(trim(item_name), 120); new_id text;
begin
  select * into sh from public.list_shares where token = t and not revoked;
  if sh.token is null or n = '' then return null; end if;
  if not exists (select 1 from public.lists where user_id = sh.user_id and id = sh.list_id and not deleted) then return null; end if;
  if (select count(*) from public.items where user_id = sh.user_id and list_id = sh.list_id and not deleted) >= 300 then raise exception 'This list is full.'; end if;
  new_id := 'item-' || encode(extensions.gen_random_bytes(6), 'hex');
  insert into public.items (user_id, id, list_id, name, priority, done, position, updated_at)
  values (sh.user_id, new_id, sh.list_id, n, 'Soon', false,
          coalesce((select max(position) + 1 from public.items where user_id = sh.user_id and list_id = sh.list_id), 0), now());
  insert into public.share_events (user_id, list_id, item_name) values (sh.user_id, sh.list_id, n);
  return new_id;
end $$;
revoke all on function public.koti_share_add(text, text) from public;
grant execute on function public.koti_share_add(text, text) to anon, authenticated;
