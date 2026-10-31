-- Koti step 2: Money. Spending categories with monthly budgets, and transactions.
-- Same pattern as step 1: rows belong to the signed-in user (RLS), soft deletes,
-- and a server-set synced_at that devices pull by.

create table public.categories (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 1 and 80),
  name       text not null check (length(name) between 1 and 60),
  budget     numeric(12, 2) check (budget is null or budget >= 0),
  position   integer not null default 0,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.transactions (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null check (length(id) between 1 and 120),
  date         date not null,
  amount       numeric(12, 2) not null check (amount > 0),
  kind         text not null default 'expense' check (kind in ('expense', 'income', 'refund')),
  category_id  text,
  payee        text check (payee is null or length(payee) <= 120),
  note         text check (note is null or length(note) <= 500),
  source       text not null default 'manual' check (source in ('manual', 'voice', 'bank', 'receipt')),
  receipt_path text,   -- step 4: receipt photo in storage
  bank_ref     text,   -- step 3: bank import reference, used to skip duplicates
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create index categories_user_synced   on public.categories (user_id, synced_at);
create index transactions_user_synced on public.transactions (user_id, synced_at);
create index transactions_user_date   on public.transactions (user_id, date) where not deleted;

create trigger categories_synced before insert or update on public.categories
  for each row execute function public.koti_touch_synced_at();
create trigger transactions_synced before insert or update on public.transactions
  for each row execute function public.koti_touch_synced_at();

alter table public.categories   enable row level security;
alter table public.transactions enable row level security;

create policy "Own categories" on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own transactions" on public.transactions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.categories, public.transactions to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.categories, public.transactions;
  end if;
end;
$$;
