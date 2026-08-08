-- SECURITY: hide the CONTENT of hidden profiles, not just the profile row.
--
-- Found and PROVEN during the 2026-08-08 review: the age gate correctly hides
-- a frozen minor's `profiles` row from anonymous callers, but their child
-- content was readable by anyone holding the public anon key. Using nothing
-- but that key I listed 8 gallery photos belonging to one frozen minor and 7
-- belonging to another, and fetched the image bytes.
--
-- Cause: these tables carry blanket `USING (true)` public-read policies. The
-- profile fence was applied to `profiles` and to the SECURITY DEFINER
-- functions (July's hidden-profile hardening) but never to direct table reads
-- — and the client talks to PostgREST directly with the anon key, so RLS is
-- the only control.
--
-- WHY THE FENCE IS A SECURITY DEFINER FUNCTION AND NOT AN INLINE SUBQUERY:
-- the first cut of this migration inlined `EXISTS (SELECT 1 FROM profiles …)`
-- into each policy. That breaks EVERY public read — including for visible
-- profiles — because `anon` holds no grant on `profiles`, so the policy
-- itself errors with "permission denied for table profiles". Caught on
-- staging before it reached production. The lookup must therefore run as the
-- definer, exactly like the July hidden-profile fences do.
--
-- Preserved deliberately:
--   * owners still see their own rows (auth.uid() = owner column)
--   * platform admins still see everything (moderation must not go blind)
--   * fail-closed on orphans: content whose owner row is gone is not public
--
-- NOTE on career_history: it carried TWO redundant `USING (true)` policies.
-- Permissive policies are OR'd, so fencing one and leaving the other would
-- have achieved nothing — the duplicate is dropped here. That same stacking
-- mistake is what made the storage bug (20260808100000) exploitable.
--
-- RESIDUAL RISK, deliberately not addressed here: the storage buckets are
-- public-by-design, so anyone who already holds a direct file URL can still
-- fetch the bytes. This closes DISCOVERY (the enumerable path); closing
-- direct-URL access means signed URLs for minors' media, tracked separately.

-- ── the fence helper ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.owner_profile_is_visible(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_owner_id
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  );
$$;

REVOKE ALL ON FUNCTION public.owner_profile_is_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_profile_is_visible(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.owner_profile_is_visible(uuid) IS
  'True when the owning profile exists and is neither blocked nor a frozen minor. SECURITY DEFINER because anon has no grant on profiles — an inline subquery in an RLS policy would fail with "permission denied for table profiles" and break all public reads.';

-- ── gallery_photos ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view all gallery photos" ON public.gallery_photos;
DROP POLICY IF EXISTS "Public can view gallery photos of visible profiles" ON public.gallery_photos;

CREATE POLICY "Public can view gallery photos of visible profiles"
  ON public.gallery_photos FOR SELECT
  USING (
    (SELECT auth.uid()) = user_id
    OR public.is_platform_admin()
    OR public.owner_profile_is_visible(user_id)
  );

-- ── career_history (two duplicate public policies collapsed into one) ─────
DROP POLICY IF EXISTS "Anyone can view career history" ON public.career_history;
DROP POLICY IF EXISTS "Public can view all playing history" ON public.career_history;
DROP POLICY IF EXISTS "Public can view career history of visible profiles" ON public.career_history;

CREATE POLICY "Public can view career history of visible profiles"
  ON public.career_history FOR SELECT
  USING (
    (SELECT auth.uid()) = user_id
    OR public.is_platform_admin()
    OR public.owner_profile_is_visible(user_id)
  );

-- ── club_media (owner column is club_id) ──────────────────────────────────
DROP POLICY IF EXISTS "Public can view club media" ON public.club_media;
DROP POLICY IF EXISTS "Public can view club media of visible clubs" ON public.club_media;

CREATE POLICY "Public can view club media of visible clubs"
  ON public.club_media FOR SELECT
  USING (
    (SELECT auth.uid()) = club_id
    OR public.is_platform_admin()
    OR public.owner_profile_is_visible(club_id)
  );

-- ── umpire_appointments ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view umpire appointments" ON public.umpire_appointments;
DROP POLICY IF EXISTS "Public can view umpire appointments of visible profiles" ON public.umpire_appointments;

CREATE POLICY "Public can view umpire appointments of visible profiles"
  ON public.umpire_appointments FOR SELECT
  USING (
    (SELECT auth.uid()) = user_id
    OR public.is_platform_admin()
    OR public.owner_profile_is_visible(user_id)
  );

-- Owner-column indexes keep the per-row fence lookup cheap.
CREATE INDEX IF NOT EXISTS idx_gallery_photos_user_id ON public.gallery_photos (user_id);
CREATE INDEX IF NOT EXISTS idx_career_history_user_id ON public.career_history (user_id);
