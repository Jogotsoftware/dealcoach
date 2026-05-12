-- Phase 3: schedule compute-coaching-nudges via pg_cron, every 4 hours
-- Idempotent: removes any existing job with the same name first.
DO $$
BEGIN
  PERFORM cron.unschedule('compute-coaching-nudges-every-4h')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-coaching-nudges-every-4h');
EXCEPTION WHEN OTHERS THEN
  -- ignore if unschedule fails (job didn't exist)
  NULL;
END $$;

SELECT cron.schedule(
  'compute-coaching-nudges-every-4h',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url', true) || '/functions/v1/compute-coaching-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
