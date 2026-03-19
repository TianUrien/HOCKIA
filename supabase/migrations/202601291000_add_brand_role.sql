-- ============================================================================
-- Migration: Add 'brand' role to profiles
-- ============================================================================
-- This migration adds 'brand' as a valid role for profiles, enabling
-- equipment manufacturers, apparel companies, and service providers
-- to join the HOCKIA platform.
-- ============================================================================

SET search_path = public;

BEGIN;

-- Drop existing constraint
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Add new constraint with 'brand' role included
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('player', 'coach', 'club', 'brand'));

COMMENT ON COLUMN public.profiles.role IS 'User role: player, coach, club, or brand';

COMMIT;
