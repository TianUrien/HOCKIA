-- M6 — fence hidden profiles out of the weekly Pulse enqueue crons.
--
-- (1) enqueue_profile_view_pulse_items: the "N recruiters viewed your profile"
--     card counted DISTINCT club/coach viewers with NO profile_is_hidden fence,
--     so a banned or frozen-minor recruiter inflated the number while the
--     paired list surface (get_my_profile_viewers) excludes them — the same
--     list/count mismatch class the daily notification cron closed in
--     20260714120000_profile_view_notification_fences. Live-verified: the
--     prod body carried no fence and 2 hidden club/coach rows exist.
--
-- (2) enqueue_availability_check_ins: enqueues a weekly check-in Pulse item to
--     player/coach/umpire RECIPIENTS with no hidden fence. Exposure is nil in
--     practice (hidden accounts can't reach the Pulse), but we should not mint
--     work for banned/frozen rows — fence for consistency with every other
--     enqueue cron.
--
-- Both are CREATE OR REPLACE with the single predicate added; all other logic
-- is byte-for-byte the live prod body.

CREATE OR REPLACE FUNCTION public.enqueue_profile_view_pulse_items()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eligible RECORD;
  v_inserted INT := 0;
  v_unique_clubs INT;
  v_unique_coaches INT;
  v_unique_recruiters INT;
  v_top_viewer_role TEXT;
BEGIN
  FOR v_eligible IN
    SELECT p.id, p.role
      FROM public.profiles p
     WHERE COALESCE(p.is_test_account, false) = false
       AND COALESCE(p.onboarding_completed, false) = true
       AND (
         p.last_profile_view_pulse_at IS NULL
         OR p.last_profile_view_pulse_at < timezone('utc', now()) - INTERVAL '7 days'
       )
  LOOP
    SELECT
      COUNT(DISTINCT e.user_id) FILTER (WHERE viewer.role = 'club'),
      COUNT(DISTINCT e.user_id) FILTER (WHERE viewer.role = 'coach')
      INTO v_unique_clubs, v_unique_coaches
      FROM public.events e
      INNER JOIN public.profiles viewer ON viewer.id = e.user_id
     WHERE e.event_name = 'profile_view'
       AND e.entity_type = 'profile'
       AND e.entity_id = v_eligible.id
       AND e.created_at >= timezone('utc', now()) - INTERVAL '7 days'
       AND e.user_id IS NOT NULL
       AND e.user_id != v_eligible.id
       AND COALESCE(viewer.is_test_account, false) = false
       AND COALESCE(viewer.browse_anonymously, false) = false
       -- Hidden-profile fence: never count banned/frozen recruiters (parity
       -- with get_my_profile_viewers and 20260714120000 notification cron).
       AND NOT public.profile_is_hidden(viewer.is_blocked, viewer.frozen_minor_at)
       AND viewer.role IN ('club', 'coach');

    v_unique_recruiters := COALESCE(v_unique_clubs, 0) + COALESCE(v_unique_coaches, 0);

    IF v_unique_recruiters < 1 THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_unique_clubs, 0) >= COALESCE(v_unique_coaches, 0) THEN
      v_top_viewer_role := 'club';
    ELSE
      v_top_viewer_role := 'coach';
    END IF;

    IF public._insert_pulse_item(
      v_eligible.id,
      'profile_viewed_by_recruiters',
      2::SMALLINT,
      jsonb_build_object(
        'unique_clubs', COALESCE(v_unique_clubs, 0),
        'unique_coaches', COALESCE(v_unique_coaches, 0),
        'unique_recruiters', v_unique_recruiters,
        'top_viewer_role', v_top_viewer_role,
        'window_days', 7
      ),
      7,
      true  -- supersede: this week's pulse replaces last week's
    ) THEN
      v_inserted := v_inserted + 1;
      UPDATE public.profiles
         SET last_profile_view_pulse_at = timezone('utc', now())
       WHERE id = v_eligible.id;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_availability_check_ins()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eligible RECORD;
  v_inserted INT := 0;
  v_state JSONB;
BEGIN
  FOR v_eligible IN
    SELECT
      p.id,
      p.role,
      p.open_to_play,
      p.open_to_coach,
      p.open_to_opportunities,
      p.coach_recruits_for_team
    FROM public.profiles p
    WHERE p.role IN ('player', 'coach', 'umpire')
      AND COALESCE(p.is_test_account, false) = false
      AND COALESCE(p.onboarding_completed, false) = true
      -- Hidden-profile fence: don't enqueue check-ins for banned/frozen rows.
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND (
        p.last_check_in_prompt_at IS NULL
        OR p.last_check_in_prompt_at < timezone('utc', now()) - INTERVAL '6 days'
      )
  LOOP
    v_state := jsonb_build_object(
      'role', v_eligible.role,
      'open_to_play', COALESCE(v_eligible.open_to_play, false),
      'open_to_coach', COALESCE(v_eligible.open_to_coach, false),
      'open_to_opportunities', COALESCE(v_eligible.open_to_opportunities, false),
      'coach_recruits_for_team', COALESCE(v_eligible.coach_recruits_for_team, false)
    );

    IF public._insert_pulse_item(
      v_eligible.id,
      'availability_check_in',
      1::SMALLINT,
      jsonb_build_object('current_state', v_state),
      6,
      true  -- supersede: this week's check-in replaces last week's
    ) THEN
      v_inserted := v_inserted + 1;
      UPDATE public.profiles
         SET last_check_in_prompt_at = timezone('utc', now())
       WHERE id = v_eligible.id;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;
