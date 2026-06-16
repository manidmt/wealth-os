-- Cron diario que sincroniza todas las conexiones bancarias activas.
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
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
