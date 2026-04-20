-- Expand brand category taxonomy
--
-- Adds three new top-level categories to better segment the brand ecosystem:
--   * coaching   — academies, camps, clinics, S&C coaches, mental performance
--   * recruiting — college recruiting agencies, exposure/scouting platforms
--   * media      — podcasts, publications, content creators
--
-- "services" is kept but its intended scope narrows to operational services
-- (stringing, umpiring, tournament organizers). Existing brands tagged
-- "services" that are really coaching/recruiting/media brands should be
-- reclassified manually after this migration lands.
--
-- Three surfaces need to move in lockstep:
--   1. The CHECK constraint on brands.category
--   2. The whitelist inside create_brand
--   3. The whitelist inside update_brand
--
-- The client-side dropdown, filter pills, and label maps are updated in the
-- same PR as this migration.

SET search_path = public;

BEGIN;

-- ============================================================================
-- 1. Expand the CHECK constraint
-- ============================================================================
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS valid_category;

ALTER TABLE public.brands
  ADD CONSTRAINT valid_category CHECK (category IN (
    'equipment',
    'apparel',
    'accessories',
    'nutrition',
    'services',
    'technology',
    'coaching',
    'recruiting',
    'media',
    'other'
  ));

COMMENT ON COLUMN public.brands.category IS
  'Brand category: equipment, apparel, accessories, nutrition, services, technology, coaching, recruiting, media, or other';

-- ============================================================================
-- 2. create_brand — refresh whitelist (preserves atomic onboarding behavior
--    from 202604180200_create_brand_atomic_onboarding.sql)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_brand(
  p_name TEXT,
  p_slug TEXT,
  p_category TEXT,
  p_bio TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_instagram_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id UUID;
  v_profile_role TEXT;
  v_brand_id UUID;
  v_clean_slug TEXT;
BEGIN
  SELECT id, role INTO v_profile_id, v_profile_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_profile_role != 'brand' THEN
    RAISE EXCEPTION 'Only brand accounts can create a brand profile';
  END IF;

  IF EXISTS (SELECT 1 FROM public.brands WHERE profile_id = v_profile_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Brand already exists for this account';
  END IF;

  v_clean_slug := lower(trim(p_slug));

  IF v_clean_slug IS NULL OR v_clean_slug = '' THEN
    RAISE EXCEPTION 'Slug is required';
  END IF;

  IF NOT (v_clean_slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR v_clean_slug ~ '^[a-z0-9]$') THEN
    RAISE EXCEPTION 'Invalid slug format. Use lowercase letters, numbers, and hyphens only.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.brands WHERE slug = v_clean_slug) THEN
    RAISE EXCEPTION 'Brand slug already taken';
  END IF;

  IF p_category NOT IN (
    'equipment', 'apparel', 'accessories', 'nutrition', 'services',
    'technology', 'coaching', 'recruiting', 'media', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  INSERT INTO public.brands (
    profile_id,
    name,
    slug,
    category,
    bio,
    logo_url,
    website_url,
    instagram_url
  )
  VALUES (
    v_profile_id,
    trim(p_name),
    v_clean_slug,
    p_category,
    nullif(trim(p_bio), ''),
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_website_url), ''),
    nullif(trim(p_instagram_url), '')
  )
  RETURNING id INTO v_brand_id;

  UPDATE public.profiles
  SET onboarding_completed = true
  WHERE id = v_profile_id;

  RETURN json_build_object(
    'success', true,
    'brand_id', v_brand_id,
    'slug', v_clean_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 3. update_brand — refresh whitelist
-- ============================================================================
-- Signature must match the current definition from
-- 202603230200_remove_cover_letter_and_cover_url.sql (cover_url column dropped
-- there). Adding p_cover_url back here would create a second overload and
-- reference a non-existent column.
CREATE OR REPLACE FUNCTION public.update_brand(
  p_name TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_instagram_url TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id UUID;
BEGIN
  SELECT id INTO v_brand_id
  FROM public.brands
  WHERE profile_id = auth.uid()
    AND deleted_at IS NULL;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN (
    'equipment', 'apparel', 'accessories', 'nutrition', 'services',
    'technology', 'coaching', 'recruiting', 'media', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  UPDATE public.brands
  SET
    name = COALESCE(nullif(trim(p_name), ''), name),
    bio = CASE WHEN p_bio IS NOT NULL THEN nullif(trim(p_bio), '') ELSE bio END,
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN nullif(trim(p_logo_url), '') ELSE logo_url END,
    website_url = CASE WHEN p_website_url IS NOT NULL THEN nullif(trim(p_website_url), '') ELSE website_url END,
    instagram_url = CASE WHEN p_instagram_url IS NOT NULL THEN nullif(trim(p_instagram_url), '') ELSE instagram_url END,
    category = COALESCE(p_category, category)
  WHERE id = v_brand_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
