-- =========================================================================
-- AI cost log, daily question cap, monthly spend alert (Hockia AI v2)
-- =========================================================================
-- Founder rulings 2026-10-03:
--   * every LLM-backed answer is logged with its tokens and an estimated cost
--     (ai_usage_log; prices in supabase/functions/_shared/aiPricing.ts);
--   * a member may ask Hockia AI 30 questions per UTC day (nl-search checks
--     ai_questions_today() before any LLM call and answers kind='cap_reached');
--   * when the month's spend passes USD 50 the founder gets ONE email per month.
--
-- What ships here:
--   * ai_usage_log: service-role only (RLS on, no policies, explicit REVOKEs).
--     Written by the nl-search edge function through the service client; one
--     row per answered question. Alert stamps live in the same table as
--     function = 'alert' rows (user_id NULL, cost 0).
--   * ai_questions_today(p_user): rows for the member since UTC midnight,
--     alert rows excluded. service_role only.
--   * ai_spend_month_usd(): sum(cost_usd) since the first of the month (UTC).
--     service_role only.
--   * check_ai_spend_alert(): the daily job. Threshold = app_settings key
--     'ai_spend_alert_usd' when the row exists, else the USD 50 constant below.
--     Idempotent per calendar month through the function='alert' stamp row.
--     Delivery reuses the existing admin email chain (same as the Monday
--     market digest): INSERT into admin_digest_queue → dashboard webhook →
--     admin-market-digest edge function → Resend to app_settings
--     'admin_digest_email'. The payload carries kind = 'ai_spend_alert' and
--     the edge function renders that kind as the short alert email (no new
--     service, no Vault secret). Without a recipient setting the stamp is
--     still written and the queue insert is skipped.
--   * enqueue_admin_market_digest(): live body (20260718150000) plus one
--     predicate so an alert row in the queue never trips the market digest's
--     5-day cooldown.
--   * cron ai_spend_alert_daily, 08:25 UTC (after signing_current_club_daily).
--
-- Grants: everything here is service_role only; pg_cron runs as the database
-- owner. The migration seeds no data (no threshold row, no recipient row).
-- Rollback: supabase/rollbacks/20261003140000_ai_usage_log.down.sql
-- Probe:    supabase/tests/security/ai_usage_log.probe.sql
-- =========================================================================


-- ═══ 1 · ai_usage_log ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  function      text NOT NULL,
  provider      text,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_usage_log IS
  'AI cost log: one row per LLM-backed answer (function = edge function name) plus monthly alert stamps (function = ''alert''). Service-role only; written by edge functions, read by ai_questions_today / ai_spend_month_usd.';

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: nothing but the service role (which bypasses RLS)
-- may read or write the log.

REVOKE ALL ON TABLE public.ai_usage_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_usage_log TO service_role;

CREATE INDEX IF NOT EXISTS ai_usage_log_user_created_idx
  ON public.ai_usage_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx
  ON public.ai_usage_log (created_at);


-- ═══ 2 · ai_questions_today ═════════════════════════════════════════════════════
-- Questions the member asked since 00:00 UTC today. Alert stamps never count.

CREATE OR REPLACE FUNCTION public.ai_questions_today(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM public.ai_usage_log l
   WHERE l.user_id = p_user
     AND l.function <> 'alert'
     AND l.created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
$$;

REVOKE ALL ON FUNCTION public.ai_questions_today(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_questions_today(uuid) TO service_role;


-- ═══ 3 · ai_spend_month_usd ═════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ai_spend_month_usd()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(l.cost_usd), 0)::numeric
    FROM public.ai_usage_log l
   WHERE l.created_at >= (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
$$;

REVOKE ALL ON FUNCTION public.ai_spend_month_usd() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend_month_usd() TO service_role;


-- ═══ 4 · check_ai_spend_alert (daily job) ══════════════════════════════════════
-- Returns what it did so a manual run in the SQL editor is self-explaining:
--   { sent, reason, month, spend_usd, threshold_usd, queued }

CREATE OR REPLACE FUNCTION public.check_ai_spend_alert()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Founder ruling 2026-10-03: USD 50 per month. Override without a deploy by
  -- inserting app_settings ('ai_spend_alert_usd', '<number>').
  c_default_threshold constant numeric := 50;
  v_threshold  numeric;
  v_setting    text;
  v_month_start timestamptz := (date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
  v_month      text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
  v_spend      numeric;
  v_questions  integer;
  v_recipient  text;
  v_queued     boolean := false;
BEGIN
  SELECT value INTO v_setting FROM public.app_settings WHERE key = 'ai_spend_alert_usd';
  BEGIN
    v_threshold := coalesce(nullif(btrim(v_setting), '')::numeric, c_default_threshold);
  EXCEPTION WHEN others THEN
    v_threshold := c_default_threshold;
  END;

  v_spend := public.ai_spend_month_usd();

  IF v_spend <= v_threshold THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'under_threshold', 'month', v_month,
                              'spend_usd', v_spend, 'threshold_usd', v_threshold, 'queued', false);
  END IF;

  -- One alert per calendar month: the stamp row is the lock.
  IF EXISTS (
    SELECT 1 FROM public.ai_usage_log
     WHERE function = 'alert' AND created_at >= v_month_start
  ) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent', 'month', v_month,
                              'spend_usd', v_spend, 'threshold_usd', v_threshold, 'queued', false);
  END IF;

  SELECT count(*) INTO v_questions
    FROM public.ai_usage_log
   WHERE function <> 'alert' AND created_at >= v_month_start;

  INSERT INTO public.ai_usage_log (user_id, function, provider, model, cost_usd)
  VALUES (NULL, 'alert', 'system', 'ai_spend_alert', 0);

  SELECT value INTO v_recipient FROM public.app_settings WHERE key = 'admin_digest_email';
  IF v_recipient IS NOT NULL AND v_recipient <> '' THEN
    INSERT INTO public.admin_digest_queue (recipient, payload)
    VALUES (v_recipient, jsonb_build_object(
      'kind', 'ai_spend_alert',
      'month', v_month,
      'spend_usd', round(v_spend, 2),
      'threshold_usd', v_threshold,
      'questions', v_questions
    ));
    v_queued := true;
  ELSE
    RAISE NOTICE 'ai spend alert: no admin_digest_email configured; stamp written, no email queued';
  END IF;

  RETURN jsonb_build_object('sent', true, 'reason', 'over_threshold', 'month', v_month,
                            'spend_usd', v_spend, 'threshold_usd', v_threshold, 'queued', v_queued);
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_spend_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ai_spend_alert() TO service_role;


-- ═══ 5 · enqueue_admin_market_digest: cooldown ignores alert rows ══════════════
-- Live body (20260718150000) plus the `kind` predicate in the cooldown guard.

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
  -- normal next week always passes). AI spend alerts share the queue but
  -- are not digests: they never count towards the cooldown.
  IF EXISTS (
    SELECT 1 FROM admin_digest_queue
    WHERE created_at > timezone('utc', now()) - interval '5 days'
      AND COALESCE(payload->>'kind', '') <> 'ai_spend_alert'
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

-- Unchanged, restated.
REVOKE ALL ON FUNCTION public.enqueue_admin_market_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_market_digest() TO authenticated, service_role;


-- ═══ Schedule ══════════════════════════════════════════════════════════════════
-- Same pattern as signing_current_club_daily (20261003100000). 08:25 UTC.

DO $$
BEGIN
  PERFORM cron.unschedule('ai_spend_alert_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior ai_spend_alert_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('ai_spend_alert_daily', '25 8 * * *',
    $cron$SELECT public.check_ai_spend_alert();$cron$);
END $$;


-- ═══ Self-checks ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.ai_usage_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ai_usage_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ai_usage_log', 'INSERT') THEN
    RAISE EXCEPTION 'ai_usage_log must be service_role only';
  END IF;
  IF has_function_privilege('anon', 'public.ai_questions_today(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ai_questions_today(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ai_spend_month_usd()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.check_ai_spend_alert()', 'EXECUTE') THEN
    RAISE EXCEPTION 'AI cost functions must be service_role only';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
