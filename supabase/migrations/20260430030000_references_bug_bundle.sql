-- =========================================================================
-- References bug bundle (Phase 4 deep-audit follow-up, 2026-04-30)
-- =========================================================================
-- The deep audit at /tmp/hockia-references-audit/DEEP_AUDIT.md surfaced five
-- real bugs in the trusted-references stack. This migration fixes all of
-- them in one go. No new product features, no UI changes, no breaking
-- contract changes for clients.
--
-- The five bugs:
--   #2  check_profile_completion_milestone has a `coach` branch that does
--       not count references and an early-return for `umpire`. The
--       client-side useCoachProfileStrength / useUmpireProfileStrength
--       both score references at 10-15 % weight, so the client and server
--       disagree and the celebratory `profile_100_percent` milestone never
--       fires for coaches/umpires who otherwise hit 100.
--   #3a request_note CHECK allows 1200 chars, modal caps input at 300.
--   #3b endorsement_text CHECK allows 1200 chars, modal caps input at 800.
--   #3c handle_profile_reference_state btrim()s relationship_type but does
--       not lower(), so staging has 309 rows of "teammate" + 8 rows of
--       "Teammate" that bin separately in any group-by analytics. Same
--       drift pattern in production.
--   #4a respond_reference does not re-check friendship on accept. Two users
--       can be friends → A requests reference from B → A unfriends B →
--       B can still accept the pending request. Friendship gate skipped.
--   #4d No rate-limit on request_reference. A user can flood-spam by
--       request → withdraw → request loops because the partial unique
--       index only covers pending+accepted rows.
--
-- Idempotent: every CREATE OR REPLACE / DROP CONSTRAINT IF EXISTS / ADD
-- CONSTRAINT pair handles re-runs cleanly. Pre-flight asserts at the top
-- prevent CHECK constraint tightening from corrupting existing rows.
-- =========================================================================


-- =========================================================================
-- Pre-flight: assert no existing data exceeds the new (tighter) caps before
-- altering the constraints. If staging or prod has any row exceeding the new
-- limit, this migration aborts cleanly with a useful error.
-- =========================================================================
DO $$
DECLARE
  v_long_notes  INTEGER;
  v_long_endorse INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_long_notes
    FROM public.profile_references
   WHERE request_note IS NOT NULL
     AND char_length(request_note) > 300;

  SELECT COUNT(*) INTO v_long_endorse
    FROM public.profile_references
   WHERE endorsement_text IS NOT NULL
     AND char_length(endorsement_text) > 800;

  IF v_long_notes > 0 THEN
    RAISE EXCEPTION
      'Cannot lower request_note cap to 300 chars: % existing row(s) exceed it. Trim them via UPDATE before re-running this migration.',
      v_long_notes;
  END IF;

  IF v_long_endorse > 0 THEN
    RAISE EXCEPTION
      'Cannot lower endorsement_text cap to 800 chars: % existing row(s) exceed it. Trim them via UPDATE before re-running this migration.',
      v_long_endorse;
  END IF;
END $$;


-- =========================================================================
-- Bug #3a + #3b — tighten CHECK constraints to match the modal input caps
-- AddReferenceModal:    request_note     ≤ 300  (was DB 1200)
-- ReferenceEndorsement: endorsement_text ≤ 800  (was DB 1200)
-- =========================================================================
ALTER TABLE public.profile_references
  DROP CONSTRAINT IF EXISTS profile_references_request_note_length;
ALTER TABLE public.profile_references
  ADD CONSTRAINT profile_references_request_note_length
  CHECK (request_note IS NULL OR char_length(request_note) <= 300);

ALTER TABLE public.profile_references
  DROP CONSTRAINT IF EXISTS profile_references_endorsement_length;
ALTER TABLE public.profile_references
  ADD CONSTRAINT profile_references_endorsement_length
  CHECK (endorsement_text IS NULL OR char_length(endorsement_text) <= 800);


-- =========================================================================
-- Bug #3c — handle_profile_reference_state now lower()s relationship_type
-- on the way in, normalises the new (300/800) char caps in the trigger to
-- match the new constraints, and preserves all existing state-machine
-- logic verbatim.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_profile_reference_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepted_count INTEGER;
  max_references CONSTANT INTEGER := 5;
BEGIN
  IF NEW.requester_id = NEW.reference_id THEN
    RAISE EXCEPTION 'You cannot add yourself as a reference.';
  END IF;

  -- Normalise relationship_type: trim, lowercase, cap at 120 chars.
  -- Phase 4 fix #3c: lowercase to prevent "teammate" / "Teammate" drift.
  NEW.relationship_type := LEFT(lower(btrim(COALESCE(NEW.relationship_type, ''))), 120);
  IF NEW.relationship_type = '' THEN
    RAISE EXCEPTION 'Relationship type is required.';
  END IF;

  -- Trim + cap to match the new (tighter) DB CHECK constraints.
  IF NEW.request_note IS NOT NULL THEN
    NEW.request_note := NULLIF(LEFT(btrim(NEW.request_note), 300), '');
  END IF;

  IF NEW.endorsement_text IS NOT NULL THEN
    NEW.endorsement_text := NULLIF(LEFT(btrim(NEW.endorsement_text), 800), '');
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := COALESCE(NEW.status, 'pending');
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
    RETURN NEW;
  END IF;

  IF NEW.requester_id <> OLD.requester_id OR NEW.reference_id <> OLD.reference_id THEN
    RAISE EXCEPTION 'Reference participants cannot change.';
  END IF;

  IF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'References cannot revert to pending after a decision.';
  END IF;

  IF NEW.status = 'accepted' AND OLD.status <> 'accepted' THEN
    SELECT COUNT(*)
      INTO accepted_count
      FROM public.profile_references
     WHERE requester_id = NEW.requester_id
       AND status = 'accepted'
       AND id <> NEW.id;

    IF accepted_count >= max_references THEN
      RAISE EXCEPTION 'You already have % trusted references.', max_references;
    END IF;

    NEW.accepted_at := timezone('utc', now());
    NEW.responded_at := NEW.accepted_at;
  ELSIF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
    NEW.accepted_at := NULL;
  END IF;

  IF NEW.status = 'declined' AND OLD.status <> 'declined' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending requests can be declined.';
    END IF;
    NEW.responded_at := timezone('utc', now());
  END IF;

  IF NEW.status = 'revoked' AND OLD.status <> 'revoked' THEN
    NEW.revoked_at := timezone('utc', now());
    NEW.revoked_by := auth.uid();
  ELSIF NEW.status <> 'revoked' THEN
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;


-- =========================================================================
-- One-time data migration for #3c — lowercase existing relationship_type
-- values so that "Teammate" → "teammate" merges with the dominant lowercase
-- bucket. Idempotent: re-running is a no-op once data is normalised.
-- =========================================================================
UPDATE public.profile_references
   SET relationship_type = lower(relationship_type)
 WHERE relationship_type IS NOT NULL
   AND relationship_type <> lower(relationship_type);


-- =========================================================================
-- Bug #4a — respond_reference now re-checks friendship before allowing the
-- pending → accepted transition. If A requests reference from B, then A
-- unfriends B, B's accept call now fails cleanly instead of leaking past
-- the friendship gate. Decline path is unchanged (declines from
-- ex-friends are allowed — the user should still be able to clear their
-- inbox).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.respond_reference(
  p_reference_id UUID,
  p_accept BOOLEAN,
  p_endorsement TEXT DEFAULT NULL
)
RETURNS public.profile_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID := auth.uid();
  pending_row     public.profile_references;
  updated_row     public.profile_references;
  is_friend       BOOLEAN;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to respond to a reference request.';
  END IF;

  -- Look up the pending row first so the friendship re-check can use the
  -- requester_id. RAISE before mutating anything.
  SELECT *
    INTO pending_row
    FROM public.profile_references
   WHERE id = p_reference_id
     AND reference_id = current_profile
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reference request not found or already handled.';
  END IF;

  -- Phase 4 fix #4a: only the accept path requires an active friendship.
  -- Decline + revoke remain accessible even if the requester unfriended
  -- the reference, so the recipient can always clear their inbox.
  IF p_accept THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.profile_friendships pf
       WHERE pf.status = 'accepted'
         AND ((pf.user_one = pending_row.requester_id AND pf.user_two = current_profile)
           OR (pf.user_two = pending_row.requester_id AND pf.user_one = current_profile))
    ) INTO is_friend;

    IF NOT is_friend THEN
      RAISE EXCEPTION 'Cannot accept this reference — the requester is no longer in your friends list.';
    END IF;
  END IF;

  UPDATE public.profile_references
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         endorsement_text = CASE
           WHEN p_accept THEN NULLIF(LEFT(btrim(COALESCE(p_endorsement, '')), 800), '')
           ELSE endorsement_text
         END,
         responded_at = timezone('utc', now())
   WHERE id = p_reference_id
     AND reference_id = current_profile
     AND status = 'pending'
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    -- Race: someone else (or another connection) handled it between the
    -- SELECT above and this UPDATE. Surface the same friendly error as
    -- the initial NOT FOUND.
    RAISE EXCEPTION 'Reference request not found or already handled.';
  END IF;

  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_reference(UUID, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION public.respond_reference IS
  'Respond to a pending trusted reference request. Accept requires the friendship is still active. Decline does not.';


-- =========================================================================
-- Bug #4d — request_reference now rate-limits to 3 INSERTs per requester
-- in any rolling 24h window. Counts every status (pending / accepted /
-- declined / revoked) so the request → withdraw → request flood-spam
-- pattern is closed. The rate window is short and the cap is generous —
-- legitimate users asking 3 friends in one day are unaffected.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.request_reference(
  p_reference_id UUID,
  p_relationship_type TEXT,
  p_request_note TEXT DEFAULT NULL
)
RETURNS public.profile_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID := auth.uid();
  requester_role  TEXT;
  accepted_count  INTEGER;
  recent_count    INTEGER;
  inserted_row    public.profile_references;
  rate_limit_max  CONSTANT INTEGER := 3;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request a reference.';
  END IF;

  IF current_profile = p_reference_id THEN
    RAISE EXCEPTION 'You cannot ask yourself to be a reference.';
  END IF;

  SELECT role INTO requester_role FROM public.profiles WHERE id = current_profile;
  IF requester_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  IF requester_role NOT IN ('player', 'coach', 'umpire') THEN
    RAISE EXCEPTION 'Only players, coaches, and umpires can collect trusted references.';
  END IF;

  -- Phase 4 fix #4d: rate-limit to 3 reference requests per rolling 24h.
  -- Counts every status so request → withdraw → request loops also count.
  SELECT COUNT(*)
    INTO recent_count
    FROM public.profile_references
   WHERE requester_id = current_profile
     AND created_at > timezone('utc', now()) - INTERVAL '24 hours';

  IF recent_count >= rate_limit_max THEN
    RAISE EXCEPTION 'You can request up to % references per day. Try again tomorrow.',
      rate_limit_max;
  END IF;

  SELECT COUNT(*)
    INTO accepted_count
    FROM public.profile_references
   WHERE requester_id = current_profile
     AND status = 'accepted';

  IF accepted_count >= 5 THEN
    RAISE EXCEPTION 'You already have 5 accepted references.';
  END IF;

  PERFORM 1
    FROM public.profile_friendships pf
   WHERE pf.status = 'accepted'
     AND ((pf.user_one = current_profile AND pf.user_two = p_reference_id)
       OR (pf.user_two = current_profile AND pf.user_one = p_reference_id))
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only request references from accepted friends.';
  END IF;

  PERFORM 1
    FROM public.profile_references pr
   WHERE pr.requester_id = current_profile
     AND pr.reference_id = p_reference_id
     AND pr.status IN ('pending', 'accepted');

  IF FOUND THEN
    RAISE EXCEPTION 'You already have an active reference with this connection.';
  END IF;

  INSERT INTO public.profile_references (requester_id, reference_id, relationship_type, request_note)
  VALUES (current_profile, p_reference_id, p_relationship_type, NULLIF(btrim(p_request_note), ''))
  RETURNING * INTO inserted_row;

  RETURN inserted_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_reference(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_reference IS
  'Send a trusted reference request. Allowed requester roles: player, coach, umpire. Requires accepted friendship with the reference. Rate-limited to 3 requests per 24h.';


-- =========================================================================
-- Bug #2 — check_profile_completion_milestone now scores references for
-- coaches and adds a full umpire branch. Player + club branches are
-- preserved verbatim from migration 202602160300.
--
-- Coach scoring rebalanced from 5 buckets (25/20/20/20/15 = 100, no
-- references) → 7 buckets (15/10/15/15/20/10/15 = 100, with references)
-- to match client-side useCoachProfileStrength weights. Existing coaches
-- who already fired profile_100_percent keep their badge — record_milestone
-- is idempotent and never un-fires.
--
-- Umpire branch is brand new: 10 buckets summing to 110 (the client-side
-- useUmpireProfileStrength uses the same 110 total, normalised in the UI
-- to 0-100). Server-side thresholds 60 / 80 / 100 fire slightly earlier
-- than the client-displayed equivalent — acceptable so umpires don't miss
-- the celebration.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_profile_completion_milestone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score INTEGER := 0;
  v_has_gallery     BOOLEAN := false;
  v_has_journey     BOOLEAN := false;
  v_has_friends     BOOLEAN := false;
  v_has_references  BOOLEAN := false;
  v_metadata JSONB;
BEGIN
  IF NEW.is_test_account = true THEN RETURN NEW; END IF;
  IF NEW.onboarding_completed != true THEN RETURN NEW; END IF;

  -- ── Player ────────────────────────────────────────────────────────────
  IF NEW.role = 'player' THEN
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.position IS NOT NULL AND NEW.position != '' THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 15;
    END IF;

    IF NEW.highlight_video_url IS NOT NULL AND NEW.highlight_video_url != '' THEN
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

  -- ── Coach (Phase 4 #2: rebalanced to add references + specialization) ──
  ELSIF NEW.role = 'coach' THEN
    -- Basic info (15): full_name + nationality + location + dob + gender
    IF NEW.full_name IS NOT NULL AND NEW.full_name != ''
       AND NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.date_of_birth IS NOT NULL
       AND NEW.gender IS NOT NULL AND NEW.gender != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Specialization (10): coach_specialization OR coach_specialization_custom
    IF (NEW.coach_specialization IS NOT NULL AND NEW.coach_specialization::text <> '')
       OR (NEW.coach_specialization_custom IS NOT NULL AND btrim(NEW.coach_specialization_custom) != '') THEN
      v_score := v_score + 10;
    END IF;

    -- Profile photo (15)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Professional bio (15)
    IF NEW.bio IS NOT NULL AND NEW.bio != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Journey (20): at least 1 career_history entry
    SELECT EXISTS(SELECT 1 FROM career_history WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_journey;
    IF v_has_journey THEN v_score := v_score + 20; END IF;

    -- Gallery (10): at least 1 gallery_photos entry
    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    -- References (15): at least 1 accepted reference
    SELECT EXISTS(
      SELECT 1 FROM profile_references
      WHERE requester_id = NEW.id
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_references;
    IF v_has_references THEN v_score := v_score + 15; END IF;

  -- ── Umpire (Phase 4 #2: NEW branch — was early-return before) ─────────
  -- 10 buckets totalling 110 (matches client-side useUmpireProfileStrength).
  -- The 60/80/100 server thresholds fire slightly earlier than the
  -- client-displayed % equivalent — intentional, so umpires get the
  -- milestone celebration without a perfect score.
  ELSIF NEW.role = 'umpire' THEN
    -- Umpire level (20)
    IF NEW.umpire_level IS NOT NULL AND NEW.umpire_level != '' THEN
      v_score := v_score + 20;
    END IF;

    -- Federation (15)
    IF NEW.federation IS NOT NULL AND NEW.federation != '' THEN
      v_score := v_score + 15;
    END IF;

    -- Specialization (10)
    IF NEW.officiating_specialization IS NOT NULL AND NEW.officiating_specialization != '' THEN
      v_score := v_score + 10;
    END IF;

    -- Profile photo (10)
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 10;
    END IF;

    -- Bio (10)
    IF NEW.bio IS NOT NULL AND NEW.bio != '' THEN
      v_score := v_score + 10;
    END IF;

    -- Languages (10): at least 1 entry
    IF NEW.languages IS NOT NULL AND array_length(NEW.languages, 1) >= 1 THEN
      v_score := v_score + 10;
    END IF;

    -- Gallery (10): at least 1 gallery_photos entry
    SELECT EXISTS(SELECT 1 FROM gallery_photos WHERE user_id = NEW.id LIMIT 1)
      INTO v_has_gallery;
    IF v_has_gallery THEN v_score := v_score + 10; END IF;

    -- Years officiating (5)
    IF NEW.umpire_since IS NOT NULL AND NEW.umpire_since > 0 THEN
      v_score := v_score + 5;
    END IF;

    -- Appointments (10): denormalized count column on profiles
    IF COALESCE(NEW.umpire_appointment_count, 0) >= 1 THEN
      v_score := v_score + 10;
    END IF;

    -- References (10): at least 1 accepted reference
    SELECT EXISTS(
      SELECT 1 FROM profile_references
      WHERE requester_id = NEW.id
        AND status = 'accepted'
      LIMIT 1
    ) INTO v_has_references;
    IF v_has_references THEN v_score := v_score + 10; END IF;

  -- ── Club ──────────────────────────────────────────────────────────────
  ELSIF NEW.role = 'club' THEN
    IF NEW.nationality_country_id IS NOT NULL
       AND NEW.base_location IS NOT NULL AND NEW.base_location != ''
       AND NEW.year_founded IS NOT NULL
       AND (
         (NEW.website IS NOT NULL AND NEW.website != '')
         OR (NEW.contact_email IS NOT NULL AND NEW.contact_email != '')
       ) THEN
      v_score := v_score + 35;
    END IF;

    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url != '' THEN
      v_score := v_score + 25;
    END IF;

    IF NEW.club_bio IS NOT NULL AND NEW.club_bio != '' THEN
      v_score := v_score + 20;
    END IF;

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
    'full_name',  NEW.full_name,
    'avatar_url', NEW.avatar_url,
    'role',       NEW.role
  );

  -- Fire milestones at each threshold (record_milestone is idempotent)
  IF v_score >= 60 THEN
    PERFORM record_milestone(NEW.id, 'profile_60_percent',  COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  IF v_score >= 80 THEN
    PERFORM record_milestone(NEW.id, 'profile_80_percent',  COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  IF v_score >= 100 THEN
    PERFORM record_milestone(NEW.id, 'profile_100_percent', COALESCE(NEW.is_test_account, false), v_metadata);
  END IF;

  RETURN NEW;
END;
$$;
