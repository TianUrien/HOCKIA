-- Push delivery log: one row per device for every push send-push attempts,
-- with what the provider answered (sent, token rejected, failed, rate
-- limited, or skipped because the device's provider is not configured).
--
-- Why: until now the outcome of a push lived only in the edge function's
-- console output, which the platform keeps for a short time. A member saying
-- "I did not get the notification" could not be answered, and a provider
-- outage (APNs or FCM refusing every send) was invisible unless someone read
-- the logs that day. Founder request 2026-11-23: register the failures that
-- do not raise an error in the app.
--
-- What it stores: the recipient, the notification kind, the platform, the
-- outcome and a short provider detail (an HTTP status or error name). It
-- never stores a device token, an endpoint, or the text of the push.
--
-- Access: service role only. No policy, no grant to anon or authenticated;
-- send-push writes with the service client and the team reads through SQL.
-- Rows are pruned after 30 days.
--
-- Rollback: supabase/rollbacks/20261123120000_push_delivery_log.down.sql

CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  notification_id uuid,
  recipient_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  outcome text NOT NULL CHECK (outcome IN ('sent', 'rejected', 'failed', 'rate_limited', 'not_configured')),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 200)
);

COMMENT ON TABLE public.push_delivery_log IS
  'One row per device per push attempt from send-push. Service role only; pruned after 30 days. Never holds a device token or the push text.';
COMMENT ON COLUMN public.push_delivery_log.notification_id IS
  'profile_notifications.id when the push came from a notification row; no foreign key, notifications are pruned on their own schedule.';
COMMENT ON COLUMN public.push_delivery_log.outcome IS
  'sent: the provider accepted it. rejected: the provider said the token is gone and the subscription was removed. failed: the provider or the network refused the send. rate_limited: HTTP 429. not_configured: the device needs a provider this project has no keys for.';

CREATE INDEX IF NOT EXISTS push_delivery_log_created_at_idx
  ON public.push_delivery_log (created_at);
CREATE INDEX IF NOT EXISTS push_delivery_log_recipient_idx
  ON public.push_delivery_log (recipient_profile_id, created_at DESC);

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_delivery_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.push_delivery_log TO service_role;

-- Retention: 30 days.
CREATE OR REPLACE FUNCTION public.prune_push_delivery_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.push_delivery_log
   WHERE created_at < timezone('utc', now()) - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_push_delivery_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_push_delivery_log() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_push_delivery_log_daily') THEN
      PERFORM cron.schedule('prune_push_delivery_log_daily', '45 4 * * *',
        $cron$SELECT public.prune_push_delivery_log();$cron$);
    END IF;
  END IF;
END $$;
