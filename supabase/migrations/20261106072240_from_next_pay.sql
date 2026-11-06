-- "I paid 11 for lunch from my upcoming salary": the expense keeps the day it was bought, and from_pay is the payday
-- it comes out of. The balance counts it on that day (js/engine.js fromNextPay). Null for everything else.
alter table public.transactions add column from_pay date;
alter table public.transactions add constraint transactions_from_pay_after check (from_pay is null or (kind = 'expense' and from_pay > date));
