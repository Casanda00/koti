-- Koti step 1: Home setup checklist, lists and per-user settings.
-- Every row belongs to the signed-in user; row level security keeps it private.
-- Rows are soft-deleted (deleted = true) so other devices learn about removals.
-- synced_at is set by the database on every write; devices pull rows changed since their last sync.

create table public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now()
);

create table public.lists (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 1 and 80),
  name       text not null check (length(name) between 1 and 120),
  room       text not null default 'OH',
  position   integer not null default 0,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 1 and 120),
  list_id    text not null,
  name       text not null check (length(name) between 1 and 200),
  priority   text not null default 'Soon' check (priority in ('Essential', 'Soon', 'Later')),
  done       boolean not null default false,
  price      numeric(12, 2) check (price is null or price >= 0),
  bought_at  date,
  position   integer not null default 0,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index items_user_synced on public.items (user_id, synced_at);
create index lists_user_synced on public.lists (user_id, synced_at);

-- Server-side change stamp, independent of device clocks.
create or replace function public.koti_touch_synced_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

create trigger settings_synced before insert or update on public.settings
  for each row execute function public.koti_touch_synced_at();
create trigger lists_synced before insert or update on public.lists
  for each row execute function public.koti_touch_synced_at();
create trigger items_synced before insert or update on public.items
  for each row execute function public.koti_touch_synced_at();

alter table public.settings enable row level security;
alter table public.lists    enable row level security;
alter table public.items    enable row level security;

create policy "Own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own lists" on public.lists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.settings, public.lists, public.items to authenticated;

-- Live updates between devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.settings, public.lists, public.items;
  end if;
end;
$$;
