-- Columna dedicada a la frescura del PRECIO (la escribe solo el botón/función
-- de actualizar precios). Separa "precio refrescado hoy" de updated_at, que se
-- modifica con cualquier edición de la posición (incluido poner ticker/ISIN).
alter table public.portfolio_positions
  add column if not exists price_updated_at timestamptz;
