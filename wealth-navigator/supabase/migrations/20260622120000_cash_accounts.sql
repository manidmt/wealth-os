create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  balance numeric not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.cash_accounts enable row level security;
create policy "own cash accounts" on public.cash_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
