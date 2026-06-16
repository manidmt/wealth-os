alter table public.bank_connections
  add column if not exists aspsp_country text,
  add column if not exists auth_state text,
  add column if not exists session_expires_at timestamptz;
