-- =========================================================================
-- get_my_week_viewers — "Who looked at you" for the player Pulse (Your week v2)
-- =========================================================================
-- Founder rulings 2026-10-03 (Pulse "Your week v2", Figma 42:276):
--   * Only CLUB and COACH viewers are ever listed by name. Players who viewed
--     are never listed — they count in "Profile views" only
--     (get_my_weekly_visibility), so the list stays a recruiter list.
--   * A viewer who browses anonymously (profiles.browse_anonymously) still
--     appears, as a masked row: every identity column NULL, is_hidden = true,
--     so the count and the list agree ("Private · Browsing hidden").
--   * Banned / frozen viewers (profile_is_hidden), block pairs and test
--     accounts vanish entirely — the same fence as get_my_profile_viewers.
--
-- Why a new function and not get_my_profile_viewers: the live one lists every
-- role, drops anonymous viewers from the list while counting them, and takes
-- (p_days, p_limit); overloading it on one parameter would make PostgREST's
-- resolution ambiguous for the existing callers. Nothing existing changes.
--
-- Owner only: auth.uid() is the profile whose views are read. One row per
-- viewer (latest view wins), newest first, at most 20, window 1–30 days.
-- Rollback: supabase/rollbacks/20261003120000_get_my_week_viewers.down.sql
-- Probe:    supabase/tests/security/week_viewers.probe.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_my_week_viewers(p_days integer DEFAULT 7)
RETURNS TABLE (
  viewer_id  uuid,
  full_name  text,
  role       text,
  username   text,
  avatar_url text,
  country_id integer,
  is_hidden  boolean,
  viewed_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_since timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_since := timezone('utc', now()) - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 7), 1), 30));

  RETURN QUERY
  WITH viewer_events AS (
    SELECT e.user_id AS vid, max(e.created_at) AS last_viewed_at
      FROM public.events e
     WHERE e.event_name = 'profile_view'
       AND e.entity_type = 'profile'
       AND e.entity_id = v_uid
       AND e.created_at >= v_since
       AND e.user_id IS NOT NULL
       AND e.user_id <> v_uid
     GROUP BY e.user_id
  )
  SELECT
    CASE WHEN p.browse_anonymously THEN NULL ELSE ve.vid END          AS viewer_id,
    CASE WHEN p.browse_anonymously THEN NULL ELSE p.full_name END     AS full_name,
    CASE WHEN p.browse_anonymously THEN NULL ELSE p.role END          AS role,
    CASE WHEN p.browse_anonymously THEN NULL ELSE p.username END      AS username,
    CASE WHEN p.browse_anonymously THEN NULL ELSE p.avatar_url END    AS avatar_url,
    CASE WHEN p.browse_anonymously THEN NULL ELSE p.nationality_country_id END AS country_id,
    COALESCE(p.browse_anonymously, false)                              AS is_hidden,
    ve.last_viewed_at                                                  AS viewed_at
  FROM viewer_events ve
  JOIN public.profiles p ON p.id = ve.vid
  WHERE p.role IN ('club', 'coach')
    AND COALESCE(p.is_test_account, false) = false
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
       WHERE (ub.blocker_id = v_uid AND ub.blocked_id = ve.vid)
          OR (ub.blocker_id = ve.vid AND ub.blocked_id = v_uid)
    )
  ORDER BY ve.last_viewed_at DESC
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.get_my_week_viewers(integer) IS
  'Owner-only: club and coach viewers of my profile in the last p_days (1–30), newest first, max 20. Anonymous browsers come back masked (is_hidden = true, identity NULL); hidden, blocked and test viewers are excluded; player viewers are never listed (founder ruling 2026-10-03).';

REVOKE ALL ON FUNCTION public.get_my_week_viewers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_week_viewers(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
