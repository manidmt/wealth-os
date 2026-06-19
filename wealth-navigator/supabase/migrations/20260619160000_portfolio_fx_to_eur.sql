-- Cambio a EUR de la divisa de la posición, escrito por la función de precios.
-- El front lo usa para convertir current_price/avg_cost (en divisa nativa) a EUR
-- en los agregados. null = tratar como 1 (posición en EUR o nunca sincronizada).
alter table public.portfolio_positions
  add column if not exists fx_to_eur numeric;
