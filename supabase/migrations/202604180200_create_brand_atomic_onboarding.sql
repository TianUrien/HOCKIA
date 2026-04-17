-- Atomic brand onboarding: fold `onboarding_completed = true` into `create_brand`
--
-- Before this migration, the client called `create_brand` and then separately
-- updated `profiles.onboarding_completed = true`. If the tab closed or the
-- network dropped between those two calls, the user was left with a brand row
-- but a `false` onboarding flag, and the BrandOnboardingPage redirect logic
-- made the state unrecoverable (it always sends users with a brand back to
-- /brands/:slug, and `create_brand` refuses to run twice for the same profile).
--
-- Folding the flip into the RPC body puts both writes inside the same
-- implicit transaction, so either both land or neither does.

SET search_path = public;

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

  IF p_category NOT IN ('equipment', 'apparel', 'accessories', 'nutrition', 'services', 'technology', 'other') THEN
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

  -- Mark onboarding complete atomically with the brand insert.
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

NOTIFY pgrst, 'reload schema';
