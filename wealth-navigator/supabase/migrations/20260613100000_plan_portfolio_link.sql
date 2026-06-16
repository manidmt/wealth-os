alter table public.investment_plans
  add column if not exists portfolio_position_id uuid
    references public.portfolio_positions(id) on delete set null;
