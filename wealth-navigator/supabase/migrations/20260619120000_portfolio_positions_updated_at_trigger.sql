-- Re-asienta el trigger updated_at de portfolio_positions: desapareció del
-- remoto por drift de esquema (un UPDATE no actualizaba updated_at). La función
-- compartida set_updated_at se garantiza con create or replace; el trigger se
-- recrea de forma idempotente.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolio_positions_set_updated_at on public.portfolio_positions;
create trigger portfolio_positions_set_updated_at
  before update on public.portfolio_positions
  for each row execute function public.set_updated_at();
