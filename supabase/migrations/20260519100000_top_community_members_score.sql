-- ─────────────────────────────────────────────────────────────────────
-- Top Community Members — profile completeness score
-- ─────────────────────────────────────────────────────────────────────
-- Adds a numeric "profile completeness" score (0-100) to each profiles
-- row, populated by a BEFORE-trigger that re-computes on every insert
-- and update. Drives the new /community "Top community members"
-- carousel: an RPC returns the top N profiles ordered by score, with
-- secondary tiebreakers (recent activity, photo, club, references,
-- open status).
--
-- Why a stored column + trigger (vs. an on-demand VIEW or computing
-- client-side):
--   - The /community page lives at platform scale (~12k members today
--     and growing). Computing client-side means fetching every row;
--     a VIEW computed at query time can't be indexed for ORDER BY.
--   - The trigger fires only on profile mutations (cheap; the row is
--     already being written). Reads are O(1) sorted index scans.
--   - The denormalized counts (accepted_friend_count etc.) the formula
--     reads are themselves trigger-maintained, so a friend accept or
--     reference accept already touches the profiles row — our trigger
--     piggybacks on the same write.
--
-- Formula is per-role (player / coach / club / umpire / brand). Each
-- role's buckets sum to 100. The player formula tracks the existing
-- client-side useProfileStrength hook closely; differences:
--   - gallery_photos bucket dropped (would need a subquery; absorbed
--     into bio + basic-info weights).
--   - bio added (was not a bucket in useProfileStrength but is a
--     low-effort high-signal field for community discovery).
--
-- Roles that don't have a particular column (e.g. brand has no
-- highlight_video) max out cleanly at 100 within their own formula —
-- ranking within a role-filtered carousel is therefore correct, and
-- the "All" view ranks roles against each other on the same 0-100
-- scale.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Column ──────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_completeness_pct SMALLINT NOT NULL DEFAULT 0
  CHECK (profile_completeness_pct BETWEEN 0 AND 100);

COMMENT ON COLUMN public.profiles.profile_completeness_pct IS
  'Per-row profile completeness 0-100, computed by trigger from role-specific bucket formula. Drives /community Top Community Members ranking.';

-- ── 2. Per-role scoring function ───────────────────────────────────────
-- IMMUTABLE except for column reads, so we keep it STABLE. The trigger
-- below passes NEW to this function and assigns the result back to NEW
-- before the row is written, so no separate UPDATE round-trip.

CREATE OR REPLACE FUNCTION public.compute_profile_completeness_pct(p public.profiles)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_score INTEGER := 0;
BEGIN
  -- Defensive: a profiles row with no role can't be scored.
  IF p.role IS NULL THEN
    RETURN 0;
  END IF;

  IF p.role = 'player' THEN
    -- Player buckets (sum to 100). Mirrors useProfileStrength; gallery
    -- dropped, bio added at 5%.
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN
      v_score := v_score + 5;
    END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF p.position IS NOT NULL AND length(btrim(p.position)) > 0 THEN
      v_score := v_score + 5;
    END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN
      v_score := v_score + 5;
    END IF;
    IF p.highlight_video_url IS NOT NULL AND length(btrim(p.highlight_video_url)) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF COALESCE(p.full_game_video_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF p.open_to_play = TRUE THEN
      v_score := v_score + 5;
    END IF;

  ELSIF p.role = 'coach' THEN
    -- Coach buckets (sum to 100).
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF (p.coaching_categories IS NOT NULL AND array_length(p.coaching_categories, 1) > 0)
       OR (p.coach_specialization IS NOT NULL AND length(btrim(p.coach_specialization)) > 0) THEN
      v_score := v_score + 10;
    END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF p.open_to_coach = TRUE THEN
      v_score := v_score + 10;
    END IF;

  ELSIF p.role = 'club' THEN
    -- Club buckets (sum to 100). Clubs don't have highlight video,
    -- references, or open_to flags — score weights the descriptive
    -- profile content + activity (posts) instead.
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF (p.club_bio IS NOT NULL AND length(btrim(p.club_bio)) > 0)
       OR (p.bio IS NOT NULL AND length(btrim(p.bio)) > 0) THEN
      v_score := v_score + 20;
    END IF;
    IF p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF p.nationality_country_id IS NOT NULL THEN
      v_score := v_score + 5;
    END IF;
    IF p.year_founded IS NOT NULL THEN
      v_score := v_score + 10;
    END IF;
    IF (p.contact_email IS NOT NULL AND length(btrim(p.contact_email)) > 0 AND p.contact_email_public = TRUE)
       OR (p.website IS NOT NULL AND length(btrim(p.website)) > 0) THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.post_count, 0) > 0 THEN
      v_score := v_score + 20;
    END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;

  ELSIF p.role = 'umpire' THEN
    -- Umpire buckets (sum to 100).
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF (p.umpire_level IS NOT NULL AND length(btrim(p.umpire_level)) > 0)
       OR (p.umpiring_categories IS NOT NULL AND array_length(p.umpiring_categories, 1) > 0) THEN
      v_score := v_score + 10;
    END IF;
    IF p.federation IS NOT NULL AND length(btrim(p.federation)) > 0 THEN
      v_score := v_score + 5;
    END IF;
    IF p.officiating_specialization IS NOT NULL AND length(btrim(p.officiating_specialization)) > 0 THEN
      v_score := v_score + 5;
    END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN
      v_score := v_score + 15;
    END IF;
    IF p.open_to_opportunities = TRUE THEN
      v_score := v_score + 5;
    END IF;
    IF COALESCE(p.umpire_appointment_count, 0) > 0 THEN
      v_score := v_score + 10;
    END IF;

  ELSIF p.role = 'brand' THEN
    -- Brand buckets (sum to 100). Brands don't have references or
    -- coaching/playing context — the formula leans heavily on
    -- descriptive content (logo, bio, website, posts) since those are
    -- the credibility signals a brand profile actually carries.
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN
      v_score := v_score + 20;
    END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN
      v_score := v_score + 20;
    END IF;
    IF p.brand_representation IS NOT NULL AND length(btrim(p.brand_representation)) > 0 THEN
      v_score := v_score + 20;
    END IF;
    IF (p.website IS NOT NULL AND length(btrim(p.website)) > 0)
       OR (p.social_links IS NOT NULL AND p.social_links::text != '{}'::text AND p.social_links::text != 'null'::text) THEN
      v_score := v_score + 20;
    END IF;
    IF COALESCE(p.post_count, 0) > 0 THEN
      v_score := v_score + 20;
    END IF;
  END IF;

  -- Clamp defensively in case of arithmetic drift.
  IF v_score < 0 THEN v_score := 0; END IF;
  IF v_score > 100 THEN v_score := 100; END IF;

  RETURN v_score;
END;
$$;

COMMENT ON FUNCTION public.compute_profile_completeness_pct(public.profiles) IS
  'Per-role profile completeness score (0-100). Pure read of profiles columns; safe to call from BEFORE trigger.';

-- ── 3. BEFORE-trigger to keep the column in sync ─────────────────────

CREATE OR REPLACE FUNCTION public.profiles_set_completeness_pct()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.profile_completeness_pct := public.compute_profile_completeness_pct(NEW);
  RETURN NEW;
END;
$$;

-- Drop first so we can re-run the migration safely on local resets.
DROP TRIGGER IF EXISTS trg_profiles_set_completeness_pct ON public.profiles;
CREATE TRIGGER trg_profiles_set_completeness_pct
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_set_completeness_pct();

COMMENT ON FUNCTION public.profiles_set_completeness_pct IS
  'BEFORE INSERT/UPDATE trigger on profiles. Sets NEW.profile_completeness_pct from compute_profile_completeness_pct(). No recursive UPDATE risk — modifies NEW in place.';

-- ── 4. Backfill existing rows ─────────────────────────────────────────
-- One pass over the table. The trigger does the work; we just touch
-- every row. updated_at intentionally NOT bumped — this is a system
-- backfill, not a user edit, and downstream "recently active" sorts
-- should not register all profiles as just-updated.

UPDATE public.profiles
SET profile_completeness_pct = public.compute_profile_completeness_pct(profiles.*);

-- ── 5. Index for the top-N ORDER BY ───────────────────────────────────
-- Covers the common queries: (role, completeness DESC) for role-scoped
-- carousels and (completeness DESC) for the "All" carousel.

CREATE INDEX IF NOT EXISTS idx_profiles_role_completeness_pct
  ON public.profiles (role, profile_completeness_pct DESC)
  WHERE onboarding_completed = TRUE AND COALESCE(is_blocked, FALSE) = FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_completeness_pct
  ON public.profiles (profile_completeness_pct DESC)
  WHERE onboarding_completed = TRUE AND COALESCE(is_blocked, FALSE) = FALSE;

-- ── 6. RPC: get_top_community_members ─────────────────────────────────
-- Returns the top N onboarded, unblocked profiles ordered by
-- completeness, with tiebreakers from the user's spec:
--   1. profile_completeness_pct DESC
--   2. last_active_at DESC NULLS LAST     (recently active)
--   3. (avatar_url IS NOT NULL) DESC      (has profile photo)
--   4. (current_club IS NOT NULL) DESC    (has current club)
--   5. (accepted_reference_count > 0) DESC (has references)
--   6. (open_to_play OR open_to_coach OR open_to_opportunities) DESC
--
-- Brands are intentionally excluded from /community per the existing
-- IA (brand discovery lives at /marketplace). The RPC respects an
-- optional role filter; pass NULL for "all roles except brand", or
-- pass 'brand' explicitly if a future surface needs brand ranking.
--
-- SECURITY INVOKER so it respects RLS on profiles. Auth required.

DROP FUNCTION IF EXISTS public.get_top_community_members(TEXT, INT);
CREATE OR REPLACE FUNCTION public.get_top_community_members(
  p_role TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  nationality TEXT,
  nationality_country_id INTEGER,
  nationality2_country_id INTEGER,
  base_location TEXT,
  -- "position" must be quoted in RETURNS TABLE because Postgres parses
  -- it as the start of the position() builtin function otherwise. The
  -- column on profiles is unquoted; we quote only in this signature.
  "position" TEXT,
  current_club TEXT,
  current_world_club_id UUID,
  open_to_play BOOLEAN,
  open_to_coach BOOLEAN,
  open_to_opportunities BOOLEAN,
  is_verified BOOLEAN,
  last_active_at TIMESTAMPTZ,
  profile_completeness_pct SMALLINT,
  accepted_reference_count INTEGER,
  accepted_friend_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.role::TEXT,
    p.full_name,
    p.username,
    p.avatar_url,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.current_club,
    p.current_world_club_id::UUID,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.is_verified,
    p.last_active_at,
    p.profile_completeness_pct,
    p.accepted_reference_count,
    p.accepted_friend_count
  FROM public.profiles p
  WHERE p.onboarding_completed = TRUE
    AND COALESCE(p.is_blocked, FALSE) = FALSE
    -- Test accounts are never surfaced in the leaderboard, even to other
    -- test accounts — keeps the public "top members" view honest.
    AND COALESCE(p.is_test_account, FALSE) = FALSE
    AND (p_role IS NULL OR p.role = p_role)
    -- /community proper excludes brands (they're at /marketplace).
    -- Caller can opt into brand ranking by passing p_role='brand'.
    AND (p_role IS NOT NULL OR p.role <> 'brand')
  ORDER BY
    p.profile_completeness_pct DESC,
    p.last_active_at DESC NULLS LAST,
    (p.avatar_url IS NOT NULL) DESC,
    (p.current_club IS NOT NULL) DESC,
    (COALESCE(p.accepted_reference_count, 0) > 0) DESC,
    (COALESCE(p.open_to_play, FALSE)
     OR COALESCE(p.open_to_coach, FALSE)
     OR COALESCE(p.open_to_opportunities, FALSE)) DESC,
    p.id  -- final deterministic tiebreaker so pagination is stable
  LIMIT GREATEST(1, LEAST(p_limit, 100));  -- safety cap
$$;

COMMENT ON FUNCTION public.get_top_community_members(TEXT, INT) IS
  'Top N community profiles by profile_completeness_pct. Optional role filter; pass NULL for the All view (excludes brands). Caps at 100 rows.';

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT) TO authenticated;
-- Anon visitors can see the public-facing community page too; the RPC
-- only returns columns already covered by the existing anon grants on
-- profiles (see 20260518100000_grant_anon_select_profile_count_columns).
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT) TO anon;

COMMIT;
