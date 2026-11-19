-- bank-sync-all exige ahora el header x-cron-secret (= secreto 'cron_secret' de
-- Vault = CRON_SECRET de las edge functions). Se reprograma el cron para enviarlo.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'bank-sync-daily') then
    perform cron.unschedule('bank-sync-daily');
  end if;
end $$;

select cron.schedule(
  'bank-sync-daily',
  '0 8 * * *',
  $job$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/bank-sync-all',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'apikey', 'sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
