-- Koti: scanned bills. A bill can happen once, keeps its payment reference and account (IBAN),
-- and each due date can have its own amount, reference and saved document ("dues", keyed by YYYY-MM-DD).

alter table public.bills drop constraint bills_frequency_check;
alter table public.bills add constraint bills_frequency_check
  check (frequency = any (array['monthly', 'quarterly', 'yearly', 'once']));

alter table public.bills
  add column due_date  date,
  add column reference text check (reference is null or length(reference) <= 60),
  add column iban      text check (iban is null or length(iban) <= 40),
  add column dues      jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dues) = 'object' and pg_column_size(dues) <= 32000);

alter table public.bills add constraint bills_once_has_date
  check (frequency <> 'once' or due_date is not null);
