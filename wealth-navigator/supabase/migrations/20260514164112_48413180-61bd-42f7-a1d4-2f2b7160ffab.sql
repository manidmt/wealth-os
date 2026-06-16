-- Enum para tipo de movimiento
create type public.movement_type as enum ('income', 'expense');

-- Enum para tipo de activo
create type public.asset_type as enum ('etf', 'stock', 'crypto', 'fund', 'bond', 'broker_cash', 'other');

-- Tabla de movimientos
create table public.movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.movement_type not null,
  date date not null,
  category text not null,
  description text,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index movements_user_id_date_idx on public.movements (user_id, date desc);

alter table public.movements enable row level security;

create policy "Movements: users can view own"
  on public.movements for select to authenticated
  using (auth.uid() = user_id);

create policy "Movements: users can insert own"
  on public.movements for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Movements: users can update own"
  on public.movements for update to authenticated
  using (auth.uid() = user_id);

create policy "Movements: users can delete own"
  on public.movements for delete to authenticated
  using (auth.uid() = user_id);

create trigger movements_set_updated_at
  before update on public.movements
  for each row execute function public.set_updated_at();

-- Tabla de posiciones de portfolio
create table public.portfolio_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_name text not null,
  ticker text,
  isin text,
  asset_type public.asset_type not null,
  platform text,
  quantity numeric(20,8) not null,
  avg_cost numeric(20,8) not null,
  current_price numeric(20,8) not null,
  currency text not null default 'EUR',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portfolio_positions_user_id_idx on public.portfolio_positions (user_id);

alter table public.portfolio_positions enable row level security;

create policy "Portfolio: users can view own"
  on public.portfolio_positions for select to authenticated
  using (auth.uid() = user_id);

create policy "Portfolio: users can insert own"
  on public.portfolio_positions for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Portfolio: users can update own"
  on public.portfolio_positions for update to authenticated
  using (auth.uid() = user_id);

create policy "Portfolio: users can delete own"
  on public.portfolio_positions for delete to authenticated
  using (auth.uid() = user_id);

create trigger portfolio_positions_set_updated_at
  before update on public.portfolio_positions
  for each row execute function public.set_updated_at();