-- Cron diario que refresca las señales de mercado invocando la Edge Function signals-sync.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: quita el job anterior si existe antes de recrearlo.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'signals-sync-daily') then
    perform cron.unschedule('signals-sync-daily');
  end if;
end $$;

select cron.schedule(
  'signals-sync-daily',
  '0 7 * * *',
  $job$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/signals-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'apikey', 'sb_publishable_OPVPYpiIjiBb8DePshGUfQ_X3Tq6NdU',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
