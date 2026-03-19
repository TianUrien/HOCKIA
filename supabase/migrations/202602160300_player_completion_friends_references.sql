-- ============================================================================
-- Player profile completion: add friends + references requirements
-- ============================================================================
-- A player profile is no longer 100% without at least one accepted friend
-- connection and one approved reference. These are core to HOCKIA's
-- networking value proposition (trusted circle + real connections).
--
-- Updated player weights (7 buckets, total 100):
--   basic_info=15, avatar=15, highlight_video=20, journey=15,
--   gallery=10, friends=10, references=15
--
-- Coach and Club scoring are unchanged.
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- 1. REPLACE check_profile_completion_milestone() — add friends + references
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_profile_completion_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score INTEGER := 0;
  v_has_gallery BOOLEAN := false;
  v_has_journey BOOLEAN := false;
  v_has_friends BOOLEAN := false;
  v_has_references BOOLEAN := false;
  v_metadata JSONB;
BEGIN
  -- Skip test accounts
  IF NEW.is_test_account = true THEN RETURN NEW; END IF;

  -- Only check when onboarding is completed
  IF NEW.onboarding_completed != true THEN RETURN NEW; END IF;

  -- ── Player ────────────────────────────────────────────────────────────
  IF NEW.role = 'player' THEN
    -- Basic info (15): nationality + location + position
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.position IS NOT NULL AND NEW.position != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Profile photo (15)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Highlight video (20)
    IF NEW.highlight_video_url IS NOT NULL AND NEW.highlight_video_url != '' THEN
      v_score := v_score + 20;
    END IF;

    -- Journey (15): at least 1 career_history entry
    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 15; END IF;

    -- Gallery (10): at least 1 gallery_photos entry
    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    -- Friends (10): at least 1 accepted friendship
    SELECT EXISTS(
      SELECT 1 FROM profile_friendships
      WHERE (user_one = NEW.id OR user_two = NEW.id)
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_friends;
    IF v_has_friends THEN v_score := v_score + 10; END IF;

    -- References (15): at least 1 accepted reference (player is the requester)
    SELECT EXISTS(
      SELECT 1 FROM profile_references
      WHERE requester_id = NEW.id
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_references;
    IF v_has_references THEN v_score := v_score + 15; END IF;

  -- ── Coach ─────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'coach' THEN
    -- Basic info (25): full_name + nationality + location + dob + gender
    IF NEW.full_name IS NOT NULL AND NEW.full_name != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth != ''
       AND NEW.gender IS NOT NULL AND NEW.gender != '' THEN
      v_score := v_score + 25;
    END IF;

    -- Profile photo (20)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 20;
    END IF;

    -- Professional bio (20)
    IF NEW.bio IS NOT NULL AND NEW.bio != '' THEN
      v_score := v_score + 20;
    END IF;

    -- Journey (20): at least 1 career_history entry
    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 20; END IF;

    -- Gallery (15): at least 1 gallery_photos entry
    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 15; END IF;

  -- ── Club ──────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'club' THEN
    -- Basic info (35): nationality + location + year_founded + (website OR contact_email)
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.year_founded IS NOT NULL
       AND (
         (NEW.website IS NOT NULL AND NEW.website != '')
         OR (NEW.contact_email IS NOT NULL AND NEW.contact_email != '')
       ) THEN
      v_score := v_score + 35;
    END IF;

    -- Club logo (25)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 25;
    END IF;

    -- Club bio (20)
    IF NEW.club_bio IS NOT NULL AND NEW.club_bio != '' THEN
      v_score := v_score + 20;
    END IF;

    -- Gallery (20): at least 1 club_media entry
    SELECT EXISTS(SELECT 1 FROM club_media WHERE club_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 20; END IF;

  ELSE
    -- Brand or unknown role — skip
    RETURN NEW;
  END IF;

  -- Build metadata for feed items
  v_metadata := jsonb_build_object(
    'profile_id', NEW.id,
    'full_name', NEW.full_name,
    'avatar_url', NEW.avatar_url,
    'role', NEW.role
  );

  -- Fire milestones at each threshold (record_milestone is idempotent)
  IF v_score >= 60 THEN
    PERFORM record_milestone(NEW.id, 'profile_60_percent', COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  IF v_score >= 80 THEN
    PERFORM record_milestone(NEW.id, 'profile_80_percent', COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  IF v_score >= 100 THEN
    PERFORM record_milestone(NEW.id, 'profile_100_percent', COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. RE-EVALUATE COMPLETION on friendship accept / reference accept
-- ============================================================================
-- Reuse the same pattern as gallery/journey: touch profiles.updated_at
-- to re-fire check_profile_completion_milestone().

-- 2a. Friendship accepted → touch both users' profiles
CREATE OR REPLACE FUNCTION public.recheck_profile_completion_on_friendship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only recheck when status becomes 'accepted'
  IF NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    UPDATE profiles SET updated_at = now() WHERE id = NEW.user_one;
    UPDATE profiles SET updated_at = now() WHERE id = NEW.user_two;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recheck_completion_on_friendship ON public.profile_friendships;
CREATE TRIGGER recheck_completion_on_friendship
  AFTER INSERT OR UPDATE ON public.profile_friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.recheck_profile_completion_on_friendship();

-- 2b. Reference accepted → touch requester's profile
CREATE OR REPLACE FUNCTION public.recheck_profile_completion_on_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only recheck when status becomes 'accepted'
  IF NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    UPDATE profiles SET updated_at = now() WHERE id = NEW.requester_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recheck_completion_on_reference ON public.profile_references;
CREATE TRIGGER recheck_completion_on_reference
  AFTER INSERT OR UPDATE ON public.profile_references
  FOR EACH ROW
  EXECUTE FUNCTION public.recheck_profile_completion_on_reference();
