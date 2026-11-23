-- Rollback of 20261123120000_push_delivery_log.sql: removes the retention
-- job, its function and the log table. send-push writes the log on a
-- best-effort basis, so a deployed function keeps sending pushes without the
-- table (each failed insert is a warning in its console output).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_push_delivery_log_daily') THEN
      PERFORM cron.unschedule('prune_push_delivery_log_daily');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.prune_push_delivery_log();
DROP TABLE IF EXISTS public.push_delivery_log;
