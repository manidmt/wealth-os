-- El upsert de Open Banking necesita un índice único en external_id (onConflict).
-- UNIQUE normal permite múltiples NULL (movimientos manuales sin external_id).
alter table public.movements
  add constraint movements_external_id_key unique (external_id);
