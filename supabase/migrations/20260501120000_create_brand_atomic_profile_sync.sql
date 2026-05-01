-- ============================================================================
-- create_brand — fold profile identity sync into the same transaction
-- ============================================================================
-- The atomic-onboarding migration (202604180200) put `onboarding_completed`
-- inside the create_brand RPC. But the brand identity itself
-- (profiles.full_name + profiles.avatar_url, mirrored from the brand row
-- so the user shows up correctly in Community / Messages / Header) is still
-- written by the CLIENT in a separate UPDATE after the RPC succeeds. If the
-- network drops between those two writes the user lands in a half-state:
--
--   - brand row exists, brand.onboarding_completed = true
--   - profile.full_name = previous OAuth display name, profile.avatar_url = null
--   - subsequent loads show the user with the wrong name / no avatar across
--     the whole app, and BrandOnboardingPage redirects them to /brands/:slug
--     before they get a chance to retry the sync
--
-- Fix: drop and re-create create_brand with two new optional params
-- (p_profile_full_name, p_profile_avatar_url). The same UPDATE that flips
-- onboarding_completed = true also writes those fields when supplied.
-- Client side then removes the post-RPC profile.update calls (separate
-- commits in this batch).
--
-- DROP + CREATE is required because Postgres `CREATE OR REPLACE FUNCTION`
-- cannot change the argument list. New params are appended at the end with
-- DEFAULT NULL so the order of existing args is preserved.
-- ============================================================================

SET search_path = public;

DROP FUNCTION IF EXISTS public.create_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_brand(
  p_name TEXT,
  p_slug TEXT,
  p_category TEXT,
  p_bio TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_instagram_url TEXT DEFAULT NULL,
  -- New optional params — when supplied, written to profiles in the same txn
  -- so brand-identity-on-profile is never split-brain with the brand row.
  p_profile_full_name TEXT DEFAULT NULL,
  p_profile_avatar_url TEXT DEFAULT NULL
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

  -- Atomic profile sync: identity (full_name + avatar_url) AND
  -- onboarding_completed flip together. COALESCE keeps existing values
  -- when the new params are NULL, so callers that haven't been updated
  -- yet still get the original onboarding-flip behaviour.
  UPDATE public.profiles
  SET
    full_name = COALESCE(nullif(trim(p_profile_full_name), ''), full_name),
    avatar_url = COALESCE(nullif(trim(p_profile_avatar_url), ''), avatar_url),
    onboarding_completed = true
  WHERE id = v_profile_id;

  RETURN json_build_object(
    'success', true,
    'brand_id', v_brand_id,
    'slug', v_clean_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  '2026-05-01: brand creation + profile identity sync + onboarding completion all in one transaction. Replaces the previous 7-arg signature.';

-- ─── Companion: pre-flight slug-availability check ───────────────────────
-- New helper RPC the client can call WITHOUT being a brand role yet (e.g.
-- a brand user typing in BrandForm) to surface "slug already taken" inline
-- BEFORE submit. Returns a simple boolean — keeps the create_brand RPC
-- itself authoritative; this is just for UX.
--
-- SECURITY DEFINER + GRANT to authenticated only. Reading the brands.slug
-- index is otherwise gated by RLS; this exposes only existence, not
-- contents, of the row.

CREATE OR REPLACE FUNCTION public.check_brand_slug_available(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_clean_slug TEXT;
BEGIN
  v_clean_slug := lower(trim(p_slug));

  IF v_clean_slug IS NULL OR v_clean_slug = '' THEN
    RETURN false;
  END IF;

  -- Same format gate as create_brand — pretend "invalid" is "taken" so the
  -- caller doesn't need to duplicate the regex on the client.
  IF NOT (v_clean_slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR v_clean_slug ~ '^[a-z0-9]$') THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (SELECT 1 FROM public.brands WHERE slug = v_clean_slug);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_brand_slug_available(TEXT) TO authenticated;

COMMENT ON FUNCTION public.check_brand_slug_available(TEXT) IS
  '2026-05-01: client-side pre-flight to surface slug collisions inline before submit. create_brand remains authoritative.';
