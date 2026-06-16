create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  incomes jsonb not null default '[]'::jsonb,
  savings_goal numeric not null default 0,
  budgets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

alter table public.monthly_budgets enable row level security;

create policy "own budgets" on public.monthly_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
