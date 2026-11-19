-- Saldos bancarios vía Open Banking: cada cuenta de efectivo puede enlazarse
-- con una cuenta real del banco y su saldo se actualiza en cada sincronización.
-- sync_transactions permite conectar un banco solo para leer saldos (p. ej.
-- Trade Republic o MyInvestor) sin importar sus movimientos a `movements`.

alter table public.bank_connections
  add column if not exists sync_transactions boolean not null default true;

alter table public.cash_accounts
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists bank_account_uid text,
  add column if not exists balance_synced_at timestamptz;

create unique index if not exists cash_accounts_user_bank_account_uid_key
  on public.cash_accounts (user_id, bank_account_uid)
  where bank_account_uid is not null;

-- La UI cambia sync_transactions desde el cliente: asegura que el dueño pueda
-- actualizar sus propias conexiones (políticas permisivas se combinan con OR).
drop policy if exists "own bank connections update" on public.bank_connections;
create policy "own bank connections update" on public.bank_connections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
