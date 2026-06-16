create table if not exists public.movement_exclusion_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_text text not null,
  created_at timestamptz not null default now(),
  unique(user_id, match_text)
);
alter table public.movement_exclusion_rules enable row level security;
create policy "own rules" on public.movement_exclusion_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
