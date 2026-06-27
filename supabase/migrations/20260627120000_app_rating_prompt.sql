-- App rating prompt — Slice 1 (internal 1-5 star prompt for engaged users).
-- STAGING FIRST. Two tables + the decision/record RPCs. No App Store routing.
-- Eligibility: onboarding_completed AND >=7 distinct active days (user_engagement_daily).
-- Backoff: dismissed -> +10 active days before re-show; cap at 3 dismissals -> stop.
-- Rated once -> never ask again. Never more than once/day.

-- ── app_ratings: one immutable row per submitted rating ──────────────────────
CREATE TABLE IF NOT EXISTS public.app_ratings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating_value          smallint NOT NULL CHECK (rating_value BETWEEN 1 AND 5),
  feedback_text         text CHECK (feedback_text IS NULL OR length(feedback_text) <= 500),
  user_role             text,        -- denormalized at submit (segment without a join)
  country_id            integer,     -- profiles.nationality_country_id|base_country_id; admin LEFT JOINs countries
  platform              text,        -- ios-native | android-native | pwa | web
  app_version           text,
  build_number          text,
  environment           text,        -- production | staging | development
  prompt_trigger_reason text,
  submitted_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at            timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_app_ratings_submitted ON public.app_ratings (submitted_at);
CREATE INDEX IF NOT EXISTS idx_app_ratings_user ON public.app_ratings (user_id);

ALTER TABLE public.app_ratings ENABLE ROW LEVEL SECURITY;
-- A user may read their own rating; admin reads all via SECURITY DEFINER RPCs (Slice 2).
DROP POLICY IF EXISTS "user reads own app rating" ON public.app_ratings;
CREATE POLICY "user reads own app rating" ON public.app_ratings FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
-- Writes ONLY through submit_app_rating() (SECURITY DEFINER) — no direct Data-API writes.
REVOKE INSERT, UPDATE, DELETE ON public.app_ratings FROM anon, authenticated;

-- ── app_rating_prompt_state: per-user prompt lifecycle (drives the decision) ──
CREATE TABLE IF NOT EXISTS public.app_rating_prompt_state (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  shown_count       integer NOT NULL DEFAULT 0,
  last_shown_at     timestamptz,
  dismissed_count   integer NOT NULL DEFAULT 0,
  last_dismissed_at timestamptz,
  rated             boolean NOT NULL DEFAULT false,
  rated_at          timestamptz,
  rating_id         uuid REFERENCES public.app_ratings(id) ON DELETE SET NULL,
  do_not_ask        boolean NOT NULL DEFAULT false,  -- set when capped (3 dismissals) or rated
  updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.app_rating_prompt_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user reads own prompt state" ON public.app_rating_prompt_state;
CREATE POLICY "user reads own prompt state" ON public.app_rating_prompt_state FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.app_rating_prompt_state FROM anon, authenticated;

-- ── Decision: should we show the prompt to the CURRENT user right now? ────────
CREATE OR REPLACE FUNCTION public.should_show_app_rating_prompt()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_onboarded boolean;
  v_active    int;
  v_since     int;
  v_state     public.app_rating_prompt_state%ROWTYPE;
  v_today     date := (timezone('utc', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('show', false, 'reason', 'no_user');
  END IF;

  SELECT onboarding_completed INTO v_onboarded FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_onboarded, false) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'not_onboarded');
  END IF;

  SELECT * INTO v_state FROM public.app_rating_prompt_state WHERE user_id = v_uid;
  IF v_state.rated THEN
    RETURN jsonb_build_object('show', false, 'reason', 'already_rated');
  END IF;
  IF COALESCE(v_state.do_not_ask, false) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'capped');
  END IF;
  IF v_state.last_shown_at IS NOT NULL AND v_state.last_shown_at::date = v_today THEN
    RETURN jsonb_build_object('show', false, 'reason', 'shown_today');
  END IF;

  -- Engagement gate: >= 7 distinct active days.
  SELECT COUNT(DISTINCT date) INTO v_active FROM public.user_engagement_daily WHERE user_id = v_uid;
  IF v_active < 7 THEN
    RETURN jsonb_build_object('show', false, 'reason', 'insufficient_active_days', 'active_days', v_active);
  END IF;

  -- Backoff: after a dismissal, require +10 active days before re-showing.
  IF v_state.last_dismissed_at IS NOT NULL THEN
    SELECT COUNT(DISTINCT date) INTO v_since
    FROM public.user_engagement_daily
    WHERE user_id = v_uid AND date > v_state.last_dismissed_at::date;
    IF v_since < 10 THEN
      RETURN jsonb_build_object('show', false, 'reason', 'backoff', 'active_days_since_dismiss', v_since);
    END IF;
  END IF;

  RETURN jsonb_build_object('show', true, 'reason', 'eligible', 'active_days', v_active,
                            'trigger', 'onboarded_7_active_days');
END;
$$;
GRANT EXECUTE ON FUNCTION public.should_show_app_rating_prompt() TO authenticated;

-- ── Record SHOWN ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_app_rating_prompt_shown()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.app_rating_prompt_state (user_id, shown_count, last_shown_at, updated_at)
  VALUES (auth.uid(), 1, timezone('utc', now()), timezone('utc', now()))
  ON CONFLICT (user_id) DO UPDATE
    SET shown_count = public.app_rating_prompt_state.shown_count + 1,
        last_shown_at = timezone('utc', now()),
        updated_at = timezone('utc', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_app_rating_prompt_shown() TO authenticated;

-- ── Record DISMISSAL (cap at 3 -> do_not_ask) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_app_rating_prompt_dismissed()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.app_rating_prompt_state (user_id, dismissed_count, last_dismissed_at, updated_at)
  VALUES (auth.uid(), 1, timezone('utc', now()), timezone('utc', now()))
  ON CONFLICT (user_id) DO UPDATE
    SET dismissed_count = public.app_rating_prompt_state.dismissed_count + 1,
        last_dismissed_at = timezone('utc', now()),
        do_not_ask = (public.app_rating_prompt_state.dismissed_count + 1 >= 3),
        updated_at = timezone('utc', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_app_rating_prompt_dismissed() TO authenticated;

-- ── Submit a rating -> insert + mark rated (never ask again) ─────────────────
CREATE OR REPLACE FUNCTION public.submit_app_rating(
  p_rating_value  smallint,
  p_feedback_text text DEFAULT NULL,
  p_platform      text DEFAULT NULL,
  p_app_version   text DEFAULT NULL,
  p_build_number  text DEFAULT NULL,
  p_environment   text DEFAULT NULL,
  p_trigger_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_country int;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_rating_value IS NULL OR p_rating_value < 1 OR p_rating_value > 5 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  SELECT role, COALESCE(nationality_country_id, base_country_id)
    INTO v_role, v_country FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.app_ratings
    (user_id, rating_value, feedback_text, user_role, country_id, platform, app_version, build_number, environment, prompt_trigger_reason)
  VALUES
    (v_uid, p_rating_value, NULLIF(btrim(COALESCE(p_feedback_text, '')), ''), v_role, v_country,
     p_platform, p_app_version, p_build_number, p_environment, p_trigger_reason)
  RETURNING id INTO v_id;

  INSERT INTO public.app_rating_prompt_state (user_id, rated, rated_at, rating_id, do_not_ask, updated_at)
  VALUES (v_uid, true, timezone('utc', now()), v_id, true, timezone('utc', now()))
  ON CONFLICT (user_id) DO UPDATE
    SET rated = true, rated_at = timezone('utc', now()), rating_id = v_id, do_not_ask = true,
        updated_at = timezone('utc', now());

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_app_rating(smallint, text, text, text, text, text, text) TO authenticated;
