alter table public.monthly_budgets
  add column if not exists allocations jsonb not null default '{}'::jsonb;
