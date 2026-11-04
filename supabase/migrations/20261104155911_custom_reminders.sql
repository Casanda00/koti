-- Your own reminders: what to say, when, and (for "before" reminders) what it's about.
-- The send-reminders function reads them every hour; each device syncs them like bills and lists.
create table public.reminders (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (length(id) between 1 and 80),
  title       text not null check (length(title) between 1 and 120),
  note        text check (note is null or length(note) <= 300),
  schedule    text not null check (schedule in ('once', 'monthly', 'weekly', 'before')),
  on_date     date,                                                            -- once
  month_day   smallint check (month_day is null or month_day between -2 and 31), -- monthly: 1-31, -1 last working day, -2 payday
  weekday     smallint check (weekday is null or weekday between 0 and 6),     -- weekly: 0 = Sunday
  before_days smallint check (before_days is null or before_days between 0 and 60),
  about_kind  text check (about_kind is null or about_kind in ('bill', 'payday', 'monthend')),
  about_id    text check (about_id is null or length(about_id) <= 80),
  hour        smallint not null default 9 check (hour between 0 and 23),
  active      boolean not null default true,
  position    integer not null default 0,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create index reminders_user_synced on public.reminders (user_id, synced_at);
create trigger reminders_synced before insert or update on public.reminders
  for each row execute function public.koti_touch_synced_at();
alter table public.reminders enable row level security;
create policy "Own reminders" on public.reminders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.reminders to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.reminders;
  end if;
end;
$$;
