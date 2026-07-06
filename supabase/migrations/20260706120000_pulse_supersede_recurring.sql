-- Fix: recurring Pulse cards stack up week after week.
--
-- _insert_pulse_item's frequency cap correctly limits creation to one card
-- per (user, type) per window — but nothing ever RETIRED the previous week's
-- card. A user who neither answered nor dismissed the weekly check-in
-- accumulated one active "Still recruiting players?" card per week, filling
-- the Home feed (reported by Tian with 4+ stacked check-ins).
--
-- Fix (three parts):
--   1. _insert_pulse_item gains p_supersede (opt-in, default false = zero
--      behavior change for event-driven callers): when a new card IS being
--      inserted, any still-active older cards of the same (user, type) are
--      auto-dismissed — the new card replaces, never stacks. When the
--      frequency cap blocks the insert, nothing is touched (the recent card
--      stays the active one).
--   2. The two weekly recurring crons (availability check-in, profile-view
--      pulse) opt in.
--   3. Retroactive cleanup: existing stacks are collapsed to the newest
--      active card per (user, recurring type).
--
-- NOTE: adding a defaulted parameter alongside the old 5-arg signature would
-- make existing 5-arg calls ambiguous — the old signature is DROPPED and the
-- security lockdown (20260507000000) re-applied to the new one.

-- ────────────────────────────────────────────────────────────────────
-- 1. Helper: supersede-on-insert (opt-in)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._insert_pulse_item(UUID, TEXT, SMALLINT, JSONB, INT);

CREATE OR REPLACE FUNCTION public._insert_pulse_item(
  p_user_id UUID,
  p_item_type TEXT,
  p_priority SMALLINT,
  p_metadata JSONB,
  p_frequency_days INT DEFAULT 7,
  p_supersede BOOLEAN DEFAULT false
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  -- Per-user-per-card-type frequency cap. The window is parameterised so
  -- different card types can use different cadences (celebrations: 7d,
  -- check-ins: 6d, etc.). Pass 0 to skip the cap entirely.
  IF p_frequency_days > 0 THEN
    SELECT COUNT(*) INTO v_recent_count
      FROM public.user_pulse_items
     WHERE user_id = p_user_id
       AND item_type = p_item_type
       AND created_at > timezone('utc', now()) - (p_frequency_days || ' days')::INTERVAL;

    IF v_recent_count > 0 THEN
      RETURN false;
    END IF;
  END IF;

  -- Recurring prompts replace their predecessors instead of stacking: any
  -- still-active older card of this type is dismissed the moment a new one
  -- ships. Only runs when we ARE inserting.
  IF p_supersede THEN
    UPDATE public.user_pulse_items
       SET dismissed_at = timezone('utc', now())
     WHERE user_id = p_user_id
       AND item_type = p_item_type
       AND dismissed_at IS NULL;
  END IF;

  INSERT INTO public.user_pulse_items (user_id, item_type, priority, metadata)
  VALUES (
    p_user_id,
    p_item_type,
    p_priority,
    COALESCE(p_metadata, '{}'::JSONB)
  );

  RETURN true;
END;
$$;

-- Re-apply the 20260507000000 lockdown on the new signature (service-role
-- SECURITY DEFINER contexts only; direct client calls could inject arbitrary
-- cards into other users' feeds).
REVOKE EXECUTE ON FUNCTION public._insert_pulse_item(UUID, TEXT, SMALLINT, JSONB, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2. Weekly recurring crons opt in (bodies identical to live definitions,
--    plus the supersede flag)
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- 3. Retroactive cleanup: collapse existing stacks to the newest active
--    card per (user, recurring type)
-- ────────────────────────────────────────────────────────────────────
UPDATE public.user_pulse_items u
   SET dismissed_at = timezone('utc', now())
 WHERE u.item_type IN ('availability_check_in', 'profile_viewed_by_recruiters')
   AND u.dismissed_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.user_pulse_items newer
     WHERE newer.user_id = u.user_id
       AND newer.item_type = u.item_type
       AND newer.dismissed_at IS NULL
       AND newer.created_at > u.created_at
   );
