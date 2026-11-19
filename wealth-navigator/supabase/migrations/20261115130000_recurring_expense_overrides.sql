-- "Gastos fijos" are inferred on the fly from recent movements (see
-- src/lib/recurring.ts), not a stored entity. This table lets the user
-- correct that inference (rename, override the monthly amount, or hide a
-- false positive) without turning it into a fully separate, hand-maintained
-- list — the detection keeps running and this only overrides its output.
create table public.recurring_expense_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- matches the normalized concept key from normalizeConcept() in recurring.ts
  concept text not null,
  display_name text,
  monthly_amount numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, concept)
);
alter table public.recurring_expense_overrides enable row level security;
create policy "own recurring expense overrides" on public.recurring_expense_overrides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
