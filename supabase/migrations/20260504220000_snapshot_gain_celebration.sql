-- =========================================================================
-- Snapshot Gain Celebration — first Pulse card type (v5 plan, Phase 1B.3)
-- =========================================================================
-- Event-driven trigger family that inserts a `snapshot_gain_celebration`
-- pulse item when a user's profile gains a meaningful trust signal for
-- the FIRST time. Owner-facing only — these celebrations live in the
-- "Since you last visited" Pulse surface, not on anyone else's feed.
--
-- Signals celebrated:
--   - first_reference          (profile_references → status=accepted)
--   - first_highlight_video    (profiles.highlight_video_url NULL→value)
--   - first_career_entry       (career_history INSERT)
--   - first_world_club_link    (profiles.current_world_club_id NULL→value)
--
-- Frequency cap: max 1 snapshot_gain_celebration per user per 7 days. A
-- user who adds three signals in one session sees ONE celebration card
-- (priority signal first); the cap prevents rapid-fire onboarding from
-- flooding the Pulse feed with celebrations.
--
-- All triggers skip test accounts. All triggers fire AFTER so the source
-- row is already committed before the pulse item is inserted.
-- =========================================================================

SET search_path = public;

-- =========================================================================
-- Helper: maybe insert a snapshot_gain_celebration for a user
-- =========================================================================
-- Idempotent at the per-user-per-week level via the frequency cap. Each
-- caller passes the specific signal name + any extra metadata; the
-- helper handles the cap check + the INSERT.
CREATE OR REPLACE FUNCTION public._maybe_insert_snapshot_gain_celebration(
  p_user_id UUID,
  p_signal TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  -- 7-day frequency cap. Per the v5-plan UX principles, no Pulse card
  -- type fires more than once per week per user — celebrations included.
  SELECT COUNT(*) INTO v_recent_count
    FROM public.user_pulse_items
   WHERE user_id = p_user_id
     AND item_type = 'snapshot_gain_celebration'
     AND created_at > timezone('utc', now()) - INTERVAL '7 days';

  IF v_recent_count > 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.user_pulse_items (user_id, item_type, priority, metadata)
  VALUES (
    p_user_id,
    'snapshot_gain_celebration',
    -- Priority 2 (high-medium): celebrations should appear above
    -- routine cards but below event-driven recruitment alerts (P2/CL2,
    -- which will be priority 1 when they ship).
    2,
    jsonb_build_object('signal', p_signal) || COALESCE(p_metadata, '{}'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public._maybe_insert_snapshot_gain_celebration IS
  'Inserts a snapshot_gain_celebration pulse item for the user, gated by a 7-day per-user frequency cap. Internal helper called by the four signal-specific triggers below. Underscore prefix marks it private — not granted to any role.';

-- =========================================================================
-- 1. First reference accepted
-- =========================================================================
CREATE OR REPLACE FUNCTION public.celebrate_first_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count INT;
  v_endorser_name TEXT;
  v_endorser_role TEXT;
  v_is_test BOOLEAN;
BEGIN
  -- Only fire when status transitions to accepted (not on every UPDATE).
  IF NEW.status != 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Skip test accounts.
  SELECT is_test_account INTO v_is_test
    FROM public.profiles
   WHERE id = NEW.requester_id;
  IF COALESCE(v_is_test, false) = true THEN
    RETURN NEW;
  END IF;

  -- Only celebrate the FIRST accepted reference for this user.
  SELECT COUNT(*) INTO v_existing_count
    FROM public.profile_references
   WHERE requester_id = NEW.requester_id
     AND status = 'accepted'
     AND id != NEW.id;

  IF v_existing_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Pull endorser details for the card metadata.
  SELECT full_name, role
    INTO v_endorser_name, v_endorser_role
    FROM public.profiles
   WHERE id = NEW.reference_id;

  PERFORM public._maybe_insert_snapshot_gain_celebration(
    NEW.requester_id,
    'first_reference',
    jsonb_build_object(
      'endorser_name', v_endorser_name,
      'endorser_role', v_endorser_role,
      'reference_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_celebrate_first_reference ON public.profile_references;
CREATE TRIGGER trigger_celebrate_first_reference
  AFTER UPDATE ON public.profile_references
  FOR EACH ROW
  EXECUTE FUNCTION public.celebrate_first_reference();

-- =========================================================================
-- 2. First highlight video added
-- =========================================================================
CREATE OR REPLACE FUNCTION public.celebrate_first_highlight_video()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only on NULL/empty → value transition. Subsequent edits don't celebrate.
  IF NEW.highlight_video_url IS NULL OR NEW.highlight_video_url = '' THEN
    RETURN NEW;
  END IF;
  IF OLD.highlight_video_url IS NOT NULL AND OLD.highlight_video_url != '' THEN
    RETURN NEW;
  END IF;

  -- Skip test accounts.
  IF COALESCE(NEW.is_test_account, false) = true THEN
    RETURN NEW;
  END IF;

  PERFORM public._maybe_insert_snapshot_gain_celebration(
    NEW.id,
    'first_highlight_video',
    '{}'::JSONB
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_celebrate_first_highlight_video ON public.profiles;
CREATE TRIGGER trigger_celebrate_first_highlight_video
  AFTER UPDATE OF highlight_video_url ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.celebrate_first_highlight_video();

-- =========================================================================
-- 3. First career history entry
-- =========================================================================
CREATE OR REPLACE FUNCTION public.celebrate_first_career_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count INT;
  v_is_test BOOLEAN;
BEGIN
  SELECT is_test_account INTO v_is_test FROM public.profiles WHERE id = NEW.user_id;
  IF COALESCE(v_is_test, false) = true THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_existing_count
    FROM public.career_history
   WHERE user_id = NEW.user_id
     AND id != NEW.id;

  IF v_existing_count > 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public._maybe_insert_snapshot_gain_celebration(
    NEW.user_id,
    'first_career_entry',
    -- Pass the club_name + entry_type so the card can render a
    -- specific subtitle ("First entry: AHC Amsterdam").
    jsonb_build_object(
      'club_name', NEW.club_name,
      'entry_type', NEW.entry_type
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_celebrate_first_career_entry ON public.career_history;
CREATE TRIGGER trigger_celebrate_first_career_entry
  AFTER INSERT ON public.career_history
  FOR EACH ROW
  EXECUTE FUNCTION public.celebrate_first_career_entry();

-- =========================================================================
-- 4. First verified world-club link
-- =========================================================================
-- Player + coach only. Clubs use current_world_club_id as a self-reference
-- (the club IS the world_club), which would generate a false-positive
-- celebration if we triggered on every role.
CREATE OR REPLACE FUNCTION public.celebrate_first_world_club_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
BEGIN
  IF NEW.current_world_club_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.current_world_club_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role NOT IN ('player', 'coach') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_test_account, false) = true THEN
    RETURN NEW;
  END IF;

  SELECT club_name INTO v_club_name
    FROM public.world_clubs
   WHERE id = NEW.current_world_club_id;

  PERFORM public._maybe_insert_snapshot_gain_celebration(
    NEW.id,
    'first_world_club_link',
    jsonb_build_object('club_name', v_club_name)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_celebrate_first_world_club_link ON public.profiles;
CREATE TRIGGER trigger_celebrate_first_world_club_link
  AFTER UPDATE OF current_world_club_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.celebrate_first_world_club_link();
