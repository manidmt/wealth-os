-- Estrategias: columnas nuevas en investment_plans
alter table public.investment_plans
  add column if not exists asset_class text
    check (asset_class in ('rv_core','rv_opp','gold','btc','rf')),
  add column if not exists multiplier_rules jsonb,
  add column if not exists dry_powder jsonb,
  add column if not exists annual_multiplier numeric not null default 1,
  add column if not exists annual_multiplier_year int;

-- LOG: columnas nuevas en plan_contributions
alter table public.plan_contributions
  add column if not exists price numeric,
  add column if not exists units numeric,
  add column if not exists multiplier numeric,
  add column if not exists signal_note text;

-- Señales de mercado (tabla global, sin user_id)
create table if not exists public.market_signals (
  signal_key text not null,
  date date not null,
  value numeric not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  updated_at timestamptz not null default now(),
  primary key (signal_key, date)
);
alter table public.market_signals enable row level security;
create policy "read signals" on public.market_signals
  for select to authenticated using (true);
create policy "manual insert" on public.market_signals
  for insert to authenticated with check (source = 'manual');
create policy "manual update" on public.market_signals
  for update to authenticated using (true) with check (source = 'manual');

-- Estado de rutinas
create table if not exists public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  items jsonb not null default '[]',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, period)
);
alter table public.routine_logs enable row level security;
create policy "own routine logs" on public.routine_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
