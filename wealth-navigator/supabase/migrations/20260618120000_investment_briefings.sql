create table public.investment_briefings (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,                 -- YYYY-MM
  content text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, period)
);
alter table public.investment_briefings enable row level security;
create policy "own investment briefings" on public.investment_briefings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
