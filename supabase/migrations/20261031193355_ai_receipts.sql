-- Koti: receipts read by AI. A transaction can keep the receipt's lines
-- (name, quantity, price, category or project), and each user has a daily scan limit.

alter table public.transactions
  add column lines jsonb check (lines is null or jsonb_typeof(lines) = 'array');

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "Own AI usage" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.ai_usage to authenticated;

-- Counts one scan for the signed-in user and stops at the daily limit.
-- Called by the read-receipt Edge Function with the user's own session, so auth.uid() is that user.
create or replace function public.koti_ai_use(daily_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception 'Sign in to read receipts';
  end if;
  insert into public.ai_usage (user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  if n > daily_limit then
    raise exception 'Daily receipt limit reached (%). It resets tomorrow.', daily_limit;
  end if;
  return n;
end;
$$;

revoke execute on function public.koti_ai_use(integer) from public, anon;
grant execute on function public.koti_ai_use(integer) to authenticated;
