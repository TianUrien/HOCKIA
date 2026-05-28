-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.opportunity_id — switch ON DELETE to CASCADE
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 3 hardening (2026-05-28).
--
-- The original table (migration 20260528010000) used ON DELETE SET
-- NULL on opportunity_id, anticipating that we might want to keep
-- the context row as a historical record after the opportunity was
-- deleted. The Sprint 3 audit caught the user-facing consequence:
--
--   1. Recruiter scopes their active context to opportunity X via
--      the auto-activate RPC.
--   2. Recruiter deletes opportunity X.
--   3. Trigger sets the context's opportunity_id to NULL but leaves
--      `type='opportunity'`, `target_category='Women'`, and crucially
--      `is_active=TRUE`.
--   4. ContextSwitcher renders the row's target/region fallback
--      ("Women · Madrid") with no hint it's pointing at a deleted
--      opportunity. Community keeps filtering by it indefinitely.
--
-- CASCADE is the honest behavior: the context only makes sense as
-- long as the opportunity exists. Deleting cascades to the context
-- row, which can leave the owner with zero actives — a recoverable
-- state (the ContextSwitcher's empty-state CTA invites them to set
-- a new context) and strictly better than the zombie alternative.

BEGIN;

ALTER TABLE public.recruiting_context
  DROP CONSTRAINT IF EXISTS recruiting_context_opportunity_id_fkey;

ALTER TABLE public.recruiting_context
  ADD CONSTRAINT recruiting_context_opportunity_id_fkey
  FOREIGN KEY (opportunity_id)
  REFERENCES public.opportunities(id)
  ON DELETE CASCADE;

-- Belt-and-braces: clean up any orphan rows that already exist
-- from a prior SET NULL execution. Idempotent — re-runs are no-ops.
DELETE FROM public.recruiting_context
WHERE type = 'opportunity' AND opportunity_id IS NULL;

COMMIT;
