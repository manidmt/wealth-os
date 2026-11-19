-- Cierre mensual automático de patrimonio.
-- Cada mañana, tras bank-sync (08:00 UTC) y prices-sync (08:30 UTC), se guarda
-- patrimonio = cartera + saldos de cuentas en el mes del DÍA ANTERIOR (hora de
-- Madrid). Así el día 1 se escribe el cierre definitivo del mes recién terminado,
-- con saldos que ya incluyen sus últimos movimientos. Misma fórmula que el dashboard.
-- Solo usuarios con cuentas de efectivo: sin ellas el patrimonio no es fiable.
-- Requiere un secreto 'cron_secret' en Vault (igual al CRON_SECRET de las edge
-- functions); se crea fuera de esta migración para no publicarlo en el repo.

create or replace function public.record_net_worth_snapshots()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  snap_month text := to_char((now() at time zone 'Europe/Madrid') - interval '1 day', 'YYYY-MM');
  cur_month text := to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM');
  n integer;
begin
  with cash as (
    select user_id, sum(balance) as cash from cash_accounts group by user_id
  ), port as (
    select user_id,
           sum(coalesce(quantity, 0) * coalesce(current_price, 0) * coalesce(nullif(fx_to_eur, 0), 1)) as value
    from portfolio_positions group by user_id
  ), sav as (
    select user_id,
           sum(case when type = 'income' then amount else -amount end) as savings
    from movements
    where not coalesce(excluded, false) and to_char(date, 'YYYY-MM') = snap_month
    group by user_id
  )
  insert into monthly_snapshots
    (user_id, month, assets, liabilities, net_worth, savings, portfolio_value, closed_at, notes)
  select c.user_id, snap_month,
         round(coalesce(p.value, 0) + c.cash, 2), 0, round(coalesce(p.value, 0) + c.cash, 2),
         round(coalesce(s.savings, 0), 2), round(coalesce(p.value, 0), 2),
         case when snap_month < cur_month then now() end,
         'auto'
  from cash c
  left join port p using (user_id)
  left join sav s using (user_id)
  on conflict (user_id, month) do update set
    assets = excluded.assets,
    liabilities = excluded.liabilities,
    net_worth = excluded.net_worth,
    savings = excluded.savings,
    portfolio_value = excluded.portfolio_value,
    closed_at = excluded.closed_at
  -- Nunca pisar un cierre hecho a mano.
  where monthly_snapshots.notes is not distinct from 'auto';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Escribe para todos los usuarios: solo debe ejecutarla el cron.
revoke execute on function public.record_net_worth_snapshots() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prices-sync-daily') then
    perform cron.unschedule('prices-sync-daily');
  end if;
  if exists (select 1 from cron.job where jobname = 'net-worth-snapshot-daily') then
    perform cron.unschedule('net-worth-snapshot-daily');
  end if;
end $$;

select cron.schedule(
  'prices-sync-daily',
  '30 8 * * *',
  $job$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/prices-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'apikey', 'sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

select cron.schedule(
  'net-worth-snapshot-daily',
  '0 9 * * *',
  $job$ select public.record_net_worth_snapshots(); $job$
);
