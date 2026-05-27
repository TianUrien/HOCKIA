-- Phase 1 of Career Snapshot + Shortlist initiative (2026-05-27).
--
-- Adds a private "save this player for later" capability so clubs and
-- coaches can collect interesting candidates from any discovery surface
-- (Community, Hockia AI, Applicants) WITHOUT having to message them.
-- Mirrors the pattern users already understand from the applicants
-- pipeline, but lives outside any specific opportunity.
--
-- Scope is deliberately minimal for slice 1:
--   - single bucket per owner (no named lists yet)
--   - optional free-text note
--   - strict per-owner privacy (saved players never see they were saved)
--
-- Named lists (profile_shortlists) come in slice 2 once we see usage
-- patterns. Schema is forward-compatible — a `shortlist_id` column can
-- be added later without rewriting reads.
--
-- RLS:
--   - SELECT / INSERT / UPDATE / DELETE — owner-only.
--   - service_role bypasses everything (admin tooling).
--   - saved_profile_id never gets a "you were saved" surface; reads
--     are gated on owner_id only, so the saved player never sees these
--     rows via RLS-scoped queries.

SET search_path = public;

CREATE TABLE IF NOT EXISTS public.saved_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  saved_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT saved_profiles_no_self CHECK (owner_id <> saved_profile_id),
  CONSTRAINT saved_profiles_unique_pair UNIQUE (owner_id, saved_profile_id)
);

COMMENT ON TABLE public.saved_profiles IS
  'Private bookmark: owner_id has saved saved_profile_id for later review. Owner-only visibility.';

CREATE INDEX IF NOT EXISTS saved_profiles_owner_idx
  ON public.saved_profiles (owner_id, created_at DESC);

-- Reverse-lookup index — kept for future admin/analytics needs (e.g.
-- "how many clubs have saved this player"). NOT exposed to clients.
CREATE INDEX IF NOT EXISTS saved_profiles_saved_idx
  ON public.saved_profiles (saved_profile_id);

CREATE TRIGGER saved_profiles_set_updated_at
  BEFORE UPDATE ON public.saved_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.saved_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_profiles_owner_read" ON public.saved_profiles;
CREATE POLICY "saved_profiles_owner_read"
  ON public.saved_profiles
  FOR SELECT
  USING (
    auth.uid() = owner_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "saved_profiles_owner_insert" ON public.saved_profiles;
CREATE POLICY "saved_profiles_owner_insert"
  ON public.saved_profiles
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() = owner_id
      AND auth.uid() <> saved_profile_id
    )
  );

DROP POLICY IF EXISTS "saved_profiles_owner_update" ON public.saved_profiles;
CREATE POLICY "saved_profiles_owner_update"
  ON public.saved_profiles
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR auth.uid() = owner_id
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR auth.uid() = owner_id
  );

DROP POLICY IF EXISTS "saved_profiles_owner_delete" ON public.saved_profiles;
CREATE POLICY "saved_profiles_owner_delete"
  ON public.saved_profiles
  FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR auth.uid() = owner_id
  );

-- Required GRANTs (Supabase Data API requires explicit GRANTs on
-- public tables from Oct 30, 2026 — applies to both projects).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_profiles TO authenticated;
GRANT ALL ON public.saved_profiles TO service_role;
