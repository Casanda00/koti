-- Koti: push reminders. Each phone that turns reminders on is saved here; an hourly job asks the
-- send-reminders function to check bills, paydays and budgets. Keys and the job's token live in Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.push_subscriptions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null check (length(endpoint) between 10 and 1000),
  p256dh     text not null check (length(p256dh) <= 200),
  auth       text not null check (length(auth) <= 100),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
create policy "Own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Which reminders were sent, so each goes out once. Only the server uses it (no policies).
create table public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null check (length(key) <= 200),
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_log enable row level security;

-- Read the push keys and the job token (server only).
create or replace function public.koti_push_secrets()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name in ('koti_vapid_public', 'koti_vapid_private', 'koti_cron_token');
$$;
-- Store the push keys the first time the function runs (server only).
create or replace function public.koti_push_save_keys(pub text, priv text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'koti_vapid_private') then return; end if;
  perform vault.create_secret(pub, 'koti_vapid_public', 'Koti push: public key');
  perform vault.create_secret(priv, 'koti_vapid_private', 'Koti push: private key');
end $$;
revoke all on function public.koti_push_secrets() from public, anon, authenticated;
revoke all on function public.koti_push_save_keys(text, text) from public, anon, authenticated;
grant execute on function public.koti_push_secrets() to service_role;
grant execute on function public.koti_push_save_keys(text, text) to service_role;

-- A random token for the hourly job, made here so it never leaves the database.
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'koti_cron_token', 'Koti: lets the hourly job call send-reminders')
where not exists (select 1 from vault.secrets where name = 'koti_cron_token');

-- Every hour at :07.
select cron.schedule('koti-reminders', '7 * * * *', $job$
  select net.http_post(
    url := 'https://dghcrcneikxuaacsyhpy.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-koti-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'koti_cron_token')),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 30000);
$job$);
