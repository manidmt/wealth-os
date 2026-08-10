create table public.position_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null references public.portfolio_positions(id) on delete cascade,
  plan_contribution_id uuid references public.plan_contributions(id) on delete set null,
  date date not null,
  quantity numeric(20,8) not null check (quantity > 0),
  price numeric(20,8) not null check (price > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_contribution_id)
);

create index position_lots_position_id_idx on public.position_lots (position_id);

alter table public.position_lots enable row level security;

create policy "Position lots: users can view own"
  on public.position_lots for select to authenticated
  using (auth.uid() = user_id);

create policy "Position lots: users can insert own"
  on public.position_lots for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Position lots: users can update own"
  on public.position_lots for update to authenticated
  using (auth.uid() = user_id);

create policy "Position lots: users can delete own"
  on public.position_lots for delete to authenticated
  using (auth.uid() = user_id);

create trigger position_lots_set_updated_at
  before update on public.position_lots
  for each row execute function public.set_updated_at();
