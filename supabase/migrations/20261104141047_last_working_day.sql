-- Pay can arrive on the last working day of the month: pay_day -1.
-- 0 is still the last calendar day, 1–31 a day of the month.
alter table public.income_sources drop constraint if exists income_sources_pay_day_check;
alter table public.income_sources add constraint income_sources_pay_day_check check (pay_day between -1 and 31);
comment on column public.income_sources.pay_day is '-1 = last working day (weekdays, not Finnish public holidays), 0 = last day of the month, 1-31 = that day';
