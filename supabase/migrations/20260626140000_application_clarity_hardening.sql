-- Application-clarity hardening — fixes from the Phases 3-5 adversarial audit.
-- Additive + idempotent. Applied to staging then prod via execute_sql (same as
-- the foundation migration); a future `db push` re-confirms it harmlessly.

-- ── #1 + #3: lock down application_views writes ──────────────────────────────
-- record_application_view was SECURITY DEFINER with NO ownership check, so any
-- authenticated user could forge a "club viewed your application" event on any
-- application UUID. And the table held the default authenticated INSERT/UPDATE
-- grant, so the same forgery was reachable via the Data API directly. Fix:
--   (a) guard the function to the owning club, and
--   (b) revoke direct write grants so ALL writes go through the guarded function.
CREATE OR REPLACE FUNCTION public.record_application_view(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only the club that owns the opportunity behind this application may record a
  -- view. Non-owners are a silent no-op (no error surface for the fire-and-forget
  -- caller, no row written).
  IF NOT EXISTS (
    SELECT 1
    FROM public.opportunity_applications oa
    JOIN public.opportunities o ON o.id = oa.opportunity_id
    WHERE oa.id = p_application_id
      AND o.club_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.application_views (application_id, viewer_id)
  VALUES (p_application_id, auth.uid())
  ON CONFLICT (application_id, viewer_id)
  DO UPDATE SET last_viewed_at = timezone('utc', now()),
                view_count = public.application_views.view_count + 1;
END;
$$;

-- No direct Data-API writes — the guarded SECURITY DEFINER function is the only
-- write path. (The applicant keeps SELECT, RLS-gated, to read who viewed them.)
REVOKE INSERT, UPDATE, DELETE ON public.application_views FROM anon, authenticated;

-- The direct-write RLS policies are now unreachable (no grant) and only checked
-- viewer_id anyway — drop them to remove the false impression of a write path.
DROP POLICY IF EXISTS "club records its own application views" ON public.application_views;
DROP POLICY IF EXISTS "club updates its own application views" ON public.application_views;

-- ── #4 + #8: give the AI cache its own column ───────────────────────────────
-- The edge fn cached its message in opportunity_applications.metadata.ai_feedback,
-- the SAME jsonb column the club rewrites for status_reason. Two full-column
-- read-modify-writes => lost updates in both directions. A dedicated column means
-- the edge fn (ai_feedback) and the club (metadata.status_reason) never touch the
-- same column again. Service-role-only; the player gets the message via the fn,
-- never by reading this column directly.
ALTER TABLE public.opportunity_applications ADD COLUMN IF NOT EXISTS ai_feedback jsonb;
