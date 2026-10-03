-- ROLLBACK for 20261003140000_ai_usage_log.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20261003140000 --linked
--
-- Unschedules ai_spend_alert_daily, drops the alert, spend and cap functions,
-- restores enqueue_admin_market_digest to its 20260718150000 body and drops
-- ai_usage_log (the cost log is lost; the nl-search edge function keeps
-- answering: its insert and cap RPC both fail soft).

DO $$
BEGIN
  PERFORM cron.unschedule('ai_spend_alert_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No ai_spend_alert_daily schedule found';
END $$;

DROP FUNCTION IF EXISTS public.check_ai_spend_alert();
DROP FUNCTION IF EXISTS public.ai_spend_month_usd();
DROP FUNCTION IF EXISTS public.ai_questions_today(uuid);

CREATE OR REPLACE FUNCTION public.enqueue_admin_market_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recipient text;
BEGIN
  -- Cron (claims-less) or an admin may enqueue; nothing else.
  IF NOT (
    public.is_platform_admin()
    OR COALESCE(current_setting('request.jwt.claims', true), '') = ''
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Cooldown guard (cron-jitter class: cooldown must be < cadence — 5 days
  -- for a weekly job, so a retried/rescheduled run cannot double-send but a
  -- normal next week always passes).
  IF EXISTS (
    SELECT 1 FROM admin_digest_queue
    WHERE created_at > timezone('utc', now()) - interval '5 days'
  ) THEN
    RAISE NOTICE 'admin market digest: skipped (sent within cooldown)';
    RETURN;
  END IF;

  SELECT value INTO v_recipient FROM app_settings WHERE key = 'admin_digest_email';
  IF v_recipient IS NULL OR v_recipient = '' THEN
    RAISE NOTICE 'admin market digest: no recipient configured';
    RETURN;
  END IF;

  INSERT INTO admin_digest_queue (recipient, payload)
  VALUES (v_recipient, public.admin_market_intelligence_impl(90));
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_admin_market_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_market_digest() TO authenticated, service_role;

DROP TABLE IF EXISTS public.ai_usage_log;

NOTIFY pgrst, 'reload schema';
