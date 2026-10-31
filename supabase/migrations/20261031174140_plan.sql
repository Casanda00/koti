-- Koti step 5: Plan. Bills and subscriptions, savings goals,
-- and a link from a transaction to the bill occurrence it pays.

create table public.bills (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null check (length(id) between 1 and 80),
  name         text not null check (length(name) between 1 and 80),
  amount       numeric(12, 2) not null check (amount > 0),
  frequency    text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'yearly')),
  due_day      smallint not null default 1 check (due_day between 1 and 31),
  anchor_month smallint not null default 1 check (anchor_month between 1 and 12),  -- yearly: the month; quarterly: first month of the cycle
  autopay      boolean not null default false,
  auto_through date,                                                               -- autopay occurrences up to here are already recorded
  active       boolean not null default true,
  payee        text check (payee is null or length(payee) <= 120),
  note         text check (note is null or length(note) <= 500),
  position     integer not null default 0,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.goals (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (length(id) between 1 and 80),
  name        text not null check (length(name) between 1 and 80),
  target      numeric(12, 2) not null check (target > 0),
  saved       numeric(12, 2) not null default 0 check (saved >= 0),
  target_date date,
  monthly     numeric(12, 2) check (monthly is null or monthly >= 0),
  position    integer not null default 0,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.transactions add column bill_id text, add column bill_due date;

create index bills_user_synced on public.bills (user_id, synced_at);
create index goals_user_synced on public.goals (user_id, synced_at);

create trigger bills_synced before insert or update on public.bills
  for each row execute function public.koti_touch_synced_at();
create trigger goals_synced before insert or update on public.goals
  for each row execute function public.koti_touch_synced_at();

alter table public.bills enable row level security;
alter table public.goals enable row level security;

create policy "Own bills" on public.bills for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own goals" on public.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.bills, public.goals to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bills, public.goals;
  end if;
end;
$$;
