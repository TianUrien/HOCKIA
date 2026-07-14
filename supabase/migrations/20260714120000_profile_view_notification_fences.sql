-- ============================================================================
-- send_profile_view_notifications: carry the fences every sibling already has
-- ============================================================================
-- Found by the 2026-07-14 bug hunt. The daily cron (profile_view_notifications_
-- daily, 03:30 UTC) inserts "{Actor} viewed your profile" notifications — which
-- also become PUSH notifications naming that actor — straight into
-- profile_notifications, bypassing enqueue_notification's block check. The live
-- body carried NO anonymity fence, NO hidden fence, NO block fence, and counted
-- self-views. Every sibling surface (the viewers list, the weekly recap email,
-- the Pulse card) honours all of these; only this cron didn't.
--
-- Measured live exposure at fix time (prod):
--   * 15 notifications already NAMED a hidden (banned/frozen) actor;
--   * 0 named an anonymous browser — but only because prod had just 2 users
--     with browse_anonymously = true. It was a loaded gun: the next time one
--     of them viewed a profile, we would have named them in a push
--     notification, breaking the exact promise that setting makes;
--   * 0 blocked pairs existed, so the missing block fence had no victim yet.
--
-- After this migration a profile_viewed notification counts and names ONLY
-- identified, visible, non-blocked, non-self viewers. Anonymous browsers are
-- deliberately absent rather than counted-but-unnamed: with unique_viewers = 1
-- the client renders the actor's name, so an anonymous viewer must not create
-- the notification at all. Their visit still reaches the owner via the weekly
-- recap's anonymous_viewers count, which is the surface designed to carry it.

SET search_path = public;

CREATE OR REPLACE FUNCTION public.send_profile_view_notifications(
  p_batch integer DEFAULT 5000,
  p_min_views integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_since TIMESTAMPTZ;
  v_inserted INT := 0;
BEGIN
  v_since := now() - INTERVAL '24 hours';

  WITH profile_view_counts AS (
    SELECT
      e.entity_id AS viewed_profile_id,
      COUNT(DISTINCT e.user_id) AS unique_viewers,
      COUNT(*) AS total_views,
      (ARRAY_AGG(e.user_id ORDER BY e.created_at DESC))[1] AS latest_viewer_id
    FROM events e
    INNER JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = 'profile_view'
      AND e.entity_type = 'profile'
      AND e.user_id IS NOT NULL
      -- Self-views never counted (previously they inflated unique_viewers and
      -- total_views; only the NAMED actor was self-checked, downstream).
      AND e.user_id <> e.entity_id
      AND e.created_at >= v_since
      AND COALESCE(p.is_test_account, false) = false
      -- Anonymity: a viewer who chose to browse anonymously is never counted
      -- and never named. This is the fence whose absence was the P1.
      AND COALESCE(p.browse_anonymously, false) = false
      -- Hidden viewers (admin-banned / frozen minor) are never named.
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      -- Mutual invisibility: a blocked pair never notifies either way.
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id = e.entity_id AND ub.blocked_id = e.user_id)
           OR (ub.blocker_id = e.user_id AND ub.blocked_id = e.entity_id)
      )
    GROUP BY e.entity_id
    HAVING COUNT(DISTINCT e.user_id) >= p_min_views
    LIMIT p_batch
  ),
  eligible AS (
    SELECT pvc.*
    FROM profile_view_counts pvc
    INNER JOIN profiles viewed ON viewed.id = pvc.viewed_profile_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM profile_notifications pn
      WHERE pn.recipient_profile_id = pvc.viewed_profile_id
        AND pn.kind = 'profile_viewed'
        AND pn.created_at >= v_since
    )
    AND viewed.onboarding_completed = true
    AND COALESCE(viewed.is_test_account, false) = false
    -- A hidden recipient is not notified (they can't act on it anyway).
    AND NOT public.profile_is_hidden(viewed.is_blocked, viewed.frozen_minor_at)
    AND pvc.viewed_profile_id <> pvc.latest_viewer_id
  ),
  inserted AS (
    INSERT INTO profile_notifications (
      recipient_profile_id,
      actor_profile_id,
      kind,
      metadata,
      target_url,
      created_at,
      updated_at
    )
    SELECT
      el.viewed_profile_id,
      el.latest_viewer_id,
      'profile_viewed'::profile_notification_kind,
      jsonb_build_object(
        'unique_viewers', el.unique_viewers,
        'total_views', el.total_views,
        'period', '24h'
      ),
      '/dashboard/profile?tab=profile&section=viewers',
      now(),
      now()
    FROM eligible el
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Clean up the notifications that already leaked a hidden actor.
-- These name a banned / frozen profile to the person they viewed. They are
-- unactionable (the target profile no longer renders) and violate the
-- standing hidden-profile invariant, so they are removed rather than left
-- for users to click into a dead end.
-- Anonymous browsers were never named (verified: 0 rows), so nothing to
-- clean there.
-- ────────────────────────────────────────────────────────────────────
DELETE FROM public.profile_notifications n
USING public.profiles a
WHERE n.actor_profile_id = a.id
  AND n.kind = 'profile_viewed'
  AND public.profile_is_hidden(a.is_blocked, a.frozen_minor_at);

-- ────────────────────────────────────────────────────────────────────
-- Self-check: all four fences present in the live body, or fail the deploy.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef(
    'public.send_profile_view_notifications(integer, integer)'::regprocedure
  );
  IF position('browse_anonymously' in v_def) = 0 THEN
    RAISE EXCEPTION 'PV-NOTIF-CHECK: anonymity fence missing';
  END IF;
  IF position('profile_is_hidden' in v_def) = 0 THEN
    RAISE EXCEPTION 'PV-NOTIF-CHECK: hidden fence missing';
  END IF;
  IF position('user_blocks' in v_def) = 0 THEN
    RAISE EXCEPTION 'PV-NOTIF-CHECK: block fence missing';
  END IF;
  IF position('e.user_id <> e.entity_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'PV-NOTIF-CHECK: self-view fence missing';
  END IF;
END $$;
