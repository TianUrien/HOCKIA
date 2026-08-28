-- Storage cleanup: re-point the nightly drain at the storage-cleanup edge
-- function (audit 2026-08-27).
--
-- process_storage_cleanup_queue() ran `DELETE FROM storage.objects` from
-- pg_cron, which Supabase forbids — it failed every night since launch. The
-- edge function deletes through the Storage API instead.
--
-- The call needs a service-role bearer. That secret is NOT in this file: it
-- is read from Supabase Vault at run time. One-time setup per project, done
-- by the founder in the SQL editor (never committed):
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'supabase_project_url');
--   select vault.create_secret('<service_role_key>',               'supabase_service_role_key');
--
-- Until both secrets exist the job logs a NOTICE and does nothing — it can
-- never fail loudly or call the function with an empty credential.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_storage_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_project_url' ORDER BY created_at DESC LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' ORDER BY created_at DESC LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'storage-cleanup skipped: vault secrets supabase_project_url / supabase_service_role_key not set';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := rtrim(v_url, '/') || '/functions/v1/storage-cleanup',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.run_storage_cleanup() FROM PUBLIC, anon, authenticated;

-- Replace the broken drain; keep the enqueue job as it is (it works).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'storage_cleanup_process';
    PERFORM cron.schedule('storage_cleanup_process', '0 4 * * *', 'SELECT public.run_storage_cleanup();');
  END IF;
END $$;
