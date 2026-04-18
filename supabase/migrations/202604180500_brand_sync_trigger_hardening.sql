-- Harden the brand → profile identity sync trigger and lock down brand text columns.
--
-- Three linked fixes (audit bugs N3 + M1 + M2):
--
-- 1. The sync trigger had no `deleted_at IS NOT NULL` guard, so an admin editing
--    a soft-deleted brand's name would still overwrite the user's
--    profiles.full_name. Bail early when the row is soft-deleted.
--
-- 2. The trigger used `COALESCE(NEW.logo_url, avatar_url)`, meaning a brand
--    that removed its logo (logo_url → NULL) would still leave the old avatar
--    on the profile — the user appears across the app with a logo they've
--    removed. Switch to a direct assignment so the profile tracks the brand's
--    real current state.
--
-- 3. `brands.name` was NOT NULL but had no empty-string guard, and `brands.slug`
--    had no reserved-word guard. Direct PATCHes under the existing UPDATE RLS
--    could set name = '' (wiping the user's display name via the trigger) or
--    create slugs that collide with frontend routes like /brands/onboarding.
--    Add CHECK constraints for both.

SET search_path = public;

-- ============================================================================
-- 1. Sync trigger: skip soft-deleted, clear avatar when logo is unset,
--    ignore empty names defensively.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_brand_identity_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Don't propagate identity from a soft-deleted brand.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
  SET
    -- Keep the existing full_name if the new name is empty/whitespace.
    full_name = COALESCE(NULLIF(TRIM(NEW.name), ''), full_name),
    -- Direct assignment so a logo removal propagates to the profile avatar.
    avatar_url = NEW.logo_url
  WHERE id = NEW.profile_id;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Name + slug CHECK constraints (NOT VALID to avoid retroactive failure;
--    all current prod rows pass).
-- ============================================================================

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brand_name_not_empty;
ALTER TABLE public.brands
  ADD CONSTRAINT brand_name_not_empty
  CHECK (length(trim(name)) > 0)
  NOT VALID;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brand_slug_not_reserved;
ALTER TABLE public.brands
  ADD CONSTRAINT brand_slug_not_reserved
  CHECK (
    slug NOT IN (
      'onboarding', 'new', 'edit', 'admin', 'settings', 'api',
      'null', 'undefined', 'brand', 'brands'
    )
  )
  NOT VALID;

NOTIFY pgrst, 'reload schema';
