-- P4 Phase 0 — post-ship audit fixes (staging only; prod untouched).
--
-- An adversarial audit of the six Phase-0 generators (22-agent workflow +
-- direct DB verification) surfaced two real defects. The cardinal risks
-- (CHECK-constraint value preservation, silent-exclude leak, error_logs
-- compatibility) all verified CLEAN. This migration fixes the two confirmed
-- bugs; both are corrections to code shipped earlier this session.
--
-- FIX 1 (HIGH) — career_move SIGNING cards had a blank, unlinked club.
--   generate_career_move_feed_item read the club from user_posts.metadata for
--   BOTH directions, but create_signing_post writes ONLY person_* keys — the
--   club of a signing is the post AUTHOR (the club), not metadata. So every
--   'signing' career_move card materialized with null club_name/avatar/link.
--   Transfer posts were fine (their metadata carries the destination club).
--   Fix: for signings, derive the club from NEW.author_id (+ its world_clubs
--   directory link); transfers keep the metadata path.
--   Also (LOW, same function): the metadata ::uuid/::integer casts lived in the
--   DECLARE section, whose initializers evaluate BEFORE the block's EXCEPTION
--   subtransaction — so a malformed value there escaped the resilience handler
--   and could roll back the user's post. Casts now live in the BODY.
--
-- FIX 2 (MED) — opportunity_posted generator had NO exception wrapper.
--   generate_opportunity_posted_feed_item (revived in 20260708110000) was the
--   only generator without EXCEPTION WHEN OTHERS, so a feed-gen failure would
--   roll back the club's opportunity publish — violating the P4 guardrail that
--   a feed-gen failure must never break the user's primary action. Wrapped +
--   made observable via _log_feed_gen_failure, matching its five siblings.

-- ────────────────────────────────────────────────────────────────────
-- FIX 1: career_move — signing club from author + casts moved to the body
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_career_move_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mover_id uuid;
  v_mover RECORD;
  v_club RECORD;
  v_club_name text;
  v_club_profile_id uuid;
  v_club_avatar text;
  v_club_country_id integer;
  v_meta_world_club uuid;
  v_world_club_id uuid;
  v_author_is_test boolean;
BEGIN
  -- Casts are in the BODY (not DECLARE) so a malformed uuid/int in metadata is
  -- caught by the EXCEPTION handler and never rolls back the user's post.
  IF NEW.post_type = 'transfer' THEN
    -- Player is the author; the destination club is described in metadata.
    v_mover_id        := NEW.author_id;
    v_club_name       := NEW.metadata->>'club_name';
    v_club_profile_id := NULLIF(NEW.metadata->>'club_profile_id', '')::uuid;
    v_club_avatar     := NEW.metadata->>'club_avatar_url';
    v_club_country_id := NULLIF(NEW.metadata->>'club_country_id', '')::integer;
    v_meta_world_club := NULLIF(NEW.metadata->>'world_club_id', '')::uuid;
  ELSE  -- 'signing': the CLUB is the author; the signed person is the mover.
    v_mover_id := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
    -- Signing metadata carries only person_* keys — derive the club from the
    -- AUTHOR (the club profile) so the card is never clubless.
    SELECT p.full_name, p.avatar_url, p.nationality_country_id, wc.id AS world_club_id
      INTO v_club
    FROM public.profiles p
    LEFT JOIN public.world_clubs wc ON wc.claimed_profile_id = p.id
    WHERE p.id = NEW.author_id;
    v_club_profile_id := NEW.author_id;
    v_club_name       := v_club.full_name;
    v_club_avatar     := v_club.avatar_url;
    v_club_country_id := v_club.nationality_country_id;
    v_meta_world_club := v_club.world_club_id;
  END IF;

  IF v_mover_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_mover
  FROM public.profiles p WHERE p.id = v_mover_id;

  IF v_mover.id IS NULL
     OR public.profile_is_hidden(v_mover.is_blocked, v_mover.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  -- Hidden club fence (applies to the author-club for signings too).
  IF v_club_profile_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.profiles cp WHERE cp.id = v_club_profile_id
         AND public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at)) THEN
    RETURN NEW;
  END IF;

  v_world_club_id := COALESCE(v_meta_world_club,
    public.resolve_world_club_by_name(v_club_name, v_club_country_id));

  SELECT COALESCE(p.is_test_account, false) INTO v_author_is_test
  FROM public.profiles p WHERE p.id = NEW.author_id;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id, metadata)
  VALUES (
    'career_move', NEW.id, 'user_post',
    v_mover.is_test OR COALESCE(v_author_is_test, false),
    v_mover.id, v_mover.role, v_mover.nationality_country_id,
    jsonb_build_object(
      'post_id', NEW.id, 'direction', NEW.post_type,
      'mover_profile_id', v_mover.id, 'mover_name', v_mover.full_name,
      'mover_role', v_mover.role, 'mover_avatar_url', v_mover.avatar_url,
      'club_name', v_club_name, 'club_world_club_id', v_world_club_id,
      'club_avatar_url', v_club_avatar, 'club_profile_id', v_club_profile_id))
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_feed_gen_failure('generate_career_move_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('post_id', NEW.id, 'post_type', NEW.post_type));
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- FIX 2: opportunity_posted — add the resilience + observability wrapper
--        (body identical to 20260708110000; only the handler is added)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_opportunity_posted_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_profile RECORD;
BEGIN
  IF NEW.status = 'open'
     AND (OLD.status IS NULL OR OLD.status::text != 'open') THEN

    SELECT p.id, p.full_name, p.avatar_url, p.is_test_account, p.role,
           p.nationality_country_id, p.is_blocked, p.frozen_minor_at
    INTO v_club_profile
    FROM profiles p
    WHERE p.id = NEW.club_id;

    IF v_club_profile.id IS NULL
       OR public.profile_is_hidden(v_club_profile.is_blocked, v_club_profile.frozen_minor_at) THEN
      RETURN NEW;
    END IF;

    INSERT INTO home_feed_items (
      item_type, source_id, source_type, is_test_account,
      author_profile_id, author_role, author_country_id,
      metadata
    )
    VALUES (
      'opportunity_posted', NEW.id, 'vacancy',
      COALESCE(v_club_profile.is_test_account, false),
      v_club_profile.id, v_club_profile.role, v_club_profile.nationality_country_id,
      jsonb_build_object(
        'opportunity_id', NEW.id,
        'title', NEW.title,
        'opportunity_type', NEW.opportunity_type,
        'position', NEW.position,
        'gender', NEW.gender,
        'location_city', NEW.location_city,
        'location_country', NEW.location_country,
        'club_id', NEW.club_id,
        'club_name', v_club_profile.full_name,
        'club_logo', v_club_profile.avatar_url,
        'priority', NEW.priority,
        'start_date', NEW.start_date
      )
    )
    ON CONFLICT (item_type, source_id) DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a feed-gen failure roll back the opportunity publish.
  PERFORM public._log_feed_gen_failure('generate_opportunity_posted_feed_item', SQLSTATE, SQLERRM,
    jsonb_build_object('opportunity_id', NEW.id, 'status', NEW.status));
  RETURN NEW;
END;
$$;
