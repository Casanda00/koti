-- Koti: income that stops (contract end) and expected payments that didn't come.
alter table public.income_sources
  add column end_date date,
  add column missed   jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missed) = 'array' and jsonb_array_length(missed) <= 120);
