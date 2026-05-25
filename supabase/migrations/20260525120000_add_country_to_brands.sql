-- Add `country_id` to brands so brands become discoverable by country.
--
-- Today's gap: the brands table has NO country column at all. The 1k-user
-- production audit found 100% of brands (10/10 on prod) invisible to every
-- country-filtered surface — search, discover, marketplace, Hockia AI. This
-- migration is the schema half of the fix; the form / RPC / display updates
-- ship in the same change set.
--
-- Three things in one migration so the rollout is atomic:
--   1. ADD COLUMN brands.country_id (FK to countries, nullable initially)
--   2. Partial index on (country_id) WHERE NOT NULL AND not deleted —
--      keeps the index tight for the common filter path
--   3. Backfill the 8 existing brands on prod by slug, with country
--      inferred from website / phone / business signal. Idempotent
--      (only updates rows where country_id IS NULL), so re-runs are
--      no-ops and staging-without-these-slugs skips cleanly.
--   4. DROP + CREATE create_brand RPC with p_country_id as a required
--      param so every NEW brand from now on lands with a country.
--
-- Why country_id stays NULLABLE: one of the existing brands ("Pain and
-- Gain Sports") has no website + no inferable country signal. Leaving
-- the column nullable keeps that row valid; the user can fill it in
-- when they next edit. Forward enforcement is at the RPC layer
-- (p_country_id is NOT NULL in the function signature).

SET search_path = public;

-- ── 1. Schema ────────────────────────────────────────────────────────────
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS country_id INTEGER REFERENCES public.countries(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.brands.country_id IS
  'Country the brand operates from. Required on NEW brands via create_brand RPC; nullable for historical brands backfilled in 20260525120000. Use this for country-filtered brand discovery — do NOT fall back to profile country (profile is the owner, brand may be elsewhere).';

-- ── 2. Index for country-filtered brand discovery ────────────────────────
CREATE INDEX IF NOT EXISTS idx_brands_country_id
  ON public.brands (country_id)
  WHERE country_id IS NOT NULL AND deleted_at IS NULL;

-- ── 3. Backfill known prod brands (idempotent, slug-scoped) ──────────────
-- Inferences from the brand's own data:
--   HOCKIA           → AR  (Tian's brand, Argentine founder)
--   QuantumWear X    → PK  (Sialkot-based manufacturer per bio)
--   MatchGear        → NL  (vankekem.com is a Dutch domain)
--   crismaloney      → US  (FootFORT.com etc. US-registered ecosystem)
--   FH College Path  → US  (US college-recruiting service)
--   US FULL RIDE     → US  (US-NCAA-focused recruiting service)
--   Ohana            → GB  (+44 phone number in bio)
--   Pain and Gain    → (left NULL — no website, no country signal)
--
-- UPDATE-by-slug is safe across environments: staging probably doesn't
-- have these slugs, so each UPDATE matches 0 rows there.

UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'AR')
  WHERE slug = 'playr' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'PK')
  WHERE slug = 'quantumwearx' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'US')
  WHERE slug = 'crismaloney' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'NL')
  WHERE slug = 'matchgear' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'US')
  WHERE slug = 'fh-college-path' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'US')
  WHERE slug = 'us-full-ride' AND country_id IS NULL;
UPDATE public.brands SET country_id = (SELECT id FROM public.countries WHERE code = 'GB')
  WHERE slug = 'ohana' AND country_id IS NULL;
-- 'pain-and-gain-sports' deliberately not backfilled — no country signal.

-- ── 4. create_brand RPC — adds p_country_id as required ──────────────────
-- DROP + CREATE because Postgres CREATE OR REPLACE FUNCTION cannot change
-- the argument list. New required param `p_country_id` goes in position 4
-- (after the other required params name/slug/category, before the optional
-- block). Old callers that don't pass it will get "required argument not
-- supplied" — exactly the forward-enforcement we want.
DROP FUNCTION IF EXISTS public.create_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_brand(
  p_name TEXT,
  p_slug TEXT,
  p_category TEXT,
  p_country_id INTEGER,
  p_bio TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_instagram_url TEXT DEFAULT NULL,
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

  -- Validate country_id — required + must exist in countries table.
  -- Without this guard, a client could submit an arbitrary integer and
  -- land a row that breaks every join through countries.
  IF p_country_id IS NULL THEN
    RAISE EXCEPTION 'Country is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.countries WHERE id = p_country_id) THEN
    RAISE EXCEPTION 'Invalid country_id: %', p_country_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.brands (
    profile_id,
    name,
    slug,
    category,
    country_id,
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
    p_country_id,
    nullif(trim(p_bio), ''),
    nullif(trim(p_logo_url), ''),
    nullif(trim(p_website_url), ''),
    nullif(trim(p_instagram_url), '')
  )
  RETURNING id INTO v_brand_id;

  -- Atomic profile sync — identity (full_name + avatar_url) AND
  -- onboarding_completed flip together. COALESCE keeps existing values
  -- when the new params are NULL.
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

GRANT EXECUTE ON FUNCTION public.create_brand(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.create_brand(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  '2026-05-25: adds required p_country_id so every new brand is discoverable by country. Replaces the previous 9-arg signature; old callers will error with "required argument not supplied" until they pass country.';

-- ── 5. get_brand_by_slug — surface country_id to the frontend ────────────
-- Without this, BrandProfilePage can never display the country flag /
-- "Based in X" because the field isn't projected. Same body as migration
-- 20260521210000 (test-account gate preserved) + new country_id field.
CREATE OR REPLACE FUNCTION public.get_brand_by_slug(p_slug text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT row_to_json(b)
    FROM (
      SELECT
        br.id,
        br.profile_id,
        br.slug,
        br.name,
        br.logo_url,
        br.bio,
        br.website_url,
        br.instagram_url,
        br.category,
        br.country_id,
        COALESCE(p.is_verified, false) AS is_verified,
        br.created_at,
        br.updated_at,
        p.nationality_country_id,
        p.nationality
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.slug = p_slug
        AND br.deleted_at IS NULL
        AND (is_staging_env() OR COALESCE(p.is_test_account, false) = false)
    ) b
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
