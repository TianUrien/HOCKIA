-- ============================================================================
-- Profile-completion milestone — avatar_url trim consistency
-- ============================================================================
-- Client-side profile-strength logic uses `avatar_url?.trim()`:
--
--   client/src/hooks/useProfileStrength.ts:50
--   client/src/hooks/useUmpireProfileStrength.ts:91
--   client/src/hooks/useCoachProfileStrength.ts
--   client/src/hooks/useClubProfileStrength.ts
--   client/src/hooks/useBrandProfileStrength.ts
--   client/src/lib/profileCompletion.ts (hasText helper)
--   client/src/lib/profileTier.ts (uses hasText)
--
-- The SQL milestone trigger (`check_profile_completion_milestone`) used a
-- looser check: `avatar_url IS NOT NULL AND avatar_url != ''`. Whitespace-
-- only avatar_url ('   ') would satisfy the SQL check but NOT the client
-- hooks — so a row could fire the 100% celebration milestone in the home
-- feed while the user still sees "Add a profile photo" in NextStepCard.
--
-- Likely zero rows in prod today (uploads always go through Supabase
-- storage publicUrl which is never whitespace), but the asymmetry is real
-- and worth removing now while we're inside the avatar-polish sprint —
-- catches future ingestion paths (CSV import, admin-edit, etc.) that
-- might insert dirty values.
--
-- This migration replaces the function with one that uses
-- `btrim(avatar_url) != ''` everywhere. Same shape as the previous
-- migration (20260501100000) — only the avatar checks differ.
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
  IF NEW.onboarding_completed != true THEN RETURN NEW; END IF;

  -- ── Player ────────────────────────────────────────────────────────────
  IF NEW.role = 'player' THEN
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND btrim(NEW.base_location) != ''
       AND NEW.position IS NOT NULL AND btrim(NEW.position) != '' THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND btrim(NEW.avatar_url) != '' THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.highlight_video_url IS NOT NULL AND btrim(NEW.highlight_video_url) != '' THEN
      v_score := v_score + 20;
    END IF;

    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 15; END IF;

    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    SELECT EXISTS(
      SELECT 1 FROM profile_friendships
      WHERE (user_one = NEW.id OR user_two = NEW.id)
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_friends;
    IF v_has_friends THEN v_score := v_score + 10; END IF;

    SELECT EXISTS(
      SELECT 1 FROM profile_references
      WHERE requester_id = NEW.id
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_references;
    IF v_has_references THEN v_score := v_score + 15; END IF;

  -- ── Coach ─────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'coach' THEN
    IF NEW.full_name IS NOT NULL AND btrim(NEW.full_name) != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND btrim(NEW.base_location) != ''
       AND NEW.date_of_birth IS NOT NULL
       AND NEW.coaching_categories IS NOT NULL
       AND array_length(NEW.coaching_categories, 1) > 0 THEN
      v_score := v_score + 25;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND btrim(NEW.avatar_url) != '' THEN
      v_score := v_score + 20;
    END IF;

    IF NEW.bio IS NOT NULL AND btrim(NEW.bio) != '' THEN
      v_score := v_score + 20;
    END IF;

    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 20; END IF;

    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 15; END IF;

  -- ── Club ──────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'club' THEN
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND btrim(NEW.base_location) != ''
       AND NEW.year_founded IS NOT NULL
       AND (
         (NEW.website IS NOT NULL AND btrim(NEW.website) != '')
         OR (NEW.contact_email IS NOT NULL AND btrim(NEW.contact_email) != '')
       ) THEN
      v_score := v_score + 35;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND btrim(NEW.avatar_url) != '' THEN
      v_score := v_score + 25;
    END IF;

    IF NEW.club_bio IS NOT NULL AND btrim(NEW.club_bio) != '' THEN
      v_score := v_score + 20;
    END IF;

    SELECT EXISTS(SELECT 1 FROM club_media WHERE club_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 20; END IF;

  -- ── Umpire ────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'umpire' THEN
    IF NEW.full_name IS NOT NULL AND btrim(NEW.full_name) != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND btrim(NEW.base_location) != ''
       AND NEW.umpire_level IS NOT NULL AND btrim(NEW.umpire_level) != ''
       AND NEW.federation IS NOT NULL AND btrim(NEW.federation) != '' THEN
      v_score := v_score + 25;
    END IF;

    IF NEW.officiating_specialization IS NOT NULL
       AND NEW.languages IS NOT NULL
       AND array_length(NEW.languages, 1) > 0 THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND btrim(NEW.avatar_url) != '' THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.bio IS NOT NULL AND btrim(NEW.bio) != '' THEN
      v_score := v_score + 15;
    END IF;

    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 10; END IF;

    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    SELECT EXISTS(
      SELECT 1 FROM profile_friendships
      WHERE (user_one = NEW.id OR user_two = NEW.id)
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_friends;
    IF v_has_friends THEN v_score := v_score + 10; END IF;

  ELSE
    RETURN NEW;
  END IF;

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
  IS '2026-05-01 — Phase 3 + umpire branch + btrim() avatar/text consistency. Whitespace-only string fields no longer satisfy the milestone (matches client-side profile-strength hooks).';
