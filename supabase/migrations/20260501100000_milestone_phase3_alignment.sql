-- ============================================================================
-- Profile-completion milestone — Phase 3 alignment + Umpire support
-- ============================================================================
-- Two bugs fixed by replacing public.check_profile_completion_milestone():
--
-- 1. Coach scoring requires NEW.gender IS NOT NULL (legacy pre-Phase-3
--    criterion). Phase 3 onboarding deliberately writes gender = NULL
--    because the field was REPLACED by hockey categories. Result: coaches
--    can never reach the 100% threshold and the celebratory home-feed
--    milestone post never fires for them. The player branch was already
--    updated in 202602160500_milestone_100_percent_only.sql (uses
--    nationality + location + position) — only coach was missed.
--
-- 2. Umpire role is NOT scored at all. The function falls through to the
--    `ELSE -- Brand or unknown role — skip` branch, so no umpire ever
--    qualifies for the milestone regardless of profile completeness.
--
-- Fix: align coach with coaching_categories ≥ 1 AND add an umpire branch
-- with weights that sum to 100, balanced against what the umpire-specific
-- profile-strength hook (useUmpireProfileStrength) already values.
-- ============================================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION public.check_profile_completion_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score INTEGER := 0;
  v_has_journey BOOLEAN;
  v_has_gallery BOOLEAN;
  v_has_friends BOOLEAN;
  v_has_references BOOLEAN;
  v_metadata JSONB;
BEGIN
  -- Skip if onboarding not completed yet — milestone is post-onboarding.
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
    -- Basic info (25): full_name + nationality + location + dob +
    -- coaching_categories (Phase 3 — replaces gender as the basic-info gate).
    IF NEW.full_name IS NOT NULL AND NEW.full_name != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.date_of_birth IS NOT NULL
       AND NEW.coaching_categories IS NOT NULL
       AND array_length(NEW.coaching_categories, 1) > 0 THEN
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

  -- ── Umpire ────────────────────────────────────────────────────────────
  -- New branch — previously umpires fell through to `ELSE … skip` and
  -- could never qualify. Weights (sum to 100) mirror the relative
  -- importance signals in useUmpireProfileStrength so the celebratory
  -- 100% milestone fires roughly when the in-app strength bar reaches
  -- "Elite" tier.
  ELSIF NEW.role = 'umpire' THEN
    -- Basic info (25): full_name + nationality + location + umpire_level + federation
    IF NEW.full_name IS NOT NULL AND NEW.full_name != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.umpire_level IS NOT NULL AND NEW.umpire_level != ''
       AND NEW.federation IS NOT NULL AND NEW.federation != '' THEN
      v_score := v_score + 25;
    END IF;

    -- Specialization + languages (15) — both required by onboarding;
    -- bundled here so a returning user who edited away one half doesn't
    -- partial-credit through.
    IF NEW.officiating_specialization IS NOT NULL
       AND NEW.languages IS NOT NULL
       AND array_length(NEW.languages, 1) > 0 THEN
      v_score := v_score + 15;
    END IF;

    -- Profile photo (15)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Bio (15)
    IF NEW.bio IS NOT NULL AND NEW.bio != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Journey (10): at least 1 career_history entry
    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 10; END IF;

    -- Gallery (10): at least 1 gallery_photos entry
    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    -- Friends (10): at least 1 accepted friendship — networking matters
    -- for umpires too (peer panels, assessor relationships).
    SELECT EXISTS(
      SELECT 1 FROM profile_friendships
      WHERE (user_one = NEW.id OR user_two = NEW.id)
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_friends;
    IF v_has_friends THEN v_score := v_score + 10; END IF;

  ELSE
    -- Brand or unknown role — skip. (Brand profiles use a separate
    -- onboarding model and don't currently surface a profile-completion
    -- milestone in the home feed.)
    RETURN NEW;
  END IF;

  -- Only fire milestone at 100% — no intermediate milestones in the feed
  IF v_score >= 100 THEN
    v_metadata := jsonb_build_object(
      'profile_id', NEW.id,
      'full_name', NEW.full_name,
      'avatar_url', NEW.avatar_url,
      'role', NEW.role
    );

    PERFORM record_milestone(NEW.id, 'profile_100_percent', COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_profile_completion_milestone()
  IS 'Phase 3 + umpire alignment (2026-05-01). Coach uses coaching_categories instead of gender. Umpire has its own scoring branch.';
