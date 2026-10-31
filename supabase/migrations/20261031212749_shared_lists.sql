-- Koti: live shared lists. A list's owner makes a secret link; anyone with the link can see the list,
-- tick items off and add items, through the functions below only. The owner's app updates live.
create table public.list_shares (
  token      text primary key check (token ~ '^[A-Za-z0-9_-]{24,64}$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  list_id    text not null check (length(list_id) <= 80),
  created_at timestamptz not null default now(),
  revoked    boolean not null default false
);
create index list_shares_owner on public.list_shares (user_id, list_id);
alter table public.list_shares enable row level security;
create policy "Own list shares" on public.list_shares for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.list_shares to authenticated;

-- The shared list: name, owner's first name, and its items. Nothing else of the owner's is reachable.
create or replace function public.koti_share_view(t text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', l.name,
    'owner', coalesce(nullif(trim(s.data->>'name'), ''), ''),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'note', i.note, 'done', i.done) order by i.done, i.position, i.name)
      from public.items i where i.user_id = sh.user_id and i.list_id = sh.list_id and not i.deleted), '[]'::jsonb))
  from public.list_shares sh
  join public.lists l on l.user_id = sh.user_id and l.id = sh.list_id and not l.deleted
  left join public.settings s on s.user_id = sh.user_id
  where sh.token = t and not sh.revoked;
$$;

-- Tick an item on or off.
create or replace function public.koti_share_tick(t text, item text, is_done boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.items i
     set done = is_done, bought_at = case when is_done then coalesce(i.bought_at, current_date) else null end, updated_at = now()
    from public.list_shares sh
   where sh.token = t and not sh.revoked and i.user_id = sh.user_id and i.list_id = sh.list_id and i.id = item and not i.deleted;
  return found;
end $$;

-- Add an item (up to 300 on a list).
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
  return new_id;
end $$;

revoke all on function public.koti_share_view(text) from public;
revoke all on function public.koti_share_tick(text, text, boolean) from public;
revoke all on function public.koti_share_add(text, text) from public;
grant execute on function public.koti_share_view(text) to anon, authenticated;
grant execute on function public.koti_share_tick(text, text, boolean) to anon, authenticated;
grant execute on function public.koti_share_add(text, text) to anon, authenticated;
