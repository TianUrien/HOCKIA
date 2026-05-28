-- ─────────────────────────────────────────────────────────────────────
-- shortlists — multi-list saved-players upgrade (P1.5)
-- ─────────────────────────────────────────────────────────────────────
-- Spec sections: C.3 (tables) + D.2 (API) + G.5/G.8 (UI).
--
-- Decision (Q3 from the v1 spec review): upgrade the existing
-- `saved_profiles` table IN PLACE rather than rename to
-- `shortlist_items`. Keeps existing FKs + the `useSavedProfiles` /
-- `useIsProfileSaved` hooks working with no client-side churn.
-- The spec's "shortlist_items" name is alias-only.
--
-- This migration:
--   1. Creates the `shortlists` table (per spec C.3).
--   2. Adds the spec's two missing columns to `saved_profiles`:
--      `shortlist_id` (FK to shortlists), `status` (4-state enum-as-
--      CHECK). The `note` column already exists.
--   3. Backfills: for every owner that already has saved_profiles
--      rows, creates a default 'Saved players' shortlist and assigns
--      all their rows to it. Idempotent — re-runs skip owners that
--      already have a default list.
--   4. Locks down: NOT NULL on shortlist_id post-backfill, plus a
--      unique (shortlist_id, saved_profile_id) constraint.
--   5. RLS owner-only on shortlists; the existing saved_profiles
--      RLS already enforces owner_id.
--
-- The default-list-per-owner pattern is enforced by a partial unique
-- index, mirroring the recruiting_context one-active-per-owner trick.
-- "Quick save" (one-click bookmark) writes to the default list.

BEGIN;

-- ── shortlists table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shortlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Saved players',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.shortlists IS
  'Recruiter-owned named lists for triaging saved players. Default list per owner is enforced by a partial unique index. Players never see these.';

-- One default list per owner. Quick-save targets this row.
CREATE UNIQUE INDEX IF NOT EXISTS shortlists_one_default_per_owner
  ON public.shortlists (owner_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS shortlists_owner_idx
  ON public.shortlists (owner_id, created_at DESC);

-- Re-use the shared updated_at trigger.
CREATE TRIGGER shortlists_set_updated_at
  BEFORE UPDATE ON public.shortlists
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── saved_profiles extensions ───────────────────────────────────────
ALTER TABLE public.saved_profiles
  ADD COLUMN IF NOT EXISTS shortlist_id UUID
    REFERENCES public.shortlists(id) ON DELETE CASCADE;

ALTER TABLE public.saved_profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unsorted'
    CHECK (status IN ('unsorted', 'good_fit', 'maybe', 'not_a_fit'));

-- ── RLS: shortlists ─────────────────────────────────────────────────
ALTER TABLE public.shortlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shortlists_owner_read" ON public.shortlists;
CREATE POLICY "shortlists_owner_read"
  ON public.shortlists FOR SELECT
  USING (auth.uid() = owner_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "shortlists_owner_insert" ON public.shortlists;
CREATE POLICY "shortlists_owner_insert"
  ON public.shortlists FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "shortlists_owner_update" ON public.shortlists;
CREATE POLICY "shortlists_owner_update"
  ON public.shortlists FOR UPDATE
  USING (auth.role() = 'service_role' OR auth.uid() = owner_id)
  WITH CHECK (auth.role() = 'service_role' OR auth.uid() = owner_id);

DROP POLICY IF EXISTS "shortlists_owner_delete" ON public.shortlists;
CREATE POLICY "shortlists_owner_delete"
  ON public.shortlists FOR DELETE
  USING (auth.role() = 'service_role' OR auth.uid() = owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shortlists TO authenticated;
GRANT ALL ON public.shortlists TO service_role;

-- ── Backfill: default list per existing owner ───────────────────────
-- For every owner that has saved_profiles but no default shortlist
-- yet, create a 'Saved players' default list. Idempotent: re-runs
-- find a default already exists and skip.
INSERT INTO public.shortlists (owner_id, name, is_default)
SELECT DISTINCT sp.owner_id, 'Saved players', TRUE
FROM public.saved_profiles sp
WHERE NOT EXISTS (
  SELECT 1 FROM public.shortlists sl
  WHERE sl.owner_id = sp.owner_id AND sl.is_default = TRUE
);

-- Point every still-unassigned saved_profiles row at its owner's
-- default list. After this the shortlist_id column is fully populated
-- and we can NOT NULL it.
UPDATE public.saved_profiles sp
SET shortlist_id = sl.id
FROM public.shortlists sl
WHERE sp.shortlist_id IS NULL
  AND sl.owner_id = sp.owner_id
  AND sl.is_default = TRUE;

-- Lock down: shortlist_id is now required.
ALTER TABLE public.saved_profiles
  ALTER COLUMN shortlist_id SET NOT NULL;

-- ── Uniqueness: a player appears at most once per shortlist ─────────
-- Spec C.3: `unique (shortlist_id, player_id)`. Our table calls it
-- saved_profile_id. The pre-existing (owner_id, saved_profile_id)
-- unique is no longer strict enough (one owner can now legitimately
-- save the same player to multiple lists in the future, even if the
-- UI doesn't expose that yet). Drop it, replace with the per-list
-- uniqueness.
ALTER TABLE public.saved_profiles
  DROP CONSTRAINT IF EXISTS saved_profiles_owner_id_saved_profile_id_key;

ALTER TABLE public.saved_profiles
  ADD CONSTRAINT saved_profiles_shortlist_player_unique
  UNIQUE (shortlist_id, saved_profile_id);

-- saved_profiles uses `created_at` (not the spec's `added_at`); same
-- semantics. Index supports "newest in this list first" ordering.
CREATE INDEX IF NOT EXISTS saved_profiles_shortlist_idx
  ON public.saved_profiles (shortlist_id, created_at DESC NULLS LAST);

COMMIT;
