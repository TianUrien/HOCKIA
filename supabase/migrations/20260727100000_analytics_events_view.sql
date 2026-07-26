-- Make the SAFE query the DEFAULT one.
--
-- QA feedback (2026-07-27, and it's correct): "a documented WHERE clause is a
-- convention someone will forget under deadline. If the funnel is computed in
-- SQL, a view with the filter baked in makes the safe path the default one."
--
-- Two populations must never appear in a funnel number:
--   1. Automated browsers — E2E runs and QA sweeps. GA4 and PostHog both
--      refuse to load for them, but the first-party pipeline accepts them, so
--      they land in the same table the funnel is computed from. One 24-minute
--      QA session produced 68 events; at ~17 landing views/day that alone can
--      dominate a conversion rate.
--   2. Test accounts — every registration_started row on staging came from
--      one, which is exactly why PostHog correctly has none.
--
-- Query `analytics_events` instead of `events` for anything a human will read
-- as a metric. `events` remains the raw, unfiltered record for debugging.

CREATE OR REPLACE VIEW public.analytics_events AS
SELECT e.*
FROM public.events e
LEFT JOIN public.profiles p ON p.id = e.user_id
WHERE
  -- Not an automated browser (marked client-side from navigator.webdriver).
  (e.properties->>'is_automated') IS NULL
  -- Not a seeded/test account. Anonymous events (user_id NULL) are kept:
  -- they are the top of the funnel and have no profile to judge by.
  AND COALESCE(p.is_test_account, false) = false;

COMMENT ON VIEW public.analytics_events IS
  'events minus automated-browser traffic and test accounts. Use this for any '
  'funnel/metric a human will read; query public.events directly only for '
  'debugging. See docs/analytics/TRACKING_PLAN.md.';

-- Same exposure as the underlying table: admin dashboards read via
-- SECURITY DEFINER RPCs / service_role. No anon grant.
REVOKE ALL ON public.analytics_events FROM PUBLIC, anon;
GRANT SELECT ON public.analytics_events TO authenticated, service_role;
