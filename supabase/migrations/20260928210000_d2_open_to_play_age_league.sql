-- =========================================================================
-- D2 · 30-second profile — slice 1 · age predicates, Open to play, own league
-- =========================================================================
-- Founder rulings 2026-09-26:
--   * Club-facing SUGGESTIONS = 18+ by date of birth AND open to play (and not
--     hidden). Club-facing FIND/SEARCH = every 18+ player, open-to-play first.
--     Under-18s never appear club-facing. 16–17-year-olds don't get the Open to
--     play switch: can_toggle_open_to_play() is the flag the UI reads.
--   * D2 records availability confirmation: set_open_to_play() stamps
--     profiles.availability_confirmed_at. No reminder job.
--   * "Add league" when the player's club has no league = the player's own
--     league in profiles.mens_league_id / womens_league_id, labelled
--     SELF-REPORTED, shown but never counted for level or fit.
--
-- "18+" means a KNOWN date of birth at least 18 years ago. An unknown date of
-- birth is not 18+ (the age gate already chases those accounts to declare it).
--
-- Self-reported league model (simplest correct option): no new column.
--   On a club account, profiles.mens/womens_league_id IS the club's league (the
--   sync trigger copies it to world_clubs). On a person account it is only ever
--   typed by the person, so it is self-reported by construction. The verified
--   league is the one on the linked world club (world_clubs.men/women_league_id,
--   owned by the club / admins). player_league() returns the club league when
--   there is one (source 'club', counts for level) and otherwise the person's
--   own league (source 'self_reported', level_band NULL, counts_for_level false).
--   "Verified" therefore happens by the club getting its league on Hockia — the
--   player's label flips to the club league with no data migration. All level /
--   fit code (compute_club_fit, _player_level_band, clubFit.ts, getClubLevelBand,
--   get_top_community_members' competition band) already reads the world club
--   only; discover_profiles' league filter is fenced to club rows in
--   20260928230000.
--
-- No UPDATE runs on public.profiles in this migration.
-- =========================================================================

-- ── 1. Pure predicates (inlinable in set queries; no data access) ─────────
CREATE OR REPLACE FUNCTION public.profile_is_adult(p_date_of_birth date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_date_of_birth IS NOT NULL
     AND p_date_of_birth <= ((timezone('utc', now()))::date - INTERVAL '18 years')::date
$$;

COMMENT ON FUNCTION public.profile_is_adult(date) IS
  'D2: known date of birth and at least 18 today (UTC). Unknown DOB = false.';

CREATE OR REPLACE FUNCTION public.profile_is_suggestible(
  p_role            text,
  p_date_of_birth   date,
  p_open_to_play    boolean,
  p_is_blocked      boolean,
  p_frozen_minor_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_role = 'player'
     AND public.profile_is_adult(p_date_of_birth)
     AND COALESCE(p_open_to_play, false)
     AND NOT public.profile_is_hidden(p_is_blocked, p_frozen_minor_at)
$$;

COMMENT ON FUNCTION public.profile_is_suggestible(text, date, boolean, boolean, timestamptz) IS
  'D2: may be suggested to clubs = player, 18+ by DOB, open to play, not hidden.';

REVOKE ALL ON FUNCTION public.profile_is_adult(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_is_suggestible(text, date, boolean, boolean, timestamptz) FROM PUBLIC;
-- Pure functions of their inputs; they must be executable wherever the
-- INVOKER read RPCs that use them run (get_top_community_members is anon-callable).
GRANT EXECUTE ON FUNCTION public.profile_is_adult(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_is_suggestible(text, date, boolean, boolean, timestamptz) TO anon, authenticated, service_role;

-- ── 2. Per-profile checks ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profile_has_eu_passport(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.nationality_country_id  = ANY (public.eu_country_ids())
        OR p.nationality2_country_id = ANY (public.eu_country_ids())
      FROM public.profiles p
     WHERE p.id = p_uid
  ), false)
$$;

COMMENT ON FUNCTION public.profile_has_eu_passport(uuid) IS
  'D2: true when either passport (nationality_country_id / nationality2_country_id) is an EU '
  'member state per eu_country_ids(). Runs under the caller''s RLS.';

REVOKE ALL ON FUNCTION public.profile_has_eu_passport(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_has_eu_passport(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_suggestible(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT public.profile_is_suggestible(p.role, p.date_of_birth, p.open_to_play, p.is_blocked, p.frozen_minor_at)
       AND p.onboarding_completed IS TRUE
      FROM public.profiles p
     WHERE p.id = p_uid
  ), false)
$$;

COMMENT ON FUNCTION public.is_suggestible(uuid) IS
  'D2: may this profile be suggested to clubs? 18+ by DOB, open to play, not hidden, onboarded player.';

REVOKE ALL ON FUNCTION public.is_suggestible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_suggestible(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_toggle_open_to_play(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.role = 'player'
       AND public.profile_is_adult(p.date_of_birth)
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      FROM public.profiles p
     WHERE p.id = p_uid
  ), false)
$$;

COMMENT ON FUNCTION public.can_toggle_open_to_play(uuid) IS
  'D2: show the Open to play switch? Players 18+ by DOB only (16–17 and unknown DOB: no switch).';

REVOKE ALL ON FUNCTION public.can_toggle_open_to_play(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_toggle_open_to_play(uuid) TO authenticated, service_role;

-- ── 3. Open to play: the one write path the D2 screen uses ────────────────
CREATE OR REPLACE FUNCTION public.set_open_to_play(
  p_open           boolean,
  p_available_from date DEFAULT NULL,
  p_duration       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_row   public.profiles%ROWTYPE;
  v_today date := (timezone('utc', now()))::date;
  v_now   timestamptz := timezone('utc', now());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF p_open IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_input');
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_row.role IS DISTINCT FROM 'player' THEN
    RETURN jsonb_build_object('outcome', 'not_a_player');
  END IF;

  -- Turning it ON needs a known 18+ date of birth. Turning it OFF is always allowed.
  IF p_open AND NOT public.can_toggle_open_to_play(v_uid) THEN
    RETURN jsonb_build_object('outcome',
      CASE WHEN v_row.date_of_birth IS NULL THEN 'dob_required' ELSE 'under_18' END);
  END IF;

  IF p_duration IS NOT NULL
     AND p_duration NOT IN ('full_season', 'half_season', 'short_term', 'flexible') THEN
    RETURN jsonb_build_object('outcome', 'invalid_duration');
  END IF;
  IF p_available_from IS NOT NULL
     AND (p_available_from < v_today - 366 OR p_available_from > v_today + 3 * 366) THEN
    RETURN jsonb_build_object('outcome', 'invalid_date');
  END IF;

  UPDATE public.profiles
     SET open_to_play              = p_open,
         available_from            = p_available_from,
         availability_duration     = p_duration,
         availability_confirmed_at = v_now
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'outcome', 'saved',
    'open_to_play', p_open,
    'available_from', p_available_from,
    'availability_duration', p_duration,
    'availability_confirmed_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION public.set_open_to_play(boolean, date, text) IS
  'D2: save Open to play + when + for how long, stamp availability_confirmed_at. '
  'Refuses to turn it on for anyone not 18+ by DOB (outcome under_18 / dob_required).';

REVOKE ALL ON FUNCTION public.set_open_to_play(boolean, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_open_to_play(boolean, date, text) TO authenticated;

-- Direct client writes of open_to_play (existing Settings / Edit profile
-- switches) keep working, but a KNOWN minor can never switch it on. Unknown DOB
-- is not blocked here so sign-up/onboarding stays exactly as it is.
CREATE OR REPLACE FUNCTION public.guard_open_to_play_minor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NEW.open_to_play IS TRUE
     AND OLD.open_to_play IS DISTINCT FROM TRUE
     AND NEW.date_of_birth IS NOT NULL
     AND NOT public.profile_is_adult(NEW.date_of_birth) THEN
    RAISE EXCEPTION 'Open to play is available from 18' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_open_to_play_minor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_open_to_play_minor() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_open_to_play_minor ON public.profiles;
CREATE TRIGGER trg_guard_open_to_play_minor
  BEFORE UPDATE OF open_to_play ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_open_to_play_minor();

-- ── 4. The player's league: club league (verified) or own (self-reported) ─
CREATE OR REPLACE FUNCTION public.player_league(p_uid uuid)
RETURNS TABLE (
  league_id        integer,
  league_name      text,
  level_band       integer,
  source           text,
  counts_for_level boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pr AS (
    SELECT p.current_world_club_id, p.playing_category, p.mens_league_id, p.womens_league_id,
           (p.playing_category IN ('adult_women', 'girls')) AS wants_women
      FROM public.profiles p
     WHERE p.id = p_uid
  ),
  club AS (
    SELECT CASE WHEN pr.wants_women THEN COALESCE(wc.women_league_id, wc.men_league_id)
                ELSE COALESCE(wc.men_league_id, wc.women_league_id) END AS id
      FROM pr JOIN public.world_clubs wc ON wc.id = pr.current_world_club_id
  ),
  own AS (
    SELECT CASE WHEN pr.wants_women THEN COALESCE(pr.womens_league_id, pr.mens_league_id)
                ELSE COALESCE(pr.mens_league_id, pr.womens_league_id) END AS id
      FROM pr
  )
  SELECT wl.id, wl.name, wl.level_band_global, 'club', true
    FROM club JOIN public.world_leagues wl ON wl.id = club.id
  UNION ALL
  SELECT wl.id, wl.name, NULL::integer, 'self_reported', false
    FROM own JOIN public.world_leagues wl ON wl.id = own.id
   WHERE NOT EXISTS (SELECT 1 FROM club WHERE club.id IS NOT NULL)
  LIMIT 1
$$;

COMMENT ON FUNCTION public.player_league(uuid) IS
  'D2: the league shown on a player''s key facts. source=club (world club league, counts for level) '
  'or self_reported (profiles.mens/womens_league_id typed by the player: shown with a label, '
  'level_band NULL, never counted for level or fit).';

REVOKE ALL ON FUNCTION public.player_league(uuid) FROM PUBLIC;
-- Not anon: it reads profiles.mens/womens_league_id, which anon cannot select.
GRANT EXECUTE ON FUNCTION public.player_league(uuid) TO authenticated, service_role;
