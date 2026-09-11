-- Schedule granola-sync to sweep all enabled folder->deal mappings every 2 hours.
-- Uses the corrected cron pattern (hardcoded URL + vault cron_secret header); the
-- GUC current_setting() pattern never worked on this managed project. granola-sync
-- validates x-cron-secret == CRON_SECRET. cron.schedule upserts by name (re-runnable).

SELECT cron.schedule(
  'granola-sync-every-2h',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://npfnsyufqqhhjmtvmold.supabase.co/functions/v1/granola-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
