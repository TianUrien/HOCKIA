-- =========================================================================
-- D5 · Hockia suggests: the top 5 players for one open role
-- =========================================================================
-- Founder rulings 2026-10-04 (docs/design-handoff/decisions.md):
--   * reason lines are TEMPLATES filled from profile fields (client
--     lib/suggestionReasons.ts); no AI text here. This migration stores the
--     facts the templates need (role_suggestions.evidence).
--   * the top 5 is recomputed NIGHTLY (cron role_suggestions_nightly, 03:30
--     UTC) and whenever the role changes (trigger on opportunities).
--   * AI only in the D5.2 refine chat (nl-search mode role_suggestions_refine),
--     which reads ONLY these 5 stored candidates' public profile facts.
--
-- Who may be suggested (compute_role_suggestions), all server-side:
--   * suggestible: player, 18+ by a KNOWN date of birth, open to play, not
--     hidden (profile_is_suggestible), onboarded, not uncontactable;
--   * position: the role's position is the player's primary OR secondary
--     position (no position on the role = any position);
--   * category: _target_accepts_category(role target, playing_category), the
--     rule compute_club_fit uses (Boys → Men's pool, Girls → Women's pool,
--     Mixed takes all). A player with no playing category is NOT suggested
--     for a Men's / Women's role (strict on purpose: a suggestion is a claim);
--   * test accounts only on staging (is_staging_env(), the nl-search /
--     community-search idiom) or when the role's publisher is itself a test
--     account;
--   * no block pair with the publisher (either direction);
--   * no application to this role (any status), no open application to
--     another of the publisher's OPEN roles, no open invite from the publisher
--     (send_invite would refuse both: "already applied" / "one open invite
--     per player per club");
--   * not declined by this publisher in the last 90 days: an application to
--     any of its roles moved to rejected (players see "Not selected") or an
--     offer the player declined (offer_declined), updated in the last 90
--     days, or an invite from this publisher the player passed on (declined)
--     in the last 90 days.
-- Ranking: compute_club_fit score (rounded to 2 decimals) desc, then the
-- evidence score (full match 32 > highlights 16 > league 8 > active in the last
-- 30 days 4 > career entries 2 > references 1), then most recently active.
-- Grey fit (score < 0.40, "no chip") is never suggested: "five players who fit".
-- At most 200 candidates per role are scored (primary-position players and the
-- most recently active first), so the nightly loop stays cheap.
--
-- compute_club_fit answers only when auth.uid() is the owner it is asked about
-- (recruiters-only guard, 20260928130000). compute_role_suggestions therefore
-- sets the transaction-local JWT claims to the role's publisher around the fit
-- calls and restores them afterwards (GUC changes also roll back with any
-- (sub)transaction that fails). compute_club_fit itself is NOT changed. When
-- the publisher is not a recruiter (banned club, coach who doesn't recruit)
-- fit returns nothing and the role gets no suggestions — correct by the same rule.
--
-- Privacy: evidence never carries a date of birth, email, phone or any column
-- the publisher couldn't read on the player's profile; "active this month"
-- honours profiles.show_last_active. Players never read role_suggestions:
-- RLS lets only the role's publisher (opportunities.club_id = auth.uid(), the
-- ownership check the applicants screens use, which covers recruiting coaches
-- who publish) SELECT; authenticated has no write grant. get_role_suggestions
-- re-applies every people fence at read time (hidden, uncontactable,
-- suggestible, test, blocks, applied/invited since the last run).
--
-- Objects:
--   role_suggestions               the top 5 per role (RLS: publisher SELECT)
--   role_suggestion_runs           last computation + last manual refresh per
--                                  role (service-role only)
--   _role_fit_target(text)         opportunity gender → fit target
--   compute_role_suggestions(uuid) SECURITY DEFINER, service_role only
--   refresh_role_suggestions(uuid) publisher-callable, once per 10 min per role
--   get_role_suggestions(uuid)     publisher-callable read for D5.1 / nl-search
--   run_role_suggestions_nightly() SECURITY DEFINER, service_role only (cron)
--   _role_suggestions_on_change()  trigger fn on opportunities (INSERT/UPDATE)
--   cron role_suggestions_nightly  03:30 UTC
--
-- Rollback: supabase/rollbacks/20261004100000_d5_role_suggestions.down.sql
-- Probes:   supabase/tests/security/d5_role_suggestions.probe.sql (fixtures,
--           rolled back) and supabase/tests/security/d5_role_suggestions_acl.probe.sql
--           (READ-ONLY: grants, RLS, function shape, trigger, cron).
-- =========================================================================


-- ═══ 1 · Tables ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.role_suggestions (
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rank           smallint NOT NULL,
  fit_score      numeric NOT NULL,
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, player_id),
  CONSTRAINT role_suggestions_rank_range CHECK (rank BETWEEN 1 AND 5)
);

COMMENT ON TABLE public.role_suggestions IS
  'D5 Hockia suggests: top 5 suggestible players per open player role, recomputed nightly and on role change. Readable only by the role''s publisher; written only by compute_role_suggestions.';

CREATE INDEX IF NOT EXISTS role_suggestions_player_idx ON public.role_suggestions (player_id);

ALTER TABLE public.role_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_suggestions_publisher_select ON public.role_suggestions;
CREATE POLICY role_suggestions_publisher_select ON public.role_suggestions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.opportunities o
       WHERE o.id = role_suggestions.opportunity_id
         AND o.club_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON TABLE public.role_suggestions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.role_suggestions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_suggestions TO service_role;


CREATE TABLE IF NOT EXISTS public.role_suggestion_runs (
  opportunity_id       uuid PRIMARY KEY REFERENCES public.opportunities(id) ON DELETE CASCADE,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  candidate_count      integer NOT NULL DEFAULT 0,
  suggestion_count     integer NOT NULL DEFAULT 0,
  manual_refreshed_at  timestamptz
);

COMMENT ON TABLE public.role_suggestion_runs IS
  'D5: when each role''s suggestions were last computed and last manually refreshed (10-minute limit). Service-role only.';

ALTER TABLE public.role_suggestion_runs ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only SECURITY DEFINER functions and the service role touch it.
REVOKE ALL ON TABLE public.role_suggestion_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_suggestion_runs TO service_role;


-- ═══ 2 · _role_fit_target ══════════════════════════════════════════════════════
-- Mirrors client lib/clubRecruiting fitTarget(): Boys → Men, Girls → Women.

CREATE OR REPLACE FUNCTION public._role_fit_target(p_gender text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_gender, '')))
    WHEN 'men'   THEN 'Men'
    WHEN 'boys'  THEN 'Men'
    WHEN 'women' THEN 'Women'
    WHEN 'girls' THEN 'Women'
    WHEN 'mixed' THEN 'Mixed'
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public._role_fit_target(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._role_fit_target(text) TO authenticated, service_role;


-- ═══ 3 · compute_role_suggestions ══════════════════════════════════════════════
-- Returns the number of suggestions stored (0..5).

CREATE OR REPLACE FUNCTION public.compute_role_suggestions(p_opportunity_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_max_candidates constant integer := 200;
  v_opp        record;
  v_pub_test   boolean;
  v_target     text;
  v_position   text;
  v_eu_ids     integer[] := public.eu_country_ids();
  v_now        timestamptz := timezone('utc', now());
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_prev_sub    text := current_setting('request.jwt.claim.sub', true);
  v_candidates integer := 0;
  v_stored     integer := 0;
  v_cand       record;
  v_score      numeric;
  v_scored     jsonb := '[]'::jsonb;
BEGIN
  IF p_opportunity_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT o.id, o.club_id, o.status::text AS status, o.opportunity_type::text AS opportunity_type,
         o.position::text AS position, o.gender::text AS gender
    INTO v_opp
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id;

  IF v_opp.id IS NULL THEN
    RETURN 0;
  END IF;

  -- Serialise runs for one role (trigger, nightly job, manual refresh).
  PERFORM pg_advisory_xact_lock(hashtext('role_suggestions:' || p_opportunity_id::text));

  DELETE FROM public.role_suggestions WHERE opportunity_id = p_opportunity_id;

  -- Only open PLAYER roles get suggestions.
  IF v_opp.status <> 'open' OR v_opp.opportunity_type <> 'player' THEN
    DELETE FROM public.role_suggestion_runs WHERE opportunity_id = p_opportunity_id;
    RETURN 0;
  END IF;

  SELECT coalesce(p.is_test_account, false) INTO v_pub_test
    FROM public.profiles p WHERE p.id = v_opp.club_id;
  v_target   := public._role_fit_target(v_opp.gender);
  v_position := nullif(lower(btrim(coalesce(v_opp.position, ''))), '');

  -- Fit runs with the publisher as the caller (see header), restored below.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_opp.club_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_opp.club_id::text, true);

  FOR v_cand IN
    SELECT p.id,
           p.position,
           p.secondary_position,
           p.playing_category,
           p.nationality_country_id,
           p.nationality2_country_id,
           p.available_from,
           p.last_active_at,
           coalesce(p.show_last_active, true) AS show_last_active,
           coalesce(p.full_game_video_count, 0) AS full_game_video_count,
           coalesce(p.career_entry_count, 0) AS career_entry_count,
           coalesce(p.accepted_reference_count, 0) AS accepted_reference_count,
           (nullif(btrim(coalesce(p.highlight_video_url, '')), '') IS NOT NULL) AS legacy_highlight,
           CASE
             WHEN v_position IS NULL THEN NULL
             WHEN lower(btrim(coalesce(p.position, ''))) = v_position THEN 'primary'
             ELSE 'secondary'
           END AS position_match
      FROM public.profiles p
     WHERE p.role = 'player'
       AND p.id <> v_opp.club_id
       AND p.onboarding_completed IS TRUE
       AND public.profile_is_suggestible(p.role, p.date_of_birth, p.open_to_play, p.is_blocked, p.frozen_minor_at)
       AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
       AND (public.is_staging_env() OR NOT coalesce(p.is_test_account, false) OR v_pub_test)
       AND (v_position IS NULL
            OR lower(btrim(coalesce(p.position, ''))) = v_position
            OR lower(btrim(coalesce(p.secondary_position, ''))) = v_position)
       AND (v_target IS NULL OR public._target_accepts_category(v_target, p.playing_category))
       AND NOT EXISTS (
             SELECT 1 FROM public.user_blocks b
              WHERE (b.blocker_id = v_opp.club_id AND b.blocked_id = p.id)
                 OR (b.blocker_id = p.id AND b.blocked_id = v_opp.club_id))
       AND NOT EXISTS (
             SELECT 1 FROM public.opportunity_applications a
              WHERE a.opportunity_id = v_opp.id AND a.applicant_id = p.id)
       AND NOT EXISTS (
             SELECT 1
               FROM public.opportunity_applications a
               JOIN public.opportunities o2 ON o2.id = a.opportunity_id
              WHERE a.applicant_id = p.id
                AND o2.club_id = v_opp.club_id
                AND (
                      (o2.status = 'open'
                       AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted',
                                              'signed_pending_confirmation'))
                   OR (a.status::text IN ('rejected', 'offer_declined')
                       AND a.updated_at > v_now - interval '90 days')
                ))
       AND NOT EXISTS (
             SELECT 1 FROM public.opportunity_invites i
              WHERE i.club_id = v_opp.club_id
                AND i.player_id = p.id
                AND (i.status = 'sent'
                     OR (i.status = 'declined'
                         AND coalesce(i.responded_at, i.sent_at) > v_now - interval '90 days')))
     ORDER BY (v_position IS NOT NULL AND lower(btrim(coalesce(p.position, ''))) = v_position) DESC,
              p.last_active_at DESC NULLS LAST,
              p.id
     LIMIT c_max_candidates
  LOOP
    v_candidates := v_candidates + 1;

    v_score := NULL;
    SELECT f.score INTO v_score
      FROM public.compute_club_fit(v_opp.club_id, v_cand.id, v_target, NULL, v_opp.id) f
     LIMIT 1;

    -- No fit row (publisher not a recruiter) or grey fit: not suggested.
    CONTINUE WHEN v_score IS NULL OR v_score < 0.40;

    DECLARE
      v_full_matches integer;
      v_highlights   integer;
      v_league       record;
      v_active       boolean;
      v_eu           boolean;
      v_ev_score     integer;
    BEGIN
      SELECT count(*) FILTER (WHERE v.kind = 'full_match'),
             count(*) FILTER (WHERE v.kind = 'highlight')
        INTO v_full_matches, v_highlights
        FROM public.player_videos v
       WHERE v.user_id = v_cand.id
         AND v.status = 'ready'
         AND v.kind IN ('full_match', 'highlight');
      v_full_matches := v_full_matches + v_cand.full_game_video_count;
      v_highlights   := v_highlights + CASE WHEN v_cand.legacy_highlight THEN 1 ELSE 0 END;

      SELECT l.league_name, l.source INTO v_league FROM public.player_league(v_cand.id) l LIMIT 1;

      v_active := v_cand.show_last_active
              AND v_cand.last_active_at IS NOT NULL
              AND v_cand.last_active_at > v_now - interval '30 days';
      v_eu := (v_cand.nationality_country_id = ANY (v_eu_ids))
           OR (v_cand.nationality2_country_id = ANY (v_eu_ids));

      v_ev_score := CASE WHEN v_full_matches > 0 THEN 32 ELSE 0 END
                  + CASE WHEN v_highlights > 0 THEN 16 ELSE 0 END
                  + CASE WHEN v_league.league_name IS NOT NULL THEN 8 ELSE 0 END
                  + CASE WHEN v_active THEN 4 ELSE 0 END
                  + CASE WHEN v_cand.career_entry_count > 0 THEN 2 ELSE 0 END
                  + CASE WHEN v_cand.accepted_reference_count > 0 THEN 1 ELSE 0 END;

      v_scored := v_scored || jsonb_build_array(jsonb_build_object(
        'player_id', v_cand.id,
        'fit_score', v_score,
        'evidence_score', v_ev_score,
        'last_active_at', CASE WHEN v_cand.show_last_active THEN v_cand.last_active_at END,
        'evidence', jsonb_build_object(
          'position_match', v_cand.position_match,
          'position', v_cand.position,
          'secondary_position', v_cand.secondary_position,
          'playing_category', v_cand.playing_category,
          'eu_passport', coalesce(v_eu, false),
          'available_from', v_cand.available_from,
          'full_matches', v_full_matches,
          'highlights', v_highlights,
          'league_name', v_league.league_name,
          'league_self_reported', coalesce(v_league.source = 'self_reported', false),
          'active_30d', coalesce(v_active, false),
          'career_entries', v_cand.career_entry_count,
          'references', v_cand.accepted_reference_count,
          'evidence_score', v_ev_score
        )
      ));
    END;
  END LOOP;

  -- Restore the caller's claims (cron: none; trigger / refresh: the caller's).
  PERFORM set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

  INSERT INTO public.role_suggestions (opportunity_id, player_id, rank, fit_score, evidence, computed_at)
  SELECT p_opportunity_id, s.player_id, s.rn::smallint, s.fit_score, s.evidence, v_now
    FROM (
      SELECT (e->>'player_id')::uuid AS player_id,
             (e->>'fit_score')::numeric AS fit_score,
             e->'evidence' AS evidence,
             row_number() OVER (
               ORDER BY round((e->>'fit_score')::numeric, 2) DESC,
                        (e->>'evidence_score')::integer DESC,
                        (e->>'last_active_at')::timestamptz DESC NULLS LAST,
                        e->>'player_id') AS rn
        FROM jsonb_array_elements(v_scored) e
    ) s
   WHERE s.rn <= 5;
  GET DIAGNOSTICS v_stored = ROW_COUNT;

  INSERT INTO public.role_suggestion_runs (opportunity_id, computed_at, candidate_count, suggestion_count)
  VALUES (p_opportunity_id, v_now, v_candidates, v_stored)
  ON CONFLICT (opportunity_id) DO UPDATE
     SET computed_at = EXCLUDED.computed_at,
         candidate_count = EXCLUDED.candidate_count,
         suggestion_count = EXCLUDED.suggestion_count;

  RETURN v_stored;
END;
$$;

COMMENT ON FUNCTION public.compute_role_suggestions(uuid) IS
  'D5: recompute the top 5 suggestible players for one open player role (fenced; see migration 20261004100000). Service role only; clubs call refresh_role_suggestions.';

REVOKE ALL ON FUNCTION public.compute_role_suggestions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_role_suggestions(uuid) TO service_role;


-- ═══ 4 · refresh_role_suggestions (publisher, once per 10 minutes) ═════════════
-- { outcome: refreshed | rate_limited | not_owner | not_open, computed_at, count }

CREATE OR REPLACE FUNCTION public.refresh_role_suggestions(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_opp   record;
  v_run   record;
  v_now   timestamptz := timezone('utc', now());
  v_count integer;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RETURN jsonb_build_object('outcome', 'not_owner');
  END IF;

  SELECT o.id, o.club_id, o.status::text AS status, o.opportunity_type::text AS opportunity_type
    INTO v_opp
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id;
  IF v_opp.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('outcome', 'not_owner');
  END IF;
  IF v_opp.status <> 'open' OR v_opp.opportunity_type <> 'player' THEN
    RETURN jsonb_build_object('outcome', 'not_open');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('role_suggestions_refresh:' || p_opportunity_id::text));

  SELECT r.computed_at, r.manual_refreshed_at, r.suggestion_count INTO v_run
    FROM public.role_suggestion_runs r
   WHERE r.opportunity_id = p_opportunity_id;
  IF v_run.manual_refreshed_at IS NOT NULL
     AND v_run.manual_refreshed_at > v_now - interval '10 minutes' THEN
    RETURN jsonb_build_object('outcome', 'rate_limited',
                              'computed_at', v_run.computed_at,
                              'count', v_run.suggestion_count);
  END IF;

  v_count := public.compute_role_suggestions(p_opportunity_id);

  UPDATE public.role_suggestion_runs
     SET manual_refreshed_at = v_now
   WHERE opportunity_id = p_opportunity_id;

  RETURN jsonb_build_object('outcome', 'refreshed', 'computed_at', v_now, 'count', v_count);
END;
$$;

COMMENT ON FUNCTION public.refresh_role_suggestions(uuid) IS
  'D5: the role''s publisher recomputes its suggestions; at most once per 10 minutes per role.';

REVOKE ALL ON FUNCTION public.refresh_role_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_role_suggestions(uuid) TO authenticated, service_role;


-- ═══ 5 · get_role_suggestions (publisher read, fenced again) ═══════════════════
-- { role: {...}, computed_at, suggestions: [ {rank, player_id, full_name,
--   avatar_url, role, position, secondary_position, nationality_country_id,
--   nationality2_country_id, fit_state, evidence}, ... ] }
-- Non-owners get NULL (no error, nothing leaks). nl-search's refine mode calls
-- it with the caller's JWT, so the same owner check runs there.

CREATE OR REPLACE FUNCTION public.get_role_suggestions(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_opp  record;
  v_pub_test boolean;
  v_run  record;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_recruiter(v_uid) THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.club_id, o.title, o.status::text AS status, o.opportunity_type::text AS opportunity_type,
         o.position::text AS position, o.gender::text AS gender, o.eu_passport_required, o.start_date
    INTO v_opp
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id;
  IF v_opp.id IS NULL OR v_opp.club_id IS DISTINCT FROM v_uid THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(p.is_test_account, false) INTO v_pub_test FROM public.profiles p WHERE p.id = v_uid;
  SELECT r.computed_at INTO v_run FROM public.role_suggestion_runs r WHERE r.opportunity_id = p_opportunity_id;

  SELECT coalesce(jsonb_agg(x.obj ORDER BY x.rank), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT s.rank,
             jsonb_build_object(
               'rank', row_number() OVER (ORDER BY s.rank),
               'player_id', p.id,
               'full_name', p.full_name,
               'avatar_url', p.avatar_url,
               'role', p.role,
               'position', p.position,
               'secondary_position', p.secondary_position,
               'nationality_country_id', p.nationality_country_id,
               'nationality2_country_id', p.nationality2_country_id,
               'fit_state', CASE WHEN s.fit_score >= 0.66 THEN 'green'
                                 WHEN s.fit_score >= 0.40 THEN 'yellow'
                                 ELSE 'grey' END,
               'evidence', s.evidence
             ) AS obj
        FROM public.role_suggestions s
        JOIN public.profiles p ON p.id = s.player_id
       WHERE s.opportunity_id = p_opportunity_id
         AND v_opp.status = 'open'
         AND p.onboarding_completed IS TRUE
         AND public.profile_is_suggestible(p.role, p.date_of_birth, p.open_to_play, p.is_blocked, p.frozen_minor_at)
         AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
         AND (public.is_staging_env() OR NOT coalesce(p.is_test_account, false) OR v_pub_test)
         AND NOT EXISTS (
               SELECT 1 FROM public.user_blocks b
                WHERE (b.blocker_id = v_uid AND b.blocked_id = p.id)
                   OR (b.blocker_id = p.id AND b.blocked_id = v_uid))
         -- Applied or invited since the last run: drop now, refill tonight.
         AND NOT EXISTS (
               SELECT 1 FROM public.opportunity_applications a
                WHERE a.opportunity_id = p_opportunity_id AND a.applicant_id = p.id)
         AND NOT EXISTS (
               SELECT 1 FROM public.opportunity_invites i
                WHERE i.club_id = v_uid AND i.player_id = p.id AND i.opportunity_id = p_opportunity_id)
    ) x;

  RETURN jsonb_build_object(
    'role', jsonb_build_object(
      'id', v_opp.id,
      'title', v_opp.title,
      'status', v_opp.status,
      'opportunity_type', v_opp.opportunity_type,
      'position', v_opp.position,
      'gender', v_opp.gender,
      'eu_passport_required', coalesce(v_opp.eu_passport_required, false),
      'start_date', v_opp.start_date
    ),
    'computed_at', v_run.computed_at,
    'suggestions', v_rows
  );
END;
$$;

COMMENT ON FUNCTION public.get_role_suggestions(uuid) IS
  'D5: the role''s stored suggestions for its publisher, with the public card fields, every people fence re-applied. NULL for anyone else.';

REVOKE ALL ON FUNCTION public.get_role_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_role_suggestions(uuid) TO authenticated, service_role;


-- ═══ 6 · Nightly job ═══════════════════════════════════════════════════════════
-- Every open player role, one at a time; a failing role is reported and
-- skipped (its sub-transaction rolls back). Rows of roles that are no longer
-- open are cleared. Returns { roles, suggestions, failed, cleared }.

CREATE OR REPLACE FUNCTION public.run_role_suggestions_nightly()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    record;
  v_roles   integer := 0;
  v_total   integer := 0;
  v_failed  integer := 0;
  v_cleared integer := 0;
BEGIN
  -- Cron (claims-less) or the service role only.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
     AND coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.role_suggestions s
   USING public.opportunities o
   WHERE o.id = s.opportunity_id
     AND (o.status::text <> 'open' OR o.opportunity_type::text <> 'player');
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  DELETE FROM public.role_suggestion_runs r
   USING public.opportunities o
   WHERE o.id = r.opportunity_id
     AND (o.status::text <> 'open' OR o.opportunity_type::text <> 'player');

  FOR v_role IN
    SELECT o.id FROM public.opportunities o
     WHERE o.status = 'open' AND o.opportunity_type = 'player'
     ORDER BY o.created_at
  LOOP
    BEGIN
      v_total := v_total + public.compute_role_suggestions(v_role.id);
      v_roles := v_roles + 1;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'role_suggestions_nightly: role % failed: %', v_role.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('roles', v_roles, 'suggestions', v_total, 'failed', v_failed, 'cleared', v_cleared);
END;
$$;

REVOKE ALL ON FUNCTION public.run_role_suggestions_nightly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_role_suggestions_nightly() TO service_role;


-- ═══ 7 · Recompute when the role changes ═══════════════════════════════════════
-- INSERT of an open role, or an UPDATE of position / gender / eu_passport_required /
-- status / opportunity_type. Open → recompute; anything else → rows cleared
-- (compute_role_suggestions does both). A failure never blocks the role save.

CREATE OR REPLACE FUNCTION public._role_suggestions_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status::text <> 'open' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.position IS NOT DISTINCT FROM OLD.position
     AND NEW.gender IS NOT DISTINCT FROM OLD.gender
     AND NEW.eu_passport_required IS NOT DISTINCT FROM OLD.eu_passport_required
     AND NEW.opportunity_type IS NOT DISTINCT FROM OLD.opportunity_type THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.compute_role_suggestions(NEW.id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'role suggestions for % not recomputed: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._role_suggestions_on_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._role_suggestions_on_change() TO service_role;

DROP TRIGGER IF EXISTS role_suggestions_on_insert ON public.opportunities;
CREATE TRIGGER role_suggestions_on_insert
  AFTER INSERT ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public._role_suggestions_on_change();

DROP TRIGGER IF EXISTS role_suggestions_on_update ON public.opportunities;
CREATE TRIGGER role_suggestions_on_update
  AFTER UPDATE OF status, position, gender, eu_passport_required, opportunity_type ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public._role_suggestions_on_change();


-- ═══ Schedule ══════════════════════════════════════════════════════════════════
-- Same pattern as ai_spend_alert_daily (20261003140000). 03:30 UTC.

DO $$
BEGIN
  PERFORM cron.unschedule('role_suggestions_nightly');
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN RAISE NOTICE 'Insufficient privilege to unschedule; continuing';
  WHEN others THEN RAISE NOTICE 'No prior role_suggestions_nightly schedule found';
END $$;
DO $$
BEGIN
  PERFORM cron.schedule('role_suggestions_nightly', '30 3 * * *',
    $cron$SELECT public.run_role_suggestions_nightly();$cron$);
END $$;


-- ═══ Self-checks ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.role_suggestions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.role_suggestions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.role_suggestions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.role_suggestions', 'DELETE') THEN
    RAISE EXCEPTION 'role_suggestions: authenticated may only SELECT (RLS), anon nothing';
  END IF;
  IF has_table_privilege('authenticated', 'public.role_suggestion_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.role_suggestion_runs', 'SELECT') THEN
    RAISE EXCEPTION 'role_suggestion_runs must be service_role only';
  END IF;
  IF has_function_privilege('authenticated', 'public.compute_role_suggestions(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.compute_role_suggestions(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.run_role_suggestions_nightly()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_role_suggestions(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.refresh_role_suggestions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D5 function grants are wrong';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
