-- ============================================================================
-- Migration: Create brands table
-- ============================================================================
-- Brands represent equipment manufacturers, apparel companies, and service
-- providers in the hockey ecosystem. Each brand has a 1:1 relationship with
-- a profile that has role = 'brand'.
-- ============================================================================

SET search_path = public;

BEGIN;

-- ============================================================================
-- Create brands table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Identity
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  cover_url TEXT,

  -- Details
  bio TEXT,
  website_url TEXT,
  instagram_url TEXT,
  category TEXT NOT NULL DEFAULT 'other',

  -- Metadata
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_category CHECK (category IN (
    'equipment', 'apparel', 'accessories',
    'nutrition', 'services', 'technology', 'other'
  )),
  CONSTRAINT valid_slug CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brands_slug ON public.brands(slug);
CREATE INDEX IF NOT EXISTS idx_brands_category ON public.brands(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brands_profile_id ON public.brands(profile_id);
CREATE INDEX IF NOT EXISTS idx_brands_created_at ON public.brands(created_at DESC) WHERE deleted_at IS NULL;

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.set_brands_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_brands_updated_at ON public.brands;
CREATE TRIGGER set_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.set_brands_updated_at();

COMMENT ON TABLE public.brands IS 'Brand profiles for equipment manufacturers, apparel companies, and service providers';
COMMENT ON COLUMN public.brands.profile_id IS 'Reference to the profile with role=brand (1:1 relationship)';
COMMENT ON COLUMN public.brands.slug IS 'URL-friendly unique identifier for the brand';
COMMENT ON COLUMN public.brands.category IS 'Brand category: equipment, apparel, accessories, nutrition, services, technology, or other';
COMMENT ON COLUMN public.brands.is_verified IS 'Whether the brand has been verified by HOCKIA staff (manual process)';

COMMIT;
