-- ============================================================================
-- Phase 2 (2d) — ONE canonical profile-completeness definition
-- ============================================================================
-- Before this migration there were FOUR divergent completeness formulas:
--   1. compute_profile_completeness_pct (SQL trigger) — the DISPLAYED pct +
--      ranking. profiles-row only; brand read the WRONG store (profiles cols,
--      not the brands table) so a fully-built brand scored ~0.
--   2. admin_get_profile_completeness_distribution — a SECOND SQL formula.
--   3. estimateMemberStrength (client) — normalized on /90,/80,/70 bases.
--   4. the 5 owner-dashboard hooks — richer (gallery/media/products), /100-110.
--
-- This unifies the SQL source of truth (#1) and repoints the admin histogram
-- (#2) onto it. The client estimator/preview (#3) is repointed to read the
-- server pct separately (client change). The owner hooks (#4) are a follow-up.
--
-- To let the canonical formula reward gallery/media (player/coach/club/umpire)
-- and the brand's real identity + ambassadors (which a BEFORE-trigger on
-- profiles can't see), we denormalise two media counts onto profiles and read
-- the brands table for the brand branch, with maintenance triggers so an edit
-- anywhere recomputes the pct.
--
-- ⚠️ Backfill re-scores EVERY profile → re-orders /community + discover. This
-- is a deliberate, one-time ranking change.

-- ── 1. Denormalised media counts (trigger-maintained; clients never write) ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gallery_photo_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS club_media_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.gallery_photo_count IS
  'Denormalised count of gallery_photos for this profile (player/coach/umpire media). Trigger-maintained; feeds completeness.';
COMMENT ON COLUMN public.profiles.club_media_count IS
  'Denormalised count of club_media for this club profile. Trigger-maintained; feeds completeness.';

-- Public read (mirrors the other denormalised count columns,
-- 20260518100000). NOT added to the client write whitelist — these are
-- trigger-only, like accepted_friend_count etc.
GRANT SELECT (gallery_photo_count, club_media_count) ON public.profiles TO anon, authenticated;

-- ── 2. Canonical per-role formula (each role sums to 100) ───────────────────
-- Reads the profiles row (incl. the denormalised counts) PLUS the brands table
-- for the brand branch. STABLE so the brands subquery is allowed.
CREATE OR REPLACE FUNCTION public.compute_profile_completeness_pct(p public.profiles)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_score INTEGER := 0;
  b RECORD;
BEGIN
  IF p.role IS NULL THEN
    RETURN 0;
  END IF;

  IF p.role = 'player' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.position IS NOT NULL AND length(btrim(p.position)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.highlight_video_url IS NOT NULL AND length(btrim(p.highlight_video_url)) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.full_game_video_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.open_to_play = TRUE THEN v_score := v_score + 5; END IF;

  ELSIF p.role = 'coach' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.coaching_categories IS NOT NULL AND array_length(p.coaching_categories, 1) > 0)
       OR (p.coach_specialization IS NOT NULL AND length(btrim(p.coach_specialization)) > 0) THEN v_score := v_score + 10; END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.open_to_coach = TRUE THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'club' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 15; END IF;
    IF (p.club_bio IS NOT NULL AND length(btrim(p.club_bio)) > 0)
       OR (p.bio IS NOT NULL AND length(btrim(p.bio)) > 0) THEN v_score := v_score + 20; END IF;
    IF p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.nationality_country_id IS NOT NULL THEN v_score := v_score + 5; END IF;
    IF p.year_founded IS NOT NULL THEN v_score := v_score + 10; END IF;
    IF (p.contact_email IS NOT NULL AND length(btrim(p.contact_email)) > 0 AND p.contact_email_public = TRUE)
       OR (p.website IS NOT NULL AND length(btrim(p.website)) > 0) THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.club_media_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.post_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;

  ELSIF p.role = 'umpire' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.umpire_level IS NOT NULL AND length(btrim(p.umpire_level)) > 0)
       OR (p.umpiring_categories IS NOT NULL AND array_length(p.umpiring_categories, 1) > 0) THEN v_score := v_score + 10; END IF;
    IF p.federation IS NOT NULL AND length(btrim(p.federation)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.officiating_specialization IS NOT NULL AND length(btrim(p.officiating_specialization)) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.available_for_appointments = TRUE THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.umpire_appointment_count, 0) > 0 THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'brand' THEN
    -- Brand identity lives in the brands table (the brand owner edits it
    -- there), NOT on profiles. Read the active brand row.
    -- Only real brands columns (product_count lives in a view, not the table).
    SELECT br.logo_url, br.bio, br.website_url, br.instagram_url, br.country_id,
           COALESCE(br.ambassador_count, 0) AS ambassador_count
      INTO b
      FROM public.brands br
      WHERE br.profile_id = p.id AND br.deleted_at IS NULL
      LIMIT 1;
    IF FOUND THEN
      IF b.logo_url IS NOT NULL AND length(btrim(b.logo_url)) > 0 THEN v_score := v_score + 20; END IF;
      IF b.bio IS NOT NULL AND length(btrim(b.bio)) > 0 THEN v_score := v_score + 20; END IF;
      IF (b.website_url IS NOT NULL AND length(btrim(b.website_url)) > 0)
         OR (b.instagram_url IS NOT NULL AND length(btrim(b.instagram_url)) > 0) THEN v_score := v_score + 20; END IF;
      IF b.country_id IS NOT NULL THEN v_score := v_score + 20; END IF;
      IF b.ambassador_count > 0 THEN v_score := v_score + 20; END IF;
    END IF;
  END IF;

  IF v_score < 0 THEN v_score := 0; END IF;
  IF v_score > 100 THEN v_score := 100; END IF;
  RETURN v_score;
END;
$$;

COMMENT ON FUNCTION public.compute_profile_completeness_pct(public.profiles) IS
  'Canonical per-role completeness (0-100). Reads the profiles row (incl. denormalised gallery_photo_count/club_media_count) and, for brand, the brands table. Maintenance triggers below recompute when any input changes.';

-- ── 3. Maintenance: recount gallery_photos → profiles.gallery_photo_count ────
-- The recount UPDATE on profiles fires the BEFORE trigger → recomputes the pct.
CREATE OR REPLACE FUNCTION public.sync_gallery_photo_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user UUID := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE public.profiles
    SET gallery_photo_count = (SELECT count(*) FROM public.gallery_photos WHERE user_id = v_user)
    WHERE id = v_user;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gallery_photos_sync_count ON public.gallery_photos;
CREATE TRIGGER trg_gallery_photos_sync_count
  AFTER INSERT OR DELETE ON public.gallery_photos
  FOR EACH ROW EXECUTE FUNCTION public.sync_gallery_photo_count();

-- ── 4. Maintenance: recount club_media → profiles.club_media_count ──────────
CREATE OR REPLACE FUNCTION public.sync_club_media_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_club UUID := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE public.profiles
    SET club_media_count = (SELECT count(*) FROM public.club_media WHERE club_id = v_club)
    WHERE id = v_club;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_media_sync_count ON public.club_media;
CREATE TRIGGER trg_club_media_sync_count
  AFTER INSERT OR DELETE ON public.club_media
  FOR EACH ROW EXECUTE FUNCTION public.sync_club_media_count();

-- ── 5. Maintenance: a brands edit must recompute the brand's profile pct ────
-- (the BEFORE-trigger on profiles doesn't fire on brands writes). Re-touch the
-- profile row → its BEFORE trigger recomputes from the now-current brands row.
CREATE OR REPLACE FUNCTION public.sync_brand_profile_completeness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile UUID := COALESCE(NEW.profile_id, OLD.profile_id);
BEGIN
  UPDATE public.profiles
    SET profile_completeness_pct = public.compute_profile_completeness_pct(profiles.*)
    WHERE id = v_profile;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_sync_profile_completeness ON public.brands;
CREATE TRIGGER trg_brands_sync_profile_completeness
  AFTER INSERT OR UPDATE OR DELETE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.sync_brand_profile_completeness();

-- ── 6. Repoint the admin histogram onto the canonical function ──────────────
-- Was a SECOND, duplicate per-role CASE formula; now reads the one source of
-- truth. Same signature + admin guard preserved (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.admin_get_profile_completeness_distribution(
  p_role text DEFAULT 'player'
)
RETURNS TABLE (bucket text, count bigint, percentage numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM profiles
  WHERE role = p_role AND NOT is_test_account;

  RETURN QUERY
  WITH scores AS (
    SELECT public.compute_profile_completeness_pct(p.*) AS score
    FROM profiles p
    WHERE p.role = p_role AND NOT p.is_test_account
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN score <= 25 THEN '0-25%'
        WHEN score <= 50 THEN '26-50%'
        WHEN score <= 75 THEN '51-75%'
        ELSE '76-100%'
      END as bucket,
      COUNT(*) as cnt
    FROM scores
    GROUP BY 1
  )
  SELECT
    bucketed.bucket,
    bucketed.cnt,
    ROUND(bucketed.cnt::NUMERIC / NULLIF(v_total, 0) * 100, 1)
  FROM bucketed
  ORDER BY
    CASE bucketed.bucket
      WHEN '0-25%' THEN 1
      WHEN '26-50%' THEN 2
      WHEN '51-75%' THEN 3
      WHEN '76-100%' THEN 4
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_profile_completeness_distribution(text) TO authenticated;

-- ── 7. Backfill the new counts, then re-score every profile ─────────────────
UPDATE public.profiles p
  SET gallery_photo_count = COALESCE((SELECT count(*) FROM public.gallery_photos g WHERE g.user_id = p.id), 0);
UPDATE public.profiles p
  SET club_media_count = COALESCE((SELECT count(*) FROM public.club_media cm WHERE cm.club_id = p.id), 0);

-- Re-score with the canonical formula (the count backfills above already
-- fired the BEFORE trigger, but brand rows depend on the brands table, so
-- one explicit pass guarantees every role is current).
UPDATE public.profiles
  SET profile_completeness_pct = public.compute_profile_completeness_pct(profiles.*);
