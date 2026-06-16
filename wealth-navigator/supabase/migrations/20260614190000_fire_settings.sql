create table public.fire_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  annual_expense numeric not null default 0,
  swr_rate numeric not null default 4,
  expected_return numeric not null default 5,
  updated_at timestamptz not null default now()
);
alter table public.fire_settings enable row level security;
create policy "own fire settings" on public.fire_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
