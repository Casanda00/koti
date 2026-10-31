-- Koti: Budgets, Income, Expenses.
-- Lists get a kind (shopping list, project, or a room inside a project), a parent, and a budget for projects.
-- Items get a quantity. Income sources are new; receiving income is a transaction linked to the source.
-- Existing data moves over: the Home setup lists become rooms of a "Home setup" project,
-- and a monthly income set in settings becomes a "Salary" source.

alter table public.lists
  add column kind        text not null default 'room' check (kind in ('shopping', 'project', 'room')),
  add column parent_id   text,
  add column budget      numeric(12, 2) check (budget is null or budget >= 0),
  add column extra_spend numeric(12, 2) not null default 0 check (extra_spend >= 0),
  add column plan        text;   -- floor plan shown for a project, e.g. 'koti-apartment'

alter table public.items
  add column qty  numeric(10, 2) check (qty is null or qty > 0),
  add column note text check (note is null or length(note) <= 300);

create table public.income_sources (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            text not null check (length(id) between 1 and 80),
  name          text not null check (length(name) between 1 and 80),
  amount        numeric(12, 2) check (amount is null or amount >= 0),   -- expected amount; null when it varies
  frequency     text not null default 'monthly' check (frequency in ('monthly', 'varies', 'once')),
  pay_day       smallint not null default 0 check (pay_day between 0 and 31),  -- 0 = last day of the month
  expected_date date,                                                       -- for one-off income
  payer         text check (payer is null or length(payer) <= 120),
  active        boolean not null default true,
  position      integer not null default 0,
  deleted       boolean not null default false,
  updated_at    timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.transactions add column income_id text, add column income_due date;

create index income_sources_user_synced on public.income_sources (user_id, synced_at);
create trigger income_sources_synced before insert or update on public.income_sources
  for each row execute function public.koti_touch_synced_at();
alter table public.income_sources enable row level security;
create policy "Own income sources" on public.income_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.income_sources to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.income_sources;
  end if;
end;
$$;

-- Move existing data: one Home setup project per user who has lists.
insert into public.lists (user_id, id, name, room, position, kind, budget, extra_spend, plan, updated_at)
select u.user_id, 'proj-home-setup', 'Home setup', 'OH', 0, 'project',
       nullif(s.data ->> 'budget', '')::numeric, coalesce(nullif(s.data ->> 'extraSpend', '')::numeric, 0), 'koti-apartment', now()
from (select distinct user_id from public.lists where not deleted) u
left join public.settings s on s.user_id = u.user_id
on conflict (user_id, id) do nothing;

update public.lists
   set kind = 'room', parent_id = 'proj-home-setup', updated_at = now()
 where id <> 'proj-home-setup' and kind = 'room' and parent_id is null;

insert into public.income_sources (user_id, id, name, amount, frequency, pay_day, position, updated_at)
select s.user_id, 'inc-salary', 'Salary', (s.data ->> 'income')::numeric, 'monthly',
       case when coalesce(s.data ->> 'payday', 'last') = 'last' then 0 else least(31, greatest(1, (s.data ->> 'payday')::int)) end, 0, now()
from public.settings s
where nullif(s.data ->> 'income', '') is not null
on conflict (user_id, id) do nothing;
