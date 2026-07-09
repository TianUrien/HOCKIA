-- P4 Phase 0 — career_move / "Who's Moving" feed generator (Home redesign).
--
-- DECISIONS (Tian, 2026-07-08):
--  • Source = signing/transfer POSTS only (user_posts.post_type in
--    'signing'/'transfer'). NOT career_history — that column is a player's
--    historical timeline (mostly backfill, 0 world-club links), and turning
--    it into "moves" would manufacture fake ones.
--  • Materialize a typed 'career_move' event into home_feed_items (like
--    member_joined / opportunity_posted) so the new ranked Pulse treats all
--    event types uniformly.
--
-- Move semantics (the subject is always the PLAYER moving → a club):
--  • transfer post  → author IS the moving player; club is in metadata.
--  • signing post   → author is the CLUB; the moving player is
--    metadata.person_profile_id; club is also in metadata.
--
-- Club link resolution: signing/transfer metadata carries club_name +
-- world_club_id (often null for free-text clubs) + club_avatar_url +
-- club_profile_id. When world_club_id is null we CONFIDENTLY resolve the
-- free-text name against world_clubs (exact case-insensitive, country-scoped,
-- unique-match-only — never a fuzzy/ambiguous link) so the club becomes
-- clickable. Player-side is always clickable (author_profile_id = mover).
--
-- Guardrails: FEED-ONLY (writes home_feed_items, no push/email — P4
-- non-negotiable); the hidden-predicate fence (no card if the mover OR the
-- club profile is banned/frozen); once-only per post (ON CONFLICT); and only
-- public display fields in metadata (no DOB/private data). Accumulates
-- SILENTLY — get_home_feed is updated to exclude 'career_move' so today's
-- feed is unchanged (signing/transfer still render via their existing
-- live user_post announcement cards until the new Pulse ships).
--
-- NOTE (Phase 1 dependency): when the new Pulse renders career_move from
-- home_feed_items, it must ALSO stop injecting signing/transfer as live
-- user_post items, or the same move would appear twice. Out of scope here.

-- ────────────────────────────────────────────────────────────────────
-- 1. Confident free-text club → world_clubs resolver
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_world_club_by_name(
  p_name text,
  p_country_id integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN NULL;
  END IF;
  -- Exact case-insensitive display-name match, country-scoped when known.
  -- Confident-only: return a link ONLY when it resolves to exactly one club.
  SELECT array_agg(wc.id) INTO v_ids
  FROM public.world_clubs wc
  WHERE lower(btrim(wc.club_name)) = lower(btrim(p_name))
    AND (p_country_id IS NULL OR wc.country_id = p_country_id);

  IF array_length(v_ids, 1) = 1 THEN
    RETURN v_ids[1];
  END IF;
  RETURN NULL;  -- no match, or ambiguous → leave unlinked (plain text)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_world_club_by_name(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_world_club_by_name(text, integer) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────
-- 2. Generator: materialize a career_move event from a signing/transfer post
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_career_move_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mover_id uuid;
  v_mover RECORD;
  v_club_name text := NEW.metadata->>'club_name';
  v_club_profile_id uuid := NULLIF(NEW.metadata->>'club_profile_id', '')::uuid;
  v_club_avatar text := NEW.metadata->>'club_avatar_url';
  v_meta_world_club uuid := NULLIF(NEW.metadata->>'world_club_id', '')::uuid;
  v_club_country_id integer := NULLIF(NEW.metadata->>'club_country_id', '')::integer;
  v_world_club_id uuid;
  v_author_is_test boolean;
BEGIN
  -- Who moved: transfer → the author (player); signing → the named person.
  IF NEW.post_type = 'transfer' THEN
    v_mover_id := NEW.author_id;
  ELSE  -- 'signing'
    v_mover_id := NULLIF(NEW.metadata->>'person_profile_id', '')::uuid;
  END IF;

  IF v_mover_id IS NULL THEN
    RETURN NEW;  -- can't attribute a mover → no card
  END IF;

  SELECT p.id, p.full_name, p.avatar_url, p.role, p.nationality_country_id,
         p.is_blocked, p.frozen_minor_at, COALESCE(p.is_test_account, false) AS is_test
    INTO v_mover
  FROM public.profiles p
  WHERE p.id = v_mover_id;

  -- Skip if the mover is missing or hidden (banned/frozen).
  IF v_mover.id IS NULL
     OR public.profile_is_hidden(v_mover.is_blocked, v_mover.frozen_minor_at) THEN
    RETURN NEW;
  END IF;

  -- Skip if the club has a HOCKIA profile that is hidden.
  IF v_club_profile_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles cp
       WHERE cp.id = v_club_profile_id
         AND public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at)
     ) THEN
    RETURN NEW;
  END IF;

  -- Resolve the club link: use the structured id if present, else a
  -- confident free-text match against the world directory.
  v_world_club_id := COALESCE(
    v_meta_world_club,
    public.resolve_world_club_by_name(v_club_name, v_club_country_id)
  );

  -- Test-account flag: keep test data out of real feeds if EITHER the
  -- mover or the posting account is a test account.
  SELECT COALESCE(p.is_test_account, false) INTO v_author_is_test
  FROM public.profiles p WHERE p.id = NEW.author_id;

  INSERT INTO public.home_feed_items (
    item_type, source_id, source_type, is_test_account,
    author_profile_id, author_role, author_country_id,
    metadata
  )
  VALUES (
    'career_move',
    NEW.id,
    'user_post',
    v_mover.is_test OR COALESCE(v_author_is_test, false),
    v_mover.id,
    v_mover.role,
    v_mover.nationality_country_id,
    jsonb_build_object(
      'post_id', NEW.id,
      'direction', NEW.post_type,                 -- 'transfer' | 'signing'
      'mover_profile_id', v_mover.id,
      'mover_name', v_mover.full_name,
      'mover_role', v_mover.role,
      'mover_avatar_url', v_mover.avatar_url,
      'club_name', v_club_name,
      'club_world_club_id', v_world_club_id,       -- null → club shown as plain text
      'club_avatar_url', v_club_avatar,
      'club_profile_id', v_club_profile_id         -- non-null → club profile clickable
    )
  )
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_career_move_feed ON public.user_posts;
CREATE TRIGGER trigger_career_move_feed
  AFTER INSERT ON public.user_posts
  FOR EACH ROW
  WHEN (NEW.post_type IN ('signing', 'transfer'))
  EXECUTE FUNCTION public.generate_career_move_feed_item();

-- ────────────────────────────────────────────────────────────────────
-- 3. Silent accumulation: exclude 'career_move' from TODAY's feed
--    (get_home_feed + get_home_feed_new_count), mirroring the member_joined
--    exclusion. Self-splice the live definitions so bodies aren't
--    transcribed; guard that the exclusion actually applied.
-- ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_home_feed', 'get_home_feed_new_count')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '!= ''member_joined''',
                            'NOT IN (''member_joined'', ''career_move'')');
    v_new := replace(v_new, '<> ''member_joined''',
                            'NOT IN (''member_joined'', ''career_move'')');
    IF v_new = v_def OR position('career_move' in v_new) = 0 THEN
      RAISE EXCEPTION 'career_move exclusion not applied to %()', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
