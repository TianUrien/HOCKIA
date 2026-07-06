-- Task 2 — public publisher responsiveness (the reward badge).
--
-- Daily precompute (product_health_snapshots pattern) of each publisher's
-- median first-response time over their most recent resolved applications:
--   - "first response" = earliest application_status_history row where
--     old_status='pending' (NOT updated_at, which the ai_feedback cache bumps)
--   - only applications with applied_at >= launch_date (decision A: the
--     grandfathered backlog can neither help nor hurt the metric — a December
--     application triaged in July would otherwise record a 7-month response)
--   - auto-expiries COUNT (changed_via='auto_expiry' rows land at the full
--     expiry window, dragging a silent publisher's median past every tier —
--     the teeth behind the badge) — but the outcome is a NEUTRAL absence of
--     badge, never a public shame label
--   - rolling 90-day window, latest 20 resolved per publisher, minimum 3
--     samples before any tier is awarded ("New on HOCKIA" = no row/no tier,
--     rendered as nothing client-side)
--
-- Tiers: fast ≤72h ("⚡ Responds within ~3 days"), week ≤168h, two_weeks
-- ≤336h; slower → NULL (neutral). Readable by everyone; written only by the
-- daily snapshot.

CREATE TABLE public.publisher_responsiveness (
  publisher_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  median_hours numeric,
  sample_count integer NOT NULL,
  tier text CHECK (tier IN ('fast', 'week', 'two_weeks')),
  computed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.publisher_responsiveness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "publisher responsiveness is public"
  ON public.publisher_responsiveness FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.publisher_responsiveness FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_publisher_responsiveness()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_launch timestamptz;
BEGIN
  SELECT s.launch_date INTO v_launch FROM application_response_settings s;
  -- Pre-launch the metric is undefined by construction; also wipes nothing.
  IF v_launch IS NULL THEN
    RETURN;
  END IF;

  WITH first_response AS (
    SELECT DISTINCT ON (h.application_id)
      h.application_id,
      h.created_at AS responded_at,
      o.club_id AS publisher_id,
      a.applied_at
    FROM application_status_history h
    JOIN opportunity_applications a ON a.id = h.application_id
    JOIN opportunities o ON o.id = a.opportunity_id
    WHERE h.old_status = 'pending'
      AND a.applied_at >= v_launch
      AND h.created_at >= timezone('utc', now()) - interval '90 days'
    ORDER BY h.application_id, h.created_at ASC
  ),
  ranked AS (
    SELECT fr.publisher_id,
           EXTRACT(EPOCH FROM (fr.responded_at - fr.applied_at)) / 3600.0 AS hours,
           row_number() OVER (PARTITION BY fr.publisher_id ORDER BY fr.responded_at DESC) AS rn
    FROM first_response fr
  ),
  agg AS (
    SELECT r.publisher_id,
           count(*)::int AS sample_count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.hours) AS median_hours
    FROM ranked r
    WHERE r.rn <= 20
    GROUP BY r.publisher_id
  ),
  upserted AS (
    INSERT INTO publisher_responsiveness (publisher_id, median_hours, sample_count, tier, computed_at)
    SELECT a.publisher_id,
           round(a.median_hours::numeric, 1),
           a.sample_count,
           CASE
             WHEN a.sample_count < 3 THEN NULL
             WHEN a.median_hours <= 72  THEN 'fast'
             WHEN a.median_hours <= 168 THEN 'week'
             WHEN a.median_hours <= 336 THEN 'two_weeks'
             ELSE NULL
           END,
           timezone('utc', now())
    FROM agg a
    ON CONFLICT (publisher_id) DO UPDATE
      SET median_hours = EXCLUDED.median_hours,
          sample_count = EXCLUDED.sample_count,
          tier         = EXCLUDED.tier,
          computed_at  = EXCLUDED.computed_at
    RETURNING publisher_id
  )
  -- Publishers that dropped out of the window lose their row (neutral state).
  DELETE FROM publisher_responsiveness pr
  WHERE pr.publisher_id NOT IN (SELECT a.publisher_id FROM agg a);
END;
$function$;

DO $$
BEGIN
  PERFORM cron.unschedule('publisher_responsiveness_daily');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior publisher_responsiveness_daily schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('publisher_responsiveness_daily', '30 2 * * *',
    $cron$SELECT public.snapshot_publisher_responsiveness();$cron$);
END $$;
