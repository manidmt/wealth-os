-- Enable Banking no usa institution_id; requisition_id (=session_id) se rellena en el callback, no al conectar.
alter table public.bank_connections
  alter column institution_id drop not null,
  alter column requisition_id drop not null;
