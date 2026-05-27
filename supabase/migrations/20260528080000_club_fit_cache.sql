-- ─────────────────────────────────────────────────────────────────────
-- club_fit_cache — server-side Club Fit cache + RPCs (P1.3)
-- ─────────────────────────────────────────────────────────────────────
-- Spec sections: C.4 (table) + D.3 (API) + E.1 (algorithm).
--
-- Purpose: a server-side, audited Club Fit value per (owner, player,
-- context). The client's TS chip stays for instant rendering. The
-- cache + RPCs serve three downstream consumers:
--   1. For-you feed (E.3) — server-side ranking by Fit score
--   2. AI Opinion Engine (Section F) — cited_facts ground in cache
--      rows so the opinion text is always paired with a stable
--      "score=0.72, state=green, computed_at=…" reading
--   3. Audit trail — what Fit did this owner see at this time?
--
-- Algorithm matches client lib/clubFit.ts exactly (weights 0.40 /
-- 0.30 / 0.20 / 0.10; thresholds 0.66 / 0.40). Any drift is a bug.
--
-- Cache key = md5(target || '|' || coalesce(region,'') || '|' ||
--   coalesce(opportunity_id::text,'') || '|v1'). The trailing 'v1'
-- bumps when the algorithm changes; doing so invalidates the cache
-- implicitly because the new hash won't match existing rows.
--
-- TTL: rows older than 24h are recomputed at read time. We don't
-- delete stale rows — they're harmless and serve audit value.

BEGIN;

-- ── Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_fit_cache (
  owner_id     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id    UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  context_hash TEXT    NOT NULL,
  score        NUMERIC(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),
  state        TEXT    NOT NULL CHECK (state IN ('green', 'yellow', 'grey')),
  components   JSONB   NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (owner_id, player_id, context_hash)
);

COMMENT ON TABLE public.club_fit_cache IS
  'Server-side Club Fit cache. Mirrors client/src/lib/clubFit.ts E.1 math. 24h TTL on read.';

CREATE INDEX IF NOT EXISTS club_fit_cache_owner_state_idx
  ON public.club_fit_cache (owner_id, state);

CREATE INDEX IF NOT EXISTS club_fit_cache_computed_at_idx
  ON public.club_fit_cache (computed_at);

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.club_fit_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "club_fit_cache_owner_read" ON public.club_fit_cache;
CREATE POLICY "club_fit_cache_owner_read"
  ON public.club_fit_cache FOR SELECT
  USING (auth.uid() = owner_id OR auth.role() = 'service_role');

-- Writes go through the RPCs (security definer-style); direct table
-- writes are blocked. Cache hygiene is the RPC's responsibility.
DROP POLICY IF EXISTS "club_fit_cache_no_direct_write" ON public.club_fit_cache;
CREATE POLICY "club_fit_cache_no_direct_write"
  ON public.club_fit_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.club_fit_cache TO authenticated;
GRANT ALL ON public.club_fit_cache TO service_role;

-- ── Helpers ─────────────────────────────────────────────────────────

-- recency_30d helper: 1.0 within 30d, linear ramp to 0 at 90d, 0 beyond.
-- Mirrors the TS recency30d() in clubFit.ts.
CREATE OR REPLACE FUNCTION public._recency_30d(ts TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  age_days NUMERIC;
BEGIN
  IF ts IS NULL THEN RETURN 0; END IF;
  age_days := EXTRACT(EPOCH FROM (timezone('utc', now()) - ts)) / 86400.0;
  IF age_days <= 30 THEN RETURN 1.0; END IF;
  IF age_days >= 90 THEN RETURN 0; END IF;
  RETURN 1.0 - (age_days - 30) / 60.0;
END;
$$;

-- Resolve a club's gender-appropriate level_band_global. Mirrors
-- getClubLevelBand() in client/src/hooks/useWorldClubLogo.ts.
CREATE OR REPLACE FUNCTION public._club_level_band(
  p_world_club_id UUID,
  p_target TEXT
) RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_world_club_id IS NULL THEN NULL
    WHEN p_target = 'Men' THEN COALESCE(wl_m.level_band_global, wl_w.level_band_global)
    WHEN p_target = 'Women' THEN COALESCE(wl_w.level_band_global, wl_m.level_band_global)
    ELSE COALESCE(wl_w.level_band_global, wl_m.level_band_global)
  END
  FROM public.world_clubs wc
  LEFT JOIN public.world_leagues wl_m ON wl_m.id = wc.men_league_id
  LEFT JOIN public.world_leagues wl_w ON wl_w.id = wc.women_league_id
  WHERE wc.id = p_world_club_id;
$$;

-- Player band — picks by player's own playing_category (not viewer's
-- target). Mirrors the get_top_community_members case expression.
CREATE OR REPLACE FUNCTION public._player_level_band(
  p_world_club_id UUID,
  p_playing_category TEXT
) RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_world_club_id IS NULL THEN NULL
    WHEN p_playing_category IN ('adult_men', 'boys') THEN
      COALESCE(wl_m.level_band_global, wl_w.level_band_global)
    WHEN p_playing_category IN ('adult_women', 'girls') THEN
      COALESCE(wl_w.level_band_global, wl_m.level_band_global)
    ELSE COALESCE(wl_w.level_band_global, wl_m.level_band_global)
  END
  FROM public.world_clubs wc
  LEFT JOIN public.world_leagues wl_m ON wl_m.id = wc.men_league_id
  LEFT JOIN public.world_leagues wl_w ON wl_w.id = wc.women_league_id
  WHERE wc.id = p_world_club_id;
$$;

-- Map a context target_category to the set of player playing_category
-- values that "match". Same semantics as playingCategoriesForTarget().
CREATE OR REPLACE FUNCTION public._target_accepts_category(
  p_target TEXT,
  p_category TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_category IS NULL THEN FALSE
    WHEN p_target = 'Men' THEN p_category IN ('adult_men', 'boys', 'mixed')
    WHEN p_target = 'Women' THEN p_category IN ('adult_women', 'girls', 'mixed')
    WHEN p_target = 'Mixed' THEN p_category IN ('adult_men', 'adult_women', 'boys', 'girls', 'mixed')
    ELSE FALSE
  END;
$$;

-- Build the cache hash for a context. Bump 'v1' when the algorithm
-- changes (implicit cache invalidation).
CREATE OR REPLACE FUNCTION public._club_fit_context_hash(
  p_target TEXT,
  p_region TEXT,
  p_opportunity_id UUID
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_target, '') || '|' ||
    COALESCE(p_region, '') || '|' ||
    COALESCE(p_opportunity_id::TEXT, '') || '|v1'
  );
$$;

-- ── Core compute: returns a single row { score, state, components } ─
-- Edge cases (per P1.3 AC):
--   - Missing competition band on either side → proximity = 0,
--     score capped at "yellow" max (we don't artificially cap; the
--     weights enforce this naturally since a missing 0.40 component
--     can never reach the 0.66 green threshold).
--   - Missing gender → gender_match = 0; same natural cap applies.
--   - Player blocked → caller (the RPC) filters before reaching here.
CREATE OR REPLACE FUNCTION public.compute_club_fit(
  p_owner_id   UUID,
  p_player_id  UUID,
  p_target     TEXT,                -- 'Men' | 'Women' | 'Mixed'
  p_region     TEXT,
  p_opportunity_id UUID
) RETURNS TABLE (
  score      NUMERIC,
  state      TEXT,
  components JSONB
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_player          RECORD;
  v_owner           RECORD;
  v_player_band     INTEGER;
  v_viewer_band     INTEGER;
  v_gender_match    NUMERIC;
  v_proximity       NUMERIC;
  v_availability    NUMERIC;
  v_recency         NUMERIC;
  v_is_open         BOOLEAN;
  v_active_factor   NUMERIC;
  v_score           NUMERIC;
  v_state           TEXT;
  v_band_distance   NUMERIC;
BEGIN
  -- Owner role gate is the caller's responsibility — this fn assumes
  -- the owner is a club/coach. The chip's UI hides for other roles.

  SELECT
    p.playing_category,
    p.current_world_club_id,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.last_active_at
  INTO v_player
  FROM public.profiles p
  WHERE p.id = p_player_id;

  IF NOT FOUND THEN
    -- Player doesn't exist → return zeroed row instead of NULL so the
    -- caller can distinguish "no data" from "low score".
    RETURN QUERY SELECT
      0::NUMERIC,
      'grey'::TEXT,
      jsonb_build_object(
        'gender_match', 0,
        'competition_proximity', 0,
        'availability', 0,
        'recency', 0
      );
    RETURN;
  END IF;

  SELECT current_world_club_id INTO v_owner
  FROM public.profiles
  WHERE id = p_owner_id;

  -- Gender match: 1 if player's category falls in the target's allowed
  -- set, else 0. Null target (no context resolution) → 0.
  v_gender_match := CASE WHEN public._target_accepts_category(p_target, v_player.playing_category) THEN 1 ELSE 0 END;

  -- Competition proximity via curated 1..10 level_band_global.
  v_player_band := public._player_level_band(v_player.current_world_club_id, v_player.playing_category);
  v_viewer_band := public._club_level_band(v_owner.current_world_club_id, p_target);
  IF v_player_band IS NULL OR v_viewer_band IS NULL THEN
    v_proximity := 0;
  ELSE
    v_band_distance := ABS(v_player_band - v_viewer_band);
    v_proximity := GREATEST(0, 1 - v_band_distance / 4.0);
  END IF;

  -- Availability: 0.6 * open_to_X + 0.4 * recency_30d(last_active_at)
  v_is_open := COALESCE(v_player.open_to_play, FALSE)
            OR COALESCE(v_player.open_to_coach, FALSE)
            OR COALESCE(v_player.open_to_opportunities, FALSE);
  v_active_factor := public._recency_30d(v_player.last_active_at);
  v_availability := LEAST(1, GREATEST(0,
    0.6 * (CASE WHEN v_is_open THEN 1 ELSE 0 END) + 0.4 * v_active_factor
  ));

  -- Recency component (10% weight) — uses same last_active_at as
  -- availability since profile_updated_at column isn't populated
  -- consistently yet. Mirrors the TS implementation.
  v_recency := v_active_factor;

  v_score := LEAST(1, GREATEST(0,
    0.40 * v_proximity +
    0.30 * v_gender_match +
    0.20 * v_availability +
    0.10 * v_recency
  ));

  v_state := CASE
    WHEN v_score >= 0.66 THEN 'green'
    WHEN v_score >= 0.40 THEN 'yellow'
    ELSE 'grey'
  END;

  RETURN QUERY SELECT
    v_score,
    v_state,
    jsonb_build_object(
      'gender_match', v_gender_match,
      'competition_proximity', v_proximity,
      'availability', v_availability,
      'recency', v_recency
    );
END;
$$;

-- ── Public RPC: get_club_fit (single player) ────────────────────────
CREATE OR REPLACE FUNCTION public.get_club_fit(
  p_player_id  UUID,
  p_context_id UUID
) RETURNS TABLE (
  score       NUMERIC,
  state       TEXT,
  components  JSONB,
  computed_at TIMESTAMPTZ,
  cache_hit   BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner_id    UUID := auth.uid();
  v_context     RECORD;
  v_hash        TEXT;
  v_cached      RECORD;
  v_fresh_until TIMESTAMPTZ;
  v_player_blocked BOOLEAN;
  v_computed    RECORD;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Resolve context — must be owned by caller. RLS would also gate
  -- this; explicit check gives a clearer error than a silent zero
  -- result.
  SELECT id, target_category, region, opportunity_id
  INTO v_context
  FROM public.recruiting_context
  WHERE id = p_context_id AND owner_id = v_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context % not found or not owned by caller', p_context_id
      USING ERRCODE = '42704';
  END IF;

  -- Visibility EC: blocked players are excluded entirely.
  SELECT COALESCE(is_blocked, FALSE) INTO v_player_blocked
  FROM public.profiles
  WHERE id = p_player_id;
  IF v_player_blocked THEN
    RAISE EXCEPTION 'player not visible' USING ERRCODE = '42704';
  END IF;

  v_hash := public._club_fit_context_hash(
    v_context.target_category,
    v_context.region,
    v_context.opportunity_id
  );

  -- Cache lookup — 24h TTL.
  v_fresh_until := timezone('utc', now()) - INTERVAL '24 hours';
  SELECT cfc.score, cfc.state, cfc.components, cfc.computed_at
  INTO v_cached
  FROM public.club_fit_cache cfc
  WHERE cfc.owner_id = v_owner_id
    AND cfc.player_id = p_player_id
    AND cfc.context_hash = v_hash
    AND cfc.computed_at >= v_fresh_until;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_cached.score, v_cached.state, v_cached.components,
      v_cached.computed_at, TRUE;
    RETURN;
  END IF;

  -- Cache miss — compute fresh.
  SELECT * INTO v_computed
  FROM public.compute_club_fit(
    v_owner_id, p_player_id,
    v_context.target_category, v_context.region, v_context.opportunity_id
  );

  -- Upsert. SECURITY INVOKER means we need the RLS bypass below to
  -- write; we use an inner SECURITY DEFINER fn to do the write.
  PERFORM public._upsert_club_fit_cache(
    v_owner_id, p_player_id, v_hash,
    v_computed.score, v_computed.state, v_computed.components
  );

  RETURN QUERY SELECT
    v_computed.score, v_computed.state, v_computed.components,
    timezone('utc', now()), FALSE;
END;
$$;

-- Internal writer (SECURITY DEFINER bypasses the table-level
-- "no direct write" policy). Called only by the get_club_fit /
-- get_club_fit_batch RPCs.
CREATE OR REPLACE FUNCTION public._upsert_club_fit_cache(
  p_owner_id    UUID,
  p_player_id   UUID,
  p_context_hash TEXT,
  p_score       NUMERIC,
  p_state       TEXT,
  p_components  JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.club_fit_cache (
    owner_id, player_id, context_hash, score, state, components, computed_at
  ) VALUES (
    p_owner_id, p_player_id, p_context_hash,
    p_score, p_state, p_components, timezone('utc', now())
  )
  ON CONFLICT (owner_id, player_id, context_hash) DO UPDATE
    SET score = EXCLUDED.score,
        state = EXCLUDED.state,
        components = EXCLUDED.components,
        computed_at = EXCLUDED.computed_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._upsert_club_fit_cache FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._upsert_club_fit_cache TO authenticated;

-- ── Public RPC: get_club_fit_batch (many players, one context) ──────
-- For-you feed + carousel ranking will use this. Single round-trip
-- instead of N per-player RPCs.
CREATE OR REPLACE FUNCTION public.get_club_fit_batch(
  p_player_ids UUID[],
  p_context_id UUID
) RETURNS TABLE (
  player_id   UUID,
  score       NUMERIC,
  state       TEXT,
  components  JSONB,
  computed_at TIMESTAMPTZ,
  cache_hit   BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner_id    UUID := auth.uid();
  v_context     RECORD;
  v_hash        TEXT;
  v_fresh_until TIMESTAMPTZ;
  v_pid         UUID;
  v_cached      RECORD;
  v_computed    RECORD;
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, target_category, region, opportunity_id
  INTO v_context
  FROM public.recruiting_context
  WHERE id = p_context_id AND owner_id = v_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context % not found or not owned by caller', p_context_id
      USING ERRCODE = '42704';
  END IF;

  v_hash := public._club_fit_context_hash(
    v_context.target_category,
    v_context.region,
    v_context.opportunity_id
  );
  v_fresh_until := timezone('utc', now()) - INTERVAL '24 hours';

  FOREACH v_pid IN ARRAY p_player_ids LOOP
    -- Skip blocked players entirely (visibility EC).
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = v_pid AND COALESCE(is_blocked, FALSE)
    ) THEN
      CONTINUE;
    END IF;

    SELECT cfc.score, cfc.state, cfc.components, cfc.computed_at
    INTO v_cached
    FROM public.club_fit_cache cfc
    WHERE cfc.owner_id = v_owner_id
      AND cfc.player_id = v_pid
      AND cfc.context_hash = v_hash
      AND cfc.computed_at >= v_fresh_until;

    IF FOUND THEN
      player_id := v_pid;
      score := v_cached.score;
      state := v_cached.state;
      components := v_cached.components;
      computed_at := v_cached.computed_at;
      cache_hit := TRUE;
      RETURN NEXT;
    ELSE
      SELECT * INTO v_computed
      FROM public.compute_club_fit(
        v_owner_id, v_pid,
        v_context.target_category, v_context.region, v_context.opportunity_id
      );
      PERFORM public._upsert_club_fit_cache(
        v_owner_id, v_pid, v_hash,
        v_computed.score, v_computed.state, v_computed.components
      );
      player_id := v_pid;
      score := v_computed.score;
      state := v_computed.state;
      components := v_computed.components;
      computed_at := timezone('utc', now());
      cache_hit := FALSE;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_club_fit(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_fit_batch(UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_club_fit(UUID, UUID, TEXT, TEXT, UUID) TO authenticated;

COMMIT;
