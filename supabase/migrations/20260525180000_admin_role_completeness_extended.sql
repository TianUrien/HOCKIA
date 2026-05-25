-- Phase 3B + 3C of the admin audit (2026-05-25):
--   3B: extend admin_get_profile_completeness_distribution so the
--       Coach / Brand / Umpire role tabs can show a histogram, not just
--       Player and Club. Previously the ELSE branch lumped all three
--       under a generic profile-fields formula that ignored brand
--       specifics (logo, website) entirely and gave coaches the same
--       weights as players.
--   3C: NEW admin_get_role_missing_fields(role) — returns the top-N
--       most-commonly-NULL required fields per role so the Users &
--       Roles tabs can show "78% of coaches are missing experience"
--       instead of just a histogram bucket. Identifies the biggest
--       single onboarding lever for each role.

SET search_path = public;

-- ── 1. Profile completeness scoring per role ─────────────────────────────
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
    SELECT
      p.id,
      CASE p_role
        WHEN 'player' THEN (
          CASE WHEN p.nationality IS NOT NULL AND p.base_location IS NOT NULL AND p."position" IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.avatar_url IS NOT NULL THEN 20 ELSE 0 END +
          CASE WHEN p.highlight_video_url IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM career_history WHERE user_id = p.id) THEN 15 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM gallery_photos WHERE user_id = p.id) THEN 15 ELSE 0 END
        )
        WHEN 'club' THEN (
          CASE WHEN p.nationality IS NOT NULL AND p.base_location IS NOT NULL AND p.year_founded IS NOT NULL THEN 35 ELSE 0 END +
          CASE WHEN p.avatar_url IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.club_bio IS NOT NULL AND LENGTH(p.club_bio) > 20 THEN 20 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM club_media WHERE club_id = p.id) THEN 20 ELSE 0 END
        )
        WHEN 'coach' THEN (
          -- Coaches don't have video highlights or galleries — replace
          -- those weights with bio + career history depth.
          CASE WHEN p.nationality IS NOT NULL AND p.base_location IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.avatar_url IS NOT NULL THEN 20 ELSE 0 END +
          CASE WHEN p.bio IS NOT NULL AND LENGTH(p.bio) > 20 THEN 25 ELSE 0 END +
          CASE WHEN EXISTS (SELECT 1 FROM career_history WHERE user_id = p.id) THEN 30 ELSE 0 END
        )
        WHEN 'umpire' THEN (
          -- Umpire signal centres on certification level + identity.
          CASE WHEN p.nationality IS NOT NULL AND p.base_location IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.avatar_url IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.umpire_level IS NOT NULL THEN 25 ELSE 0 END +
          CASE WHEN p.bio IS NOT NULL AND LENGTH(p.bio) > 20 THEN 25 ELSE 0 END
        )
        WHEN 'brand' THEN (
          -- Brand completeness lives on the brands row, not the profile.
          -- LEFT JOIN so users with role=brand but no brand row yet
          -- (mid-onboarding) score 0 — that's the right signal.
          COALESCE(
            (SELECT
              CASE WHEN b.country_id IS NOT NULL AND b.category IS NOT NULL THEN 20 ELSE 0 END +
              CASE WHEN b.logo_url IS NOT NULL THEN 25 ELSE 0 END +
              CASE WHEN b.bio IS NOT NULL AND LENGTH(b.bio) > 20 THEN 25 ELSE 0 END +
              CASE WHEN b.website_url IS NOT NULL OR b.instagram_url IS NOT NULL THEN 30 ELSE 0 END
             FROM brands b
             WHERE b.profile_id = p.id AND b.deleted_at IS NULL
             LIMIT 1),
            0
          )
        )
        ELSE 0  -- unknown role: don't pretend to score
      END as score
    FROM profiles p
    WHERE p.role = p_role AND NOT p.is_test_account
  )
  SELECT
    bucketed.bucket,
    bucketed.cnt,
    ROUND(bucketed.cnt::NUMERIC / NULLIF(v_total, 0) * 100, 1)
  FROM (
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
  ) bucketed
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

-- ── 2. Per-role missing-field breakdown ─────────────────────────────────
-- Returns one row per important field for the role, with how many users
-- in that role have it NULL/empty and what % of role users that is.
-- Sorted by null_pct DESC so the worst-filled fields surface first.
CREATE OR REPLACE FUNCTION public.admin_get_role_missing_fields(
  p_role text
)
RETURNS TABLE (
  field_name text,
  null_count bigint,
  total_role_users bigint,
  null_pct numeric
)
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

  IF v_total = 0 THEN
    RETURN;  -- no users in role → empty result, not an error
  END IF;

  -- One UNION ALL per (role, field) combination. Easier to read than a
  -- generic loop over a field list, and PG can statically plan each
  -- COUNT. Cost is a few seq scans of profiles per call — fine at
  -- HOCKIA's scale (~1k profiles).
  RETURN QUERY
  WITH role_users AS (
    SELECT id FROM profiles WHERE role = p_role AND NOT is_test_account
  ),
  missing AS (
    SELECT 'Avatar' AS field_name,
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND avatar_url IS NULL) AS null_count
    UNION ALL
    SELECT 'Nationality',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND nationality IS NULL)
    UNION ALL
    SELECT 'Base location',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND base_location IS NULL)
    UNION ALL
    -- Player-specific fields
    SELECT 'Position',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role = 'player' AND "position" IS NULL)
    WHERE p_role = 'player'
    UNION ALL
    SELECT 'Highlight video',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role = 'player' AND highlight_video_url IS NULL)
    WHERE p_role = 'player'
    UNION ALL
    SELECT 'Career history entries',
      (SELECT COUNT(*) FROM role_users ru WHERE NOT EXISTS (SELECT 1 FROM career_history WHERE user_id = ru.id))
    WHERE p_role IN ('player', 'coach')
    UNION ALL
    SELECT 'Gallery photos',
      (SELECT COUNT(*) FROM role_users ru WHERE NOT EXISTS (SELECT 1 FROM gallery_photos WHERE user_id = ru.id))
    WHERE p_role = 'player'
    UNION ALL
    -- Coach / umpire bio
    SELECT 'Bio',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role IN ('coach', 'umpire') AND (bio IS NULL OR LENGTH(bio) <= 20))
    WHERE p_role IN ('coach', 'umpire')
    UNION ALL
    -- Umpire-specific
    SELECT 'Umpire level',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role = 'umpire' AND umpire_level IS NULL)
    WHERE p_role = 'umpire'
    UNION ALL
    -- Club-specific
    SELECT 'Year founded',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role = 'club' AND year_founded IS NULL)
    WHERE p_role = 'club'
    UNION ALL
    SELECT 'Club bio',
      (SELECT COUNT(*) FROM profiles WHERE role = p_role AND NOT is_test_account AND p_role = 'club' AND (club_bio IS NULL OR LENGTH(club_bio) <= 20))
    WHERE p_role = 'club'
    UNION ALL
    SELECT 'Club media',
      (SELECT COUNT(*) FROM role_users ru WHERE NOT EXISTS (SELECT 1 FROM club_media WHERE club_id = ru.id))
    WHERE p_role = 'club'
    UNION ALL
    -- Brand-specific (queries brands table, joined via profile_id).
    -- A profile with role=brand but NO brand row counts as "missing"
    -- for every brand field — that's the right signal during mid-
    -- onboarding when the brand row hasn't been created yet.
    SELECT 'Brand logo',
      (SELECT COUNT(*) FROM role_users ru
       WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.profile_id = ru.id AND b.deleted_at IS NULL AND b.logo_url IS NOT NULL))
    WHERE p_role = 'brand'
    UNION ALL
    SELECT 'Brand bio',
      (SELECT COUNT(*) FROM role_users ru
       WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.profile_id = ru.id AND b.deleted_at IS NULL AND b.bio IS NOT NULL AND LENGTH(b.bio) > 20))
    WHERE p_role = 'brand'
    UNION ALL
    SELECT 'Brand country',
      (SELECT COUNT(*) FROM role_users ru
       WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.profile_id = ru.id AND b.deleted_at IS NULL AND b.country_id IS NOT NULL))
    WHERE p_role = 'brand'
    UNION ALL
    SELECT 'Brand website or Instagram',
      (SELECT COUNT(*) FROM role_users ru
       WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.profile_id = ru.id AND b.deleted_at IS NULL AND (b.website_url IS NOT NULL OR b.instagram_url IS NOT NULL)))
    WHERE p_role = 'brand'
  )
  SELECT
    m.field_name,
    m.null_count,
    v_total AS total_role_users,
    ROUND(m.null_count::NUMERIC / v_total * 100, 1) AS null_pct
  FROM missing m
  WHERE m.null_count > 0  -- skip 100%-filled fields, they're not "missing"
  ORDER BY m.null_count DESC, m.field_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_role_missing_fields(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
