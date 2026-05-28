-- ─────────────────────────────────────────────────────────────────────
-- ai_opinion_feedback — Section F Phase 2 Slice A
-- ─────────────────────────────────────────────────────────────────────
-- Recruiter thumbs-up/down on a generated opinion + optional reason.
-- Feeds the v1.x → v1.x+1 prompt iteration loop with real-world
-- signal instead of relying on manual QA reads.
--
-- Phase 2 design notes:
--   - One feedback row per (opinion_id, viewer_id). User changing
--     their mind UPSERT-replaces the prior row (no rating history
--     kept — Phase 2 doesn't need the audit trail; Phase 3 can
--     evolve to time-series if we want trend data).
--   - viewer_id MUST match the underlying ai_opinions.viewer_id.
--     RLS enforces both that auth.uid() = viewer_id AND that the
--     viewer owns the underlying opinion. A recruiter can't rate
--     another recruiter's opinion even with a known UUID.
--   - reason is OPTIONAL. Thumbs-up rarely needs justification;
--     thumbs-down may or may not include free text. No length
--     constraint at the DB layer (constrain at the UI to ~500 chars
--     if needed — Phase 2 ships UI-side cap).
--   - Direct authenticated INSERT/UPDATE/DELETE — no edge function
--     needed for a simple two-state rating. Service role retains
--     full access for analytics RPCs in later phases.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_opinion_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opinion_id  UUID NOT NULL REFERENCES public.ai_opinions(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating      TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  reason      TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.ai_opinion_feedback IS
  'Recruiter thumbs-up/down rating on a specific ai_opinions row. One row per (opinion, viewer); UPSERT replaces. Phase 2 of Section F AI Opinion Engine.';

-- One rating per (opinion, viewer). Client UPSERTs on this triple to
-- swap up→down without insert-then-delete dance.
CREATE UNIQUE INDEX IF NOT EXISTS ai_opinion_feedback_opinion_viewer_unique
  ON public.ai_opinion_feedback (opinion_id, viewer_id);

-- Supports the analytics direction: "give me all negative feedback
-- across the prompt_version=v1.2 corpus" (joins ai_opinions on
-- opinion_id, filters by prompt_version, then by rating='down').
CREATE INDEX IF NOT EXISTS ai_opinion_feedback_rating_created_idx
  ON public.ai_opinion_feedback (rating, created_at DESC);

-- Auto-touch updated_at on rating changes.
CREATE OR REPLACE FUNCTION public.set_ai_opinion_feedback_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_opinion_feedback_updated_at_trigger
  ON public.ai_opinion_feedback;
CREATE TRIGGER ai_opinion_feedback_updated_at_trigger
  BEFORE UPDATE ON public.ai_opinion_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.set_ai_opinion_feedback_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.ai_opinion_feedback ENABLE ROW LEVEL SECURITY;

-- Read: viewer reads their own rating rows.
DROP POLICY IF EXISTS "ai_opinion_feedback_viewer_read_own" ON public.ai_opinion_feedback;
CREATE POLICY "ai_opinion_feedback_viewer_read_own"
  ON public.ai_opinion_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = viewer_id);

-- Write: viewer writes their own rating, but ONLY for opinions they
-- own. The EXISTS check on ai_opinions blocks the "guessed UUID"
-- attack even though ai_opinions RLS would already hide other
-- recruiters' opinion IDs from this viewer.
DROP POLICY IF EXISTS "ai_opinion_feedback_viewer_insert_own" ON public.ai_opinion_feedback;
CREATE POLICY "ai_opinion_feedback_viewer_insert_own"
  ON public.ai_opinion_feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = viewer_id
    AND EXISTS (
      SELECT 1 FROM public.ai_opinions o
      WHERE o.id = opinion_id AND o.viewer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_opinion_feedback_viewer_update_own" ON public.ai_opinion_feedback;
CREATE POLICY "ai_opinion_feedback_viewer_update_own"
  ON public.ai_opinion_feedback FOR UPDATE
  TO authenticated
  USING (auth.uid() = viewer_id)
  WITH CHECK (
    auth.uid() = viewer_id
    AND EXISTS (
      SELECT 1 FROM public.ai_opinions o
      WHERE o.id = opinion_id AND o.viewer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_opinion_feedback_viewer_delete_own" ON public.ai_opinion_feedback;
CREATE POLICY "ai_opinion_feedback_viewer_delete_own"
  ON public.ai_opinion_feedback FOR DELETE
  TO authenticated
  USING (auth.uid() = viewer_id);

-- Service role for future analytics RPCs (e.g. surfacing
-- prompt-version negative-feedback breakdown to admins).
DROP POLICY IF EXISTS "ai_opinion_feedback_service_role_all" ON public.ai_opinion_feedback;
CREATE POLICY "ai_opinion_feedback_service_role_all"
  ON public.ai_opinion_feedback FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── GRANTs (post-Oct-30 2026 explicit pattern) ──────────────────────
-- anon          — no access (recruiter-only feature)
-- authenticated — SELECT/INSERT/UPDATE/DELETE (own rows via RLS)
-- service_role  — ALL

REVOKE ALL ON TABLE public.ai_opinion_feedback FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.ai_opinion_feedback TO authenticated;

GRANT ALL ON TABLE public.ai_opinion_feedback TO service_role;

COMMIT;
