-- App rating — audit hardening. STAGING FIRST.
-- Enforce ONE rating per user (was only client-side): a unique constraint + an
-- idempotent, race-safe submit_app_rating. Fixes the audit's data-integrity +
-- concurrent-double-submit findings.

-- Defensive dedup (no-op when already clean): keep the latest rating per user.
DELETE FROM public.app_ratings
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY submitted_at DESC, id DESC) AS rn
    FROM public.app_ratings
  ) t WHERE t.rn > 1
);

-- One immutable rating per user, DB-enforced (also closes the TOCTOU race).
ALTER TABLE public.app_ratings DROP CONSTRAINT IF EXISTS app_ratings_user_id_key;
ALTER TABLE public.app_ratings ADD CONSTRAINT app_ratings_user_id_key UNIQUE (user_id);
-- The plain index is now redundant with the unique index.
DROP INDEX IF EXISTS public.idx_app_ratings_user;

-- Idempotent + race-safe submit: never a 2nd row; repeat/concurrent calls return
-- the existing rating id.
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
  v_uid      uuid := auth.uid();
  v_role     text;
  v_country  int;
  v_id       uuid;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_rating_value IS NULL OR p_rating_value < 1 OR p_rating_value > 5 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  -- One rating per user, ever — return the existing one rather than inserting again.
  SELECT id INTO v_existing FROM public.app_ratings WHERE user_id = v_uid LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT role, COALESCE(nationality_country_id, base_country_id)
    INTO v_role, v_country FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.app_ratings
    (user_id, rating_value, feedback_text, user_role, country_id, platform, app_version, build_number, environment, prompt_trigger_reason)
  VALUES
    (v_uid, p_rating_value, NULLIF(btrim(COALESCE(p_feedback_text, '')), ''), v_role, v_country,
     p_platform, p_app_version, p_build_number, p_environment, p_trigger_reason)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO v_id;

  -- Lost a concurrent race — fetch the row the other call inserted.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.app_ratings WHERE user_id = v_uid LIMIT 1;
  END IF;

  INSERT INTO public.app_rating_prompt_state (user_id, rated, rated_at, rating_id, do_not_ask, updated_at)
  VALUES (v_uid, true, timezone('utc', now()), v_id, true, timezone('utc', now()))
  ON CONFLICT (user_id) DO UPDATE
    SET rated = true, rated_at = timezone('utc', now()), rating_id = v_id, do_not_ask = true,
        updated_at = timezone('utc', now());

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_app_rating(smallint, text, text, text, text, text, text) TO authenticated;
