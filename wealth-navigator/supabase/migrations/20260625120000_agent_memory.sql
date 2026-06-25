create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index agent_messages_user_created_idx on public.agent_messages (user_id, created_at);
alter table public.agent_messages enable row level security;
create policy "own agent messages" on public.agent_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.agent_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  facts text not null default '',
  summary text not null default '',
  summarized_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_memory enable row level security;
create policy "own agent memory" on public.agent_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
