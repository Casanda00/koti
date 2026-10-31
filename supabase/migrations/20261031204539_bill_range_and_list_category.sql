-- Koti: a recurring bill runs from a start month (and optionally to an end month), so adding one
-- doesn't make it look unpaid in earlier months. Lists can be linked to a spending category.
alter table public.bills
  add column start_date date,
  add column end_date   date,
  add constraint bills_range_check check (end_date is null or start_date is null or end_date >= start_date);

-- Bills that already exist start in the month they were last saved (they were added recently).
update public.bills set start_date = date_trunc('month', updated_at)::date where start_date is null;

alter table public.lists
  add column category_id text check (category_id is null or length(category_id) <= 80);
